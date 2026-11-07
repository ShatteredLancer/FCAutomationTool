import { afterEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { inspectFc27RunnerInputs, readFc27PuzzlePolicy } from '../../src/adapters/ea/fc27-fsu-read.js';
import * as club from '../../src/adapters/ea/fc27-local-read.js';

afterEach(() => vi.restoreAllMocks());

it('checks live Puzzle protections without repeatedly normalizing the whole Club for discarded diagnostic counts', () => {
  const { root } = executionRuntime();
  const items = root.repositories.Item.club.items._collection;
  for (let id = 1000; id < 1553; id++) items[id] = root.factories.Item.createItem({ id, resourceId: id + 10000 });
  const before = readFc27PuzzlePolicy(root);
  const read = vi.spyOn(club, 'readFc27CachedClub');
  const started = performance.now();
  for (let index = 0; index < 100; index++) expect(readFc27PuzzlePolicy(root)).toEqual(before);
  const elapsedMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ control: 'synthetic-564-club-100-policy-checks', elapsedMs, fullClubReads: read.mock.calls.length }));
  expect(read.mock.calls.length).toBe(0);
  const diagnostics = inspectFc27RunnerInputs(root);
  expect(read).toHaveBeenCalledOnce();
  expect(diagnostics.club.cachedPlayers).toBe(564);
});

it('still observes every FSU setting and exact protection change immediately', () => {
  const { root } = executionRuntime();
  const before = readFc27PuzzlePolicy(root);
  root.info.build.untradeable = !before.onlyUntradeable;
  root.info.build.firststorage = !before.storageFirst;
  root.info.build.league = true; root.info.set.shield_league = [19];
  root.info.set.goldenrange = 79; root.info.lock = [7, 8]; root.info.squad[0] = 9;
  expect(readFc27PuzzlePolicy(root)).toMatchObject({ onlyUntradeable: !before.onlyUntradeable,
    storageFirst: !before.storageFirst, maxRating: 79, goldRange: [75, 79], excludedLeagueIds: [19],
    lockedItemIds: [7, 8], activeSquadItemIds: [9] });
  root.info.lock = [null];
  expect(() => readFc27PuzzlePolicy(root)).toThrow('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
});

it.each(['readiness', 'flags', 'validator', 'account'])('retains the fail-closed %s policy boundary', mode => {
  const { root } = executionRuntime();
  if (mode === 'readiness') root.info.base.initialized = false;
  if (mode === 'flags') root.info.build.untradeable = null;
  if (mode === 'validator') root.events.validateClubPlayers = null;
  if (mode === 'account') root.services.User.currentUserId = null;
  expect(() => readFc27PuzzlePolicy(root)).toThrow(/FC27_/);
});
