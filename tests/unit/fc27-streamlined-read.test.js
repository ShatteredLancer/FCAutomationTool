import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { locateFc27StreamlinedPage, readFc27StreamlinedInputs, inspectFc27Streamlined, createFc27StreamlinedMatcher,
  readFc27StreamlinedProtection, assertFc27StreamlinedPolicy } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { challenge as fixtureChallenge } from '../helpers/streamlined.js';
import { inspectStreamlined } from '../../scripts/browser-inspection/streamlined-inspection.mjs';
import { runInNewContext } from 'node:vm';
import { filterStreamlinedItems } from '../../src/streamlined/eligibility.js';
import expiredTransfer from '../fixtures/fc27-streamlined-expired-transfer-2026-10-24.json';
import { readStreamlinedExternalRows } from '../../src/streamlined/external-selection.js';
import { snapshotFc27ClubPlayer } from '../../src/adapters/ea/fc27-local-read.js';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { refreshFc27StreamlinedSquad } from '../../src/adapters/ea/fc27-streamlined-squad-refresh.js';
import { safeItem } from '../helpers/streamlined.js';
import rarity11502 from '../fixtures/fc27-item-rarity-11502.json';

function runtime() {
  const f = executionRuntime(), { root } = f;
  root.document = {};
  const anchor = { isConnected: true, ownerDocument: root.document };
  const challenge = { id: 61, setId: 31, status: 'IN_PROGRESS', name: 'Synthetic points', isOneClickChallenge: () => true,
    scoreRequirement: 2500, submittedScore: 0, eligibilityOperation: 'AND',
    eligibilityRequirements: [{ count: -1, scope: 0, kvPairs: { _collection: { 40: [45], 41: [1] } } }] };
  const set = { id: 31, repeats: 1, repeatabilityMode: 'REFRESH' };
  class Split { constructor() { this.workAreaController = { viewModel: { getChallenge: () => challenge, getSet: () => set,
    getSelectionLimit: () => 30 }, getView: () => ({ getRootElement: () => anchor }) }; } }
  root.UTOneClickSBCWorkAreaSplitViewController = Split;
  const controller = new Split();
  root.getAppMain = () => ({ getRootViewController: () => ({ currentController: controller }) });
  root.UTEvolutionEligibilityVO = class { isValid = true; meetsRequirements = item => item._rating >= 45; };
  for (const item of Object.values(root.repositories.Item.club.items._collection)) item.sbsScore = 20;
  return { ...f, challenge, set, controller, anchor };
}

it('uses verified normal Club and Storage stock under the public 11502 rarity enum before buying the shortfall', async () => {
  const f = runtime(), { root } = f;
  root.ItemRarity = { ...rarity11502.enum };
  root.info.set.goldenrange = 90;
  root.info.lock = [3];
  root.repositories.Squad.squads._collection[902]._collection[7]._players[0]._item.id = root.info.squad[0] = 4;
  f.challenge.scoreRequirement = 1240;
  const row = (id, facts) => ({ ...root.repositories.Item.club.items._collection[id], _rating: 83, sbsScore: 205, ...facts });
  root.repositories.Item.storage = { _collection: { 1: row(1, { _rareflag: 1 }) } };
  root.repositories.Item.club.items._collection = {
    2: row(2, { _rareflag: 0 }), 3: row(3, { _rareflag: 1 }), 4: row(4, { _rareflag: 0 }),
    5: row(5, { _rareflag: 3 }), 6: row(6, { _rareflag: null }),
    7: row(7, { _rareflag: 1, upgrades: {} }), 8: row(8, { _rareflag: 1, _rating: null }),
    9: row(9, { _rareflag: 0, cosmetics: [1] }), 10: row(10, { _rareflag: 1, _rating: 91 }),
  };
  const session = createFc27StreamlinedSession({
    inspect: () => { const { context, challenge } = readFc27StreamlinedInputs(root); return { context, challenge }; },
    readInputs: settings => readFc27StreamlinedInputs(root, settings),
    get: async () => null, set: async () => { throw Error('Unexpected write'); }, now: () => 100,
    readMarketCandidates: async ({ input }) => {
      const item = safeItem({ source: 'market', definitionId: 901, rating: 84, price: 700, points: 830,
        quote: { definitionId: 901, source: 'futgg', price: 700, fetchedAt: 1, expiresAt: 1000 } });
      input.registerMarketEntity(item, { definitionId: 901, concept: true, _rating: 84 });
      return { market: [item] };
    },
  });
  const input = readFc27StreamlinedInputs(root);
  expect(filterStreamlinedItems(input.inventory, input)).toMatchObject({ excluded: {
    special: 2, locked: 1, 'active-squad': 1, rating: 2, cosmetic: 1, 'fsu-gold-range': 1 } });
  const result = await session.plan({ objective: 'inventory-first', mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'ready', route: { inventoryCount: 2, marketCount: 1, purchaseCost: 700 } });
  expect(result.items.filter(item => item.source === 'inventory').map(item => item.id)).toEqual([1, 2]);
  expect(f.calls).toEqual([]);
});

it.each([
  { NONE: 0 }, { ...rarity11502.enum, DEFAULT: 777 }, { ...rarity11502.enum, RARE: 3 },
  { ...rarity11502.enum, 2: 'UNKNOWN' }, { ...rarity11502.enum, 1: 'SPECIAL' }, null,
])('does not assume normal card metadata for an unreviewed enum %j', rarity => {
  const f = runtime(); f.root.ItemRarity = rarity;
  const entity = f.root.repositories.Item.club.items._collection[1];
  for (const value of [0, 1]) {
    entity._rareflag = value;
    expect(snapshotFc27ClubPlayer(entity, f.root).special).toBeNull();
  }
});

it('recognizes native expired unsold Transfer material without changing the shared Club snapshot', () => {
  const f = runtime();
  f.root.info.build.untradeable = false;
  Object.assign(f.root.AuctionTradeStateEnum, expiredTransfer.enums);
  const card = { ...f.root.repositories.Item.club.items._collection[1], ...structuredClone(expiredTransfer.item),
    id: 901, definitionId: 1901, utasPile: 5, tradable: true };
  f.root.repositories.Item.getTransferItems = () => [card];
  const native = Object.fromEntries(Object.entries(expiredTransfer.sources).map(([key, source]) => [key,
    runInNewContext(`(${source})`, { _0x23b357: null, AuctionTradeStateEnum: expiredTransfer.enums })]));
  const auction = { ...card._auction, tradeState: card._auction._tradeState, ...native };
  expect(auction.isExpired()).toBe(true); expect(auction.isSold()).toBe(false);
  const input = readFc27StreamlinedInputs(f.root, { sources: ['club', 'transfer'] });
  expect(input.inventory.find(item => item.id === 901).activeTrade).toBe(false);
  expect(snapshotFc27ClubPlayer(card, f.root).activeTrade).toBeNull();
  expect(readStreamlinedExternalRows(input).rows[0]).toMatchObject({ selectable: true });
  expect(f.calls).toEqual([]);
});

it.each(['active', 'closed', 'unknown', 'bid', 'owner', 'enum', 'state'])
('does not make %s Transfer material selectable as an expired unsold card', change => {
  const f = runtime(); f.root.info.build.untradeable = false;
  Object.assign(f.root.AuctionTradeStateEnum, expiredTransfer.enums);
  const card = { ...f.root.repositories.Item.club.items._collection[1], ...structuredClone(expiredTransfer.item),
    id: 901, definitionId: 1901, utasPile: 5, tradable: true };
  if (['active', 'closed', 'unknown'].includes(change)) card._auction._tradeState = change;
  if (change === 'bid') card._auction.currentBid = 650;
  if (change === 'owner') delete card._auction.tradeOwner;
  if (change === 'enum') delete f.root.AuctionTradeStateEnum.EXPIRED;
  if (change === 'state') card.state = 'invalid';
  f.root.repositories.Item.getTransferItems = () => [card];
  const input = readFc27StreamlinedInputs(f.root, { sources: ['club', 'transfer'] });
  expect(readStreamlinedExternalRows(input).rows[0]).toMatchObject({ selectable: false, reason: 'trade' });
  expect(f.calls).toEqual([]);
});

it('retains Only Untradeable and never treats expired cards in other piles as available Transfer material', () => {
  const f = runtime(); Object.assign(f.root.AuctionTradeStateEnum, expiredTransfer.enums);
  const card = { ...f.root.repositories.Item.club.items._collection[1], ...structuredClone(expiredTransfer.item),
    id: 901, definitionId: 1901, utasPile: 5, tradable: true };
  f.root.repositories.Item.getTransferItems = () => [card];
  expect(readStreamlinedExternalRows(readFc27StreamlinedInputs(f.root, { sources: ['transfer'] })).rows[0])
    .toMatchObject({ selectable: false, reason: 'untradeable' });
  f.root.repositories.Item.getUnassignedItems = () => [card];
  expect(readStreamlinedExternalRows(readFc27StreamlinedInputs(f.root, { sources: ['unassigned'] })).rows[0])
    .toMatchObject({ selectable: false, reason: 'trade' });
});

function zeroSquadRuntime() {
  const f = runtime(), squads = f.root.repositories.Squad.squads._collection[902]._collection;
  const squad = squads[7]; delete squads[7];
  squads[0] = squad; squad._id = 0; squad._isActive = true;
  f.root.services.Squad.activeSquad = 0;
  for (const [index, id] of [[0, 1], [12, 2], [22, 3]]) squad._players[index]._item.id = f.root.info.squad[index] = id;
  f.root.info.lock = [4];
  return { ...f, squad };
}

function inactiveSquadSession() {
  const { root, squad } = zeroSquadRuntime();
  const { context, challenge } = readFc27StreamlinedInputs(root);
  squad._isActive = false;
  const reply = value => ({ observe: (owner, callback) => callback(owner, value) });
  const expire = root.repositories.Squad.setSquadListCacheTimestamp = vi.fn();
  const list = root.services.Squad.requestSquadList = vi.fn(() => {
    squad._isActive = true;
    return reply({ success: true, status: 200, data: { activeSquadId: 0, squads: [squad] } });
  });
  const detail = root.services.Squad.requestSquadById = vi.fn(() =>
    reply({ success: true, status: 200, data: { squad } }));
  const session = createFc27StreamlinedSession({ inspect: () => ({ context, challenge }),
    readInputs: settings => readFc27StreamlinedInputs(root, settings),
    refreshSquad: check => refreshFc27StreamlinedSquad(root, check),
    get: async () => null, set: async () => { throw Error('Unexpected write'); } });
  return { root, session, expire, list, detail, squad, reply };
}

it('repairs an inactive zero squad once on Solve and keeps its exact players and FSU locks out of the plan', async () => {
  const f = inactiveSquadSession();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.session.plan({ objective: 'inventory-first', mode: 'inventory' });
    expect(result.plan.items.length).toBeGreaterThan(0);
    expect(result.plan.items.some(item => [1, 2, 3, 4].includes(item.id))).toBe(false);
  }
  expect(f.expire.mock.calls).toEqual([[0, 0]]);
  expect(f.list).toHaveBeenCalledTimes(1);
  expect(f.detail.mock.calls).toEqual([[0]]);
});

it.each(['cached list', 'two active squads', 'rejected detail', 'incomplete slots', 'cancelled'])(
  'keeps the preview unavailable after an inconclusive active squad refresh: %s', async issue => {
    const f = inactiveSquadSession();
    if (issue === 'cached list') f.list.mockReturnValue(f.reply({ success: true, status: 304 }));
    if (issue === 'two active squads') f.list.mockImplementation(() => {
      f.squad._isActive = true;
      return f.reply({ success: true, status: 200, data: { activeSquadId: 0, squads: [f.squad, { _id: 2, _isActive: true }] } });
    });
    if (issue === 'rejected detail') f.detail.mockReturnValue(f.reply({ success: false, status: 401 }));
    if (issue === 'incomplete slots') f.squad._players.pop();
    if (issue === 'cancelled') f.list.mockImplementation(() => {
      f.session.stop();
      return f.reply({ success: true, status: 200 });
    });
    const result = await f.session.plan({ objective: 'inventory-first', mode: 'inventory' });
    expect(result.plan).toBeUndefined();
    expect(result.status).toBe(issue === 'cancelled' ? 'cancelled' : 'blocked');
    expect(f.detail).toHaveBeenCalledTimes(['rejected detail', 'incomplete slots'].includes(issue) ? 1 : 0);
    if (issue === 'rejected detail') {
      expect(f.squad._isActive).toBe(true);
      expect((await f.session.plan({ objective: 'inventory-first', mode: 'inventory' })).protectionFailure.phase)
        .toBe('protection-squad-detail');
      expect(f.detail).toHaveBeenCalledTimes(2);
    }
  });

it('uses the active ID from the fresh list when zero was the service default', async () => {
  const f = inactiveSquadSession();
  const current = structuredClone(f.squad);
  current._id = 7; current._isActive = true; current._players[22]._item.id = 7;
  f.list.mockImplementation(() => {
    f.root.services.Squad.activeSquad = 7;
    f.root.repositories.Squad.squads._collection[902]._collection[7] = current;
    return f.reply({ success: true, status: 200, data: { activeSquadId: 7, squads: [f.squad, current] } });
  });
  f.detail.mockReturnValue(f.reply({ success: true, status: 200, data: { squad: current } }));
  const result = await f.session.plan({ objective: 'inventory-first', mode: 'inventory' });
  expect(f.detail.mock.calls).toEqual([[7]]);
  expect(result.plan.policy.activeSquadItemIds).toContain(7);
  expect(result.plan.items.some(item => item.id === 7)).toBe(false);
});

it('does not plan 5x80+ when the FSU season, initialization or Club cache is not ready', () => {
  for (const issue of ['season', 'initializing', 'cache']) {
    const f = runtime(); f.challenge.name = '5x 80+ Upgrade'; f.challenge.scoreRequirement = 6750;
    if (issue === 'season') f.root.info.base.year = 26;
    if (issue === 'initializing') f.root.info.base.initialized = false;
    if (issue === 'cache') f.root.info.base.clubCache.status = 'loading';
    expect(() => readFc27StreamlinedInputs(f.root)).toThrow('FSU_NOT_READY');
    expect(f.calls).toEqual([]);
  }
});

it('accepts a complete, explicitly active native squad with ID zero and protects starters, bench, reserves and manual locks', () => {
  const f = zeroSquadRuntime(), input = readFc27StreamlinedInputs(f.root);
  expect(input.policy).toMatchObject({ activeSquadId: 0, protectFsuLockedPlayers: true, protectActiveSquad: true });
  expect(input.policy.activeSquadItemIds).toEqual([1, 2, 3]);
  const selected = filterStreamlinedItems(input.inventory, input).items;
  expect(selected.some(item => [1, 2, 3, 4].includes(item.id))).toBe(false);
  input.assertCurrent();
  f.squad._isActive = false;
  expect(input.assertCurrent).toThrow('PROTECTION_UNVERIFIED');
  expect(f.calls).toEqual([]);
});

it('does not confuse an uninitialized zero default, inactive roster or invalid identifier with a verified active squad', () => {
  for (const change of ['absent', 'inactive', 'unknown-active', 'partial', 'wrong-id', 'negative', 'nan', 'infinite', 'string']) {
    const f = zeroSquadRuntime();
    if (change === 'absent') f.root.repositories.Squad.squads._collection = {};
    if (change === 'inactive') f.squad._isActive = false;
    if (change === 'unknown-active') delete f.squad._isActive;
    if (change === 'partial') f.squad._players.pop();
    if (change === 'wrong-id') f.squad._id = 1;
    if (change === 'negative') f.root.services.Squad.activeSquad = -1;
    if (change === 'nan') f.root.services.Squad.activeSquad = NaN;
    if (change === 'infinite') f.root.services.Squad.activeSquad = Infinity;
    if (change === 'string') f.root.services.Squad.activeSquad = '0';
    expect(() => readFc27StreamlinedProtection(f.root)).toThrow('PROTECTION_UNVERIFIED');
    expect(f.calls).toEqual([]);
  }
});

it('reuses only a verified zero-ID roster after cache eviction and rejects changed account/squad/FSU bindings', () => {
  for (const change of ['none', 'fsu', 'squad', 'account']) {
    const f = zeroSquadRuntime(), before = readFc27StreamlinedProtection(f.root);
    f.root.repositories.Squad.squads._collection = {};
    if (change === 'fsu') f.root.info.squad[22] = 5;
    if (change === 'squad') f.root.services.Squad.activeSquad = 7;
    if (change === 'account') {
      f.root.services.User.currentUserId = 903;
      f.root.services.User.repository._collection[903] = { ...f.root.services.User.repository._collection[901], id: 903 };
    }
    if (change === 'none') expect(readFc27StreamlinedProtection(f.root)).toEqual(before);
    else expect(() => readFc27StreamlinedProtection(f.root)).toThrow('PROTECTION_UNVERIFIED');
  }
});

it('identifies the failed protection stage without exporting account or card identities', () => {
  for (const [phase, change] of [
    ['protection-lock-list', f => { delete f.root.info.lock; }],
    ['protection-active-id', f => { f.root.services.Squad.activeSquad = '7'; }],
    ['protection-native-id', f => { f.root.repositories.Squad.squads._collection[902]._collection[7]._id = 8; }],
    ['protection-layout', f => { delete f.root.UTSquadEntity.TOTAL_PLAYERS; }],
    ['protection-slot-list', f => { f.root.repositories.Squad.squads._collection[902]._collection[7]._players.pop(); }],
    ['protection-slot-id', f => { delete f.root.repositories.Squad.squads._collection[902]._collection[7]._players[22]._item.id; }],
    ['protection-fsu-roster', f => { f.root.info.squad[22] = null; }],
    ['protection-cache', f => { f.root.repositories.Squad.squads._collection = {}; }],
  ]) {
    const f = runtime(); change(f);
    let error; try { readFc27StreamlinedProtection(f.root); } catch (e) { error = e; }
    expect(error?.message).toBe('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
    expect(error?.evidence?.phase).toBe(phase);
    expect(JSON.stringify(error.evidence)).not.toMatch(/account|itemId|persona|lockedItemIds|903|902/);
    expect(f.calls).toEqual([]);
  }
});

it('excludes FSU-locked and current-squad players including substitutes and reserves', () => {
  const f = runtime(), slots = f.root.repositories.Squad.squads._collection[902]._collection[7]._players;
  f.root.info.lock = [1];
  for (const [index, id] of [[0, 2], [12, 3], [22, 4]]) slots[index]._item.id = f.root.info.squad[index] = id;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.policy).toMatchObject({ protectFsuLockedPlayers: true, protectActiveSquad: true });
  const selected = filterStreamlinedItems(input.inventory, input).items;
  expect(selected.some(item => [1, 2, 3, 4].includes(item.id))).toBe(false);
  expect(input.inventory.find(item => item.id === 1).locked).toBe(true);
  expect(input.inventory.find(item => item.id === 4).activeSquad).toBe(true);
  expect(f.calls).toEqual([]);
});

it('invalidates a preview after lock/roster changes and never accepts missing protection as false', () => {
  for (const change of ['lock', 'roster', 'missing-lock', 'missing-squad', 'partial-roster']) {
    const f = runtime(), input = readFc27StreamlinedInputs(f.root);
    if (change === 'lock') f.root.info.lock.push(1);
    if (change === 'roster') f.root.repositories.Squad.squads._collection[902]._collection[7]._players[22]._item.id = 1;
    if (change === 'missing-lock') delete f.root.info.lock;
    if (change === 'missing-squad') f.root.services.Squad.activeSquad = 8;
    if (change === 'partial-roster') f.root.repositories.Squad.squads._collection[902]._collection[7]._players.pop();
    expect(input.assertCurrent).toThrow();
    expect(f.calls).toEqual([]);
  }
});

it('survives a bound native cache eviction but not a new account/squad or unknown first read', () => {
  const f = runtime();
  const slots = f.root.repositories.Squad.squads._collection[902]._collection[7]._players;
  slots[12]._item.id = f.root.info.squad[12] = 3;
  const before = readFc27StreamlinedProtection(f.root);
  f.root.repositories.Squad.squads._collection = {};
  expect(readFc27StreamlinedProtection(f.root)).toEqual(before);
  f.root.info.squad[12] = 4;
  expect(() => readFc27StreamlinedProtection(f.root)).toThrow('PROTECTION_UNVERIFIED');
  const g = runtime(); g.root.repositories.Squad.squads._collection = {};
  expect(() => readFc27StreamlinedProtection(g.root)).toThrow('PROTECTION_UNVERIFIED');
  for (const change of ['account', 'squad']) {
    const h = runtime();
    readFc27StreamlinedProtection(h.root);
    h.root.repositories.Squad.squads._collection = {};
    if (change === 'squad') h.root.services.Squad.activeSquad = 8;
    else {
      h.root.services.User.currentUserId = 903;
      h.root.services.User.repository._collection[903] = {
        ...h.root.services.User.repository._collection[901], id: 903,
      };
    }
    expect(() => readFc27StreamlinedProtection(h.root)).toThrow('PROTECTION_UNVERIFIED');
    expect(h.calls).toEqual([]);
  }
});

it('adds protection to frozen legacy policies without rewriting them or relaxing unrelated settings', () => {
  const f = runtime(), current = readFc27StreamlinedInputs(f.root).policy;
  const { lockedItemIds: _locks, activeSquadId: _squad, activeSquadItemIds: _members, ...base } = current;
  const legacy = { ...base, protectFsuLockedPlayers: false, protectActiveSquad: false }, before = structuredClone(legacy);
  expect(assertFc27StreamlinedPolicy(f.root, legacy).protectFsuLockedPlayers).toBe(true);
  f.root.info.lock = [1];
  expect(() => assertFc27StreamlinedPolicy(f.root, legacy, [{ id: 1, source: 'inventory' }])).toThrow('MATERIAL_CHANGED');
  expect(legacy).toEqual(before);
  expect(() => assertFc27StreamlinedPolicy(f.root, { ...legacy, onlyUntradeable: false })).toThrow('POLICY_CHANGED');
});
it('reads exact native score, scope and source without a network request or Puzzle ceiling', () => {
  const f = runtime();
  f.root.info.set.goldenrange = 90;
  expect(locateFc27StreamlinedPage(f.root)?.challengeId).toBe(61);
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.challenge).toMatchObject({ targetScore: 2500, selectionLimit: 30, repeats: 1 });
  expect(input.policy.maxRating).toBe(99);
  expect(input.inventory[0]).toMatchObject({ points: 20, scoreVerified: true, price: null, loans: -1, special: false });
  expect(input.eligibility.matches(input.inventory[0]).status).toBe('eligible');
  expect(input.resolveDisplayItem(input.inventory[0])).toBe(f.root.repositories.Item.club.items._collection[1]);
  expect(input.resolveDisplayItem({ ...input.inventory[0], definitionId: 999 })).toBeNull();
  input.assertCurrent(); expect(f.calls).toEqual([]);
  f.challenge.submittedScore = 20;
  expect(input.assertCurrent).toThrow('CONTEXT_CHANGED');
});

it('does not apply the FSU golden range as a hidden Streamlined rating ceiling', () => {
  const f = runtime();
  f.root.info.set.goldenrange = 82;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.policy.maxRating).toBe(99);
  expect(input.policy.goldRange).toEqual([75, 82]);
});

it('follows FSU Only Untradeable instead of forcing it on', () => {
  const f = runtime();
  f.root.info.build.untradeable = false;
  f.root.repositories.Item.club.items._collection[1].tradable = true;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.policy.onlyUntradeable).toBe(false);
  expect(input.inventoryStats).toMatchObject({ count: 11, byPile: { club: 11, storage: 0 },
    tradeability: { tradeable: 1, untradeable: 10, unknown: 0 }, transferSupported: false });
  const filtered = input.inventory.filter(item => item.tradeable === true);
  expect(filtered).toHaveLength(1);
});

it('keeps Only Untradeable protection when FSU enables it', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  f.root.repositories.Item.club.items._collection[1].tradable = true;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.policy.onlyUntradeable).toBe(true);
});

it('reads external piles only when explicitly enabled and reports their capabilities', () => {
  const f = runtime();
  const external = { ...f.root.repositories.Item.club.items._collection[1], id: 901, definitionId: 1901, sbsScore: 20 };
  f.root.repositories.Item.getUnassignedItems = () => [external];
  f.root.repositories.Item.getTransferItems = () => [];
  const input = readFc27StreamlinedInputs(f.root, { sources: ['club', 'storage', 'unassigned', 'transfer'] });
  expect(input.inventoryStats).toMatchObject({ byPile: { unassigned: 1, transfer: 0 }, unassignedSupported: true, transferSupported: true });
  expect(input.inventory.find(item => item.id === 901)).toMatchObject({ pile: 'unassigned', executionPile: 'club' });
  expect(() => readFc27StreamlinedInputs(f.root, { sources: ['unassigned'] })).not.toThrow();
});

it('fails closed when an explicitly enabled external pile has no EA getter', () => {
  const f = runtime();
  expect(() => readFc27StreamlinedInputs(f.root, { sources: ['transfer'] })).toThrow('FC27_STREAMLINED_PILE_UNAVAILABLE');
});

it('reads tradeability from the loaded static DTO when the entity omits it', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first._staticData = { tradable: false };
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.inventory.find(item => item.id === 1)?.tradeable).toBe(false);
  expect(input.inventoryStats.tradeability.untradeable).toBe(11);
});

it('reads FC27 untradeableCount when the entity and static DTO omit tradable', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first._staticData = { untradeableCount: 1 };
  const input = readFc27StreamlinedInputs(f.root);
  expect(snapshotFc27ClubPlayer(first, f.root)).toMatchObject({ tradeable: false, untradeableCount: 1 });
  expect(input.inventory.find(item => item.id === 1)?.tradeable).toBe(false);
});

it('matches FSU: an explicit zero untradeableCount is tradeable', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first._staticData = { untradeableCount: 0 };
  const input = readFc27StreamlinedInputs(f.root);
  expect(snapshotFc27ClubPlayer(first, f.root)).toMatchObject({ tradeable: true, untradeableCount: 0 });
  expect(input.inventory.find(item => item.id === 1)?.tradeable).toBe(true);
});

it('reads untradeableCount from the observed EA data payload', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first.data = { untradeableCount: 1 };
  expect(snapshotFc27ClubPlayer(first, f.root)).toMatchObject({ tradeable: false, untradeableCount: 1 });
});

it('uses the explicit EA tradeability method when DTO flags are omitted', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first._staticData = {};
  first.isUntradeable = () => true;
  expect(snapshotFc27ClubPlayer(first, f.root)).toMatchObject({ tradeable: false });
  delete first.isUntradeable;
  first.isTradeable = () => true;
  expect(snapshotFc27ClubPlayer(first, f.root)).toMatchObject({ tradeable: true });
});

it('does not infer tradeability when all observed data layers omit it', () => {
  const f = runtime();
  f.root.info.build.untradeable = true;
  const first = f.root.repositories.Item.club.items._collection[1];
  delete first.tradable;
  first._staticData = {};
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.inventory.find(item => item.id === 1)?.tradeable).toBeNull();
  expect(input.inventoryStats.tradeability.unknown).toBe(1);
});

it('keeps native FC27 player entities when type is not an own field', () => {
  const f = runtime();
  const first = f.root.repositories.Item.club.items._collection[1];
  first.type = null;
  first.isPlayer = () => true;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.inventory.some(item => item.id === 1)).toBe(true);
  expect(input.inventoryStats.rawByPile.club).toBe(11);
  expect(input.inventoryStats.skippedNonPlayerByPile.club).toBe(0);
});

it('does not guess a non-player entity as a player when type is absent', () => {
  const f = runtime();
  const first = f.root.repositories.Item.club.items._collection[1];
  first.type = null;
  first.isPlayer = () => false;
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.inventory.some(item => item.id === 1)).toBe(false);
  expect(input.inventoryStats.skippedNonPlayerByPile.club).toBe(1);
});
it('projects the EA static card name before falling back to a version identifier', () => {
  const f = runtime();
  const first = f.root.repositories.Item.club.items._collection[1];
  first._staticData = { knownAs: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', name: 'Static Name' };
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('Ada Lovelace');
  delete first._staticData.knownAs;
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('Ada Lovelace');
  delete first._staticData.firstName;
  delete first._staticData.lastName;
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('Static Name');
  delete first._staticData.name;
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBeNull();
});
it('skips native placeholder names and uses the already loaded static identity', () => {
  const f = runtime();
  const first = f.root.repositories.Item.club.items._collection[1];
  first.displayName = '';
  first._staticData = { knownAs: '---', firstName: 'Denzel', lastName: 'Dumfries', name: 'Dumfries' };
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('Denzel Dumfries');
  first.displayName = ' --- ';
  first._staticData.knownAs = 'João Cancelo';
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('João Cancelo');
  first._staticData = { knownAs: '---', firstName: '---', lastName: '---', name: 'Dumfries' };
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBe('Dumfries');
  first._staticData.name = '---';
  expect(readFc27StreamlinedInputs(f.root).inventory[0].name).toBeNull();
  expect(f.calls).toEqual([]);
});
it('rejects unrelated screens, invalid rules, missing point accessors and account changes', () => {
  const f = runtime(), input = readFc27StreamlinedInputs(f.root);
  f.user.selectedPersona = 444;
  expect(input.assertCurrent).toThrow();
  f.user.selectedPersona = 902;
  delete f.root.repositories.Item.club.items._collection[1].sbsScore;
  expect(readFc27StreamlinedInputs(f.root).inventory[0].points).toBeNull();
  f.challenge.eligibilityRequirements[0].kvPairs._collection[999] = [1];
  expect(() => readFc27StreamlinedInputs(f.root)).toThrow('ELIGIBILITY_UNVERIFIED');
  f.challenge.isOneClickChallenge = () => false;
  expect(locateFc27StreamlinedPage(f.root)).toBeNull();
  expect(inspectFc27Streamlined(f.root).status).toBe('blocked');
});
it('uses native AND/OR semantics and never matches market versions against an owned item by definition alone', () => {
  const contract = fixtureChallenge();
  const entities = new Map([[1, { definitionId: 2 }]]);
  const root = { UTEvolutionEligibilityVO: class { isValid = true; meetsRequirements = () => true; } };
  const matcher = createFc27StreamlinedMatcher(root, contract, entities);
  expect(matcher.matches({ id: 1, definitionId: 2 }).status).toBe('eligible');
  expect(matcher.matches({ id: null, definitionId: 2 }).status).toBe('unknown');
  expect(matcher.matches({ id: 1, definitionId: 3 }).status).toBe('unknown');
});

it('bundles the read-only inspector and exports no account or item identities', async () => {
  const { root, calls } = runtime();
  root.scheduler = { yield: () => { throw Error('plain inspection must not schedule planning'); } };
  root.MessageChannel = class { constructor() { throw Error('plain inspection must not open a task port'); } };
  root.setTimeout = () => { throw Error('plain inspection must not start a timer'); };
  const report = await inspectStreamlined({ url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: source => runInNewContext(source, { globalThis: root, structuredClone }) });
  expect(report).toMatchObject({ status: 'observed', challenge: { id: 61, targetScore: 2500 }, liveExecutionEnabled: false });
  expect(report.challenge.context).toBeUndefined();
  expect(report.inventory).toBeUndefined();
  expect(calls).toEqual([]);
});
