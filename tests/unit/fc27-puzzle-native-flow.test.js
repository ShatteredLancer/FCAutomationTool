import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27AcceptanceSession } from '../../src/adapters/browser/fc27-acceptance-session.js';
import { readFc27PuzzlePage, readFc27PuzzlePageSnapshot } from '../../src/adapters/ea/fc27-puzzle-page.js';
import { inspectFc27PuzzlePlan } from '../../src/adapters/ea/fc27-puzzle-read.js';
import { planFc27PuzzleShortageQueries } from '../../src/fc27/puzzle-procurement.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';
import { fc27ConceptPendingKey } from '../../src/fc27/puzzle-concept-session.js';
import { FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import observation from '../fixtures/fc27-puzzle-plan-observation.json';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fsuSource = readFileSync(new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url), 'utf8');
const fsuBuyStart = fsuSource.indexOf('events.buyConceptPlayer = async');
const fsuBuyBody = fsuSource.slice(fsuBuyStart, fsuSource.indexOf('events.buyPlayer = async', fsuBuyStart));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());

function fixture({ bricks = [], gold = false, marquee = false, diagnosticLog } = {}) {
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
  let operationSequence = 0;
  root.crypto.randomUUID = () => `native-test-${++operationSequence}`;
  root.document = {};
  const anchor = { isConnected: true, ownerDocument: root.document };
  root.UTSBCSquadSplitViewController = class {};
  root.UTSBCSquadDetailPanelViewController = class {};
  challenge.squad = { _formation: state.formation, simpleBrickIndices: bricks, customBrickIndices: [],
    _players: Array.from({ length: 23 }, (_, index) => ({ index, _item: { id: 0 } })) };
  Object.setPrototypeOf(challenge.squad, root.UTSquadEntity.prototype);
  root.UTSquadEntity.prototype.getPlayers = function () { return this._players; };
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
  const restart = () => createFc27AcceptanceSession({ root, liveEnabled: true, diagnosticLog,
    gmRequest: options => options.onload({ status: 200, responseText: JSON.stringify({ data:
      Array.from({ length: 32 }, (_, i) => ({ resource_id: 901 + i, ID: 101 + i, Player_Resource: 901 + i, LCPrice: 200 })) }) }),
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
    .toEqual(['squad', 'POST club', 'squad', 'PUT squad', 'squad']);
  expect(x.calls.find(call => call.method === 'POST').body.defId.split(',').map(Number).sort((a, b) => a - b))
    .toEqual(Array.from({ length: 11 }, (_, i) => i + 101));
  expect([...x.data.values()].find(value => value?.kind === 'puzzle-fill')).toMatchObject({ phase: 'saved', submitted: false });
});

it('exports native Puzzle search and pre-request market failures without raw inventory or account data', async () => {
  const store = new Map();
  const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, value), version: '27.0.4' });
  const x = fixture({ diagnosticLog });
  const removed = x.state.players.pop(); delete x.root.repositories.Item.club.items._collection[removed.id];
  x.root.UTHttpRequest = function unreviewedRequest() { throw new Error('must not run'); };
  expect(await x.fill()).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_METHOD_0_CHANGED',
    purchaseSuggestion: { reason: 'FC27_MARKET_METHOD_0_CHANGED', requests: 0 } });
  const payload = await diagnosticLog.exportPayload();
  expect(payload.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ area: 'puzzle', event: 'solve-result', setId: 4, challengeId: 16,
      reason: 'FC27_MARKET_METHOD_0_CHANGED', safeCandidates: 10 }),
    expect.objectContaining({ area: 'puzzle', event: 'procurement-result', reason: 'FC27_MARKET_METHOD_0_CHANGED',
      source: 'transport', requests: 0, catalogAttempts: 0, quoteAttempts: 0 }),
  ]));
  expect(JSON.stringify(payload)).not.toMatch(/accountScope|definitionId|selected|unreviewedRequest|must not run/);
  expect(x.calls).toHaveLength(0);
});

it.each(['throw', 'reject'])('keeps native fill behavior when optional diagnostics %s', async mode => {
  const diagnosticLog = { record: () => {
    if (mode === 'throw') throw new Error('log unavailable');
    return Promise.reject(new Error('log unavailable'));
  } };
  const x = fixture({ diagnosticLog });
  expect(await x.fill()).toMatchObject({ status: 'filled', saved: true, submitted: false });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

async function missingFixture(missing = 1, options = {}) {
  const x = fixture(options);
  for (let i = 0; i < missing; i++) {
    const removed = x.state.players.pop(); delete x.root.repositories.Item.club.items._collection[removed.id];
  }
  const snapshot = readFc27PuzzlePageSnapshot(x.root, { setId: 4, challengeId: 16 });
  let input;
  await inspectFc27PuzzlePlan(x.root, { setId: 4, challengeId: 16, layout: snapshot.layout,
    catalog: { status: 'observed', challenges: [snapshot.challenge] } }, inputs => {
    input = inputs; return { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE' };
  });
  const scope = traditionalJournalScope(input.context);
  const card = { definitionId: 901, rating: 60, rarity: 0, nationId: 27, leagueId: 10, teamId: 1,
    positions: [5], groups: [], special: false, evolution: false, cosmetic: false };
  for (const query of planFc27PuzzleShortageQueries(input).queries) {
    x.data.set(`fcat-fc27-puzzle-market:${scope}:catalog:${JSON.stringify(query)}`, {
      schema: 1, kind: 'catalog', query, at: Date.now(), state: 'observed',
      result: { status: 'observed', season: '27', source: 'ea-defid', query, observedAt: Date.now(),
        entries: Array.from({ length: missing }, (_, i) => ({ ...card, definitionId: 901 + i })) },
    });
  }
  for (let i = 0; i < missing; i++) {
  const query = { definitionId: 901 + i, start: 0, count: 20, maxBuy: null };
  x.data.set(`fcat-fc27-puzzle-market:${scope}:quote:${JSON.stringify(query)}`, {
    schema: 1, kind: 'quote', query, at: Date.now(), state: 'observed', result: {
      status: 'observed', season: '27', platform: input.context.platform, source: 'ea-visible-buy-now',
      definitionId: 901 + i, observedAt: Date.now(), eligible: 1, price: 500,
    },
  });
  }
  return x;
}

it('continues from filtered internal routes into cached procurement on repeated native clicks without writes', async () => {
  const x = fixture();
  x.challenge.eligibilityRequirements[1].kvPairs._collection[35] = [33];
  x.challenge.eligibilityRequirements[1].scope = 2;
  x.state.players = Array.from({ length: 70 }, (_, i) => ({ id: i + 1, resourceId: i + 101 }));
  x.state.playerFactsById = Object.fromEntries(x.state.players.map((player, i) => [player.id, {
    _rating: i < 40 ? 70 : 60, nationId: i < 40 ? 1 : 2, leagueId: i < 40 ? 1 : 2,
    basePossiblePositions: [9],
  }]));
  x.root.repositories.Item.club.items._collection = Object.fromEntries(x.state.players.map(player =>
    [player.id, x.root.factories.Item.createItem(player)]));
  const target = { setId: x.set.id, challengeId: x.challenge.id };
  const snapshot = readFc27PuzzlePageSnapshot(x.root, target);
  await inspectFc27PuzzlePlan(x.root, { ...target, layout: snapshot.layout,
    catalog: { status: 'observed', challenges: [snapshot.challenge] } }, input => {
    const scope = traditionalJournalScope(input.context);
    for (const query of planFc27PuzzleShortageQueries(input).queries) {
      x.data.set(`fcat-fc27-puzzle-market:${scope}:catalog:${JSON.stringify(query)}`, {
        schema: 1, kind: 'catalog', query, at: Date.now(), state: 'observed', result: {
          status: 'observed', season: '27', source: 'ea-defid', query, observedAt: Date.now(), entries: [],
        },
      });
    }
    return { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE', selected: [] };
  });
  for (let click = 0; click < 2; click++) {
    const result = await x.fill();
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT',
      purchaseSuggestion: { reason: 'FC27_PURCHASE_REPAIR_NO_PLAN', requests: 0,
        diagnostics: { usableCandidates: 0, nodes: 0, truncated: false } } });
    expect(result.purchaseSuggestion.cacheHits).toBeGreaterThan(0);
  }
  expect(x.calls).toEqual([]);
  expect(x.state.saved).toBeNull();
  expect([...x.data.values()].some(value => value?.phase === 'save-pending')).toBe(false);
}, 30000);

async function buyingFixture(count = 1, options = {}) {
  const x = await missingFixture(count, options);
  expect((await x.fill()).status).toBe('concept-filled');
  const { root, state } = x; state.filterClubQueries = true;
  Object.assign(root.ItemPile, { PURCHASED: 6 }); root.GameCurrency = { COINS: 'COINS' }; root.MAX_NEW_ITEMS = 100;
  root.SearchType = { PLAYER: 'player' }; root.SearchCategory = { ANY: 'any' }; root.UTSearchCriteriaDTO = class {};
  root.UTBucketedItemSearchViewModel = class {
    defaultSearchCriteria = {};
    updateSearchCriteria(criteria) { this.searchCriteria = { ...criteria }; }
  };
  root.ItemSearchFeature = { MARKET: 1 };
  root.UTCurrencyInputControl = { getIncrementAboveVal: n => n + 50, getIncrementBelowVal: n => n - 50 };
  root.PINEventType = { PAGE_VIEW: 'view' }; root.PIN_PAGEVIEW_EVT_TYPE = 'page';
  root.services.PIN = { sendData: (_type, data) => x.calls.push({ kind: 'pin', page: data.pgid }) };
  root.UtasErrorCode = { PERMISSION_DENIED: 461 };
  const user = { getCurrency: () => ({ amount: 10000 }) }; root.services.User.getUser = () => user;
  const observable = reply => ({ observe(owner, cb) { cb(this, reply); }, unobserve() {} });
  const purchases = Array.from({ length: count }, (_, i) => Object.assign(root.factories.Item.createItem({ id: 801 + i, resourceId: 901 + i }),
    { tradable: true, isPlayer: () => true, isDuplicate: () => false, pile: 6,
      getAuctionData: () => ({ tradeId: String(9901 + i), tradeState: 'active', buyNowPrice: 200, getSecondsRemaining: () => 60, canBuy: () => true }) }));
  const purchased = purchases[0];
  class ItemService {
    bid(item, price) { x.calls.push({ kind: 'buy', id: item.id, price }); return observable(state.bidReplies?.[item.id]
      ?? { success: true, status: 200, data: { itemIds: [item.id] } }); }
    move(item, pile) {
      x.calls.push({ kind: 'move', id: item.id, pile });
      if (state.moveReplies?.[item.id]) return observable(state.moveReplies[item.id]);
      item.pile = pile;
      state.players.push({ id: item.id, resourceId: item.definitionId });
      state.playerFactsById = { ...state.playerFactsById, [item.id]: { tradable: true } };
      const index = x.challenge.squad._players.findIndex(slot => slot._item.concept && slot._item.definitionId === item.definitionId);
      if (index >= 0 && !state.deferConceptReplacement) {
        x.challenge.squad._players[index]._item = item;
        if (state.saved[index]) state.saved[index].itemData = { id: item.id, dream: false };
      }
      return observable({ success: true, status: 200, data: { itemIds: [item.id] } });
    }
    searchTransferMarket(criteria) { x.calls.push({ kind: 'search', criteria }); return observable({ success: true, status: 200,
      data: { items: purchases.filter(item => criteria.defId.includes(item.definitionId)
        && (!criteria.maxBuy || item.getAuctionData().buyNowPrice <= criteria.maxBuy)) } }); }
    clearTransferMarketCache() {}
    requestUnassignedItems() { return observable({ success: true, status: 200, response: { items: [purchased] } }); }
  }
  root.services.Item = new ItemService();
  root.repositories.Item.numItemsInCache = () => 0; root.repositories.Item.setDirty = () => {};
  const digest = root.crypto.subtle.digest;
  root.crypto.subtle.digest = async (algorithm, bytes) => {
    const source = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
    const method = FC27_BUY_SERVICE_METHODS.find(([name]) => String(ItemService.prototype[name]).replace(/\r\n/g, '\n') === source);
    return method ? Uint8Array.from(Buffer.from(state.buyMethodHashes?.[method[0]] ?? method[1], 'hex')).buffer : digest(algorithm, bytes);
  };
  const buy = async budget => {
    const target = { setId: 4, challengeId: 16 };
    const summary = await x.session.inspectPuzzlePurchases(target);
    const promise = x.session.buyPuzzlePlayers(target, { approved: true, budget, expectedOperationId: summary.operationId }, { isCurrent: () => true });
    await vi.runAllTimersAsync(); return promise;
  };
  return { ...x, buy, purchased, purchases };
}

it('buys with the independently reviewed October 3 bid/move fingerprints', async () => {
  const x = await buyingFixture(3);
  x.state.buyMethodHashes = {
    bid: '3d2e79b2534121b761fec1924de8b129270b8cd41243f4a368db49a9857ff98a',
    move: '5ab5e0676e5323587ff68b71815fbe031a1e26742defe782c4f2b00a7f1889ef',
  };
  expect(await x.buy()).toMatchObject({ purchased: 3, spent: 600 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(3);
  expect(x.calls.filter(call => call.kind === 'move')).toHaveLength(3);
});

it.each(['bid', 'move'])('rejects an unknown %s fingerprint before searching or writing a buy journal', async name => {
  const store = new Map();
  const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, value) });
  const x = await buyingFixture(1, { diagnosticLog });
  x.state.buyMethodHashes = { [name]: '0'.repeat(64) };
  expect(await x.buy()).toMatchObject({ reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED', purchased: 0, spent: 0 });
  expect(x.calls.filter(call => ['search', 'buy', 'move'].includes(call.kind))).toEqual([]);
  expect([...x.data.keys()].filter(key => /^fcat-fc27-puzzle-buy(?:-pending)?:/.test(key))).toEqual([]);
  const trace = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-buy-trace:'))?.[1];
  expect(trace.events).toContainEqual(expect.objectContaining({ stage: 'method-check', method: `service.${name}`,
    status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED', observedHash: '0'.repeat(64) }));
  const exported = await diagnosticLog.exportPayload();
  expect(exported.entries).toContainEqual(expect.objectContaining({ event: 'buy-method-check', method: `service.${name}`,
    observedHash: '0'.repeat(64), reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED' }));
  expect(exported.entries).toContainEqual(expect.objectContaining({ event: 'buy-result', count: 0, spent: 0 }));
});

it.each(['throws', 'rejects'])('keeps purchasing unchanged when optional diagnostics %s', async mode => {
  const x = await buyingFixture(1, { diagnosticLog: { record: () => {
    if (mode === 'throws') throw Error('diagnostic unavailable');
    return Promise.reject(Error('diagnostic unavailable'));
  } } });
  expect(await x.buy()).toMatchObject({ purchased: 1, spent: 200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
});


it.each(['normal', 'expired-cheapest', 'same-price', 'permission-denied', 'explicit-rejection', 'move-rejected', 'cannot-buy'])
('matches the original FSU buyConceptPlayer buy/move selection and continuation: %s', async scenario => {
  const x = await buyingFixture(6);
  const makeAuction = (item, changes) => {
    const data = { ...item.getAuctionData(), ...changes };
    item._auction = data; item.getAuctionData = () => data;
  };
  for (const item of x.purchases) makeAuction(item, {});
  if (scenario === 'expired-cheapest') {
    makeAuction(x.purchased, { buyNowPrice: 150, getSecondsRemaining: () => 0 });
    const extra = { ...x.purchased, id: 888 };
    makeAuction(extra, { tradeId: '9999', buyNowPrice: 200, getSecondsRemaining: () => 60 }); x.purchases.push(extra);
  }
  if (scenario === 'same-price') {
    const extra = { ...x.purchased, id: 888 }; makeAuction(extra, { tradeId: '9999' }); x.purchases.push(extra);
  }
  if (scenario === 'cannot-buy') makeAuction(x.purchased, { canBuy: () => false });
  if (scenario === 'permission-denied') x.state.bidReplies = { 801: { success: false, status: 403, error: { code: 461 } } };
  if (scenario === 'explicit-rejection') x.state.bidReplies = { 801: { success: false, status: 401, error: { code: 999 } } };
  if (scenario === 'move-rejected') x.state.moveReplies = { 801: { success: false, status: 409, error: { code: 999 } } };
  const trace = []; const failures = [];
  const observable = reply => ({ observe(_owner, cb) { cb(this, reply); }, unobserve() {} });
  const sandbox = { console: { log() {} }, info: { run: {} }, MAX_NEW_ITEMS: 100,
    repositories: { Item: { numItemsInCache: () => 0 } }, ItemPile: x.root.ItemPile,
    GameCurrency: x.root.GameCurrency, UtasErrorCode: x.root.UtasErrorCode, isPhone: () => false, fy: key => key,
    services: { User: x.root.services.User, Item: {
      bid(item, price) { trace.push({ kind: 'buy', id: item.id, price }); return observable(x.state.bidReplies?.[item.id] ?? { success: true }); },
      move(item, pile) { trace.push({ kind: 'move', id: item.id, pile }); return observable(x.state.moveReplies?.[item.id] ?? { success: true }); },
    } }, events: { showLoader() {}, hideLoader() {}, notice() {}, changeLoadingText() {}, wait: async () => {},
      cardAddBuyErrorTips: id => failures.push(id), sendPinEvents: page => trace.push({ kind: 'pin', page }),
      readAuctionPrices: async player => x.purchases.filter(item => item.definitionId === player.definitionId),
    } };
  vm.runInNewContext(fsuBuyBody, sandbox);
  await sandbox.events.buyConceptPlayer(x.challenge.squad.getPlayers().filter(slot => slot._item.concept)
    .map(slot => ({ definitionId: slot._item.definitionId, isPlayer: () => true,
      getStaticData: () => ({ name: `Player ${slot._item.definitionId}` }) })));
  const result = await x.buy(10000);
  // Search PIN events have their own original-code differential suite.
  expect(x.calls.filter(call => ['buy', 'move'].includes(call.kind) || call.kind === 'pin' && call.page === 'Item - Detail View')).toEqual(trace);
  expect(result.failures.map(failure => failure.definitionId)).toEqual(failures);
  expect(x.calls.filter(call => call.kind === 'search').every(call => call.criteria.maxBuy === 200)).toBe(true);
});

it('buys concept cards in the work area without solver layout gates or FSU', async () => {
  const x = await buyingFixture();
  const index = x.challenge.squad._players.findIndex(slot => slot._item.concept);
  x.challenge.squad._players[15]._item = x.challenge.squad._players[index]._item;
  x.challenge.squad._players[index]._item = { id: 0 };
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1 });
  expect(x.challenge.squad._players[15]._item.id).toBe(801);
});

it('buys an eleven-card native squad serially without a fixed batch-size stop', async () => {
  const x = await buyingFixture(11);
  expect(await x.buy(10000)).toMatchObject({ status: 'purchased', purchased: 11, spent: 2200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(11);
});

it('retains receipts without an extra PUT or repeat buy while native replacement is delayed', async () => {
  const x = await buyingFixture(); x.state.deferConceptReplacement = true;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1, saved: false, replacementPending: true });
  expect(await x.buy(500)).toMatchObject({ purchased: 1, saved: false, replacementPending: true });
  const slot = x.challenge.squad._players.find(slot => slot._item.concept);
  slot._item = x.purchased;
  expect(await x.buy(500)).toMatchObject({ purchased: 1, saved: true, replacementPending: false });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('buys six concepts without FSU while EA replaces each card independently', async () => {
  const x = await buyingFixture(6);
  delete x.root.info; delete x.root.events; delete x.root.call;
  const move = x.root.services.Item.move.bind(x.root.services.Item);
  const prototype = Object.getPrototypeOf(x.root.services.Item);
  prototype.move = (item, pile) => {
    const reply = move(item, pile);
    if (item.id === 801) {
      const index = x.challenge.squad._players.findIndex(slot => slot._item.definitionId === item.definitionId);
      x.challenge.squad._players[index]._item = item;
      x.state.saved[index].itemData = { id: item.id, dream: false };
    }
    return reply;
  };
  expect(await x.buy(3000)).toMatchObject({ status: 'purchased', purchased: 6, spent: 1200, saved: true });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(6);
  expect(x.challenge.squad._players.slice(0, 11).some(slot => slot._item.concept)).toBe(false);
  expect(await x.buy(3000)).toMatchObject({ status: 'purchased', purchased: 6 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(6);
});

it('resumes a legacy two-of-six journal whose Club receipts are known but replacements were not marked applied', async () => {
  const x = await buyingFixture(6);
  expect(await x.buy(400)).toMatchObject({ status: 'partial', purchased: 2 });
  const key = [...x.data.keys()].find(key => key.startsWith('fcat-fc27-puzzle-buy:'));
  const record = x.data.get(key); record.phase = 'ready'; record.applied = [];
  // Actual pre-parity journals used the eleven-player solver draft schema.
  delete record.base.kind; record.base.slots = record.base.slots.slice(0, 11);
  record.base.challenge.formation = { id: x.state.formation.id, positions: x.state.formation.positions.map(p => p.typeId) };
  record.base.challenge.brickIndices = [];
  x.data.set(`fcat-fc27-puzzle-buy-pending:${record.scope}`, { key, operationId: record.operationId });
  expect(await x.buy(3000)).toMatchObject({ status: 'purchased', purchased: 6, spent: 1200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(6);
  expect(x.data.get(`fcat-fc27-puzzle-buy-pending:${record.scope}`)).toBeNull();
});

it('does not insert a Club search or auto-reuse a different owned copy before FSU-style buying', async () => {
  const x = await buyingFixture();
  x.state.players.push({ id: 777, resourceId: 901 });
  const before = x.calls.length;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1, reused: 0, spent: 200 });
  expect(x.calls.slice(before).some(call => call.kind === 'request' || call.kind === 'squad')).toBe(false);
  expect(x.challenge.squad._players.some(slot => slot._item.id === 801)).toBe(true);
});

it('purchases in a partially filled saved squad without solving or filling an empty slot', async () => {
  const x = await buyingFixture();
  const index = x.challenge.squad._players.findIndex(slot => slot._item.id > 0 && slot._item.concept === false);
  x.challenge.squad._players[index]._item = { id: 0 };
  x.state.saved[index].itemData = { id: 0, dream: false };
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1, saved: true });
  expect(x.challenge.squad._players[index]._item.id).toBe(0);
  expect(x.state.saved[index].itemData.id).toBe(0);
});

it('runs the native FSU-style search/bid/move chain without an extra squad GET or PUT', async () => {
  const x = await buyingFixture(); const result = await x.buy(500);
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'purchased', purchased: 1, spent: 200, saved: true, submitted: false });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1); // initial concept only
  expect(x.state.saved.filter(slot => slot.itemData.dream)).toHaveLength(0);
  expect(x.challenge.squad._players.some(slot => slot._item.id === 801 && slot._item.concept === false)).toBe(true);
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('does not apply solver rating filters to an exact-version FSU-style purchase', async () => {
  const x = await buyingFixture(); x.purchased._rating = 83;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', spent: 200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
});

it('recovers a real legacy replacement PUT with a lost response without buying or saving twice', async () => {
  const x = await buyingFixture(); x.state.deferConceptReplacement = true;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1, replacementPending: true });
  const key = [...x.data.keys()].find(key => key.startsWith('fcat-fc27-puzzle-buy:'));
  const record = x.data.get(key);
  delete record.base.kind; record.base.slots = record.base.slots.slice(0, 11);
  record.base.challenge.formation = { id: x.state.formation.id, positions: x.state.formation.positions.map(p => p.typeId) };
  record.base.challenge.brickIndices = [];
  x.state.saveResponseLost = true;
  expect(await x.buy(500)).toMatchObject({ status: 'recovery-required', purchased: 1 });
  x.state.saveResponseLost = false;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', spent: 200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(2);
});

it('uses the current page after a manual edit made before the purchase click', async () => {
  const x = await buyingFixture(); x.challenge.squad._players[0]._item = { id: 0 };
  const result = await x.buy(500);
  expect(result.status).toBe('purchased'); expect(x.challenge.squad._players[0]._item.id).toBe(0);
});

it('buys a native saved concept squad without FSU, its cache or any FCAT solve record', async () => {
  const x = await buyingFixture();
  x.data.clear(); delete x.root.info; delete x.root.events; delete x.root.call;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1, spent: 200 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.challenge.squad._players.some(slot => slot._item.id === 801 && slot._item.concept === false)).toBe(true);
});

it('accepts the native replacement of a confirmed purchase on both page and server without an extra save', async () => {
  const x = await buyingFixture();
  const move = x.root.services.Item.move.bind(x.root.services.Item);
  x.root.services.Item.move = (item, pile) => {
    const result = move(item, pile);
    const index = x.challenge.squad._players.findIndex(slot => slot._item.definitionId === item.definitionId);
    x.challenge.squad._players[index]._item = item;
    x.state.saved[index].itemData = { id: item.id, dream: false };
    return result;
  };
  // Method identity must remain the inspected prototype implementation.
  Object.getPrototypeOf(x.root.services.Item).move = x.root.services.Item.move;
  expect(await x.buy(500)).toMatchObject({ status: 'purchased', purchased: 1 });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it.each([false, true])('ignores other Challenge pending saves on native click (concept=%s)', async concept => {
  const x = concept ? await missingFixture() : fixture();
  const context = readFc27Context(x.root); const scope = traditionalJournalScope(context);
  const old = { setId: 19, challengeId: 43, operationId: 'old' };
  const base = `fcat-fc27-puzzle-fill:${contextKey(context, 'puzzle-fill')}`;
  const record = { schema: 1, kind: 'puzzle-fill', scope, ...old, phase: 'save-pending', submitted: false, updatedAt: 1,
    account: { accountScope: context.accountScope, platform: context.platform },
    itemRefs: Array.from({ length: 11 }, (_, slot) => ({ id: slot + 1, definitionId: slot + 101, pile: 'club', slot })) };
  x.data.set(`${base}:19:43`, record);
  x.data.set(`${base}:index`, [{ setId: 19, challengeId: 43 }]);
  x.data.set(fc27ConceptPendingKey(scope), old);
  expect(await x.session.inspectRecovery()).toMatchObject({ status: 'idle' });
  expect(await x.fill()).toMatchObject({ status: concept ? 'concept-filled' : 'filled', saved: true, submitted: false });
  expect(x.data.get(`${base}:19:43`)).toEqual(record);
  expect(x.data.get(fc27ConceptPendingKey(scope))).toEqual(old);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('fills ten owned cards plus one concept on the native pitch and restores without another PUT', async () => {
  const x = await missingFixture();
  expect(await x.fill()).toMatchObject({ status: 'concept-filled', saved: true, submitted: false, purchaseCount: 1 });
  expect(x.challenge.squad._players.slice(0, 11).filter(slot => slot._item.concept)).toHaveLength(1);
  expect(x.challenge.squad._players.slice(0, 11).every(slot => slot._item.id > 0)).toBe(true);
  expect(x.calls.map(call => call.kind === 'request' ? `${call.method} ${new URL(call.url).pathname.split('/').at(-1)}` : call.kind))
    .toEqual(['squad', 'POST club', 'squad', 'PUT squad', 'squad']);
  const again = x.restart().solveAndFillPuzzle({ setId: 4, challengeId: 16 }, { isCurrent: () => true });
  await vi.runAllTimersAsync();
  expect(await again).toMatchObject({ status: 'concept-filled', restored: true });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('preserves procurement diagnostics in the native result and existing local attempt log with no extra requests', async () => {
  const x = await missingFixture();
  for (const [key, value] of x.data) if (key.includes(':catalog:')) value.result.entries = [];
  const result = await x.fill();
  expect(result.purchaseSuggestion).toMatchObject({ status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN', requests: 0,
    diagnostics: { route: 'joint', stage: 'local-market-search', catalogCandidates: 0, usableCandidates: 0,
      catalogAttempts: 0, quoteAttempts: 0 } });
  const log = [...x.data.entries()].find(([key]) => key.startsWith('fcat-fc27-puzzle-last:'))[1];
  expect(log.result.purchaseSuggestion.diagnostics).toEqual(result.purchaseSuggestion.diagnostics);
  expect(x.calls).toHaveLength(0);
});

it('recovers a concept save after page synchronization fails without overwriting a user edit', async () => {
  const x = await missingFixture(); const push = x.calls.push.bind(x.calls);
  x.calls.push = call => {
    if (call.method === 'PUT') x.challenge.squad._players[0]._item = { id: 999, definitionId: 1999, concept: false };
    return push(call);
  };
  expect(await x.fill()).toMatchObject({ status: 'recovery-required', saved: null });
  expect(x.challenge.squad._players[0]._item.id).toBe(999);
  expect([...x.data.entries()].some(([key, value]) => key.startsWith('fcat-fc27-concept-pending:') && value)).toBe(true);
  const beforeInspect = x.calls.length;
  expect(await x.session.inspectRecovery()).toMatchObject({ status: 'blocked', kind: 'puzzle-concept',
    reason: 'FC27_CONCEPT_RECOVERY_REQUIRED', recoverySetId: 4, recoveryChallengeId: 16 });
  expect(x.calls).toHaveLength(beforeInspect);
  x.challenge.squad._players[0]._item = { id: 0 };
  const again = x.restart().solveAndFillPuzzle({ setId: 4, challengeId: 16 }, { isCurrent: () => true });
  await vi.runAllTimersAsync();
  expect(await again).toMatchObject({ status: 'concept-filled', restored: true });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('fills a managerless native squad even when EA update skips player slots', async () => {
  const x = await missingFixture(); x.state.skipSquadUpdate = true;
  expect(await x.fill()).toMatchObject({ status: 'concept-filled', saved: true, purchaseCount: 1 });
  expect(x.challenge.squad._players.slice(0, 11).filter(slot => slot._item.concept)).toHaveLength(1);
  expect(x.challenge.squad._players.slice(0, 11).every(slot => slot._item.id > 0)).toBe(true);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('uses the verified original setPlayers without invoking the FSU history wrapper', async () => {
  const x = await missingFixture(); x.state.skipSquadUpdate = true;
  const original = x.root.UTSquadEntity.prototype.setPlayers;
  x.root.call = { squad: { setPlayers: original } };
  x.root.UTSquadEntity.prototype.setPlayers = vi.fn(() => { throw new Error('do not invoke wrapper'); });
  expect(await x.fill()).toMatchObject({ status: 'concept-filled', purchaseCount: 1 });
  expect(x.root.UTSquadEntity.prototype.setPlayers).not.toHaveBeenCalled();
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

it('keeps pending recovery when the retained player-update method is unknown', async () => {
  const x = await missingFixture(); x.state.skipSquadUpdate = true;
  const unknown = vi.fn(); x.root.call = { squad: { setPlayers: unknown } };
  expect(await x.fill()).toMatchObject({ status: 'recovery-required', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED' });
  expect(unknown).not.toHaveBeenCalled();
  expect(x.challenge.squad._players.slice(0, 11).every(slot => slot._item.id === 0)).toBe(true);
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

it('replaces an unchanged old server squad when the native editor is empty', async () => {
  const x = fixture({ marquee: true });
  x.state.saved = Array.from({ length: 23 }, (_, index) => ({ index, itemData: { id: index < 11 ? index + 1 : 0 } }));
  expect(await x.fill()).toMatchObject({ status: 'filled', saved: true });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  expect([...x.data.values()].find(v => v?.kind === 'puzzle-fill').phase).toBe('saved');
});

const clearLocalSquad = x => {
  x.challenge.squad._players = x.challenge.squad._players.map(slot => ({ index: slot.index, _item: { id: 0 } }));
};

it.each([false, true])('re-solves a locally cleared squad without restoring the terminal draft (concept=%s)', async concept => {
  const x = concept ? await missingFixture() : fixture();
  const status = concept ? 'concept-filled' : 'filled';
  expect(await x.fill()).toMatchObject({ status, saved: true });
  clearLocalSquad(x);
  const before = x.calls.length;
  const second = await x.fill();
  expect(second, JSON.stringify(second)).toMatchObject({ status, saved: true });
  const writes = x.calls.slice(before).filter(call => call.method === 'PUT');
  expect(writes).toHaveLength(1);
  expect(writes[0].body.players.filter(slot => slot.itemData.id > 0)).toHaveLength(11);
  expect(x.calls.some(call => ['buy', 'move'].includes(call.kind))).toBe(false);
});

it('keeps five confirmed purchase receipts when the user clears the local squad and re-solves', async () => {
  const x = await buyingFixture(6);
  expect(await x.buy(1000)).toMatchObject({ status: 'partial', purchased: 5 });
  const key = [...x.data.keys()].find(key => key.startsWith('fcat-fc27-puzzle-buy:'));
  const record = structuredClone(x.data.get(key));
  clearLocalSquad(x);
  const before = x.calls.length;
  expect(await x.fill()).toMatchObject({ status: 'concept-filled', saved: true });
  expect(x.data.get(key)).toEqual(record);
  expect(x.calls.slice(before).filter(call => call.method === 'PUT')).toHaveLength(1);
  expect(x.calls.slice(before).some(call => ['buy', 'move'].includes(call.kind))).toBe(false);
});

it.each([false, true])('preserves the terminal record if re-solving fails after local clear (concept=%s)', async concept => {
  const x = concept ? await missingFixture() : fixture();
  await x.fill(); clearLocalSquad(x);
  const key = [...x.data.keys()].find(key => concept ? key.startsWith('fcat-fc27-concept-draft:')
    : x.data.get(key)?.kind === 'puzzle-fill');
  const record = structuredClone(x.data.get(key));
  const before = x.calls.length;
  x.root.info.set.goldenrange = 1;
  expect((await x.fill()).saved).not.toBe(true);
  expect(x.data.get(key)).toEqual(record);
  expect(x.calls.slice(before).some(call => call.method === 'PUT')).toBe(false);
});

it.each([false, true])('blocks server changes between the baseline and save (concept=%s)', async concept => {
  const x = concept ? await missingFixture() : fixture();
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'POST') x.state.saved = Array.from({ length: 23 }, (_, index) =>
      ({ index, itemData: { id: index === 0 ? 1 : 0, dream: false } }));
    return push(call);
  });
  expect(await x.fill()).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_SERVER_SQUAD_CHANGED', saved: false });
  expect(x.calls.some(call => call.method === 'PUT')).toBe(false);
  expect([...x.data.values()].some(value => value?.phase === 'save-pending')).toBe(false);
});

it.each([false, true])('blocks a partial local edit during pre-save validation (concept=%s)', async concept => {
  const x = concept ? await missingFixture() : fixture();
  const push = x.calls.push.bind(x.calls);
  vi.spyOn(x.calls, 'push').mockImplementation(call => {
    if (call.method === 'POST') x.challenge.squad._players[0]._item = { id: 999, definitionId: 1999, concept: false };
    return push(call);
  });
  expect(await x.fill()).toMatchObject({ status: 'blocked', saved: false });
  expect(x.calls.some(call => call.method === 'PUT')).toBe(false);
  expect(x.challenge.squad._players[0]._item.id).toBe(999);
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
  expect(x.calls.map(call => call.kind === 'request' ? call.method : call.kind)).toEqual(['squad', 'POST', 'squad', 'PUT', 'squad']);
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

it('persists an optional account-scoped quote ceiling while retaining rating-only settings', async () => {
  const x = fixture(); await x.session.setPuzzleMaxRating(74);
  expect(await x.session.inspectPuzzlePolicy()).toMatchObject({ maxRating: 74, quoteCeiling: null });
  expect(await x.session.setPuzzlePolicy({ maxRating: 74, quoteCeiling: 7500 })).toMatchObject({ status: 'observed', quoteCeiling: 7500 });
  expect(await x.restart().inspectPuzzlePolicy()).toMatchObject({ maxRating: 74, quoteCeiling: 7500 });
  await x.session.setPuzzleMaxRating(80);
  expect(await x.session.inspectPuzzlePolicy()).toMatchObject({ maxRating: 80, quoteCeiling: 7500 });
  expect(await x.session.setPuzzlePolicy({ maxRating: 80, quoteCeiling: 100 })).toMatchObject({ status: 'blocked' });
  expect(await x.session.inspectPuzzlePolicy()).toMatchObject({ quoteCeiling: 7500 });
  expect(await x.session.setPuzzlePolicy({ maxRating: 80, quoteCeiling: null })).toMatchObject({ status: 'observed', quoteCeiling: null });
  expect(x.calls).toHaveLength(0);
});

it('uses the configured ceiling for native procurement and validates a higher-price concept plan', async () => {
  const x = await missingFixture();
  const oldKey = [...x.data.keys()].find(key => key.includes(':quote:'));
  const record = x.data.get(oldKey); x.data.delete(oldKey);
  record.query.maxBuy = 5000; record.result.price = 4500;
  x.data.set(oldKey.replace('"maxBuy":null', '"maxBuy":5000'), record);
  await x.session.setPuzzlePolicy({ maxRating: 82, quoteCeiling: 5000 });
  expect(await x.fill()).toMatchObject({ status: 'concept-filled', saved: true, estimatedCost: 4500 });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
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
  expect(x.calls.map(call => call.kind === 'request' ? call.method : call.kind)).toEqual(['squad', 'POST', 'squad', 'PUT', 'squad']);
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
