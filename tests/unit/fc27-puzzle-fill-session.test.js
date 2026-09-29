import { beforeEach, expect, it, vi } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { prepareFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';
import { createFc27AcceptanceSession } from '../../src/adapters/browser/fc27-acceptance-session.js';

const state = vi.hoisted(() => ({}));
const currentChallenge = () => ({ id: 43, setId: 19, status: state.challengeStatus,
  eligibilityOperation: 'AND', requirements: state.input.challenge.rawRequirements });
const currentLayout = () => ({ status: 'observed', setId: 19, challengeId: 43, slotCount: 11,
  simpleBrickIndices: [], customBrickIndices: [], requiredPlayerCount: 11,
  formation: state.input.challenge.formation, squadEmpty: !state.saved });
vi.mock('../../src/adapters/ea/fc27-puzzle-page.js', () => ({
  readFc27PuzzlePage: () => state.pageMissing ? null : ({ setId: 19, challengeId: 43 }),
  readFc27PuzzlePageSnapshot: () => state.pageMissing ? null : ({ challenge: currentChallenge(), layout: currentLayout() }),
  readFc27CurrentPuzzleChallenge: () => currentChallenge(),
}));
vi.mock('../../src/adapters/ea/fc27-local-read.js', () => ({ readFc27Context: () => state.input.context }));
vi.mock('../../src/adapters/ea/fc27-fsu-read.js', () => ({ readFc27PuzzlePolicy: () => state.input.policy }));
vi.mock('../../src/adapters/ea/fc27-challenge-catalog.js', () => ({ inspectFc27ChallengeCatalog: async () => {
  state.catalogReads = (state.catalogReads ?? 0) + 1;
  return {
  status: state.rateLimited ? 'blocked' : 'observed', ...(state.rateLimited ? { reason: 'FC27_CATALOG_READ_UNCONFIRMED', httpStatus: 429 } : {}),
  challenges: [43, 44, 45, 46].map(id => ({ id, status: 'IN_PROGRESS', eligibilityOperation: 'AND' })),
  };
} }));
vi.mock('../../src/adapters/ea/fc27-puzzle-read.js', () => ({
  readFc27PuzzleClubLinks: () => state.input.clubLinks,
  readFc27PuzzleChemistry: () => state.input.chemistry,
  inspectFc27PuzzlePlan: async (_root, options, callback) => {
    state.localPlans++; expect(options.layout).toEqual(currentLayout());
    const result = await callback(state.input);
    return { status: result.status, reason: result.reason, plan: { selectedCount: result.selected?.length ?? 0 } };
  },
}));
vi.mock('../../src/adapters/ea/fc27-puzzle-verify.js', () => ({ inspectFc27VerifiedPuzzlePlan: async (_root, options, callback) => {
  state.verifiedPlans++;
  const preview = previewFc27PuzzleSquad(state.input);
  const fillPlan = prepareFc27PuzzleFillPlan(state.input, preview);
  await callback({}, { inputs: state.input, preview, fillPlan });
  return { status: 'preview', ...options, plan: { selectedCount: 11 } };
} }));
vi.mock('../../src/adapters/ea/fc27-traditional-provider.js', () => ({ createFc27TraditionalProvider: async (_root, { canWrite }) => {
  const stamp = () => ({ context: state.input.context, fresh: true, observedAt: Date.now(), setId: 19, challengeId: 43 });
  return {
    assertCurrent: () => true, cancel: vi.fn(),
    readInputs: () => { throw new Error('Traditional single-challenge reader must not handle Puzzle'); },
    readSquadState: async () => { state.squadReads++; return { ...stamp(), squadEmpty: !state.saved, layout: currentLayout() }; },
    validateItems: async () => {
      state.exactReads++;
      if (state.exact429) throw new Error('FC27_CLUB_HTTP_429');
      state.afterExact?.();
      return { ...stamp(), items: state.missing ? [] : state.input.inventory.items };
    },
    save: async (plan, beforeWrite, beforeDispatch) => {
      expect(canWrite()).toBe(true); expect(beforeWrite()).toBe(true);
      await beforeDispatch();
      expect(plan.set.id).toBe(19); state.saves++;
      state.saved = plan.items.map(item => ({ ...item, slot: plan.selected.find(ref => ref.id === item.id).slot }));
      if (state.lost) throw new Error('FC27_PROVIDER_READ_TIMEOUT');
      return { status: 'confirmed', setId: 19, challengeId: 43 };
    },
    readSavedSquad: async () => { state.savedReads++; return { ...stamp(), items: state.saved ?? [], squadEmpty: !state.saved, layout: currentLayout() }; },
    syncSavedSquad: async () => ({ status: 'synchronized' }),
  };
} }));

beforeEach(() => {
  Object.assign(state, { input: puzzleFillFixture(), saved: null, saves: 0, lost: false, missing: false,
    rateLimited: false, catalogReads: 0, pageMissing: false, challengeStatus: 'IN_PROGRESS',
    localPlans: 0, verifiedPlans: 0, exactReads: 0, squadReads: 0, savedReads: 0, afterExact: null, exact429: false });
});
function fixture() {
  const data = new Map(); let sequence = 0;
  const options = { root: { crypto: { randomUUID: () => `operation-${++sequence}` } }, liveEnabled: true,
    gmGetValue: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
    gmSetValue: async (key, value) => { data.set(key, structuredClone(value)); },
    lockManager: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } };
  const session = createFc27AcceptanceSession(options);
  // Matches panel property order, deliberately different from the engine schema.
  const approval = { approved: true, action: 'fill-only', count: 1, setId: 19, challengeId: 43, maxPlayers: 11, maxRating: 74 };
  const plan = () => { state.pageMissing = true; return session.inspectPuzzle({ setId: 19, challengeId: 43 }); };
  return { session, plan, approval, data, restart: () => createFc27AcceptanceSession(options) };
}

it('prepares an explicit challenge in a four-challenge Set and saves once through the real transaction and GM journal', async () => {
  const x = fixture(); expect((await x.plan()).fillReady).toBe(true);
  expect((await x.session.fillPuzzle(x.approval))).toMatchObject({ status: 'filled', saved: true, submitted: false });
  expect(state.saves).toBe(1);
  expect([...x.data.values()].find(value => value?.phase === 'saved')).toMatchObject({ phase: 'saved', submitted: false });
  expect((await x.session.fillPuzzle(x.approval)).status).toBe('blocked');
  expect(state.saves).toBe(1);
});

it('rejects ambiguous catalog selection and incorrect confirmation without saving', async () => {
  const x = fixture(); state.pageMissing = true;
  expect((await x.session.inspectPuzzle({ setId: 19 })).reason).toBe('FC27_PUZZLE_CHALLENGE_AMBIGUOUS');
  await x.plan(); expect((await x.session.fillPuzzle({ ...x.approval, challengeId: 44 })).status).toBe('blocked');
  expect(state.saves).toBe(0);
});

it('does not mistake executable callbacks in the input for serializable plan data', async () => {
  const x = fixture(); expect(typeof state.input.evaluateSquad).toBe('function');
  expect((await x.plan()).fillReady).toBe(true);
  state.input.policy.onlyUntradeable = false;
  expect((await x.session.fillPuzzle(x.approval)).status).toBe('blocked'); expect(state.saves).toBe(0);
});

it('retains uncertain save across restart, isolates another target, and only acknowledges an exact saved readback', async () => {
  const x = fixture(); await x.plan(); state.lost = true;
  expect((await x.session.fillPuzzle(x.approval)).status).toBe('recovery-required');
  const next = x.restart();
  expect((await next.inspectPuzzle({ setId: 19, challengeId: 43 })).reason).toBe('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
  expect((await next.prepare({ setId: 4 })).reason).not.toBe('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
  expect(await next.inspectRecovery()).toMatchObject({ status: 'recoverable', outcome: 'saved' });
  expect(state.catalogReads).toBe(1);
  expect((await next.resolveRecovery(false)).status).toBe('blocked');
  expect(await next.resolveRecovery(true)).toMatchObject({ status: 'resolved', saved: true, submitted: false });
  expect(state.saves).toBe(1);
});

it('does not clear recovery after a slot mismatch or empty squad with missing Club items', async () => {
  const x = fixture(); await x.plan(); state.lost = true; await x.session.fillPuzzle(x.approval);
  state.saved[0].slot = 10;
  expect((await x.session.inspectRecovery()).status).toBe('blocked');
  state.saved = null; state.missing = true;
  expect((await x.session.inspectRecovery()).status).toBe('blocked');
  state.missing = false;
  expect(await x.session.inspectRecovery()).toMatchObject({ status: 'recoverable', outcome: 'empty' });
  expect(await x.session.resolveRecovery(true)).toMatchObject({ status: 'resolved', saved: false });
  expect(state.saves).toBe(1);
});

it('allows a subsequent verified save without manual recovery acknowledgement', async () => {
  const x = fixture(); await x.plan(); await x.session.fillPuzzle(x.approval);
  state.saved = null; // A newly empty target, observed again before preparing.
  expect((await x.plan()).fillReady).toBe(true);
  expect((await x.session.fillPuzzle(x.approval)).status).toBe('filled'); expect(state.saves).toBe(2);
});

it('runs native one-click planning, exact checks and one save without a panel approval round-trip', async () => {
  const x = fixture(); const stages = [];
  const result = await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, {
    isCurrent: () => true, onProgress: stage => stages.push(stage),
  });
  expect(result).toMatchObject({ status: 'filled', saved: true, submitted: false });
  expect(state.saves).toBe(1);
  expect(stages).toEqual(['planning', 'validating', 'saving', 'verifying']);
  expect(state.catalogReads).toBe(0);
  expect(state.verifiedPlans).toBe(0);
  expect(state.localPlans).toBe(1);
  expect(state.exactReads).toBe(1);
  expect(state.squadReads).toBe(0);
  expect(state.savedReads).toBe(1);
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.plan.selected).toHaveLength(11);
  expect(log.result.status).toBe('filled'); expect(log).not.toHaveProperty('inventory');
});

it('does not fall back to another Challenge when the native target is already completed', async () => {
  const x = fixture(); state.challengeStatus = 'COMPLETED';
  const result = await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, {
    isCurrent: () => true,
  });
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_CHALLENGE_COMPLETED' });
  expect(state.catalogReads).toBe(0);
  expect(state.saves).toBe(0);
});

it('reads the diagnostic catalog once, persists a sanitized projection, and reuses it after restart', async () => {
  const x = fixture();
  expect((await x.plan()).status).toBe('preview');
  expect(state.catalogReads).toBe(1);
  const cached = [...x.data.entries()].find(([key]) => key.includes('fcat-fc27-puzzle-catalog:'))?.[1];
  expect(cached).toMatchObject({ schema: 1, setId: 19, result: { status: 'observed', setId: 19 } });
  expect(JSON.stringify(cached)).not.toMatch(/inventory|item|definition|request|response/);
  const next = x.restart();
  state.saved = null;
  expect((await next.inspectPuzzle({ setId: 19, challengeId: 43 })).catalogSource).toBe('cached');
  expect(state.catalogReads).toBe(1);
});

it('reuses the one Set read for another Challenge without a second EA request', async () => {
  const x = fixture();
  expect((await x.plan()).status).toBe('preview');
  expect(state.catalogReads).toBe(1);
  const next = x.restart();
  state.saved = null;
  await next.inspectPuzzle({ setId: 19, challengeId: 44 });
  expect(state.catalogReads).toBe(1);
});

it('records a single failed catalog read and never retries the same Set', async () => {
  const x = fixture(); state.rateLimited = true;
  expect((await x.plan()).httpStatus).toBe(429);
  expect(state.catalogReads).toBe(1);
  state.rateLimited = false;
  expect((await x.plan()).httpStatus).toBe(429);
  expect(state.catalogReads).toBe(1);
  // A failed historical catalog must not strand the already-open native editor.
  state.pageMissing = false;
  expect((await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true })).status).toBe('filled');
  expect(state.catalogReads).toBe(1);
});

it.each(['before-plan', 'after-plan', 'before-save'])('cancels one-click navigation drift %s', async stage => {
  const x = fixture(); let active = stage !== 'before-plan';
  const result = await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, {
    isCurrent: () => active,
    onProgress: phase => { if (stage === 'after-plan' && phase === 'validating' || stage === 'before-save' && phase === 'saving') active = false; },
  });
  expect(result.status).not.toBe('filled'); expect(state.saves).toBe(0);
  expect((await x.session.fillPuzzle(x.approval)).status).toBe('blocked');
});

it('does not allow a simultaneous click or traditional action to replace a one-click plan', async () => {
  const x = fixture();
  const first = x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true });
  expect((await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true })).reason).toBe('FC27_ATTEMPT_BUSY');
  expect((await x.session.prepare({ setId: 4 })).reason).toBe('FC27_ATTEMPT_BUSY');
  expect((await first).status).toBe('filled'); expect(state.saves).toBe(1);
});

it('logs a rate limit without retrying or retaining a usable plan', async () => {
  const x = fixture(); state.exact429 = true;
  expect(await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_CLUB_HTTP_429' });
  expect(state.saves).toBe(0);
  expect(state.catalogReads).toBe(0); expect(state.exactReads).toBe(1);
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.result.reason).toBe('FC27_CLUB_HTTP_429');
});

it.each(['status', 'rules', 'formation', 'occupied'])('rejects native %s drift after the precise Club read', async kind => {
  const x = fixture();
  state.afterExact = () => {
    if (kind === 'status') state.challengeStatus = 'COMPLETED';
    if (kind === 'rules') state.input.challenge.rawRequirements[0].count = 5;
    if (kind === 'formation') state.input.challenge.formation.id++;
    if (kind === 'occupied') state.saved = [state.input.inventory.items[0]];
  };
  expect((await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true })).status).toBe('blocked');
  expect(state.saves).toBe(0); expect(state.exactReads).toBe(1); expect(state.catalogReads).toBe(0);
});

it('does not fall back to a network scan when the native editor cannot be read', async () => {
  const x = fixture(); state.pageMissing = true;
  expect((await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, { isCurrent: () => true })).status).toBe('blocked');
  expect(state.catalogReads).toBe(0); expect(state.exactReads).toBe(0); expect(state.saves).toBe(0);
});

it('reconciles a dispatched save even if the user leaves the page during the response', async () => {
  const x = fixture(); let active = true;
  const result = await x.session.solveAndFillPuzzle({ setId: 19, challengeId: 43 }, {
    isCurrent: () => active, onProgress: stage => { if (stage === 'verifying') active = false; },
  });
  expect(result.status).toBe('filled'); expect(state.saves).toBe(1);
});
