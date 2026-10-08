import { integer, same, fail } from './contract.js';
import { nextStreamlinedWave } from './waves.js';

// One explicitly approved target. Injected adapters own native read/buy/move/
// contribution contracts. Durable intent precedes every irreversible request.
export function createStreamlinedProcurement({ journal, lock, adapter, operationId, now = () => Date.now() }) {
  let busy = false, stopped = false;
  const stoppedError = () => { const error = new Error('FC27_STREAMLINED_STOPPED'); error.stopped = true; return error; };
  const reason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_PURCHASE_UNCONFIRMED';
  const execute = async (plan, approval, { onProgress = () => {}, reconcileOnly = false } = {}) => {
    if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
    busy = true; stopped = false; let release, record;
    const report = (phase, extra = {}) => { try { onProgress({ phase, spent: record?.spent ?? 0, budget: record?.budget,
      submittedScore: record?.submittedScore ?? 0, targetScore: record?.challenge.targetScore,
      purchased: record?.entries.filter(e => e.source === 'market' && ['bought', 'move-pending', 'club', 'consumed'].includes(e.state)).length ?? 0,
      purchasedWaitingMove: record?.entries.filter(e => e.source === 'market' && ['bought', 'move-pending'].includes(e.state)).length ?? 0,
      ownedUnconsumed: (record?.entries.filter(e => e.source === 'inventory' && e.state === 'ready').length ?? 0)
        + (record?.entries.filter(e => e.source === 'market' && e.state === 'club').length ?? 0),
      purchaseTarget: record?.route.groups.filter(g => g.source === 'market').reduce((n, g) => n + g.quantity, 0),
      remainingQuantity: record?.route.groups.reduce((n, g, i) => n + Math.max(0, g.quantity - (record.fulfilled[i] ?? 0)
        - record.entries.filter(e => e.groupIndex === i && ['ready', 'bought', 'move-pending', 'club'].includes(e.state)).length), 0),
      batchNumber: (record?.confirmedBatches ?? 0) + (phase === 'confirmed' ? 0 : 1),
      contributed: record?.consumedIds.length ?? 0,
      remainingScore: Math.max(0, (record?.challenge.targetScore ?? 0) - (record?.submittedScore ?? 0)), ...extra }); } catch { /* UI only. */ } };
    const save = async () => { record = await journal.write(record); };
    try {
      if (!reconcileOnly && (approval?.approved !== true || approval.fingerprint !== (plan.fingerprint ?? JSON.stringify(plan)) || !integer(approval.budget)
          || !integer(approval.attempts, 1) || !integer(approval.expiresAt)
          || !plan?.route?.groups?.length || !integer(plan.challenge?.selectionLimit, 1, 1000))) fail('PURCHASE_APPROVAL_REQUIRED');
      release = await lock.acquire(plan.context); if (typeof release !== 'function') fail('BUSY');
      record = await journal.read(plan.context);
      const fingerprint = plan.fingerprint ?? JSON.stringify(plan);
      if (reconcileOnly && !record) return { status: 'absent' };
      if (record && (reconcileOnly || !record.completed) && record.fingerprint !== fingerprint) fail('PURCHASE_RECOVERY_REQUIRED');
      if (record?.completed && record.fingerprint === fingerprint) return { status: 'completed', record };
      const hasPending = record?.entries?.some(entry => ['buy-pending', 'bought', 'move-pending'].includes(entry.state))
        || !!record?.contribution;
      if (!reconcileOnly && now() >= approval.expiresAt && !hasPending) fail('PURCHASE_APPROVAL_EXPIRED');
      if (!record || record.completed) {
        if (now() >= approval.expiresAt) fail('PURCHASE_APPROVAL_EXPIRED');
        const inventoryEntries = plan.route.groups.flatMap((group, groupIndex) => group.source === 'inventory'
          ? group.items.slice(0, group.quantity).map((item, index) => ({
            key: `inventory:${item.id}:${index}`, source: 'inventory', groupIndex, definitionId: item.definitionId,
            itemId: item.id, price: null, cap: null, tradeId: null, state: 'ready' })) : []);
        record = await journal.write({ schema: 1, context: plan.context, operationId: operationId(), revision: record?.revision ?? 0,
          fingerprint: approval.fingerprint, plan, challenge: plan.challenge, policy: plan.policy, route: plan.route,
          budget: approval.budget, spent: 0, submittedScore: plan.challenge.submittedScore,
          consumedIds: [], fulfilled: plan.route.groups.map(() => 0), contribution: null, completed: false,
          entries: inventoryEntries }, record?.revision ?? 0);
      }
      if (!reconcileOnly && record.budget !== approval.budget) fail('PURCHASE_APPROVAL_CHANGED');
      const check = async ({ recovery = false } = {}) => {
        if (stopped && !recovery) throw stoppedError();
        if (!recovery && now() >= approval.expiresAt) fail('PURCHASE_APPROVAL_EXPIRED');
        await adapter.assertCurrent(record);
      };
      await check({ recovery: true });
      if (record.contribution) {
        const result = await adapter.recoverContribution(record.contribution);
        if (result?.notDispatched) { record.contribution = null; await save(); }
        else { if (!result?.confirmed) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED'); await settleContribution(result); }
      }
      // A pending contribution may already have consumed the receipt, so
      // settle it before requiring any unconsumed market item to be located.
      for (let index = 0; index < record.entries.length; index++) {
        if (!['buy-pending', 'bought', 'move-pending', 'club'].includes(record.entries[index].state)) continue;
        const entry = record.entries[index];
        if (entry.state === 'club' && record.consumedIds.includes(entry.itemId)) continue;
        const location = await adapter.locate(entry);
        if (!['club', 'purchased'].includes(location)) fail('PURCHASE_RECOVERY_REQUIRED');
        if (record.entries[index].state === 'buy-pending') { record.entries[index].state = 'bought'; record.spent += entry.price; }
        record.entries[index].state = location === 'club' ? 'club' : 'bought';
        await save();
      }
      if (reconcileOnly) return { status: record.completed ? 'completed' : 'recovered', record };
      if (now() >= approval.expiresAt) return { status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED', record };
      while (!stopped && record.submittedScore < record.challenge.targetScore) {
        await check();
        for (let i = 0; i < record.entries.length; i++) {
          const entry = record.entries[i];
          if (!['bought', 'move-pending'].includes(entry.state)) continue;
          await check();
          record.entries[i].state = 'move-pending'; await save();
          await check();
          const moved = await adapter.move(record.entries[i]);
          if (moved?.status === 'rejected') fail('PURCHASE_MOVE_REJECTED');
          if (await adapter.locate(record.entries[i]) !== 'club') fail('PURCHASE_RECOVERY_REQUIRED');
          record.entries[i].state = 'club'; await save();
        }
        if (record.contribution) {
          const result = await adapter.recoverContribution(record.contribution);
          if (!result?.confirmed) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
          await settleContribution(result); continue;
        }
        const state = await adapter.readState(record); await check();
        if (state.submittedScore !== record.submittedScore) fail('PROGRESS_CHANGED');
        const readyEntries = record.entries.filter(e => ['ready', 'club'].includes(e.state)).slice(0, record.challenge.selectionLimit);
        const materialized = await adapter.materialize(readyEntries, record);
        if (!Array.isArray(materialized)) fail('PURCHASE_MATERIAL_UNKNOWN');
        const ready = materialized.map((row, index) => row?.item ? row : ({
          groupIndex: readyEntries[index]?.groupIndex, item: row,
        })).filter(row => Number.isSafeInteger(row.groupIndex) && row.item).slice(0, record.challenge.selectionLimit);
        const wave = nextStreamlinedWave(record.route, { ...state, ready, limit: record.challenge.selectionLimit,
          submittedScore: record.submittedScore, targetScore: record.challenge.targetScore,
          consumedIds: record.consumedIds, fulfilled: record.fulfilled });
        if (wave.status === 'waiting') return { status: 'paused', reason: 'FC27_STREAMLINED_NO_AFFORDABLE_CARDS', record };
        const material = [...wave.material], attempted = new Set(state.blockedDefinitions ?? []);
        let lastBought = now(), boughtThisWave = 0;
        while (!stopped) {
          // Reallocate after every version attempt using actual material, not
          // projected purchases. This allows approved alternatives without
          // overbuying the remaining group quantity or target points.
          const next = nextStreamlinedWave(record.route, { ...state, ready: material,
            freeSlots: Math.max(0, state.freeSlots - boughtThisWave),
            blockedDefinitions: [...attempted], limit: record.challenge.selectionLimit,
            submittedScore: record.submittedScore, targetScore: record.challenge.targetScore,
            consumedIds: record.consumedIds, fulfilled: record.fulfilled });
          const slot = next.purchases[0];
          if (!slot) break;
          const candidate = slot.item;
          attempted.add(candidate.definitionId);
          if (stopped) break; await check();
          const cap = candidate.purchaseMaxBuy;
          if (!integer(cap, 150, 15000000)) fail('PURCHASE_PRICE_UNVERIFIED');
          if (record.spent + cap > record.budget) continue;
          for (let attempt = 0; attempt < approval.attempts && !stopped; attempt++) {
            report('search'); const offer = await adapter.find(candidate, cap, record); await check();
            if (!offer || offer.unavailable) break;
            if (record.entries.some(e => e.state === 'rejected' && (e.itemId === offer.itemId || e.tradeId === offer.tradeId))) continue;
            if (offer.definitionId !== candidate.definitionId || !integer(offer.price, 150, cap)
                || !integer(offer.itemId, 1) || record.entries.some(e => e.itemId === offer.itemId || e.tradeId === offer.tradeId)) fail('PURCHASE_OFFER_CHANGED');
            const index = record.entries.length;
            record.entries.push({ ...offer, source: 'market', key: `${record.operationId}:${index}`, groupIndex: slot.groupIndex, cap, state: 'buy-pending' });
            await save(); report('buying');
            if (stopped || now() >= approval.expiresAt) {
              record.entries.splice(index, 1); await save(); await check();
            }
            const receipt = await adapter.buy(record.entries[index]);
            if (receipt?.status === 'rejected') { record.entries[index].state = 'rejected'; await save(); continue; }
            if (receipt?.status !== 'bought' || !same([receipt.itemId, receipt.definitionId, receipt.tradeId, receipt.price],
              [offer.itemId, offer.definitionId, offer.tradeId, offer.price])) fail('PURCHASE_RECOVERY_REQUIRED');
            record.entries[index].state = 'bought'; record.spent += receipt.price; await save();
            // A stop received while the native buy request was in flight is
            // honored at the durable boundary. The confirmed item remains in
            // the journal for recovery; it must not be moved or contributed
            // implicitly after the user stopped the run.
            if (stopped) break;
            record.entries[index].state = 'move-pending'; await save(); report('moving');
            await check();
            if ((await adapter.move(record.entries[index]))?.status === 'rejected') fail('PURCHASE_MOVE_REJECTED');
            if (await adapter.locate(record.entries[index]) !== 'club') fail('PURCHASE_RECOVERY_REQUIRED');
            record.entries[index].state = 'club'; await save();
            if (stopped) break;
            const rows = await adapter.materialize([record.entries[index]], record);
            if (rows.length !== 1) fail('PURCHASE_MATERIAL_UNKNOWN');
            material.push(rows[0]?.item ? rows[0] : { groupIndex: slot.groupIndex, item: rows[0] });
            lastBought = now(); boughtThisWave++;
            await adapter.afterPlayer?.(); break;
          }
        }
        if (stopped) break;
        if (!material.length) return { status: 'paused', reason: 'FC27_STREAMLINED_NO_AFFORDABLE_CARDS', record };
        if (wave.purchases.length && material.length < record.challenge.selectionLimit
            && material.reduce((sum,r) => sum+r.item.points, record.submittedScore) < record.challenge.targetScore) {
          report('partial-ready', { readyCount: material.length,
            readyPoints: material.reduce((sum, row) => sum + row.item.points, 0), selectionLimit: record.challenge.selectionLimit,
            nextBatch: (record.confirmedBatches ?? 0) + 1 });
          await adapter.waitForPartial?.(Math.max(0, (approval.idleMs ?? 60000) - (now() - lastBought)), () => stopped);
        }
        if (stopped) break;
        await check();
        const batchPlan = await adapter.prepareContribution(material, record);
        await check();
        record.contribution = { batchPlan, material, dispatched: true }; await save(); report('contribution');
        await check();
        const result = await adapter.contribute(batchPlan);
        if (!result?.confirmed) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
        await settleContribution(result);
      }
      record.completed = record.submittedScore >= record.challenge.targetScore; await save();
      return { status: record.completed ? 'completed' : 'stopped', record };
      async function settleContribution(result) {
        const material = record.contribution.material;
        if (!integer(result.submittedScore, record.submittedScore + 1,
          record.submittedScore + material.reduce((sum,r) => sum+r.item.points, 0))) fail('PROGRESS_CHANGED');
        for (const row of material) {
          if (record.consumedIds.includes(row.item.id)) fail('PURCHASE_IDENTITY_CONFLICT');
          record.consumedIds.push(row.item.id); record.fulfilled[row.groupIndex]++;
          const entry = record.entries.find(e => e.itemId === row.item.id);
          if (entry) entry.state = 'consumed';
        }
        const expected = record.submittedScore + material.reduce((sum,r) => sum+r.item.points, 0);
        record.submittedScore = result.submittedScore; record.contribution = null;
        record.completed = record.submittedScore >= record.challenge.targetScore;
        record.confirmedBatches = (record.confirmedBatches ?? 0) + 1;
        record.progressChanged = result.submittedScore !== expected && result.submittedScore < record.challenge.targetScore;
        await save(); report('confirmed');
        if (record.progressChanged) fail('PROGRESS_CHANGED');
      }
    } catch (error) {
      if (error?.stopped || error?.message === 'FC27_STREAMLINED_STOPPED') {
        return { status: 'stopped', reason: 'FC27_STREAMLINED_STOPPED', record };
      }
      return { status: 'recovery-required', reason: reason(error), record };
    }
    finally { try { adapter.cancel?.(); } finally { try { await release?.(); } finally { busy = false; } } }
  };
  return Object.freeze({ execute, stop: () => { stopped = true; } });
}
