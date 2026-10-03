import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { createFc27PuzzleConceptSession, fc27ConceptPendingKey, fc27ConceptDraftKey, readFc27ConceptPending, readFc27ConceptReservation } from '../../src/fc27/puzzle-concept-session.js';

function fixture() {
  const input = puzzleFillFixture();
  const missing = input.inventory.items.pop();
  const suggestion = {
    selectedOwned: input.inventory.items.map((item, slot) => ({ id: item.id, definitionId: item.definitionId,
      rating: item.rating, pile: 'club', slot })),
    purchases: [{ definitionId: 901, catalogRef: 'fc27:901', rating: missing.rating, rarity: missing.rarity,
      nationId: missing.nationId, leagueId: missing.leagueId, teamId: missing.teamId, positions: missing.positions,
      groups: missing.groups, special: false, evolution: false, cosmetic: false, type: 'player', concept: false,
      academyEnrolled: false, slot: 10, quantity: 1, observedBuyNow: 500 }], purchaseCount: 1,
  };
  const values = new Map(); let provider;
  const state = { lost: false, occupied: false, syncFailed: false, cleared: false, manual: false, writes: 0, reads: 0 };
  const session = createFc27PuzzleConceptSession({ scope: 'ea:test', context: input.context, get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)), exclusive: async (_scope, task) => task(),
    checkOtherTransactions: async () => true, operationId: () => 'concept-op',
    assertCurrent: () => true, readCurrent: async plan => ({ ...input, challenge: plan.challenge, squadEmpty: true }),
    createProvider: async () => {
      provider = { cancel: () => {}, validateItems: async ({ selected }) => ({ context: input.context, fresh: true,
        observedAt: Date.now(), items: selected.map(ref => input.inventory.items.find(item => item.id === ref.id)) }),
      saveConceptDraft: async (_plan, beforeWrite, beforeDispatch) => {
        if (state.occupied) throw new Error('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
        expect(beforeWrite()).toBe(true); await beforeDispatch(); state.writes++;
        if (state.lost) throw new Error('FC27_TRANSACTION_REQUEST_UNCONFIRMED');
        return { status: 'confirmed', setId: 19, challengeId: 43 };
      },
      readConceptDraft: async plan => { state.reads++;
        if (state.cleared) throw new Error('FC27_CONCEPT_SQUAD_CLEARED');
        if (state.manual) throw new Error('FC27_CONCEPT_SQUAD_MANUAL_EDITED');
        return { context: plan.context, fresh: true, observedAt: Date.now(), setId: 19, challengeId: 43,
        owned: input.inventory.items.map((item, slot) => ({ ...item, pile: 'club', slot })), concepts: [{ slot: 10, definitionId: 901 }] }; },
      syncConceptDraft: async () => { if (state.syncFailed) throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED'); return { status: 'synchronized' }; } };
      return provider;
    }, now: () => Date.now() });
  return { input, suggestion, values, state, session, getProvider: () => provider };
}

it('saves a concept draft once and records a recoverable transaction', async () => {
  const x = fixture(); const result = await x.session.save(x.input, x.suggestion);
  expect(result).toMatchObject({ status: 'concept-filled', saved: true, submitted: false, purchaseCount: 1 });
  expect(x.values.get(fc27ConceptPendingKey('ea:test', { setId: 19, challengeId: 43 }))).toBeNull();
  expect(x.getProvider()).toBeTruthy();
});

it('blocks a second concept save while the durable pending marker exists', async () => {
  const x = fixture(); x.values.set(fc27ConceptPendingKey('ea:test'), { setId: 19, challengeId: 43, operationId: 'old' });
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'blocked', reason: 'FC27_CONCEPT_RECOVERY_REQUIRED' });
});

it.each(['lost', 'syncFailed'])('reconciles %s by one readback without buying or a second save', async field => {
  const x = fixture(); x.state[field] = true;
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'recovery-required', saved: null });
  const pending = structuredClone(x.values.get(fc27ConceptPendingKey('ea:test', { setId: 19, challengeId: 43 })));
  expect(pending).toMatchObject({ account: { accountScope: x.input.context.accountScope, platform: x.input.context.platform } });
  expect(await x.session.recover({ setId: 19, challengeId: 44 })).toBeNull();
  expect(x.values.get(fc27ConceptPendingKey('ea:test', { setId: 19, challengeId: 43 }))).toEqual(pending);
  expect(await readFc27ConceptPending(async (key, fallback) => x.values.get(key) ?? fallback, 'ea:test')).toEqual(pending);
  x.state[field] = false;
  expect(await x.session.recover({ setId: 19, challengeId: 43 })).toMatchObject({ status: 'concept-filled', restored: true });
  expect(x.state.writes).toBe(1);
});

it('does not create pending state if the server squad is occupied before dispatch', async () => {
  const x = fixture(); x.state.occupied = true;
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'blocked', saved: false });
  expect(x.values.size).toBe(0); expect(x.state.writes).toBe(0);
});

it('saves the current target without deleting another target legacy recovery marker', async () => {
  const x = fixture();
  const other = { setId: 21, challengeId: 48, operationId: 'other' };
  x.values.set(fc27ConceptPendingKey('ea:test'), other);
  expect(await x.session.recover({ setId: 19, challengeId: 43 })).toBeNull();
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'concept-filled' });
  expect(x.values.get(fc27ConceptPendingKey('ea:test'))).toEqual(other);
});

it('abandons only the old concept record when the user cleared the whole squad', async () => {
  const x = fixture();
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'concept-filled' });
  const key = [...x.values.keys()].find(value => value.startsWith('fcat-fc27-concept-draft:'));
  x.state.cleared = true;
  expect(await x.session.recover({ setId: 19, challengeId: 43 })).toMatchObject({
    status: 'reset', reason: 'FC27_CONCEPT_SQUAD_CLEARED', saved: false,
  });
  expect(x.values.get(key)).toBeNull();
  expect(x.values.get(fc27ConceptPendingKey('ea:test', { setId: 19, challengeId: 43 }))).toBeNull();
});

it('keeps the old record and blocks when the user partially edits the squad', async () => {
  const x = fixture();
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'concept-filled' });
  const key = [...x.values.keys()].find(value => value.startsWith('fcat-fc27-concept-draft:'));
  const before = structuredClone(x.values.get(key));
  x.state.manual = true;
  expect(await x.session.recover({ setId: 19, challengeId: 43 })).toMatchObject({
    status: 'blocked', reason: 'FC27_CONCEPT_SQUAD_MANUAL_EDITED', saved: false,
  });
  expect(x.values.get(key)).toEqual(before);
});

it('never abandons an unknown save just because the server is empty', async () => {
  const x = fixture(); x.state.lost = true;
  expect(await x.session.save(x.input, x.suggestion)).toMatchObject({ status: 'recovery-required' });
  const before = structuredClone([...x.values]);
  x.state.cleared = true;
  expect(await x.session.recover({ setId: 19, challengeId: 43 }, { restartIfEmpty: true })).toMatchObject({
    status: 'blocked', reason: 'FC27_CONCEPT_RECOVERY_REQUIRED',
  });
  expect([...x.values]).toEqual(before);
  expect(x.state.writes).toBe(1);
});

it('treats a locally empty page as a new solve intent while retaining the terminal draft', async () => {
  const x = fixture(); await x.session.save(x.input, x.suggestion);
  const before = structuredClone([...x.values]); const reads = x.state.reads;
  expect(await x.session.recover({ setId: 19, challengeId: 43 }, { restartIfEmpty: true })).toMatchObject({
    status: 'reset', reason: 'FC27_PUZZLE_LOCAL_SQUAD_CLEARED', saved: false,
  });
  expect([...x.values]).toEqual(before);
  expect(x.state.reads).toBe(reads);
});

it('rejects corrupted persisted slots before querying EA or restoring the page', async () => {
  const x = fixture(); await x.session.save(x.input, x.suggestion);
  const key = [...x.values.keys()].find(key => key.startsWith('fcat-fc27-concept-draft:'));
  x.values.get(key).plan.slots[0].slot = 10;
  const reads = x.state.reads;
  expect((await x.session.recover({ setId: 19, challengeId: 43 })).status).toBe('blocked');
  expect(x.state.reads).toBe(reads);
});

it('rejects a stored account mismatch before querying EA', async () => {
  const x = fixture(); await x.session.save(x.input, x.suggestion);
  const key = [...x.values.keys()].find(key => key.startsWith('fcat-fc27-concept-draft:'));
  x.values.get(key).account.accountScope = 'another-account';
  const reads = x.state.reads;
  expect(await x.session.recover({ setId: 19, challengeId: 43 })).toMatchObject({ reason: 'FC27_CONCEPT_JOURNAL_UNCONFIRMED' });
  expect(x.state.reads).toBe(reads);
});

it('recovers owned reservations from a terminal draft written before the reservation index', async () => {
  const x = fixture();
  const target = { setId: 19, challengeId: 43 };
  await x.session.save(x.input, x.suggestion);
  const record = structuredClone(x.values.get(fc27ConceptDraftKey('ea:test', target)));
  expect(record.phase).toBe('saved');
  expect(await readFc27ConceptReservation(async (key, fallback) => x.values.get(key) ?? fallback,
    'ea:test', target, x.input.context)).toEqual(x.input.inventory.items.slice(0, 10).map(item => ({
      id: item.id, definitionId: item.definitionId,
    })));
  record.account.accountScope = 'another-account';
  x.values.set(fc27ConceptDraftKey('ea:test', target), record);
  expect(await readFc27ConceptReservation(async (key, fallback) => x.values.get(key) ?? fallback,
    'ea:test', target, x.input.context)).toBeNull();
});
