import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { readFc27StreamlinedInputs, projectFc27StreamlinedItem } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { createFc27StreamlinedValidator } from '../../src/adapters/ea/fc27-streamlined-validation.js';
import extraVersion from '../fixtures/streamlined-club-extra-version.json';
import { addStorageRuntime } from '../helpers/fc27-storage-runtime.js';

function setup({ storage = false, endTime = 0 } = {}) {
  const f = executionRuntime();
  f.root.document = {};
  const anchor = { isConnected: true, ownerDocument: f.root.document };
  const challenge = { id: 61, setId: 31, status: 'IN_PROGRESS', isOneClickChallenge: () => true,
    scoreRequirement: 100, submittedScore: 0, eligibilityOperation: 'AND',
    eligibilityRequirements: [{ count: -1, scope: 0, kvPairs: { _collection: { 40: [45], 41: [1] } } }] };
  const set = { id: 31, repeats: 1, repeatabilityMode: 'REFRESH', endTime };
  class Split { constructor() { this.workAreaController = { viewModel: { getChallenge: () => challenge, getSet: () => set,
    getSelectionLimit: () => 30 }, getView: () => ({ getRootElement: () => anchor }) }; } }
  f.root.UTOneClickSBCWorkAreaSplitViewController = Split;
  const controller = new Split();
  f.root.getAppMain = () => ({ getRootViewController: () => ({ currentController: controller }) });
  f.root.UTEvolutionEligibilityVO = class { isValid = true; meetsRequirements = item => item._rating >= 45; };
  for (const item of Object.values(f.root.repositories.Item.club.items._collection)) item.sbsScore = 20;
  const input = readFc27StreamlinedInputs(f.root);
  const selected = input.inventory.slice(0, 5).map(item => storage ? { ...item, pile: 'storage' } : item);
  const result = { status: 'ready', items: selected, batches: [selected], score: 100,
    progress: { target: 100, submitted: 0, added: 100, total: 100, remaining: 0, excess: 0, reached: true },
    purchaseCost: 0, materialValue: null, searchComplete: true };
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge,
    policy: input.policy, result });
  const batch = { index: 0, refs: selected.map(({ id, definitionId, points, pile }) => ({ id, definitionId, points, pile })) };
  f.state.filterClubQueries = true;
  f.state.playerFacts = { sbsScore: 20 };
  return { ...f, challenge, set, controller, input, plan, selected, batch };
}

function transportFor(f, mutate = () => {}) {
  return async (_root, { onEntity }) => ({
    getRequestCount: () => 1,
    readPage: async ({ definitionIds }) => {
      const rows = f.selected.filter(item => definitionIds.includes(item.definitionId)).map(item => {
        const raw = structuredClone(f.root.repositories.Item.club.items._collection[item.id]);
        mutate(raw, item);
        onEntity(raw);
        return { id: raw.id, definitionId: raw.definitionId, pile: raw.utasPile === 7 ? 'club' : null };
      });
      return rows;
    },
  });
}

function purchasedSetup({ receipt = true, maxRating = 82, marketMaxRating = 99 } = {}) {
  const f = setup();
  f.root.info.set.goldenrange = 82;
  const raw = f.root.repositories.Item.club.items._collection[1];
  raw._rating = 84; raw.tradable = true;
  f.input = readFc27StreamlinedInputs(f.root, { maxRating, marketMaxRating });
  const bought = { ...projectFc27StreamlinedItem(raw, f.root, 'club') };
  if (receipt) bought.purchaseReceipt = { operationId: 'test-purchase', itemId: 1, definitionId: 101, tradeId: 'trade-1', price: 1100 };
  f.selected = [bought, ...f.selected.slice(1)];
  f.plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge, policy: f.input.policy,
    result: { ...f.plan, items: f.selected, batches: [f.selected] } });
  return f;
}

it('allows an exact verified purchased 84 above stock range 82 without changing its real rating', async () => {
  const f = purchasedSetup(), purchaseVerifier = vi.fn(async () => true);
  await expect(createFc27StreamlinedValidator(f.root, { createTransport: transportFor(f), purchaseVerifier })
    .verify(f.plan, f.batch, 0)).resolves.toMatchObject({ fresh: true, count: 5 });
  expect(purchaseVerifier).toHaveBeenCalledWith(expect.objectContaining({ rating: 84, tradeable: true }),
    expect.objectContaining({ itemId: 1, definitionId: 101 }), f.plan);
  expect(f.plan.policy.goldRange).toEqual([75, 82]);
});

it('does not extend the purchased exception to unreceipted stock, explicit caps or changed material', async () => {
  for (const scenario of ['no-receipt', 'explicit-cap', 'special', 'rating-changed', 'other-stock']) {
    const f = purchasedSetup({ receipt: scenario !== 'no-receipt', marketMaxRating: scenario === 'explicit-cap' ? 82 : 99 });
    const mutate = (raw, item) => {
      if (item.id === 1 && scenario === 'special') raw._rareflag = 72;
      if (item.id === 1 && scenario === 'rating-changed') raw._rating = 85;
      if (item.id === 2 && scenario === 'other-stock') raw._rating = 84;
    };
    await expect(createFc27StreamlinedValidator(f.root, { createTransport: transportFor(f, mutate), purchaseVerifier: async () => true })
      .verify(f.plan, f.batch, 0)).rejects.toThrow('MATERIAL_CHANGED');
  }
});

it('requires a verified receipt bound to the exact purchased entity', async () => {
  for (const scenario of ['missing-verifier', 'rejected', 'wrong-item', 'wrong-version']) {
    const f = purchasedSetup();
    if (scenario === 'wrong-item' || scenario === 'wrong-version') {
      f.selected[0].purchaseReceipt[scenario === 'wrong-item' ? 'itemId' : 'definitionId'] = 999;
      f.plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge, policy: f.input.policy,
        result: { ...f.plan, items: f.selected, batches: [f.selected] } });
    }
    await expect(createFc27StreamlinedValidator(f.root, { createTransport: transportFor(f),
      purchaseVerifier: scenario === 'missing-verifier' ? null : async () => scenario !== 'rejected' })
      .verify(f.plan, f.batch, 0)).rejects.toThrow('PURCHASE_RECEIPT_UNVERIFIED');
  }
});

it('performs one targeted fresh Club read and never mutates the repository', async () => {
  const f = setup();
  const before = structuredClone(f.root.repositories.Item.club.items._collection);
  const progress = vi.fn();
  const result = await createFc27StreamlinedValidator(f.root)
    .verify(f.plan, f.batch, 0, { onProgress: progress });
  expect(result).toMatchObject({ fresh: true, count: 5, points: 100, requests: 1, contributionReady: false });
  expect(progress).toHaveBeenCalledWith({ phase: 'validation', completed: 5, total: 5 });
  expect(f.root.repositories.Item.club.items._collection).toEqual(before);
  expect(f.calls).toEqual([expect.objectContaining({ method: 'POST',
    url: 'https://utas.test.ea.com/ut/game/fc27/club',
    body: { type: 'player', start: 0, count: 250, defId: '101,102,103,104,105' }, retry: false, reauth: false })]);
});

it('fails closed for missing, wrong-pile, identity and changed-score evidence', async () => {
  const cases = [
    ['MATERIAL_MISSING', (raw, item) => { if (item.id === 1) raw.id = 999; }],
    ['FRESH_ENTITY_UNVERIFIED', (raw, item) => { if (item.id === 1) raw.definitionId = 999; }],
    ['FRESH_ENTITY_UNVERIFIED', (raw, item) => { if (item.id === 1) raw.utasPile = 9; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw.sbsScore = 35; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw.tradable = true; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw.loans = 0; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw._rating = 40; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw._rating = 61; }],
    ['MATERIAL_CHANGED', (raw, item) => { if (item.id === 1) raw.leagueId = 11; }],
  ];
  for (const [reason, mutate] of cases) {
    const f = setup();
    await expect(createFc27StreamlinedValidator(f.root, { createTransport: transportFor(f, mutate) })
      .verify(f.plan, f.batch, 0)).rejects.toThrow(`FC27_STREAMLINED_${reason}`);
  }
  const f = setup();
  const bad = structuredClone(f.plan); bad.batches[0][0].pile = 'storage';
  await expect(createFc27StreamlinedValidator(f.root, { createTransport: transportFor(f) })
    .verify(bad, { index: 0, refs: bad.batches[0] }, 0)).rejects.toThrow('FC27_STREAMLINED_PLAN_CHANGED');
});

it('stops when the page context, policy or cancellation changes during the read', async () => {
  const changes = [
    ['PROGRESS_CHANGED', f => { f.challenge.submittedScore = 1; }],
    ['PROGRESS_CHANGED', f => { f.challenge.scoreRequirement = 101; }],
    ['CONTEXT_CHANGED', f => { f.root.getAppMain = () => null; }],
    ['POLICY_CHANGED', f => { f.root.info.set.shield_league = [20, 21]; }],
  ];
  for (const [reason, change] of changes) {
    const f = setup();
    const transport = transportFor(f, () => change(f));
    await expect(createFc27StreamlinedValidator(f.root, { createTransport: transport })
      .verify(f.plan, f.batch, 0)).rejects.toThrow(`FC27_STREAMLINED_${reason}`);
  }
  const g = setup();
  await expect(createFc27StreamlinedValidator(g.root, { createTransport: transportFor(g) })
    .verify(g.plan, g.batch, 0, { stopped: () => true })).rejects.toThrow('FC27_STREAMLINED_CANCELLED');
});

it('rechecks expiry after the response and cancellation before another query', async () => {
  const f = setup({ endTime: 1 }); let clock = 500;
  await expect(createFc27StreamlinedValidator(f.root, { now: () => clock,
    createTransport: transportFor(f, () => { clock = 1000; }) }).verify(f.plan, f.batch, 0))
    .rejects.toThrow('CHALLENGE_EXPIRED');
  const g = setup(); let stopped = false;
  await expect(createFc27StreamlinedValidator(g.root, {
    createTransport: transportFor(g, () => { stopped = true; }) }).verify(g.plan, g.batch, 0, { stopped: () => stopped }))
    .rejects.toThrow('CANCELLED');
});

it('reads Storage independently and checks exact batch references before requesting', async () => {
  const f = setup({ storage: true }), createTransport = vi.fn();
  addStorageRuntime(f, { payload: f.selected.map(item => ({ id: item.id, resourceId: item.definitionId, pile: 8 })) });
  const validator = createFc27StreamlinedValidator(f.root, { createTransport });
  await expect(validator.verify(f.plan, f.batch, 0)).resolves.toMatchObject({ fresh: true, count: 5, requests: 1 });
  await expect(validator.verify(f.plan, { ...f.batch, refs: f.batch.refs.slice(1) }, 0)).rejects.toThrow('PLAN_CHANGED');
  expect(createTransport).not.toHaveBeenCalled();
});

it('validates a mixed Club and Storage batch with one request per pile', async () => {
  const f = setup();
  const storageSelected = f.selected.slice(0, 2).map(item => ({ ...item, id: item.id + 500, key: `item:${item.id + 500}`, pile: 'storage' }));
  const clubSelected = f.selected.slice(0, 3);
  const selected = [...storageSelected, ...clubSelected];
  const result = { status: 'ready', items: selected, batches: [selected], score: 100,
    progress: { target: 100, submitted: 0, added: 100, total: 100, remaining: 0, excess: 0, reached: true },
    purchaseCost: 0, materialValue: null, searchComplete: true };
  const plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge,
    policy: f.input.policy, result });
  addStorageRuntime(f, { payload: storageSelected.map(item => ({ id: item.id, resourceId: item.definitionId, pile: 8 })) });
  const validator = createFc27StreamlinedValidator(f.root);
  const refs = selected.map(({ id, definitionId, points, pile }) => ({ id, definitionId, points, pile }));
  await expect(validator.verify(plan, { index: 0, refs }, 0))
    .resolves.toMatchObject({ fresh: true, count: 5, requests: 2 });
  expect(f.calls.map(call => call.kind)).toEqual(['request', 'storage']);
});

it('rejects missing Storage copies and changed Storage version, rating or protection', async () => {
  for (const change of ['missing', 'version', 'rating', 'tradeable', 'loan', 'score']) {
    const f = setup({ storage: true });
    const payload = f.selected.map(item => ({ id: item.id, resourceId: item.definitionId, pile: 8 }));
    if (change === 'missing') payload[0].id = 501; // same version is not the planned copy
    if (change === 'version') payload[0].resourceId = 999;
    const facts = { rating: { _rating: 61 }, tradeable: { tradable: true }, loan: { loans: 0 }, score: { sbsScore: 35 } };
    if (facts[change]) f.state.playerFactsById = { 1: facts[change] };
    addStorageRuntime(f, { payload });
    await expect(createFc27StreamlinedValidator(f.root).verify(f.plan, f.batch, 0))
      .rejects.toThrow(change === 'missing' ? 'MATERIAL_MISSING' : change === 'version' ? 'FRESH_ENTITY_UNVERIFIED' : 'MATERIAL_CHANGED');
    expect(f.calls.map(call => call.kind)).toEqual(['storage']);
  }
});

it('serializes checks, releases busy after failure, and excludes account switches', async () => {
  const f = setup(); let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const createTransport = async (...args) => {
    started(); await new Promise(resolve => { release = resolve; });
    return transportFor(f)(...args);
  };
  const validator = createFc27StreamlinedValidator(f.root, { createTransport });
  const first = validator.verify(f.plan, f.batch, 0);
  await entered;
  await expect(validator.verify(f.plan, f.batch, 0)).rejects.toThrow('BUSY');
  release(); await expect(first).resolves.toMatchObject({ fresh: true });
  f.user.selectedPersona = 444;
  await expect(validator.verify(f.plan, f.batch, 0)).rejects.toThrow();
  f.user.selectedPersona = 902;
  const next = validator.verify(f.plan, f.batch, 0);
  await Promise.resolve(); release();
  await expect(next).resolves.toMatchObject({ fresh: true });
});

it('uses independently fresh progress for later batches without rewriting a stale page', async () => {
  const f = setup();
  const readProgress = async () => ({ fresh: true, observedAt: 1000,
    challenge: { ...f.plan.challenge, submittedScore: 20, remainingScore: 80 } });
  const validator = createFc27StreamlinedValidator(f.root, { now: () => 1000, readProgress });
  await expect(validator.verify(f.plan, f.batch, 20)).resolves.toMatchObject({ fresh: true });
  expect(f.challenge.submittedScore).toBe(0);
  const wrong = createFc27StreamlinedValidator(f.root, { now: () => 1000,
    readProgress: async () => ({ ...await readProgress(), observedAt: 1001 }) });
  await expect(wrong.verify(f.plan, f.batch, 20)).rejects.toThrow('PROGRESS_CHANGED');
});

it('ignores extra returned versions but still requires every exact selected item and definition', async () => {
  const f = setup(), original = transportFor(f);
  const createTransport = async (root, options) => {
    const transport = await original(root, options);
    return { ...transport, async readPage(query) {
      const rows = await transport.readPage(query);
      options.onEntity(extraVersion.syntheticExtra);
      return [...rows, extraVersion.syntheticExtra];
    } };
  };
  await expect(createFc27StreamlinedValidator(f.root, { createTransport }).verify(f.plan, f.batch, 0))
    .resolves.toMatchObject({ fresh: true, count: 5 });
});
