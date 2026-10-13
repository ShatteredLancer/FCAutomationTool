import { createEaInventoryAdapter } from './inventory.js';
import { readFc27Context } from './fc27-local-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { FC27_BUY_SERVICE_METHODS, FC27_BUY_COMPATIBLE_HASHES } from './fc27-puzzle-buy.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { createStreamlinedMaterializationJournal, streamlinedMaterializationRecovery } from '../../streamlined/materialization-journal.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { projectFc27StreamlinedItem, createFc27StreamlinedMatcher } from './fc27-streamlined-read.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';

async function readMaterializationClub(root, ref, createTransport, assert) {
  assert();
  const transport = await createTransport(root, { nativeReauth: true });
  const matches = [];
  for (let start = 0; start < 20000; start += 250) {
    assert();
    const rows = await transport.readPage({ start, count: 250, definitionIds: [ref.definitionId] });
    assert();
    if (!Array.isArray(rows) || rows.length > 250 || rows.some(row => !integer(row?.id, 1)
        || !integer(row.definitionId, 1) || row.pile !== 'club' || row.id === ref.id && row.definitionId !== ref.definitionId)
        || new Set([...matches, ...rows].map(row => row.id)).size !== matches.length + rows.length) fail('MATERIALIZE_READBACK_UNCONFIRMED');
    matches.push(...rows);
    if (rows.length < 250) return matches.filter(row => row.definitionId === ref.definitionId);
  }
  fail('INVENTORY_LIMIT');
}

// Recovery confirms only positive, exact Club evidence. An absent card or a
// source-cache hit cannot prove an unknown move was rejected, so never resend.
export async function createFc27StreamlinedMaterializationRecovery(root, { context, get, set,
  createTransport = createFc27ClubReadTransport, assertCurrent = () => {}, onProgress = () => {} } = {}) {
  const assert = () => {
    if (!same(readFc27Context(root), context)) fail('MATERIALIZE_CONTEXT_CHANGED');
    assertCurrent();
  };
  const journal = createStreamlinedMaterializationJournal({ context, get, set, assertCurrent: assert });
  let busy = false;
  return Object.freeze({ async recover() {
    if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_MATERIALIZE_BUSY' };
    busy = true;
    let record, confirmed = 0, original;
    try {
      record = await journal.read();
      const pending = record.entries.filter(entry => entry.state === 'pending');
      if (!pending.length) return { status: 'absent' };
      original = streamlinedMaterializationRecovery(record);
      for (const [index, entry] of pending.entries()) {
        try { onProgress({ phase: 'materialize', stage: 'recovery-check', completed: index, total: pending.length }); } catch { /* display only */ }
        const rows = await readMaterializationClub(root, entry, createTransport, assert);
        if (!rows.some(row => row.id === entry.id)) continue;
        assert(); entry.state = 'confirmed';
        try { await journal.save(record); } catch (error) { entry.state = 'pending'; throw error; }
        confirmed++;
        try { onProgress({ phase: 'materialize', stage: 'recovery-confirmed', completed: index + 1, total: pending.length }); } catch { /* display only */ }
      }
      const recovery = streamlinedMaterializationRecovery(record);
      return recovery.pendingCount ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED', confirmed, recovery }
        : { status: 'recovered', confirmed, recovery: { ...original, pendingCount: 0, targets: [] } };
    } catch (error) {
      return { status: 'recovery-required', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message)
        ? error.message : 'FC27_STREAMLINED_MATERIALIZE_READBACK_UNCONFIRMED', confirmed,
        ...(record ? { recovery: streamlinedMaterializationRecovery(record) } : {}) };
    } finally { busy = false; }
  } });
}

// Streamlined accepts Unassigned and idle Transfer candidates in a plan, but
// EA's one-click submit contract consumes Club entities. Materialization is a
// separate, user-approved transaction: move one exact entity, verify the
// response, then verify the Club repository before the SBC validator runs.
export async function createFc27StreamlinedMaterializer(root, { canWrite = () => false, plan, get, set,
  createTransport = createFc27ClubReadTransport, assertCurrent = () => {}, onProgress = () => {} } = {}) {
  const service = root.services?.Item, proto = service && Object.getPrototypeOf(service);
  if (!service || !proto) fail('MATERIALIZE_RUNTIME_UNVERIFIED');
  const runtime = await verifyFc27Methods({ service: proto, crypto: root.crypto },
    FC27_BUY_SERVICE_METHODS.filter(([name]) => name === 'move').map(([name, hash]) => [`service.${name}`, hash]), FC27_BUY_COMPATIBLE_HASHES);
  const context = readFc27Context(root), adapter = createEaInventoryAdapter(root);
  const move = service.move;
  if (typeof move !== 'function' || root.ItemPile?.CLUB !== 7) fail('MATERIALIZE_RUNTIME_UNVERIFIED');
  if (!same(plan?.context, context) || typeof get !== 'function' || typeof set !== 'function') fail('MATERIALIZE_JOURNAL_UNAVAILABLE');
  let busy = false;
  const report = (stage, index, total, id) => {
    try { onProgress({ phase: 'materialize', stage, index, completed: stage === 'confirmed' ? index + 1 : index,
      total, materialTotal: total, id }); } catch { /* display only */ }
  };
  const assert = () => {
    runtime();
    if (canWrite() !== true || !same(readFc27Context(root), context)
        || root.services?.Item !== service || Object.getPrototypeOf(service) !== proto || service.move !== move) {
      fail('MATERIALIZE_CONTEXT_CHANGED');
    }
    assertCurrent();
  };
  const { read, save } = createStreamlinedMaterializationJournal({ context, get, set, assertCurrent: assert });
  const observe = operation => new Promise((resolve, reject) => {
    let observable, done = false;
    const owner = {}, finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { observable?.unobserve(owner); } catch { /* own observer only */ }
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Error('FC27_STREAMLINED_MATERIALIZE_UNCONFIRMED')), 16000);
    try {
      observable = operation();
      if (!observable || typeof observable.observe !== 'function') return finish(Error('FC27_STREAMLINED_MATERIALIZE_UNCONFIRMED'));
      observable.observe(owner, (_sender, reply) => finish(null, reply));
    } catch (error) { finish(error); }
  });
  const freshClub = ref => readMaterializationClub(root, ref, createTransport, assert);
  const checkSource = (ref, source) => {
    const selected = plan.items.find(item => item.id === ref.id && item.definitionId === ref.definitionId && item.pile === ref.pile);
    const projected = projectFc27StreamlinedItem(source, root, ref.pile);
    const eligibility = createFc27StreamlinedMatcher(root, plan.challenge, new Map([[ref.id, source]]));
    const checked = filterStreamlinedItems([projected], { policy: plan.policy, eligibility });
    const fields = ['id', 'definitionId', 'points', 'rating', 'leagueId', 'loans', 'tradeable', 'special',
      'concept', 'evolution', 'cosmetic', 'academyEnrolled', 'activeTrade', 'limitedUse', 'protected'];
    if (!selected || checked.status !== 'observed' || checked.items.length !== 1
        || fields.some(field => !same(projected?.[field], selected[field]))) fail('MATERIALIZE_MATERIAL_CHANGED');
  };
  return Object.freeze({
    async prepare(refs = []) {
      if (busy) fail('MATERIALIZE_BUSY');
      if (!Array.isArray(refs) || refs.some(ref => !integer(ref?.id, 1) || !integer(ref?.definitionId, 1)
          || !['club', 'storage', 'unassigned', 'transfer'].includes(ref?.pile)
          || ['unassigned', 'transfer'].includes(ref.pile) && ref.executionPile !== 'club')
          || new Set(refs.map(ref => ref.id)).size !== refs.length) fail('MATERIALIZE_INPUT_INVALID');
      busy = true;
      const external = refs.filter(ref => ['unassigned', 'transfer'].includes(ref.pile));
      try {
        assert();
        const record = await read(); assert();
        if (record.entries.some(e => e.state === 'pending'
            && (e.setId !== plan.challenge.setId || e.challengeId !== plan.challenge.id
              || !external.some(ref => ref.id === e.id && ref.definitionId === e.definitionId && ref.pile === e.pile)))) {
          throw Object.assign(Error('FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED'), {
            recovery: streamlinedMaterializationRecovery(record) });
        }
        // Confirmed/rejected entries are only move-audit history. Retain the
        // active challenge's entries for idempotent recovery, but compact old
        // terminal entries so one account cannot accumulate an unbounded map.
        record.entries = record.entries.filter(e => e.state === 'pending'
          || e.setId === plan.challenge.setId && e.challengeId === plan.challenge.id);
        for (let index = 0; index < external.length; index++) {
          const ref = external[index];
          report('checking-source', index, external.length, ref.id);
          let entry = record.entries.find(e => e.id === ref.id);
          if (entry && (entry.definitionId !== ref.definitionId || entry.pile !== ref.pile
              || entry.setId !== plan.challenge.setId || entry.challengeId !== plan.challenge.id)) fail('MATERIALIZE_IDENTITY_CHANGED');
          report('checking-club', index, external.length, ref.id);
          const before = await freshClub(ref);
          if (before.some(row => row.id === ref.id)) {
            if (!entry || !['pending', 'confirmed'].includes(entry.state)) fail('MATERIALIZE_IDENTITY_CHANGED');
            entry.state = 'confirmed'; await save(record); assert();
            report('confirmed', index, external.length, ref.id); continue;
          }
          if (entry && entry.state !== 'rejected') throw Object.assign(Error('FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED'), {
            recovery: streamlinedMaterializationRecovery(record) });
          const source = adapter.readPile(ref.pile).find(item => Number(item?.id) === ref.id
            && Number(item?.definitionId) === ref.definitionId);
          if (!source) fail('MATERIALIZE_SOURCE_MISSING');
          const snapshot = adapter.snapshotItem(source, ref.pile);
          if (snapshot.activeTrade === true) fail('MATERIALIZE_ACTIVE_TRADE');
          // Club's fresh version query is authoritative, not a stale duplicateId
          // or provisional cache. After the Club copy is consumed, an external
          // entity may move even if Storage still holds that version.
          if (before.length) fail('MATERIALIZE_DUPLICATE_BLOCKED');
          checkSource(ref, source);
          entry ??= { id: ref.id, definitionId: ref.definitionId, pile: ref.pile,
            setId: plan.challenge.setId, challengeId: plan.challenge.id };
          if (!record.entries.includes(entry)) {
            if (record.entries.length >= 20000) fail('MATERIALIZE_JOURNAL_LIMIT');
            record.entries.push(entry);
          }
          entry.state = 'pending'; report('journal-pending', index, external.length, ref.id); await save(record);
          assert();
          report('move-request', index, external.length, ref.id);
          const reply = await observe(() => service.move(source, root.ItemPile.CLUB));
          assert();
          if (reply?.success === false) { entry.state = 'rejected'; await save(record); fail('MATERIALIZE_MOVE_REJECTED'); }
          if (reply?.success !== true || !Array.isArray(reply.data?.itemIds)
              || !reply.data.itemIds.map(Number).includes(ref.id)) fail('MATERIALIZE_UNCONFIRMED');
          report('move-acknowledged', index, external.length, ref.id);
          report('club-readback', index, external.length, ref.id);
          if (!(await freshClub(ref)).some(row => row.id === ref.id)) fail('MATERIALIZE_READBACK_UNCONFIRMED');
          entry.state = 'confirmed'; await save(record); assert();
          report('confirmed', index, external.length, ref.id);
        }
        return { status: 'materialized', moved: external.map(ref => ref.id) };
      } finally { busy = false; }
    },
  });
}
