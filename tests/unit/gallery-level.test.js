import { expect, it, vi } from 'vitest';
import fixture from '../fixtures/fc27-gallery-level-2026-10-26.json';
import { projectGalleryLevelMilestones } from '../../src/gallery/level-milestones.js';
import { createFc27GalleryLevelReader, FC27_GALLERY_LEVEL_CATEGORIES_HASH } from '../../src/adapters/ea/fc27-gallery-level.js';

it('shows verified level-5 and level-10 Hero milestone without inventing an exact level from progress=1', () => {
  const result = projectGalleryLevelMilestones(fixture.groups, 1000);
  expect(result).toMatchObject({ status: 'observed', exactLevel: null, galleryXp: null, confirmedAtLeast: 5,
    nextMilestone: { level: 10, completed: null, claimed: null, rewards: ['1 of 5 Holographic Base Hero Player Pick'] } });
  expect(result.milestones[0]).toMatchObject({ level: 5, completed: true, claimed: true });
});

it('keeps unstarted/default state unknown and updates only a confirmed milestone lower bound', () => {
  const groups = structuredClone(fixture.groups);
  groups[0].objectives[1].state = 2;
  expect(projectGalleryLevelMilestones(groups)).toMatchObject({ exactLevel: null, confirmedAtLeast: 10,
    nextMilestone: { level: 15 } });
  expect(projectGalleryLevelMilestones([])).toMatchObject({ status: 'unavailable', exactLevel: null });
  const season = [{ objectives: [{ description: 'Reach Season Level 8.', state: 3 }] }];
  expect(projectGalleryLevelMilestones(season).milestones).toHaveLength(0);
});

function setup() {
  const categories = [{ groups: { _collection: { 81: { objectives: { _collection: Object.fromEntries(fixture.groups[0].objectives.map(o => [o.id, {
    id: o.id, title: o.title, description: o.description, _state: o.state, _progress: o.state === 3 ? 1 : 0, companion: false,
    rewards: { rewards: o.rewards.map(description => ({ item: { _staticData: { description } } })) },
  }])) } } } } }];
  let response = { success: true, status: 200, response: { categories } };
  class Dao { getCategories() { calls.read++; return { observe: (_owner, callback) => queueMicrotask(() => callback(null, response)), unobserve() {} }; } }
  const calls = { read: 0, claim: 0 };
  const users = Object.fromEntries([1, 2].map(id => [id, { id, selectedPersona: id + 10,
    _personas: { _collection: { [id + 10]: { id: id + 10, _sku: 'fixture', clubs: { _collection: {
      fixture: { sku: 'fixture', year: 2027, platform: 'pc' },
    } } } } } }]));
  const root = { APP_YEAR_SHORT: 27, APP_YEAR: 2027, GAME_NAME: 'fc27',
    services: { User: { currentUserId: 1, repository: { _collection: users } }, Objectives: { objectivesDAO: new Dao() } },
    ObjectiveProgressState: { COMPLETED: 2, REDEEMED: 3, IN_PROGRESS: 1 },
    crypto: { subtle: { digest: vi.fn(async () => Uint8Array.from(FC27_GALLERY_LEVEL_CATEGORIES_HASH.match(/../g).map(value => parseInt(value, 16))).buffer) } } };
  root.services.Objectives.claimLevelReward = () => { calls.claim++; throw Error('No claims allowed'); };
  const data = new Map([['locked-players', [123]]]);
  const reader = createFc27GalleryLevelReader(root, { get: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
    set: async (key, value) => data.set(key, structuredClone(value)), now: () => 1000 });
  return { root, reader, calls, data, fail: () => { response = { success: false, status: 503 }; } };
}

it('uses one reviewed read for concurrent refreshes and never claims a reward', async () => {
  const { reader, calls } = setup();
  const [a, b] = await Promise.all([reader.refresh(), reader.refresh()]);
  expect(a).toMatchObject({ confirmedAtLeast: 5, exactLevel: null });
  expect(b).toEqual(a); expect(calls).toEqual({ read: 1, claim: 0 });
});

it('blocks a changed native method fingerprint and retains prior data on a read failure', async () => {
  const { reader, root, calls, fail } = setup();
  await reader.refresh(); fail();
  expect(await reader.refresh()).toMatchObject({ status: 'unavailable', stale: true, confirmedAtLeast: 5, exactLevel: null });
  root.crypto.subtle.digest.mockResolvedValue(new Uint8Array(32).buffer);
  expect(await reader.refresh()).toMatchObject({ reason: 'FC27_GALLERY_LEVEL_RUNTIME_UNVERIFIED' });
  expect(calls.read).toBe(2); expect(calls.claim).toBe(0);
});

it('keeps user-confirmed console level separate, account-scoped and outside protected settings', async () => {
  const { reader, root, data } = setup();
  const note = await reader.saveNote(8);
  expect(note).toMatchObject({ level: 8, source: 'console-user-recorded' });
  expect(await reader.readNote()).toEqual(note);
  root.services.User.currentUserId = 2;
  expect(await reader.readNote()).toBeNull(); expect(reader.peek()).toBeNull();
  expect(data.get('locked-players')).toEqual([123]);
  await expect(reader.saveNote(0)).rejects.toThrow('FC27_GALLERY_LEVEL_NOTE_INVALID');
});

it('rejects an account change while the native fingerprint is being checked', async () => {
  const { reader, root, calls } = setup();
  const request = reader.refresh(); root.services.User.currentUserId = 2;
  expect(await request).toMatchObject({ reason: 'FC27_GALLERY_CONTEXT_CHANGED' });
  expect(calls.read).toBe(0); expect(reader.peek()).toBeNull();
});
