import { expect, it } from 'vitest';
import { createFc27GalleryProgressReader, sanitizeGalleryNativeCard } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { futggGalleryPool } from '../fixtures/fc27-gallery.js';
import { enhancerDatabase } from '../helpers/gallery-enhancer-idb.js';

function fixture() {
  const club = { sku: 'test27', year: 2027, platform: 'pc' };
  const persona = { id: 1002, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 1001, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } } },
    repositories: { Item: { club: { items: { _collection: {} } } } } };
  const pool = normalizeGalleryPool('futgg', futggGalleryPool(), 30), store = new Map();
  const context = readFc27Context(root), key = contextKey(context, 'gallery-collection');
  const options = { gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value), now: () => 1000 };
  return { root, club, pool, store, context, key, options, reader: () => createFc27GalleryProgressReader(root, options) };
}

it('recovers exact-version Enhancer history read-only, preserving native collection and local/verified precedence across reload', async () => {
  const f = fixture();
  f.root.indexedDB = enhancerDatabase(JSON.stringify({ version: 2, state: { playersByPersonaId: {
    1002: { 900001: true, 900002: false, 900003: true }, 9999: { 900002: true },
  } } }));
  f.store.set(f.key, { schema: 3, context: f.context, fetchedAt: 900, concepts: [
    { definitionId: 900001, isCollected: true, gradingScore: 100, collectedOwners: 1 },
    { definitionId: 900002, isCollected: true, gradingScore: 100 },
  ] });
  let reader = f.reader();
  let result = await reader.project(f.pool);
  expect(result.progress.rows[0]).toMatchObject({ collected: true, firstOwned: true, observedFirstOwned: null, firstOwnedSource: 'enhancer-history' });
  expect(result.progress.rows[1]).toMatchObject({ firstOwned: false, firstOwnedSource: 'enhancer-history' });
  expect(result.progress.rows[2]).toMatchObject({ collected: null, firstOwned: null });
  await reader.updateFirstOwner(900002, true);
  expect((await reader.project(f.pool)).progress.rows[1]).toMatchObject({ firstOwned: true, firstOwnedSource: 'local-history' });
  await reader.updateFirstOwner(900002, null);
  expect((await reader.project(f.pool)).progress.rows[1].firstOwned).toBe(false);
  reader.dispose();
  f.root.repositories.Item.club.items._collection.card = { id: 501, type: 'player', concept: false, definitionId: 900002, owners: 1 };
  reader = f.reader(); result = await reader.project(f.pool);
  expect(result.progress.rows[0].firstOwnedSource).toBe('enhancer-history');
  expect(result.progress.rows[1]).toMatchObject({ firstOwned: true, firstOwnedSource: 'ea-observed' });
  expect(f.root.indexedDB.calls.filter(c => c[0] === 'transaction')).toEqual([['transaction', 'setting', 'readonly'], ['transaction', 'setting', 'readonly']]);
  reader.dispose();
});

it.each(['account', 'dispose'])('discards a late Enhancer read after %s changes', async action => {
  const f = fixture(); let release;
  f.root.indexedDB = enhancerDatabase(JSON.stringify({ version: 2, state: { playersByPersonaId: { 1002: { 900001: true } } } }));
  f.root.indexedDB.databases = () => new Promise(resolve => { release = resolve; });
  const reader = f.reader(), task = reader.project(f.pool);
  if (action === 'account') f.club.platform = 'other'; else reader.dispose();
  release([{ name: 'fce-27' }]);
  expect(await task).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' });
  reader.dispose();
});

it('restores shared historical collection without requesting EA or inventing absent version flags', async () => {
  const f = fixture(); f.store.set(f.key, { schema: 3, context: f.context, fetchedAt: 900, syncedAt: 900,
    concepts: [{ definitionId: 900001, isCollected: true, gradingScore: 100, verifiedCollectedOwners: 1 }] });
  const reader = f.reader(), result = await reader.project(f.pool);
  expect(result.progress.totals).toMatchObject({ collected: 1, unknown: 2 });
  expect(result.progress.rows[0]).toMatchObject({ firstOwned: true, inClub: null });
  expect(reader.syncState().synced).toBe(false); reader.dispose();
});

it.each(['future', 'context', 'duplicate', 'invalid'])('ignores %s shared snapshots', async kind => {
  const f = fixture(), saved = { schema: 3, context: f.context, fetchedAt: 900,
    concepts: [{ definitionId: 900001, isCollected: true, gradingScore: 100 }] };
  if (kind === 'future') saved.fetchedAt = 1001;
  if (kind === 'context') saved.context = { ...f.context, platform: 'other' };
  if (kind === 'duplicate') saved.concepts.push({ ...saved.concepts[0] });
  if (kind === 'invalid') saved.concepts[0].definitionId = 0;
  f.store.set(f.key, saved); const reader = f.reader();
  expect((await reader.project(f.pool)).progress.totals.unknown).toBe(3); reader.dispose();
});

it('rechecks account after an asynchronous persistent read before projecting progress', async () => {
  const f = fixture(); f.options.gmGetValue = async () => { f.club.platform = 'other'; return null; };
  const reader = f.reader();
  expect(await reader.project(f.pool)).toEqual({ status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' });
  reader.dispose();
});

it('migrates an exact legacy per-set snapshot into shared evidence without native service access', async () => {
  const f = fixture(); f.store.set(contextKey(f.context, 'gallery-progress:futgg:30'), {
    schema: 2, context: f.context, revision: f.pool.revision, fetchedAt: 900,
    concepts: f.pool.items.map(row => ({ definitionId: row.eaId, isCollected: false, gradingScore: 100 })) });
  const reader = f.reader();
  expect((await reader.load(f.pool)).progress.totals.missing).toBe(3);
  expect(f.store.get(f.key).schema).toBe(3);
  expect((await reader.load({ ...f.pool, setId: 31 })).cached).toBe(true); reader.dispose();
});

it('retains exact-version display fields and drops account and transport data', () => {
  const raw = { resourceId: 900001, itemType: 'player', dream: true, rareflag: 22, rating: 86,
    attributeArray: [80,70,60,50,40,30], guidAssetId: 'version-900001', secret: 'omit', token: 'omit' };
  const card = sanitizeGalleryNativeCard(raw);
  expect(card).toMatchObject({ resourceId: 900001, guidAssetId: 'version-900001', attributeArray: raw.attributeArray });
  expect(card).not.toHaveProperty('secret'); expect(card).not.toHaveProperty('token');
  expect(sanitizeGalleryNativeCard({ ...raw, resourceId: 0 })).toBeNull();
  expect(sanitizeGalleryNativeCard({ ...raw, attributeArray: [80] })).toBeNull();
  expect(raw).not.toHaveProperty('id');
});

it('reads already-cached held piles once and leaves absence unknown', async () => {
  const f = fixture();
  f.root.repositories.Item.storage = { _collection: {
    one: { id: 123, definitionId: 900001, type: 'player', concept: false },
    concept: { id: 124, definitionId: 900002, type: 'player', concept: true },
  } };
  const reader = f.reader(), result = await reader.project(f.pool);
  expect(result.progress.rows[0]).toMatchObject({ held: true, inClub: null, collected: null });
  expect(result.progress.rows[1]).toMatchObject({ held: null });
  reader.dispose();
});

it('persists local FO by account and restores EA evidence after undo without network reads', async () => {
  const f = fixture(); f.store.set(f.key, { schema: 3, context: f.context, fetchedAt: 900,
    concepts: [{ definitionId: 900001, isCollected: true, gradingScore: 100, verifiedCollectedOwners: 2 }] });
  let reader = f.reader();
  await reader.updateFirstOwner(900001, true);
  expect((await reader.project(f.pool)).progress.rows[0]).toMatchObject({ firstOwned: true, observedFirstOwned: false, firstOwnedSource: 'local-history', collected: true });
  reader.dispose(); reader = f.reader();
  expect((await reader.project(f.pool)).progress.rows[0].firstOwned).toBe(true);
  f.club.platform = 'other';
  expect((await reader.project(f.pool)).progress.rows[0].firstOwned).toBeNull();
  f.club.platform = 'pc';
  await reader.updateFirstOwner(900001, null);
  expect((await reader.project(f.pool)).progress.rows[0]).toMatchObject({ firstOwned: false, firstOwnedSource: 'ea-observed', collected: true });
  reader.dispose();
});

it('serializes concurrent local declarations without losing another version or poisoning later writes', async () => {
  const f = fixture(), reader = f.reader();
  await Promise.all([reader.updateFirstOwner(900001, true), reader.updateFirstOwner(900002, true)]);
  expect(await reader.readFirstOwnerHistory()).toHaveLength(2);
  await reader.updateFirstOwner(900001, null);
  expect(await reader.readFirstOwnerHistory()).toEqual([{ definitionId: 900002, firstOwned: true, updatedAt: 1000 }]);
  reader.dispose();
});

it('does not report a failed local FO write as saved or leave an optimistic override', async () => {
  const f = fixture(); f.options.gmSetValue = () => { throw Error('disk full'); };
  const reader = f.reader();
  await expect(reader.updateFirstOwner(900001, true)).rejects.toThrow('FC27_GALLERY_FO_SAVE_FAILED');
  expect(await reader.readFirstOwnerHistory()).toEqual([]);
  expect((await reader.project(f.pool)).progress.rows[0].firstOwned).toBeNull();
  reader.dispose();
});

it.each([1, 2])('retains legacy owner count %s without treating it as verified account ownership', async owners => {
  const f = fixture(), saved = { schema: 3, context: f.context, fetchedAt: 900,
    concepts: [{ definitionId: 900001, isCollected: true, gradingScore: 100, collectedOwners: owners }] };
  f.store.set(f.key, structuredClone(saved)); const r = f.reader();
  expect((await r.project(f.pool)).progress.rows[0]).toMatchObject({ collected: true, gradingScore: 100,
    firstOwned: null, observedFirstOwned: null, firstOwnedHistoryUnverified: true });
  await r.updateFirstOwner(900001, true);
  expect((await r.project(f.pool)).progress.rows[0]).toMatchObject({ firstOwned: true, firstOwnedSource: 'local-history' });
  await r.updateFirstOwner(900001, null);
  expect((await r.project(f.pool)).progress.rows[0].firstOwned).toBeNull();
  expect(f.store.get(f.key).concepts[0].collectedOwners).toBe(owners);
  r.dispose();
  const reopened = f.reader();
  expect((await reopened.project(f.pool)).progress.rows[0].firstOwned).toBeNull(); reopened.dispose();
});

it.each([1, 2])('uses current Club owner count %s instead of unverified legacy minimum, without deleting the original record', async owners => {
  const f = fixture(); f.store.set(f.key, { schema: 3, context: f.context, fetchedAt: 900,
    concepts: [{ definitionId: 900001, isCollected: true, gradingScore: 100, collectedOwners: 1 }] });
  f.root.repositories.Item.club.items._collection.card = { id: 501, type: 'player', concept: false, definitionId: 900001, owners };
  const r = f.reader();
  expect((await r.project(f.pool)).progress.rows[0]).toMatchObject({ firstOwned: owners === 1, observedFirstOwned: owners === 1 });
  expect(f.store.get(f.key).concepts[0].collectedOwners).toBe(1); r.dispose();
});
