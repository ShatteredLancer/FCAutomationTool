import { expect, it, vi } from 'vitest';
import { parseEnhancerGalleryHistory, readEnhancerGalleryHistory } from '../../src/adapters/browser/fc27-gallery-enhancer-history.js';
import { enhancerDatabase } from '../helpers/gallery-enhancer-idb.js';

const data = () => ({ version: 2, state: { playersByPersonaId: { 1002: { 2001: true, 2002: false }, 1003: { 2001: false } } } });
it('reads only the exact existing DB/store/key in a readonly transaction and selects the matching persona', async () => {
  const db = enhancerDatabase(JSON.stringify(data()));
  expect(await readEnhancerGalleryHistory(db, '1002')).toEqual(new Map([[2001, true], [2002, false]]));
  expect(db.calls).toEqual([['databases'], ['open', 'fce-27'], ['transaction', 'setting', 'readonly'],
    ['get', 'setting', 'gallery-collected-players-state'], ['close']]);
  expect(await readEnhancerGalleryHistory(db, '1003')).toEqual(new Map([[2001, false]]));
  expect(await readEnhancerGalleryHistory(db, '1004')).toBeNull();
});
it.each(['absent', 'old-browser', 'deleted', 'blocked', 'denied'])('does not create or upgrade a DB when %s', async kind => {
  const db = enhancerDatabase(JSON.stringify(data()), { listed: kind !== 'absent', upgrade: kind === 'deleted', blocked: kind === 'blocked' });
  if (kind === 'old-browser') delete db.databases;
  if (kind === 'denied') db.databases = () => Promise.reject(Error('denied'));
  expect(await readEnhancerGalleryHistory(db, '1002')).toBeNull();
  expect(db.calls.filter(c => c[0] === 'transaction')).toEqual([]);
  if (kind === 'deleted') expect(db.calls).toContainEqual(['abort']);
  if (['absent', 'old-browser', 'denied'].includes(kind)) expect(db.calls.filter(c => c[0] === 'open')).toEqual([]);
});
it.each(['json', 'schema', 'bool', 'id', 'array', 'oversize'])('rejects malformed %s history without partial or cross-persona fallback', kind => {
  const value = data();
  if (kind === 'schema') value.version = 1;
  if (kind === 'bool') value.state.playersByPersonaId[1002][2002] = 1;
  if (kind === 'id') value.state.playersByPersonaId[1002]['01'] = true;
  if (kind === 'array') value.state.playersByPersonaId[1002] = [];
  expect(parseEnhancerGalleryHistory(kind === 'json' ? '{' : kind === 'oversize' ? ' '.repeat(4000001) : JSON.stringify(value), '1002')).toBeNull();
});
it('bounds a stalled read and never opens the DB after the deadline', async () => {
  vi.useFakeTimers();
  try {
    let release;
    const db = { databases: () => new Promise(resolve => { release = resolve; }), open: vi.fn() };
    const task = readEnhancerGalleryHistory(db, '1002');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await task).toBeNull();
    release([{ name: 'fce-27' }]); await Promise.resolve();
    expect(db.open).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
