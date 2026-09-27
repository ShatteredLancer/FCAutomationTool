import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { probeFc27TeamFactsRuntime } from '../../src/adapters/ea/fc27-team-facts-probe.js';

it('fingerprints methods without invoking them or promoting differential verification', async () => {
  function getRating() { throw new Error('must not call'); }
  const getter = vi.fn(() => { throw new Error('must not read'); });
  const proto = { getRating };
  Object.defineProperty(proto, 'chemistry', { get: getter });
  const root = { APP_YEAR_SHORT: 27, UTSquadEntity: { prototype: proto }, privateAccount: 'secret' };
  const report = await probeFc27TeamFactsRuntime(root);
  expect(report).toMatchObject({ status: 'unverified', reason: 'FC27_EA_TEAM_FACTS_UNVERIFIED',
    invoked: false, executable: false, liveExecutionEnabled: false });
  expect(report.targets.find(target => target.path === 'UTSquadEntity.prototype').methods).toEqual([
    { name: 'getRating', kind: 'function', arity: 0,
      sha256: createHash('sha256').update(getRating.toString().replace(/\r\n/g, '\n')).digest('hex') },
    { name: 'chemistry', kind: 'accessor', arity: null, sha256: null },
  ]);
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toMatch(/secret|must not call|privateAccount/);
});

it('does not invoke constructors or getters while resolving allowlisted paths', async () => {
  const constructor = vi.fn(); const getter = vi.fn();
  const root = { APP_YEAR_SHORT: '27', UTSquadEntity: constructor };
  Object.defineProperty(root, 'UTSBCChallengeEntity', { get: getter });
  const report = await probeFc27TeamFactsRuntime(root);
  expect(report.targets.find(t => t.path === 'UTSBCChallengeEntity.prototype').present).toBe(false);
  expect(constructor).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
});

it('fingerprints allowlisted factory methods through their prototype without calling them', async () => {
  const createSBCSquad = vi.fn((a, b, c) => { void a; void b; void c; throw new Error('must not call'); });
  const factory = Object.create({ createSBCSquad });
  const report = await probeFc27TeamFactsRuntime({ APP_YEAR_SHORT: 27, factories: { Squad: factory } });
  expect(report.targets.find(t => t.path === 'factories.Squad').methods[0]).toMatchObject({
    name: 'createSBCSquad', kind: 'function', arity: 3,
  });
  expect(createSBCSquad).not.toHaveBeenCalled();
});

it('bounds descriptor output and does not recursively traverse runtime collections', async () => {
  const proto = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`method${i}`, () => 0]));
  const report = await probeFc27TeamFactsRuntime({ APP_YEAR_SHORT: 27, UTSquadEntity: { prototype: proto } });
  expect(report.targets).toHaveLength(11);
  expect(report.targets.find(target => target.path === 'UTSquadEntity.prototype')).toMatchObject({ truncated: true, methods: [] });
});

it('does not inspect non-FC27 runtime', async () => {
  const getter = vi.fn(); const root = { APP_YEAR_SHORT: 26 };
  Object.defineProperty(root, 'UTSquadEntity', { get: getter });
  expect(await probeFc27TeamFactsRuntime(root)).toMatchObject({ reason: 'FC27_WEB_APP_REQUIRED', targets: [] });
  expect(getter).not.toHaveBeenCalled();
});
