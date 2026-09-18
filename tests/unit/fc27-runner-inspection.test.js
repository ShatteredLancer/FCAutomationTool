import { expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { inspectFc27RunnerInputs, readFc27RunnerPanel } from '../../src/adapters/ea/fc27-fsu-read.js';
import { buildRunnerInspection, inspectRunnerInputs, inspectRunnerContract } from '../../scripts/browser-inspection/runner-inspection.mjs';

function fixture() {
  const sku = 'synthetic-27-pc';
  const club = { sku, year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: sku, clubs: { _collection: { [sku]: club } } };
  const user = { id: 901, selectedPersona: 902, _personas: { _collection: { 902: persona } } };
  const player = { id: 101, definitionId: 201, type: 'player', _rating: 71, _rareflag: 0,
    utasPile: 7, state: 'free', tradable: false, loans: -1, limitedUseType: 0, upgrades: null,
    concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10, startTime: -1, endTime: -1 };
  const forbidden = vi.fn(() => { throw new Error('must not invoke effects'); });
  return { forbidden, root: { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7, EVOLUTION: 11 },
    ItemRarity: { NONE: 0, RARE: 1 }, LimitedUseType: { NONE: 0 },
    services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } },
      SBC: { repository: { sets: { _collection: {} } }, saveChallenge: forbidden, submitChallenge: forbidden } },
    repositories: { Item: { club: { items: { _collection: { 101: player } } } } },
    info: { base: { year: 27, initialized: true, state: true, clubCache: { status: 'ready' } },
      build: { untradeable: true, academy: true, league: true, firststorage: true },
      set: { goldenrange: 82, shield_league: [10, 20] } },
    events: { validateClubPlayers: forbidden, oneFillCreationGF: forbidden, playerListFillSquad: forbidden } } };
}

it('observes existing Local FSU without invoking any method or granting Live authority', () => {
  const { root, forbidden } = fixture();
  const result = inspectFc27RunnerInputs(root);
  expect(result).toMatchObject({ status: 'observed', reason: 'FC27_TRANSACTION_UNVERIFIED',
    liveExecutionEnabled: false, contextVerified: true,
    fsu: { initialized: true, readiness: 'ready', targetedValidationAvailable: true,
      policy: { onlyUntradeable: true, excludeEvolution: true, goldRange: [75, 82], excludedLeagueCount: 2 } },
    club: { cachedPlayers: 1, complete: false, status: 'partial' } });
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/901|902|synthetic-27|definitionId|accountScope/);
});

it('lists only bounded unambiguous local targets without getters or requests', () => {
  const { root, forbidden } = fixture();
  const sets = root.services.SBC.repository.sets._collection;
  sets.a = { id: 4, name: 'Bronze Upgrade' };
  expect(readFc27RunnerPanel(root).targets).toEqual([{ setId: 4, name: 'Bronze Upgrade' }]);
  sets.b = { id: 4, name: 'Duplicate' };
  expect(readFc27RunnerPanel(root)).toMatchObject({ inputs: { status: 'blocked' }, targets: [] });
  delete sets.b;
  Object.defineProperty(sets, 'b', { get: forbidden });
  expect(readFc27RunnerPanel(root).targets).toEqual([]);
  expect(forbidden).not.toHaveBeenCalled();
});

it.each(['untradeable', 'academy', 'league', 'firststorage'])('does not default missing FSU policy field %s', key => {
  const { root } = fixture();
  delete root.info.build[key];
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_FSU_POLICY_UNVERIFIED');
});

it('keeps provisional separate from ready and never treats unknown FSU state as ready', () => {
  const { root } = fixture();
  root.info.base.clubCache.status = 'trusted-provisional';
  root.info.base.state = false;
  expect(inspectFc27RunnerInputs(root)).toMatchObject({ status: 'observed', fsu: { readiness: 'provisional' } });
  delete root.info.base.clubCache;
  delete root.info.base.state;
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_FSU_NOT_READY');
});

it('requires targeted validation capability even when a cache claims ready', () => {
  const { root } = fixture();
  delete root.events.validateClubPlayers;
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_FSU_VALIDATION_UNAVAILABLE');
});

it('blocks stale season, missing context and accessors without invoking them', () => {
  const { root, forbidden } = fixture();
  root.info.base.year = 26;
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_FSU_SEASON_MISMATCH');
  Object.defineProperty(root, 'services', { get: forbidden });
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_CONTEXT_UNAVAILABLE');
  expect(forbidden).not.toHaveBeenCalled();
});

it('preserves false settings and rejects unknown league/range shapes instead of weakening policy', () => {
  const { root } = fixture();
  root.info.build.league = false;
  root.info.build.academy = false;
  expect(inspectFc27RunnerInputs(root).fsu.policy).toMatchObject({ excludeEvolution: false, excludedLeagueCount: 0 });
  root.info.set.goldenrange = null;
  expect(inspectFc27RunnerInputs(root).reason).toBe('FC27_FSU_POLICY_UNVERIFIED');
});

it('builds a bounded standalone probe and refuses non-EA targets', async () => {
  const artifact = await buildRunnerInspection();
  expect(artifact.inputs).not.toContain('src/userscript-entry.js');
  const sandbox = {};
  vm.runInNewContext(artifact.source, sandbox);
  expect(sandbox.FC27RunnerReadOnly.inspectFc27RunnerInputs({}).liveExecutionEnabled).toBe(false);
  const page = { url: () => 'https://example.com/', evaluate: vi.fn() };
  expect((await inspectRunnerInputs(page)).reason).toBe('WEB_APP_REQUIRED');
  expect(page.evaluate).not.toHaveBeenCalled();
});

it('keeps the fresh-contract probe read-only and excludes the executable transaction core', async () => {
  const artifact = await buildRunnerInspection({ contract: true });
  expect(artifact.inputs).toContain('src/adapters/ea/fc27-sbc-contract.js');
  expect(artifact.inputs.some(path => /traditional-transaction|traditional-journal|traditional-lock|transaction-persistence|submit-attempt|userscript-entry/.test(path))).toBe(false);
  expect(artifact.source).not.toMatch(/\.submitChallenge\(|\.saveChallenge\(/);
  const page = { url: () => 'https://example.com/', evaluate: vi.fn() };
  expect((await inspectRunnerContract(page, 4)).reason).toBe('WEB_APP_REQUIRED');
  expect(page.evaluate).not.toHaveBeenCalled();
  page.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
  await expect(inspectRunnerContract(page, '4')).rejects.toThrow('FSU_CATALOG_SET_INVALID');
  expect(page.evaluate).not.toHaveBeenCalled();
});
