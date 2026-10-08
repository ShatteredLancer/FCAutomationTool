import { createFc27PuzzleBuyAdapter } from './fc27-puzzle-buy.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, projectFc27StreamlinedItem } from './fc27-streamlined-read.js';
import { readFc27Context } from './fc27-local-read.js';
import { createStreamlinedPlan } from '../../streamlined/plan.js';
import { createStreamlinedTransaction } from '../../streamlined/transaction.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { galleryReferenceQuote, purchasePriceCap } from '../../gallery/public-price-policy.js';

// Streamlined market execution is isolated from Gallery/Puzzle records. It
// reuses the reviewed native search/bid/move adapter and sends contribution
// only through the existing One Click validator supplied by the caller.
export async function createFc27StreamlinedPurchaseAdapter(root, { plan, persistence, canWrite, searchAttempts = 5, now = () => Date.now(),
  contributionAdapter = null, createBuyer = createFc27PuzzleBuyAdapter, prices = null } = {}) {
  if (!plan?.route?.groups?.some(group => group.source === 'market')) fail('PURCHASE_ROUTE_UNVERIFIED');
  const origin = readFc27Context(root), marketItems = plan.route.groups.flatMap(group => group.source === 'market' ? group.items : []);
  const players = new Map(marketItems.map(item => [item.definitionId, { _rating: item.rating, nationId: item.nationId,
    teamId: item.teamId, leagueId: item.leagueId, preferredPosition: item.preferredPosition }]));
  const references = new Map(marketItems.map(item => [item.definitionId, item.price]));
  const assertTarget = () => {
    if (!same(origin, readFc27Context(root))) fail('CONTEXT_CHANGED');
    const page = locateFc27StreamlinedPage(root);
    if (!page || page.setId !== plan.challenge.setId || page.challengeId !== plan.challenge.id) fail('CONTEXT_CHANGED');
    const current = projectFc27StreamlinedChallenge(page, origin);
    for (const key of ['targetScore', 'selectionLimit', 'eligibility', 'eligibilityOperation', 'repeats', 'repeatabilityMode', 'endTime']) {
      if (!same(current[key], plan.challenge[key])) fail('CONTEXT_CHANGED');
    }
  };
  const buyer = await createBuyer(root, {
    canWrite: () => canWrite() === true && persistence.inspect().active === true,
    assertTarget, attempts: searchAttempts, playerDetails: players,
    referencePrice: ({ definitionId }) => references.get(definitionId),
    verifyCurrent: () => assertTarget(), verifySquad: async () => assertTarget(),
  });
  const materialize = async (entries, currentRecord) => {
    const output = [];
    for (const entry of entries) {
      const group = currentRecord.route.groups[entry.groupIndex];
      if (entry.source === 'inventory') {
        const item = group?.items.find(row => row.id === entry.itemId && row.definitionId === entry.definitionId);
        if (!item) fail('PURCHASE_MATERIAL_UNKNOWN');
        output.push({ groupIndex: entry.groupIndex, item }); continue;
      }
      const entities = new Map();
      const transport = await createFc27ClubReadTransport(root, { nativeReauth: true,
        onEntity: entity => entities.set(entity.id, entity) });
      const rows = await transport.readPage({ start: 0, count: 250, definitionIds: [entry.definitionId] });
      const raw = rows.find(item => item.id === entry.itemId && item.definitionId === entry.definitionId && item.pile === 'club');
      if (!raw) fail('PURCHASE_MATERIAL_UNKNOWN');
      const entity = entities.get(entry.itemId);
      if (!entity || entity.id !== raw.id || entity.definitionId !== raw.definitionId) fail('PURCHASE_MATERIAL_UNKNOWN');
      const projected = projectFc27StreamlinedItem(entity, root, 'club');
      output.push({ groupIndex: entry.groupIndex, item: { ...projected, purchaseReceipt: { operationId: currentRecord.operationId,
        itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId, price: entry.price } } });
    }
    return output;
  };
  const contribute = async (batchPlan) => {
    if (!contributionAdapter?.adapter || !contributionAdapter?.journal) fail('WRITE_CONTRACT_UNVERIFIED');
    const result = await createStreamlinedTransaction({ adapter: contributionAdapter.adapter, journal: contributionAdapter.journal,
      lock: { acquire: async () => () => {} }, now }).execute(batchPlan,
      { approved: true, fingerprint: batchPlan.fingerprint, batchIndices: [0], allowPartial: true });
    return result.status === 'completed' || result.status === 'partial' ? { confirmed: true, submittedScore: result.record.submittedScore }
      : { confirmed: false, reason: result.reason };
  };
  return Object.freeze({
    async assertCurrent(currentRecord) { assertTarget(); await buyer.verifySquad(currentRecord); },
    async readState(currentRecord) {
      assertTarget(); const page = locateFc27StreamlinedPage(root), challenge = projectFc27StreamlinedChallenge(page, origin);
      const purchased = root.repositories?.Item?.numItemsInCache?.(root.ItemPile.PURCHASED);
      if (!Number.isSafeInteger(purchased) || purchased < 0) throw new Error('FC27_BUY_CAPACITY_UNVERIFIED');
      const capacity = Number.isSafeInteger(root.MAX_NEW_ITEMS) && root.MAX_NEW_ITEMS >= purchased
        ? root.MAX_NEW_ITEMS : null;
      if (capacity === null) throw new Error('FC27_BUY_CAPACITY_UNVERIFIED');
      const heldDefinitions = [];
      const clubItems = root.repositories?.Item?.club?.items?._collection ?? {};
      for (const value of Object.values(clubItems)) {
        const definitionId = value?.definitionId ?? value?.resourceId;
        if (Number.isSafeInteger(definitionId) && definitionId > 0) heldDefinitions.push(definitionId);
      }
      return { submittedScore: challenge.submittedScore, freeSlots: Math.max(0, capacity - purchased),
        heldDefinitions: [...new Set(heldDefinitions)], blockedDefinitions: [] };
    },
    async find(item, cap) {
      assertTarget();
      if (plan.challenge.endTime > 0 && plan.challenge.endTime * 1000 <= now()) fail('CHALLENGE_EXPIRED');
      let quote = item.quote;
      if (prices) {
        const snapshot = await prices.load([item.definitionId], { purpose: 'purchase', policy: item.pricePolicy, rows: [item],
          isCurrent: () => { assertTarget(); return true; } });
        assertTarget(); quote = snapshot.references[item.definitionId]?.quotes?.[item.pricePolicy.source];
      }
      if (!integer(quote?.expiresAt) || quote.expiresAt <= now()) fail('PURCHASE_QUOTE_EXPIRED');
      if (quote?.definitionId !== item.definitionId || quote.error || !integer(quote.price, 150, 15000000)
          || !integer(quote.fetchedAt) || quote.fetchedAt > now()) fail('PURCHASE_PRICE_UNVERIFIED');
      const authority = item.pricePolicy ? galleryReferenceQuote({ [quote.source]: quote.price }, item.pricePolicy) : { maxBuy: cap };
      cap = purchasePriceCap({ maxBuy: authority.maxBuy, approvedCap: cap, priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS });
      if (cap === null) return { unavailable: true, reason: 'FC27_STREAMLINED_PURCHASE_PRICE_UNVERIFIED' };
      references.set(item.definitionId, quote.price);
      return buyer.find(item.definitionId, cap);
    },
    async buy(entry) { return buyer.buy(entry); }, async locate(entry) { return buyer.locate(entry); },
    async move(entry) { return buyer.move(entry); }, async afterPlayer() { return buyer.afterPlayer?.(); }, materialize,
    async prepareContribution(material, currentRecord) {
      const page = locateFc27StreamlinedPage(root), challenge = projectFc27StreamlinedChallenge(page, origin);
      const items = material.map(row => row.item), score = items.reduce((sum, item) => sum + item.points, 0);
      const progress = { target: challenge.targetScore, submitted: currentRecord.submittedScore, added: score,
        total: currentRecord.submittedScore + score, remaining: Math.max(0, challenge.targetScore - currentRecord.submittedScore - score),
        excess: Math.max(0, currentRecord.submittedScore + score - challenge.targetScore), reached: currentRecord.submittedScore + score >= challenge.targetScore };
      return createStreamlinedPlan({ context: origin, challenge: { ...challenge, submittedScore: currentRecord.submittedScore,
        remainingScore: Math.max(0, challenge.targetScore - currentRecord.submittedScore) }, policy: plan.policy,
        result: { status: progress.reached ? 'ready' : 'partial', items, batches: [items], score, progress,
          purchaseCost: 0, materialValue: items.every(item => integer(item.price, 1, 15000000))
            ? items.reduce((sum, item) => sum + item.price, 0) : null, searchComplete: true } });
    },
    async contribute(batchPlan) { return contribute(batchPlan); },
    async recoverContribution(saved) {
      assertTarget();
      const previous = await contributionAdapter.journal.read(origin);
      if (!previous || previous.plan.fingerprint !== saved.batchPlan.fingerprint
          && previous.batches.every(batch => ['confirmed', 'rejected'].includes(batch.state))) return { notDispatched: true };
      if (previous.plan.fingerprint !== saved.batchPlan.fingerprint) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
      if (previous.batches.every(batch => ['waiting', 'rejected'].includes(batch.state))) return { notDispatched: true };
      const result = await createStreamlinedTransaction({ adapter: contributionAdapter.adapter, journal: contributionAdapter.journal,
        lock: { acquire: async () => () => {} }, now }).recover(origin, { setId: plan.challenge.setId, challengeId: plan.challenge.id });
      if (result.status === 'recovered' || result.status === 'observed') {
        const score = result.record?.submittedScore;
        if (integer(score, saved.batchPlan.challenge.submittedScore + 1)) return { confirmed: true, submittedScore: score };
      }
      return { confirmed: false, reason: result.reason ?? 'FC27_STREAMLINED_CONTRIBUTION_RECOVERY_REQUIRED' };
    },
    async waitForPartial(ms, stopped) { for (let left = ms; left > 0 && !stopped(); left -= 250) await new Promise(resolve => setTimeout(resolve, Math.min(250, left))); },
    cancel() { buyer.cancel?.(); },
  });
}
