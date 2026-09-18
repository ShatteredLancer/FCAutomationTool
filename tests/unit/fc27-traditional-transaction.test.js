import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createTraditionalTransaction } from '../../src/fc27/traditional-transaction.js';
import { createFc27TransactionPersistence } from '../../src/adapters/browser/fc27-transaction-persistence.js';

function fixture(options = {}) {
  let time = 10000;
  const context = { schema: 1, season: '27', accountScope: 'private-synthetic-account', platform: 'pc' };
  const contract = { schema: 1, source: 'fresh-dao', context, observedAt: time,
    set: { id: 4, name: 'Synthetic', challengesCount: 1, challengesCompletedCount: 0,
      timesCompleted: 0, repeats: 0, repeatabilityMode: 'UNLIMITED', startTime: 0, endTime: 0 },
    challenge: { schema: 1, context, mechanism: 'traditional', requirementsOperation: 'AND', completed: false,
      setId: 4, id: 16, slotCount: 11, brickIndices: [2,3,4,5,6,7,8,9,10],
      requirements: [{ kind: 'player-count', count: 2 }, { kind: 'player-max-overall', count: 2, value: 64 }] },
    rewards: [{ scope: 'set', type: 'pack', value: 509, count: 1, tradable: false }] };
  const policy = { schema: 1, context, reviewed: true, maxRating: 74, onlyUntradeable: true,
    goldRange: [75,83], protectFsuLockedPlayers: true, protectActiveSquad: true, storageFirst: true, excludedLeagueIds: [20] };
  const item = id => ({ id, definitionId: id + 100, type: 'player', pile: 'club', rating: 60 + id, rarity: 0,
    special: false, evolution: false, cosmetic: false, concept: false, academyEnrolled: false, activeTrade: false,
    state: 'free', limitedUse: false, loans: -1, protected: false, tradeable: false, leagueId: 1, locked: false, activeSquad: false });
  const inventory = { schema: 1, kind: 'normalized-inventory', context, status: 'provisional', items: [item(1),item(2)] };
  const events = [];
  let record = null;
  const journal = { read: vi.fn(async () => structuredClone(record)),
    write: vi.fn(async (_key, value) => { record = structuredClone(value); events.push(`journal:${value.phase}`); }) };
  let stopped = false;
  let operationSequence = 0;
  const adapter = { capabilities: { verified: true, submitWithoutSave: true },
    readInputs: vi.fn(async () => ({ contract: structuredClone(contract), policy: structuredClone(policy), unassignedClear: true })),
    validateItems: vi.fn(async () => { events.push('validate'); return { context, fresh: true, items: structuredClone(inventory.items) }; }),
    readRewardBaseline: vi.fn(async () => ({ context, fresh: true, packId: 509, count: 3 })),
    save: vi.fn(async () => { events.push('save'); return { status: 'confirmed', setId: 4, challengeId: 16 }; }),
    readSavedSquad: vi.fn(async () => { events.push('read-saved'); return { context, fresh: true, setId: 4, challengeId: 16, ready: true,
      items: inventory.items.map((item, slot) => ({ ...item, slot })) }; }),
    submit: vi.fn(async () => { events.push('submit'); return { status: 'confirmed', setId: 4, challengeId: 16 }; }),
    reconcile: vi.fn(async () => { events.push('reconcile'); return { context, fresh: true, setId: 4, challengeId: 16,
      progressConfirmed: true, consumed: inventory.items.map(({ id, definitionId, pile }) => ({ id, definitionId, pile })),
      packId: 509, packCount: 4 }; }),
  };
  const settings = { enabled: true, adapter, journal, exclusive: async (_key, work) => work(),
    now: () => time, createOperationId: () => `synthetic-operation-${++operationSequence}`, shouldStop: () => stopped, ...options };
  const engine = createTraditionalTransaction(settings);
  const prepare = () => engine.prepare({ contract, policy, inventory });
  const approve = plan => engine.approve(plan, { approved: true, setId: 4, challengeId: 16, maxRating: 74, maxPlayers: 2, count: 1 });
  return { engine, prepare, approve, contract, policy, inventory, adapter, journal, settings, events,
    record: () => record, setRecord: value => { record = value; }, stop: () => { stopped = true; },
    advance: ms => { time += ms; } };
}
afterEach(() => vi.useRealTimers());

const observation = JSON.parse(readFileSync(new URL('../fixtures/fc27-fresh-sbc-contract-observation.json', import.meta.url), 'utf8'));
it.each(observation.contracts)('prepares the live $set.name facts using explicitly synthetic sufficient inventory', observed => {
  const x = fixture({ now: () => observed.observedAt });
  const context = x.contract.context;
  const contract = { ...observed, context, challenge: { ...observed.challenge, context } };
  const rating = observed.set.id === 4 ? 60 : 80;
  x.inventory.items = Array.from({ length: 11 }, (_, index) => ({ ...x.inventory.items[0], id: index + 1, definitionId: 101 + index, rating }));
  const result = x.engine.prepare({ contract, policy: { ...x.policy, maxRating: 83 }, inventory: x.inventory });
  expect(result).toMatchObject({ status: 'prepared', set: { id: observed.set.id }, rewards: observed.rewards });
  expect(result.selected).toHaveLength(11);
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it('reuses the shared transaction without pulling EA adapters, legacy workflows or UI into the core', async () => {
  const result = await build({ entryPoints: ['src/fc27/traditional-transaction.js'], bundle: true, write: false,
    metafile: true, format: 'esm', minify: true });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/')).sort();
  expect(inputs).toEqual([
    'src/domain/contracts.js', 'src/domain/player-rarity.js', 'src/fc27/prelaunch-contract.js',
    'src/fc27/traditional-journal.js',
    'src/fc27/traditional-preview.js', 'src/fc27/traditional-transaction.js', 'src/sbc/submit-attempt.js',
  ]);
  expect(result.outputFiles[0].contents.length).toBeLessThan(25000);
});

it('uses the shared transaction for exact validation, one save, saved reread, one submit and reconciliation', async () => {
  const x = fixture(); const prepared = x.prepare();
  expect(prepared.status).toBe('prepared');
  const result = await x.engine.execute(x.approve(prepared).permit);
  expect(result).toMatchObject({ status: 'completed', submitted: true, consumedCount: 2, rewardCount: 1 });
  expect(x.adapter.save).toHaveBeenCalledOnce(); expect(x.adapter.submit).toHaveBeenCalledOnce();
  expect(x.adapter.submit.mock.calls[0][1]).toEqual({ skipValidation: false });
  expect(x.events.indexOf('validate')).toBeLessThan(x.events.indexOf('save'));
  expect(x.events.indexOf('read-saved')).toBeGreaterThan(x.events.indexOf('save'));
  expect(x.events.indexOf('read-saved')).toBeLessThan(x.events.indexOf('submit'));
  expect(x.events.indexOf('submit')).toBeLessThan(x.events.indexOf('reconcile'));
  expect(x.record().phase).toBe('completed');
  expect(JSON.stringify(result)).not.toMatch(/private-synthetic|definitionId|itemRefs|permit/);
});

it('is disabled by default and never authorizes arbitrary handles or mismatched limits', async () => {
  const x = fixture({ enabled: undefined });
  expect(x.approve(x.prepare()).reason).toBe('FC27_LIVE_DISABLED');
  expect((await x.engine.execute({})).reason).toBe('FC27_LIVE_DISABLED');
  expect(x.adapter.save).not.toHaveBeenCalled();
  const y = fixture(); const plan = y.prepare();
  expect(y.engine.approve(plan, { approved: true }).status).toBe('blocked');
  expect(y.approve(structuredClone(plan)).status).toBe('blocked');
});

it.each([1, 'true'])('does not treat non-boolean enablement %s as write authority', async enabled => {
  const x = fixture({ enabled });
  expect(x.approve(x.prepare()).reason).toBe('FC27_LIVE_DISABLED');
  expect((await x.engine.execute({})).reason).toBe('FC27_LIVE_DISABLED');
});

it('blocks revoked adapter verification before saving', async () => {
  const x = fixture();
  const validate = x.adapter.validateItems.getMockImplementation();
  x.adapter.validateItems.mockImplementation(async () => {
    const result = await validate(); x.adapter.capabilities.verified = false; return result;
  });
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_TRANSACTION_ADAPTER_UNVERIFIED');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it.each(['shortage','protected','special','evolution','tradeable','league','expiry','reward','rarity','storage'])('rejects %s before creating an executable plan', kind => {
  const x = fixture();
  if (kind === 'shortage') x.inventory.items.pop();
  if (['protected','special','evolution','tradeable'].includes(kind)) x.inventory.items[0][kind] = true;
  if (kind === 'league') x.inventory.items[0].leagueId = 20;
  if (kind === 'expiry') x.contract.set.endTime = 1;
  if (kind === 'reward') x.contract.rewards[0].type = 'unknown';
  if (kind === 'rarity') delete x.inventory.items[0].rarity;
  if (kind === 'storage') x.inventory.items[0].pile = 'storage';
  expect(x.prepare().status).toBe('blocked');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it('freezes the exact prepared selection and invalidates expired approvals', async () => {
  const x = fixture(); const plan = x.prepare();
  expect(Object.isFrozen(plan.selected[0])).toBe(true);
  const { permit } = x.approve(plan); x.advance(60001);
  expect((await x.engine.execute(permit)).reason).toBe('FC27_APPROVAL_EXPIRED');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it.each(['identity','rating','rarity','league','tradeable','missing','cached'])('blocks changed %s during exact item validation without substituting cards', async kind => {
  const x = fixture(); const plan = x.prepare(); const { permit } = x.approve(plan);
  const snapshot = { context: x.contract.context, fresh: true, items: structuredClone(x.inventory.items) };
  if (kind === 'identity') snapshot.items[0].id = 88;
  if (kind === 'rating') snapshot.items[0].rating++;
  if (kind === 'rarity') snapshot.items[0].rarity = 1;
  if (kind === 'league') snapshot.items[0].leagueId = 2;
  if (kind === 'tradeable') snapshot.items[0].tradeable = true;
  if (kind === 'missing') snapshot.items.pop();
  if (kind === 'cached') snapshot.fresh = false;
  x.adapter.validateItems.mockResolvedValue(snapshot);
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  expect(x.adapter.save).not.toHaveBeenCalled(); expect(x.adapter.submit).not.toHaveBeenCalled();
});

it.each(['policy','context','reward','unassigned'])('blocks %s drift before saving', async kind => {
  const x = fixture(); const { permit } = x.approve(x.prepare());
  if (kind === 'policy') x.policy.excludedLeagueIds.push(1);
  if (kind === 'context') x.contract.context.accountScope = 'different-account';
  if (kind === 'reward') x.contract.rewards[0].value = 1022;
  if (kind === 'unassigned') x.adapter.readInputs.mockResolvedValue({ contract: x.contract, policy: x.policy, unassignedClear: false });
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it('does not submit a different saved slot or item, and preserves the saved boundary', async () => {
  const x = fixture(); const original = x.adapter.readSavedSquad.getMockImplementation();
  x.adapter.readSavedSquad.mockImplementation(async () => { const result = await original(); result.items[0].slot = 2; return result; });
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({ status: 'blocked', submitted: false });
  expect(x.adapter.submit).not.toHaveBeenCalled(); expect(x.record().phase).toBe('saved');
});

it.each(['save','submit'])('retains an unknown %s boundary across a new engine and never retries', async phase => {
  const x = fixture(); x.adapter[phase].mockRejectedValue(new Error('private-response'));
  const result = await x.engine.execute(x.approve(x.prepare()).permit);
  expect(result).toMatchObject({ status: 'blocked', recoveryRequired: true });
  expect(x.record().phase).toBe(`${phase}-pending`);
  const restarted = createTraditionalTransaction(x.settings);
  const plan = restarted.prepare({ contract: x.contract, policy: x.policy, inventory: x.inventory });
  const permit = restarted.approve(plan, { approved: true, setId: 4, challengeId: 16, maxRating: 74, maxPlayers: 2, count: 1 }).permit;
  expect((await restarted.execute(permit)).reason).toBe('FC27_RECOVERY_REQUIRED');
  expect(x.adapter[phase]).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('private-response');
});

it('never retries or forces confirmation after a 409 rejection', async () => {
  const x = fixture(); x.adapter.submit.mockResolvedValue({ status: 'rejected', httpStatus: 409, setId: 4, challengeId: 16 });
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({ status: 'blocked', submitted: false, reason: 'FC27_SUBMIT_REJECTED' });
  expect(x.adapter.submit).toHaveBeenCalledOnce(); expect(x.adapter.reconcile).not.toHaveBeenCalled();
});

it('defers Stop after confirmed submit until reconciliation and preserves completed result', async () => {
  const x = fixture(); x.adapter.submit.mockImplementation(async () => { x.stop(); return { status: 'confirmed', setId: 4, challengeId: 16 }; });
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({ status: 'completed', submitted: true });
  expect(x.adapter.reconcile).toHaveBeenCalledOnce();
});

it('honors Stop before save and after save without submitting', async () => {
  for (const phase of ['before','after']) {
    const x = fixture(); const { permit } = x.approve(x.prepare());
    if (phase === 'before') x.stop();
    else x.adapter.save.mockImplementation(async () => { x.stop(); return { status: 'confirmed', setId: 4, challengeId: 16 }; });
    expect((await x.engine.execute(permit)).reason).toBe('FC27_STOP_REQUESTED');
    expect(x.adapter.submit).not.toHaveBeenCalled();
  }
});

it.each(['missing-reward','wrong-consumed','stale','wrong-target','read-failure'])('retains confirmed submission when reconciliation has %s', async kind => {
  const x = fixture(); const reconciliation = await x.adapter.reconcile(); x.adapter.reconcile.mockClear();
  if (kind === 'missing-reward') reconciliation.packCount = 3;
  if (kind === 'wrong-consumed') reconciliation.consumed[0].id = 88;
  if (kind === 'stale') reconciliation.fresh = false;
  if (kind === 'wrong-target') reconciliation.challengeId = 17;
  if (kind === 'read-failure') x.adapter.reconcile.mockRejectedValue(new Error('private'));
  else x.adapter.reconcile.mockResolvedValue(reconciliation);
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({ status: 'blocked', submitted: true, recoveryRequired: true });
  expect(x.record().phase).toBe('submitted');
});

it('blocks duplicate clicks and consumes approval once', async () => {
  const x = fixture(); let release;
  const original = x.adapter.validateItems.getMockImplementation();
  x.adapter.validateItems.mockImplementationOnce(() => new Promise(resolve => { release = async () => resolve(await original()); }));
  const plan = x.prepare(); const { permit } = x.approve(plan);
  const pending = x.engine.execute(permit);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  await release(); await pending;
  expect((await x.engine.execute(permit)).reason).toBe('FC27_APPROVAL_INVALID');
  expect(x.approve(plan).reason).toBe('FC27_APPROVAL_INVALID');
  expect(x.adapter.submit).toHaveBeenCalledOnce();
});

it('never saves when journal persistence fails', async () => {
  const x = fixture(); x.journal.write.mockRejectedValue(new Error('disk unavailable'));
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_JOURNAL_UNCONFIRMED');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it('still reconciles a confirmed submit when its journal update fails', async () => {
  const x = fixture(); const write = x.journal.write.getMockImplementation();
  x.journal.write.mockImplementation(async (key, record) => {
    if (record.phase === 'submitted') throw new Error('private disk error');
    return write(key, record);
  });
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({
    status: 'blocked', reason: 'FC27_JOURNAL_UNCONFIRMED', submitted: true, recoveryRequired: true,
  });
  expect(x.adapter.reconcile).toHaveBeenCalledOnce();
  expect(x.record().phase).toBe('submit-pending');
});

it('rechecks policy after the final saved-squad read before sending submit', async () => {
  const x = fixture(); const read = x.adapter.readSavedSquad.getMockImplementation();
  let calls = 0;
  x.adapter.readSavedSquad.mockImplementation(async () => {
    const result = await read(); if (++calls === 3) x.policy.excludedLeagueIds.push(1); return result;
  });
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_ATTEMPT_INPUTS_CHANGED');
  expect(x.adapter.submit).not.toHaveBeenCalled();
});

it.each([{}, { schema: 1, phase: 'completed', submitted: true }])('does not overwrite a malformed existing journal', async record => {
  const x = fixture(); x.setRecord(record);
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_RECOVERY_REQUIRED');
  expect(x.journal.write).not.toHaveBeenCalled(); expect(x.adapter.save).not.toHaveBeenCalled();
});

it.each(['completed', 'rejected'])('rejects corrupted %s refs or reward metadata before replacing the journal', async phase => {
  const corruptions = [
    record => { record.itemRefs[1].id = record.itemRefs[0].id; },
    record => { record.itemRefs[1].definitionId = record.itemRefs[0].definitionId; },
    record => { record.itemRefs[0] = null; },
    record => { delete record.reward; },
    record => { record.reward.scope = 'unknown'; },
    record => { record.reward.type = 'unknown'; },
    record => { record.reward.value = 0; },
    record => { record.reward.count = 0; },
    record => { record.reward.count = 11; },
    record => { delete record.reward.tradable; },
    record => { delete record.rewardBaselineCount; },
    record => { record.rewardBaselineCount = -1; },
    record => { record.rewardBaselineCount = '3'; },
  ];
  for (const corrupt of corruptions) {
    const x = fixture(); await x.engine.execute(x.approve(x.prepare()).permit);
    const record = x.record();
    record.phase = phase; record.submitted = phase === 'completed'; corrupt(record);
    const original = structuredClone(record);
    x.adapter.save.mockClear(); x.adapter.submit.mockClear(); x.journal.write.mockClear();
    expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({
      reason: 'FC27_RECOVERY_REQUIRED', recoveryRequired: true,
    });
    expect(x.adapter.save).not.toHaveBeenCalled(); expect(x.journal.write).not.toHaveBeenCalled();
    expect(x.adapter.submit).not.toHaveBeenCalled(); expect(x.record()).toEqual(original);
  }
});

it.each(['completed', 'rejected'])('allows a new approved attempt after an intact %s record', async phase => {
  const x = fixture();
  if (phase === 'rejected') x.adapter.submit.mockResolvedValueOnce({ status: 'rejected', setId: 4, challengeId: 16 });
  await x.engine.execute(x.approve(x.prepare()).permit);
  expect(x.record().phase).toBe(phase);
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({ status: 'completed', submitted: true });
  expect(x.adapter.save).toHaveBeenCalledTimes(2); expect(x.adapter.submit).toHaveBeenCalledTimes(2);
});

it('does not authorize Service submit-with-save or enter effects without exclusive access', async () => {
  const x = fixture(); x.adapter.capabilities.submitWithoutSave = false;
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_TRANSACTION_ADAPTER_UNVERIFIED');
  expect(x.adapter.save).not.toHaveBeenCalled();
  const y = fixture({ exclusive: async () => null });
  expect((await y.engine.execute(y.approve(y.prepare()).permit)).reason).toBe('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  expect(y.adapter.readInputs).not.toHaveBeenCalled();
});

it('preserves confirmed submission if the exclusive provider fails while releasing the lock', async () => {
  const x = fixture({ exclusive: async (_key, work) => { await work(); throw new Error('private release failure'); } });
  expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({
    status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_LOST', submitted: true,
  });
  expect(x.adapter.reconcile).toHaveBeenCalledOnce();
});

it('does not mutate when the exclusive provider releases before its operation finishes', async () => {
  const x = fixture({ exclusive: async (_key, work) => { void work(); return null; } });
  expect((await x.engine.execute(x.approve(x.prepare()).permit)).reason).toBe('FC27_EXCLUSIVE_ACCESS_LOST');
  expect(x.adapter.save).not.toHaveBeenCalled(); expect(x.adapter.submit).not.toHaveBeenCalled();
});

it('rejects missing or mismatched confirmation without inferring success from an empty callback', async () => {
  for (const receipt of [undefined, { status: 'confirmed', setId: 4, challengeId: 99 }]) {
    const x = fixture(); x.adapter.submit.mockResolvedValue(receipt);
    expect(await x.engine.execute(x.approve(x.prepare()).permit)).toMatchObject({
      reason: 'FC27_SUBMIT_UNCONFIRMED', submitted: null, recoveryRequired: true,
    });
    expect(x.adapter.reconcile).not.toHaveBeenCalled();
    expect(x.record()).toMatchObject({ phase: 'submit-pending', submitted: null });
  }
});

it('times out a mutation, retains its boundary and cannot retry with the same approval', async () => {
  vi.useFakeTimers(); const x = fixture(); x.adapter.submit.mockImplementation(() => new Promise(() => {}));
  const { permit } = x.approve(x.prepare()); const pending = x.engine.execute(permit);
  await vi.advanceTimersByTimeAsync(15001);
  expect(await pending).toMatchObject({ reason: 'FC27_OPERATION_TIMEOUT', recoveryRequired: true, submitted: null });
  expect(x.record().phase).toBe('submit-pending');
  expect((await x.engine.execute(permit)).reason).toBe('FC27_APPROVAL_INVALID');
});

function persistenceFixture() {
  const x = fixture();
  const values = new Map();
  const gmGetValue = vi.fn(async (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback);
  const gmSetValue = vi.fn(async (key, value) => { values.set(key, structuredClone(value)); });
  let held = false;
  const lockManager = { request: async (name, options, work) => {
    if (held) return work(null);
    held = true;
    try { return await work({ name, mode: options.mode }); } finally { held = false; }
  } };
  const recreate = () => {
    const provider = createFc27TransactionPersistence({ context: x.contract.context, gmGetValue, gmSetValue, lockManager });
    const engine = createTraditionalTransaction({ ...x.settings, ...provider });
    return { provider, engine, run: () => {
      const plan = engine.prepare({ contract: x.contract, policy: x.policy, inventory: x.inventory });
      return engine.execute(engine.approve(plan, { approved: true, setId: 4, challengeId: 16,
        maxRating: 74, maxPlayers: 2, count: 1 }).permit);
    } };
  };
  return { ...x, values, gmGetValue, gmSetValue, recreate, ...recreate() };
}

it('composes the real journal and exclusion providers with simulated EA effects end to end', async () => {
  const x = persistenceFixture();
  expect(await x.run()).toMatchObject({ status: 'completed', submitted: true });
  expect(x.gmSetValue.mock.calls.map(([, value]) => value.phase)).toEqual([
    'save-pending', 'saved', 'submit-pending', 'submitted', 'completed',
  ]);
  expect(await x.recreate().run()).toMatchObject({ status: 'completed', submitted: true });
  expect(x.adapter.submit).toHaveBeenCalledTimes(2);
});

it.each(['save', 'submit', 'reconcile'])('retains the durable %s boundary after recreating the whole composition', async phase => {
  const x = persistenceFixture(); x.adapter[phase].mockRejectedValue(new Error('synthetic failure'));
  expect(await x.run()).toMatchObject({ status: 'blocked', recoveryRequired: true });
  const previous = structuredClone([...x.values]); x.gmSetValue.mockClear(); x.adapter.save.mockClear();
  expect(await x.recreate().run()).toMatchObject({ reason: 'FC27_RECOVERY_REQUIRED', recoveryRequired: true });
  expect(x.gmSetValue).not.toHaveBeenCalled(); expect(x.adapter.save).not.toHaveBeenCalled();
  expect([...x.values]).toEqual(previous);
});

it('flags recovery when reading the durable journal fails before any EA effect', async () => {
  const x = persistenceFixture(); x.gmGetValue.mockRejectedValue(new Error('private'));
  expect(await x.run()).toMatchObject({ reason: 'FC27_JOURNAL_READ_UNCONFIRMED', recoveryRequired: true });
  expect(x.adapter.readInputs).not.toHaveBeenCalled(); expect(x.adapter.save).not.toHaveBeenCalled();
  expect(x.gmSetValue).not.toHaveBeenCalled();
});

it('retains recovery when a confirmed rejection cannot be journaled', async () => {
  const x = persistenceFixture(); const write = x.gmSetValue.getMockImplementation();
  x.adapter.submit.mockResolvedValue({ status: 'rejected', setId: 4, challengeId: 16 });
  x.gmSetValue.mockImplementation(async (key, value) => {
    if (value.phase === 'rejected') throw new Error('private');
    return write(key, value);
  });
  expect(await x.run()).toMatchObject({ submitted: false, reason: 'FC27_JOURNAL_UNCONFIRMED', recoveryRequired: true });
  expect(await x.recreate().run()).toMatchObject({ reason: 'FC27_RECOVERY_REQUIRED' });
  expect(x.adapter.submit).toHaveBeenCalledOnce();
});

it('keeps exclusion during a timed-out GM write until it settles, with zero EA save', async () => {
  vi.useFakeTimers(); const x = persistenceFixture(); let release;
  const write = x.gmSetValue.getMockImplementation();
  x.gmSetValue.mockImplementationOnce((key, value) => new Promise(resolve => {
    release = async () => { await write(key, value); resolve(); };
  }));
  let finished = false;
  const pending = x.run().then(result => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(15001);
  expect(release).toBeTypeOf('function'); expect(finished).toBe(false);
  expect(await x.recreate().run()).toMatchObject({ reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' });
  await release();
  expect(await pending).toMatchObject({ reason: 'FC27_JOURNAL_UNCONFIRMED', recoveryRequired: true });
  expect(x.adapter.save).not.toHaveBeenCalled();
  expect(await x.recreate().run()).toMatchObject({ reason: 'FC27_RECOVERY_REQUIRED' });
});
