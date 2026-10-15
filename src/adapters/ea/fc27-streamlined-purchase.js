import { createFc27PuzzleBuyAdapter } from './fc27-puzzle-buy.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, projectFc27StreamlinedItem, assertFc27StreamlinedPolicy } from './fc27-streamlined-read.js';
import { readFc27Context } from './fc27-local-read.js';
import { createStreamlinedPlan } from '../../streamlined/plan.js';
import { createStreamlinedTransaction } from '../../streamlined/transaction.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { galleryReferenceQuote, purchasePriceCap } from '../../gallery/public-price-policy.js';
import { approvedStreamlinedPurchaseRoute } from '../../streamlined/purchase-scope.js';

// Streamlined market execution is isolated from Gallery/Puzzle records. It
// reuses the reviewed native search/bid/move adapter and sends contribution
// only through the existing One Click validator supplied by the caller.
export async function createFc27StreamlinedPurchaseAdapter(root, { plan, persistence, canWrite, searchAttempts = 5, now = () => Date.now(),
  contributionAdapter = null, createBuyer = createFc27PuzzleBuyAdapter, createClubRead = createFc27ClubReadTransport,
  prices = null, onEvent = () => {} } = {}) {
  if (!plan?.route?.groups?.some(group => group.source === 'market')) fail('PURCHASE_ROUTE_UNVERIFIED');
  const origin = readFc27Context(root), marketItems = approvedStreamlinedPurchaseRoute(plan).groups.flatMap(group => group.source === 'market' ? group.items : []);
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
    excludeOffer: (offer, record) => record?.entries?.some(entry => ['rejected', 'consumed'].includes(entry.state)
      && entry.definitionId === offer.definitionId && entry.itemId === offer.itemId && entry.tradeId === offer.tradeId) === true,
    onEvent,
    verifyCurrent: () => assertTarget(), verifySquad: async () => assertTarget(),
  });
  const createOwnedReader = async onEntity => {
    const contradictoryIds = new Set(), evolutionIds = new Set();
    const reader = await createClubRead(root, { nativeReauth: true, onEntity: entity => {
      // The shared snapshot collapses ANY and explicit non-Club piles to null.
      // Retain the local raw distinction without changing that shared contract.
      const descriptor = Object.getOwnPropertyDescriptor(entity, 'utasPile'), pile = descriptor?.value;
      const any = root.ItemPile?.ANY, club = root.ItemPile?.CLUB, evolution = root.ItemPile?.EVOLUTION;
      // EA's native pile getter maps EVOLUTION to CLUB. Count ownership, but
      // never turn that protected entity into purchased contribution material.
      if (Number.isSafeInteger(evolution) && pile === evolution) evolutionIds.add(entity.id);
      else if ((descriptor && !('value' in descriptor)) || (pile != null && pile !== club
          && !(Number.isSafeInteger(any) && pile === any))) contradictoryIds.add(entity.id);
      onEntity?.(entity);
    } });
    return { reader, contradictoryIds, evolutionIds };
  };
  const readOwnedClub = async (definitionIds, { itemId = null, onEntity = null, owned = null, onProgress = () => {}, stopped = () => false } = {}) => {
    // Provenance is the owned, authenticated /club request and exact entity
    // identity. EA's factory uses ItemPile.ANY when this DTO omits pile; that
    // is not absence of ownership. This never grants permission to consume a
    // stock copy, and explicit contradictory piles remain blocked.
    const { reader, contradictoryIds, evolutionIds } = owned ?? await createOwnedReader(onEntity);
    const seen = new Set(), matched = [];
    for (let offset = 0; offset <= 20000; offset += 250) {
      if (stopped()) fail('STOPPED');
      assertTarget(); onProgress({ phase: 'checking-holdings', offset });
      if (stopped()) fail('STOPPED');
      const rows = await reader.readPage({ start: offset, count: 250, definitionIds });
      assertTarget();
      if (stopped()) fail('STOPPED');
      const invalid = !Array.isArray(rows) || rows.length > 250 || rows.some(row => !integer(row?.id, 1)
        || !integer(row.definitionId, 1) || !['club', null].includes(row.pile) || contradictoryIds.has(row.id));
      const duplicate = !invalid && rows.some(row => {
        if (seen.has(row.id)) return true;
        seen.add(row.id); return false;
      });
      const current = invalid ? [] : rows.filter(row => definitionIds.includes(row.definitionId));
      try { onEvent({ stage: 'holdings-read', offset, requestedCount: definitionIds.length,
        responseCount: Array.isArray(rows) ? rows.length : 0, acceptedCount: current.length,
        foreignCount: invalid ? 0 : rows.length - current.length,
        unknownCount: invalid ? 0 : current.filter(row => row.pile === null).length,
        reason: invalid || duplicate ? 'FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED' : undefined }); } catch { /* diagnostic only */ }
      if (invalid || duplicate) fail('PURCHASE_HOLDINGS_UNVERIFIED');
      if (itemId !== null && evolutionIds.has(itemId)) fail('PURCHASE_MATERIAL_UNKNOWN');
      matched.push(...current.filter(row => itemId === null || row.id === itemId));
      if ((itemId !== null && matched.length) || (itemId === null && definitionIds.every(id => matched.some(row => row.definitionId === id)))) return matched;
      // An expanded family or ignored filter is not a negative lookup. Only a
      // complete, bounded read can establish that a requested version is absent.
      if (rows.length < 250) return matched;
    }
    fail('PURCHASE_HOLDINGS_UNVERIFIED');
  };
  const materialize = async (entries, currentRecord) => {
    assertFc27StreamlinedPolicy(root, plan.policy, entries.map(entry => ({ id: entry.itemId, source: 'inventory' })));
    const output = [];
    for (const entry of entries) {
      const group = currentRecord.route.groups[entry.groupIndex];
      if (entry.source === 'inventory') {
        const item = group?.items.find(row => row.id === entry.itemId && row.definitionId === entry.definitionId);
        if (!item) fail('PURCHASE_MATERIAL_UNKNOWN');
        output.push({ groupIndex: entry.groupIndex, item }); continue;
      }
      const entities = new Map();
      const rows = await readOwnedClub([entry.definitionId], { itemId: entry.itemId,
        onEntity: entity => { if (entity.id === entry.itemId) entities.set(entity.id, entity); } });
      const raw = rows.find(item => item.id === entry.itemId && item.definitionId === entry.definitionId);
      if (!raw) fail('PURCHASE_MATERIAL_UNKNOWN');
      const entity = entities.get(entry.itemId);
      if (!entity || entity.id !== raw.id || entity.definitionId !== raw.definitionId) fail('PURCHASE_MATERIAL_UNKNOWN');
      const projected = projectFc27StreamlinedItem(entity, root, 'club');
      output.push({ groupIndex: entry.groupIndex, item: { ...projected, purchaseReceipt: { operationId: currentRecord.operationId,
        itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId, price: entry.price } } });
    }
    return output;
  };
  const contributionDiagnostic = row => onEvent({ ...row, stage: `contribution-${row.phase}` });
  const contribute = async (batchPlan, callbacks = {}) => {
    if (!contributionAdapter?.adapter || !contributionAdapter?.journal) fail('WRITE_CONTRACT_UNVERIFIED');
    const result = await createStreamlinedTransaction({ adapter: contributionAdapter.adapter, journal: contributionAdapter.journal,
      lock: { acquire: async () => () => {} }, now, onDiagnostic: contributionDiagnostic }).execute(batchPlan,
      { approved: true, fingerprint: batchPlan.fingerprint, batchIndices: [0], allowPartial: true }, callbacks);
    return result.status === 'completed' || result.status === 'partial' ? { confirmed: true, submittedScore: result.record.submittedScore }
      : { confirmed: false, reason: result.reason, ...(result.confirmation ? { confirmation: result.confirmation } : {}) };
  };
  return Object.freeze({
    async assertCurrent(currentRecord) { assertTarget(); await buyer.verifySquad(currentRecord); },
    async readState(currentRecord, { onProgress = () => {}, stopped = () => false } = {}) {
      assertTarget(); const page = locateFc27StreamlinedPage(root), challenge = projectFc27StreamlinedChallenge(page, origin);
      const purchased = root.repositories?.Item?.numItemsInCache?.(root.ItemPile.PURCHASED);
      if (!Number.isSafeInteger(purchased) || purchased < 0) throw new Error('FC27_BUY_CAPACITY_UNVERIFIED');
      const capacity = Number.isSafeInteger(root.MAX_NEW_ITEMS) && root.MAX_NEW_ITEMS >= purchased
        ? root.MAX_NEW_ITEMS : null;
      if (capacity === null) throw new Error('FC27_BUY_CAPACITY_UNVERIFIED');
      const heldDefinitions = [];
      if (plan.execution?.purchaseScope) {
        // Club caches are partial and may retain consumed entities. Verify only
        // the approved pool through the existing owned native read transport;
        // a held copy is a blocker, never authorization to consume that copy.
        const ids = [...new Set(marketItems.map(item => item.definitionId))];
        const owned = await createOwnedReader();
        for (let start = 0; start < ids.length; start += 50) {
          const batch = ids.slice(start, start + 50);
          const rows = await readOwnedClub(batch, { owned, stopped, onProgress: row => onProgress({ ...row,
            holdingsBatch: start / 50 + 1, holdingsBatchTotal: Math.ceil(ids.length / 50), requestedCount: ids.length }) });
          heldDefinitions.push(...rows.map(row => row.definitionId));
        }
      } else {
        const clubItems = root.repositories?.Item?.club?.items?._collection ?? {};
        for (const value of Object.values(clubItems)) {
          const definitionId = value?.definitionId ?? value?.resourceId;
          if (Number.isSafeInteger(definitionId) && definitionId > 0) heldDefinitions.push(definitionId);
        }
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
    async contribute(batchPlan, callbacks) { return contribute(batchPlan, callbacks); },
    async recoverContribution(saved) {
      assertTarget();
      const previous = await contributionAdapter.journal.read(origin);
      if (!previous || previous.plan.fingerprint !== saved.batchPlan.fingerprint
          && previous.batches.every(batch => ['confirmed', 'rejected'].includes(batch.state))) return { notDispatched: true };
      if (previous.plan.fingerprint !== saved.batchPlan.fingerprint) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
      if (previous.batches.every(batch => ['waiting', 'rejected'].includes(batch.state))) return { notDispatched: true };
      const result = await createStreamlinedTransaction({ adapter: contributionAdapter.adapter, journal: contributionAdapter.journal,
        lock: { acquire: async () => () => {} }, now, onDiagnostic: contributionDiagnostic }).recover(origin, { setId: plan.challenge.setId, challengeId: plan.challenge.id });
      if (result.status === 'recovered' || result.status === 'observed') {
        const score = result.record?.submittedScore;
        if (integer(score, saved.batchPlan.challenge.submittedScore + 1)) return { confirmed: true, submittedScore: score };
      }
      return { confirmed: false, reason: result.reason ?? 'FC27_STREAMLINED_CONTRIBUTION_RECOVERY_REQUIRED',
        ...(result.confirmation ? { confirmation: result.confirmation } : {}) };
    },
    async waitForPartial(ms, stopped) { for (let left = ms; left > 0 && !stopped(); left -= 250) await new Promise(resolve => setTimeout(resolve, Math.min(250, left))); },
    cancel() { buyer.cancel?.(); },
  });
}
