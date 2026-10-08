import { expect, it } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { FC27_CLUB_READ_METHODS } from '../../src/adapters/ea/fc27-club-read.js';
import { FC27_STREAMLINED_CACHE_METHODS } from '../../src/adapters/ea/fc27-streamlined-cache.js';
import { FC27_STREAMLINED_PAGE_METHODS } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { FC27_STREAMLINED_PROGRESS_HASH } from '../../src/adapters/ea/fc27-streamlined-progress.js';
import { FC27_STREAMLINED_STORAGE_HASH, FC27_STREAMLINED_STORAGE_QUERY_HASH } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';

// CI checks out these helpers with CRLF; the fixture must recognize the same
// synthetic implementation for both raw readers and LF-normalizing readers.
it.each(['\n', '\r\n'])('keeps nested Storage/Streamlined fixture hashes consistent with %j', async eol => {
  const { root } = streamlinedRuntime({ mixedStorage: true });
  const scope = { ...root, methods: {
    evict: root.services.SBC._evictSubmittedItems,
    removeFromSbc: root.services.SBC.removeItemsById,
    resetSquads: root.services.Squad.resetSquadsCache,
    dirty: root.events.markClubCacheDirty,
    hub: root.services.SBC.sbcDAO.getHub,
    notify: root.EAObservable.prototype.notify,
  } };
  const methods = [
    ...FC27_CLUB_READ_METHODS,
    ...FC27_STREAMLINED_CACHE_METHODS,
    ...FC27_STREAMLINED_PAGE_METHODS,
    ['services.SBC.sbcDAO.getChallengesForSet', FC27_STREAMLINED_PROGRESS_HASH],
    ['services.Item.itemDao.searchStorageItems', FC27_STREAMLINED_STORAGE_HASH],
    ['UTHttpRequest.prototype.setUrlVariables', FC27_STREAMLINED_STORAGE_QUERY_HASH],
  ];
  for (const [path, expected] of methods) {
    const fn = path.split('.').reduce((value, key) => value[key], scope);
    const source = String(fn).replace(/\r\n/g, '\n').replace(/\n/g, eol);
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    expect(Buffer.from(digest).toString('hex'), path).toBe(expected);
  }
  const unknown = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode('function changed() {}'));
  expect(Buffer.from(unknown).toString('hex')).toBe('0'.repeat(64));
});
