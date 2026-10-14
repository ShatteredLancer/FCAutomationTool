import { expect, it } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { locateFc27StreamlinedPage, readFc27StreamlinedInputs, inspectFc27Streamlined, createFc27StreamlinedMatcher,
  readFc27StreamlinedProtection, assertFc27StreamlinedPolicy } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { challenge as fixtureChallenge } from '../helpers/streamlined.js';
import { inspectStreamlined } from '../../scripts/browser-inspection/streamlined-inspection.mjs';
import { runInNewContext } from 'node:vm';
import { filterStreamlinedItems } from '../../src/streamlined/eligibility.js';

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
  const report = await inspectStreamlined({ url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: source => runInNewContext(source, { globalThis: root, structuredClone }) });
  expect(report).toMatchObject({ status: 'observed', challenge: { id: 61, targetScore: 2500 }, liveExecutionEnabled: false });
  expect(report.challenge.context).toBeUndefined();
  expect(report.inventory).toBeUndefined();
  expect(calls).toEqual([]);
});
