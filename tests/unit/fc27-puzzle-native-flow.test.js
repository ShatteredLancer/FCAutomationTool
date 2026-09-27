import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27AcceptanceSession } from '../../src/adapters/browser/fc27-acceptance-session.js';
import { readFc27PuzzlePage } from '../../src/adapters/ea/fc27-puzzle-page.js';
import observation from '../fixtures/fc27-puzzle-plan-observation.json';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());

function fixture({ bricks = [], gold = false, marquee = false } = {}) {
  const x = executionRuntime(); const { root, state, challenge } = x;
  state.players = state.players.slice(0, 11 - bricks.length);
  root.repositories.Item.club.items._collection = {};
  state.playerFacts = { nationId: 27, teamId: 1, basePossiblePositions: [5], groups: [] };
  for (const player of state.players) root.repositories.Item.club.items._collection[player.id] = root.factories.Item.createItem(player);
  Object.assign(root.SBCEligibilityScope, { LOWER: 1 });
  Object.assign(root.SBCEligibilityKey, { CHEMISTRY_POINTS: 35 });
  challenge.eligibilityRequirements.push({ count: -1, scope: 0, kvPairs: { _collection: { 35: [14] } } });
  if (bricks.length) {
    state.simpleBrickIndices = bricks;
    challenge.eligibilityRequirements.pop();
  }
  if (gold) {
    state.playerFacts._rating = 80;
    challenge.eligibilityRequirements[0].kvPairs._collection[3] = [3];
    for (const player of state.players) root.repositories.Item.club.items._collection[player.id] = root.factories.Item.createItem(player);
  }
  if (marquee) {
    Object.assign(root.SBCEligibilityKey, { NATION_ID: 10, CLUB_COUNT: 9, PLAYER_LEVEL: 17 });
    x.set.id = challenge.setId = observation.setId; challenge.id = observation.challengeId;
    x.set.name = challenge.name = 'Recorded Marquee requirements / synthetic inventory';
    challenge.eligibilityRequirements = observation.rawRequirements.map(rule => ({ count: rule.count, scope: rule.scope,
      kvPairs: { _collection: Object.fromEntries(rule.pairs.map(pair => [pair.key, pair.values])) } }));
    state.formation = { id: observation.layout.formation.id,
      positions: observation.layout.formation.positions.map(typeId => ({ typeId })) };
    state.playerFactsById = Object.fromEntries(state.players.map((player, index) => [player.id, {
      _rating: index < 3 ? 70 : 60, teamId: index % 3 + 1,
      basePossiblePositions: [observation.layout.formation.positions[index]],
    }]));
    root.services.SBC.repository.sets._collection = { [x.set.id]: { ...x.set, challenges: [challenge] } };
    for (const player of state.players) root.repositories.Item.club.items._collection[player.id] = root.factories.Item.createItem(player);
  }
  root.UTItemEntity = { LEGENDS_CLUB_ID: 9001, LEGENDS_LEAGUE_ID: 9002, LEAGUE_HERO_CLUB_ID: 9003, HALL_OF_FUT_CLUB_ID: 9004 };
  root.UTServerSettingsRepository = { KEY: { CHEMISTRY_PROFILES_ENABLED: 'chemistry',
    SQUAD_RATING_FLOAT_CALCULATION_ENABLED: 'rating', SUPER_CHEM_RARITY_IDS: 'super' } };
  root.services.Configuration = { checkFeatureEnabled: () => false };
  root.repositories.ServerSettings = { getStringSettingByKey: () => '' };
  root.repositories.TeamConfig = { teamLinks: new Map() };
  root.repositories.Chemistry = { parameters: [1, 2, 3].map(id => ({ id,
    thresholds: [2, 5, 8].map(requirement => ({ requirement, points: 1 })) })),
    profiles: [{ id: 1, maxChem: false, baseOverride: false, applicableRarityIds: [],
      rules: [1, 2, 3].map(parameterId => ({ parameterId, calculationType: 1, contribution: 1 })) }] };
  root.crypto.randomUUID = () => 'native-test';
  root.document = {};
  const anchor = { isConnected: true, ownerDocument: root.document };
  root.UTSBCSquadSplitViewController = class {};
  root.UTSBCSquadDetailPanelViewController = class {};
  challenge.squad = { _formation: state.formation, simpleBrickIndices: bricks, customBrickIndices: [],
    _players: Array.from({ length: 23 }, (_, index) => ({ index, _item: { id: 0 } })) };
  Object.setPrototypeOf(challenge.squad, root.UTSquadEntity.prototype);
  challenge.squad.onDataUpdated = new root.EAObservable();
  challenge.onDataChange = new root.EAObservable();
  const detail = Object.assign(new root.UTSBCSquadDetailPanelViewController(), {
    _set: x.set, _challenge: challenge, getView: () => ({ _btnExchange: { getRootElement: () => anchor } }),
  });
  const controller = Object.assign(new root.UTSBCSquadSplitViewController(), {
    _set: x.set, _challengeId: challenge.id, _challengeDetailsController: { currentController: detail },
  });
  root.getAppMain = () => ({ getRootViewController: () => ({ currentController: {
    currentController: { currentController: controller },
  } }) });
  const data = new Map();
  const restart = () => createFc27AcceptanceSession({ root, liveEnabled: true,
    gmGetValue: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
    gmSetValue: async (key, value) => { data.set(key, structuredClone(value)); },
    lockManager: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } });
  const session = restart();
  const fill = async () => {
    const promise = session.solveAndFillPuzzle({ setId: x.set.id, challengeId: challenge.id }, {
      isCurrent: () => readFc27PuzzlePage(root)?.challengeId === challenge.id,
    });
    await vi.runAllTimersAsync(); return promise;
  };
  return { ...x, data, fill, session, controller, detail, restart };
}

it('runs the real page reader, planner, session and provider with one selected-Club query and no catalog scan', async () => {
  const x = fixture();
  expect(await x.fill()).toMatchObject({ status: 'filled', saved: true, submitted: false });
  expect(x.calls.map(call => call.kind === 'request' ? `${call.method} ${new URL(call.url).pathname.split('/').at(-1)}` : call.kind))
    .toEqual(['POST club', 'squad', 'PUT squad', 'squad']);
  expect(x.calls.find(call => call.method === 'POST').body.defId.split(',').map(Number).sort((a, b) => a - b))
    .toEqual(Array.from({ length: 11 }, (_, i) => i + 101));
  expect([...x.data.values()].find(value => value?.kind === 'puzzle-fill')).toMatchObject({ phase: 'saved', submitted: false });
});

it('synchronizes the separate native squad after saving and blocks a second click without new requests or pending state', async () => {
  const x = fixture({ marquee: true });
  expect((await x.fill()).status).toBe('filled');
  expect(x.challenge.squad._players.filter(slot => slot._item.id > 0)).toHaveLength(11);
  expect(x.challenge.squad.onDataUpdated.notifications).toBe(1);
  expect(x.challenge.onDataChange.notifications).toBe(1);
  const before = x.calls.length;
  expect(await x.fill()).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_EXISTING_SQUAD_BLOCKED' });
  expect(x.calls).toHaveLength(before);
  expect([...x.data.values()].find(v => v?.kind === 'puzzle-fill').phase).toBe('saved');
});

it('does not create a pending journal when the server squad is already occupied before dispatch', async () => {
  const x = fixture({ marquee: true });
  x.state.saved = Array.from({ length: 23 }, (_, index) => ({ index, itemData: { id: index < 11 ? index + 1 : 0 } }));
  expect(await x.fill()).toMatchObject({ status: 'blocked', saved: false, reason: 'FC27_PUZZLE_EXISTING_SQUAD_BLOCKED' });
  expect(x.calls.some(call => call.method === 'PUT')).toBe(false);
  expect([...x.data.values()].some(v => v?.kind === 'puzzle-fill')).toBe(false);
});

it.each(['local-edit', 'method-changed'])('keeps a saved-server recovery record for %s and never overwrites a different local squad', async kind => {
  const x = fixture({ marquee: true });
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'PUT') {
      if (kind === 'local-edit') x.challenge.squad._players[0]._item = { id: 9999, definitionId: 9999 };
      else x.challenge.squad.update = () => { throw new Error('must not invoke unknown method'); };
    }
    return push(call);
  });
  expect(await x.fill()).toMatchObject({ status: 'recovery-required', reason: 'FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED' });
  expect([...x.data.values()].find(v => v?.kind === 'puzzle-fill').phase).toBe('save-pending');
  expect(x.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  if (kind === 'local-edit') expect(x.challenge.squad._players[0]._item.id).toBe(9999);
  const failureKey = [...x.data.keys()].find(k => k.startsWith('fcat-fc27-puzzle-write-failure:'));
  const failure = structuredClone(x.data.get(failureKey));
  expect((await x.fill()).reason).toBe('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
  expect(x.data.get(failureKey)).toEqual(failure);
});

it('restores an exact pending save from the same native button with one read and no second save', async () => {
  const x = fixture({ marquee: true });
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'PUT') x.challenge.squad.update = () => {};
    return push(call);
  });
  expect((await x.fill()).status).toBe('recovery-required');
  delete x.challenge.squad.update;
  const before = x.calls.length;
  expect(await x.fill()).toMatchObject({ status: 'filled', restored: true, submitted: false });
  expect(x.calls.slice(before).map(c => c.kind)).toEqual(['squad']);
  expect(x.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  expect(x.challenge.squad._players.filter(s => s._item.id > 0)).toHaveLength(11);
  expect([...x.data.values()].find(v => v?.kind === 'puzzle-fill').phase).toBe('saved');
});

it.each([{ bricks: [0] }, { bricks: [0, 2, 3, 5, 6, 7, 8, 9, 10] },
  { bricks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }])('saves only playable slots with bricks $bricks and records them for recovery', async ({ bricks }) => {
  const x = fixture({ bricks });
  const result = await x.fill();
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'filled', selectedCount: 11 - bricks.length });
  const saved = x.calls.find(call => call.method === 'PUT').body.players;
  expect(saved.filter(slot => slot.itemData.id > 0)).toHaveLength(11 - bricks.length);
  for (const slot of bricks) expect(saved[slot].itemData.id).toBe(0);
  expect([...x.data.values()].find(value => value?.kind === 'puzzle-fill')).toMatchObject({
    schema: 2, phase: 'saved', brickIndices: bricks,
  });
  expect(x.calls.map(call => call.kind === 'request' ? call.method : call.kind)).toEqual(['POST', 'squad', 'PUT', 'squad']);
});

it('defaults Puzzle to 82, preserves an explicit lower cap and persists manual changes', async () => {
  const x = fixture({ gold: true });
  expect(await x.session.inspectPuzzlePolicy()).toMatchObject({ maxRating: 82 });
  await x.session.setPuzzleMaxRating(74);
  expect((await x.fill()).status).toBe('blocked'); expect(x.calls).toHaveLength(0);
  expect(await x.session.setPuzzleMaxRating(83)).toMatchObject({ status: 'observed', maxRating: 83 });
  expect(await x.restart().inspectPuzzlePolicy()).toMatchObject({ status: 'observed', maxRating: 83 });
  expect(await x.fill()).toMatchObject({ status: 'filled', selectedCount: 11 });
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.preview.policy.maxRating).toBe(83);
});

it.each([82, 83])('allows default-cap gold at %i only when at most 82', async rating => {
  const x = fixture({ gold: true }); x.state.playerFacts._rating = rating;
  for (const player of x.state.players) x.root.repositories.Item.club.items._collection[player.id] = x.root.factories.Item.createItem(player);
  expect((await x.fill()).status).toBe(rating === 82 ? 'filled' : 'blocked');
  if (rating === 83) expect(x.calls).toHaveLength(0);
});

it('solves recorded Marquee conditions and formation using synthetic inventory through the complete native save path', async () => {
  const x = fixture({ marquee: true });
  const result = await x.fill();
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'filled', setId: 19, challengeId: 43, submitted: false });
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.plan.validation.requirementCount).toBe(5);
  expect(log.plan.validation.teamFacts.chemistry).toBeGreaterThanOrEqual(14);
  expect(x.calls.map(call => call.kind === 'request' ? call.method : call.kind)).toEqual(['POST', 'squad', 'PUT', 'squad']);
});

it('clamps the saved Puzzle cap to the current FSU ceiling', async () => {
  const x = fixture({ gold: true });
  await x.session.setPuzzleMaxRating(90);
  x.root.info.set.goldenrange = 79;
  expect((await x.fill()).status).toBe('blocked'); expect(x.calls).toHaveLength(0);
  x.root.info.set.goldenrange = 83;
  expect((await x.fill()).status).toBe('filled');
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.preview.policy.maxRating).toBe(83);
});

it('refuses corrupt saved settings without requesting inventory or silently defaulting', async () => {
  const x = fixture(); await x.session.setPuzzleMaxRating(74);
  const key = [...x.data.keys()].find(key => key.startsWith('fcat-fc27-puzzle-policy:'));
  x.data.set(key, { schema: 1, maxRating: '99' });
  expect(await x.fill()).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_POLICY_INVALID' });
  expect(x.calls).toHaveLength(0);
});

it.each(['setting', 'fsu'])('stops before save when %s policy changes during exact validation', async source => {
  const x = fixture(); await x.session.setPuzzleMaxRating(74);
  const key = [...x.data.keys()].find(key => key.startsWith('fcat-fc27-puzzle-policy:'));
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'POST') {
      if (source === 'setting') x.data.set(key, { schema: 1, maxRating: 83 });
      else x.root.info.set.goldenrange = 82;
    }
    return push(call);
  });
  expect(await x.fill()).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_FILL_INPUTS_CHANGED' });
  expect(x.calls.some(call => call.method === 'PUT')).toBe(false);
});

it.each(['layout', 'brick-item'])('refuses %s corruption in the pre-save server layout', async kind => {
  const x = fixture({ bricks: [0] });
  if (kind === 'layout') x.state.simpleBrickIndices = [1];
  else x.state.saved = Array.from({ length: 23 }, (_, index) => ({ index, itemData: { id: index === 0 ? 1 : 0 } }));
  expect((await x.fill()).status).toBe('blocked');
  expect(x.calls.some(call => call.method === 'PUT')).toBe(false);
});

it('retains recovery after a changed post-save brick layout and resolves only an exact readback', async () => {
  const x = fixture({ bricks: [0] });
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'PUT') x.state.simpleBrickIndices = [1];
    return push(call);
  });
  expect(await x.fill()).toMatchObject({ status: 'recovery-required', submitted: false });
  const next = x.restart();
  let pending = next.inspectRecovery(); await vi.runAllTimersAsync();
  expect((await pending).status).toBe('blocked');
  x.state.simpleBrickIndices = [0];
  pending = next.inspectRecovery(); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ status: 'recoverable', outcome: 'saved' });
  pending = next.resolveRecovery(true); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ status: 'resolved', saved: true, submitted: false });
  expect(x.challenge.squad._players.filter(slot => slot._item.id > 0)).toHaveLength(10);
  expect(x.challenge.onDataChange.notifications).toBe(1);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('does not request Club data or overwrite the occupied native squad on another click', async () => {
  const x = fixture(); x.challenge.squad._players[0]._item.id = 1;
  expect(await x.fill()).toMatchObject({ reason: 'FC27_PUZZLE_EXISTING_SQUAD_BLOCKED', saved: false });
  expect(x.calls).toHaveLength(0);
});
