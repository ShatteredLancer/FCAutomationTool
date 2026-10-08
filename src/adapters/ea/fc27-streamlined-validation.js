import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { createFc27StreamlinedStorageReader } from './fc27-streamlined-storage-read.js';
import { readFc27Context } from './fc27-local-read.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, readFc27StreamlinedPolicy,
  projectFc27StreamlinedItem, createFc27StreamlinedMatcher } from './fc27-streamlined-read.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';
import { assertStreamlinedPlan } from '../../streamlined/plan.js';
import { integer, same, fail } from '../../streamlined/contract.js';

// Fresh, selected-material read only. No shared cache updates or contribution.
export function createFc27StreamlinedValidator(root, { now = () => Date.now(),
  createTransport = createFc27ClubReadTransport, createStorage = createFc27StreamlinedStorageReader,
  readProgress = null, nativeReauth = false, purchaseVerifier = null } = {}) {
  let busy = false;
  return Object.freeze({ async verify(plan, batch, submittedScore, { onProgress = () => {}, stopped = () => false } = {}) {
    if (busy) fail('BUSY');
    busy = true;
    try {
      assertStreamlinedPlan(plan);
      const expected = plan.batches[batch?.index]?.map(item => ({ id: item.id, definitionId: item.definitionId, points: item.points, pile: item.pile }));
      if (!expected || !same(expected, batch.refs) || !integer(submittedScore, plan.challenge.submittedScore, plan.challenge.targetScore - 1)) fail('PLAN_CHANGED');
      const page = locateFc27StreamlinedPage(root);
      const expectedChallenge = { ...plan.challenge, submittedScore,
        remainingScore: Math.max(0, plan.challenge.targetScore - submittedScore) };
      // Owned DAO writes do not mutate the page cache. A provider can supply
      // a fresh progress reader for later batches; stale page score alone can
      // neither grant nor veto that next batch. All other page facts stay bound.
      const pageChallenge = page && projectFc27StreamlinedChallenge(page, plan.context);
      let fresh = null;
      if (typeof readProgress === 'function') {
        fresh = await readProgress(plan.challenge);
        if (fresh?.fresh !== true || !integer(fresh.observedAt) || fresh.observedAt > now()
            || now() - fresh.observedAt > 15000 || !same(fresh.challenge, expectedChallenge)) fail('PROGRESS_CHANGED');
        if (!same(pageChallenge, { ...expectedChallenge, submittedScore: pageChallenge.submittedScore,
          remainingScore: pageChallenge.remainingScore })) fail('PROGRESS_CHANGED');
      }
      const check = () => {
        if (stopped()) fail('CANCELLED');
        const current = locateFc27StreamlinedPage(root);
        if (!current || current.controller !== page?.controller || !same(readFc27Context(root), plan.context)) fail('CONTEXT_CHANGED');
        const challenge = projectFc27StreamlinedChallenge(current, plan.context);
        if (!same(challenge, fresh ? pageChallenge : expectedChallenge)
            || fresh && now() - fresh.observedAt > 15000) fail('PROGRESS_CHANGED');
        if (challenge.endTime > 0 && challenge.endTime * 1000 <= now()) fail('CHALLENGE_EXPIRED');
        if (!same(readFc27StreamlinedPolicy(root, plan.policy.maxRating, plan.policy.marketMaxRating), plan.policy)) fail('POLICY_CHANGED');
      };
      check();
      const entities = new Map();
      const onEntity = entity => {
        if (entities.has(entity.id)) fail('IDENTITY_CONFLICT');
        entities.set(entity.id, entity);
      };
      const clubRefs = batch.refs.filter(ref => ref.pile === 'club');
      const transport = clubRefs.length ? await createTransport(root, { nativeReauth, onEntity }) : null;
      const ids = [...new Set(clubRefs.map(ref => ref.definitionId))];
      let requests = 0;
      for (let offset = 0; offset < ids.length; offset += 50) {
        const definitionIds = ids.slice(offset, offset + 50);
        for (let start = 0; ; start += 250) {
          check();
          if (start >= 20000) fail('INVENTORY_LIMIT');
          const rows = await transport.readPage({ start, count: 250, definitionIds });
          check();
          if (!Array.isArray(rows) || rows.length > 250) fail('FRESH_ENTITY_UNVERIFIED');
          // EA may return another version alongside requested definitions.
          // Validate its identity, but never use it as a selected entity.
          if (rows.some(row => !row || !integer(row.id, 1) || !integer(row.definitionId, 1)
              || batch.refs.some(ref => ref.id === row.id && ref.definitionId !== row.definitionId)
              || row.pile !== 'club' || entities.get(row.id)?.definitionId !== row.definitionId)) {
            const error = Error('FC27_STREAMLINED_FRESH_ENTITY_UNVERIFIED');
            error.evidence = { phase: 'selected-club-read', rows: rows.length,
              unexpectedVersion: rows.filter(row => !definitionIds.includes(row?.definitionId)).length,
              wrongPile: rows.filter(row => row?.pile !== 'club').length,
              factoryMismatch: rows.filter(row => entities.get(row?.id)?.definitionId !== row?.definitionId).length };
            throw error;
          }
          // All selected entities in this query found: no full-club scan needed.
          const selected = clubRefs.filter(ref => definitionIds.includes(ref.definitionId));
          if (selected.every(ref => entities.get(ref.id)?.definitionId === ref.definitionId)) break;
          if (rows.length < 250) fail('MATERIAL_MISSING');
        }
        try { onProgress({ phase: 'validation', completed: Math.min(offset + 50, ids.length), total: ids.length }); } catch { /* UI only. */ }
      }
      requests += transport?.getRequestCount() ?? 0;
      const storageRefs = batch.refs.filter(ref => ref.pile === 'storage');
      if (storageRefs.length) {
        check();
        const storage = await createStorage(root, { nativeReauth, onEntity });
        check();
        const rows = await storage.read();
        check();
        if (!Array.isArray(rows) || rows.length > 20000 || new Set(rows.map(row => row?.id)).size !== rows.length
            || rows.some(row => !row || !integer(row.id, 1) || !integer(row.definitionId, 1) || row.pile !== 'storage'
              || entities.get(row.id)?.definitionId !== row.definitionId
              || batch.refs.some(ref => ref.id === row.id && (ref.definitionId !== row.definitionId || ref.pile !== 'storage')))) fail('FRESH_ENTITY_UNVERIFIED');
        if (storageRefs.some(ref => !rows.some(row => row.id === ref.id && row.definitionId === ref.definitionId))) fail('MATERIAL_MISSING');
        requests += storage.getRequestCount();
        try { onProgress({ phase: 'validation', completed: batch.refs.length, total: batch.refs.length }); } catch { /* UI only. */ }
      }
      check();
      const items = batch.refs.map(ref => projectFc27StreamlinedItem(entities.get(ref.id), root, ref.pile));
      const eligibility = createFc27StreamlinedMatcher(root, plan.challenge, entities);
      // Check identity across the entire batch before any receipt-scoped exception.
      const filtered = filterStreamlinedItems(items, { policy: plan.policy, eligibility });
      if (filtered.status !== 'observed') fail('MATERIAL_CHANGED');
      const accepted = new Set(filtered.items.map(item => item.key));
      for (let index = 0; index < items.length; index++) {
        const proof = plan.batches[batch.index][index]?.purchaseReceipt;
        if (!proof) continue;
        if (proof.itemId !== items[index]?.id || proof.definitionId !== items[index]?.definitionId
            || typeof purchaseVerifier !== 'function' || await purchaseVerifier(items[index], proof, plan) !== true) fail('PURCHASE_RECEIPT_UNVERIFIED');
        // Only this exact verified purchase bypasses stock range/untradeable
        // restrictions. Preserve real rating and every other material fact.
        const checked = filterStreamlinedItems([items[index]], {
          policy: { ...plan.policy, maxRating: plan.policy.marketMaxRating ?? plan.policy.maxRating,
            goldRange: [75, 99], onlyUntradeable: false }, eligibility });
        if (checked.status !== 'observed' || checked.items.length !== 1) fail('MATERIAL_CHANGED');
        accepted.add(items[index].key);
      }
      // Price/name changes do not affect material identity, but a changed rating,
      // league, score or protection flag invalidates the frozen selection.
      const facts = item => Object.fromEntries(['id', 'definitionId', 'points', 'scoreVerified', 'pile',
        'rating', 'leagueId', 'loans', 'tradeable', 'special', 'concept', 'evolution', 'cosmetic',
        'academyEnrolled', 'activeTrade', 'limitedUse', 'locked', 'activeSquad', 'protected'].map(key => [key, item[key]]));
      if (accepted.size !== items.length
          || items.some((item, index) => !same(facts(item), facts(plan.batches[batch.index][index])))) fail('MATERIAL_CHANGED');
      check();
      return { fresh: true, observedAt: now(), count: items.length, points: items.reduce((sum, item) => sum + item.points, 0),
        requests, contributionReady: false,
        timesCompleted: integer(fresh?.timesCompleted) ? fresh.timesCompleted : null };
    } finally { busy = false; }
  } });
}
