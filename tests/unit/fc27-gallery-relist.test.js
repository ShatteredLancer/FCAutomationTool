import { afterEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27GalleryRelist } from '../../src/adapters/browser/fc27-gallery-relist.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  let at = 1000;
  const { root } = executionRuntime();
  const values = new Map(), context = readFc27Context(root);
  const scope = traditionalJournalScope(context);
  const item = { id: 11, definitionId: 111, pile: 'transfer' };
  let active = false;
  root.navigator = { locks: { request: async (_name, _options, task) => task({ name: FC27_TRADITIONAL_WEB_LOCK, mode: 'exclusive' }) } };
  root.crypto.randomUUID = () => 'relist-run';
  const auction = () => ({ state: active ? 'active' : 'inactive', tradeId: 9001, startingBid: 150, buyNowPrice: 200 });
  const snapshot = () => ({ status: 'loaded', total: 1, truncated: false, items: [{ item, name: 'Player', auction: auction() }] });
  const adapter = {
    refreshTransferItems: vi.fn(async () => ({ status: 'completed' })),
    inspectBulkRelistSnapshot: vi.fn(() => snapshot()),
    inspectListingItem: vi.fn(() => ({ status: 'loaded', candidate: { item, auction: auction() } })),
    inspectCapabilities: () => ({ transferCapacity: { free: 10 } }),
    acquireRequestPermit: vi.fn(async () => ({ status: 'acquired', permit: {} })),
    relistExpiredAuctions: vi.fn(async () => { active = true; return { status: 'accepted', response: { status: 200, success: true } }; }),
  };
  const service = createFc27GalleryRelist({ root, get: (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: (key, value) => { values.set(key, structuredClone(value)); }, liveEnabled: true,
    adapterFactory: () => adapter, purchase: { inspect: vi.fn(async () => ({ status: 'observed', operationId: 'purchase-1', binding: 'bind-1' })) },
    now: () => at, sleep: async () => {} });
  return { service, values, adapter, scope, root, advance: value => { at = value; } };
}

it('requires an explicit range approval and arms the default batch mode only through the UI call', async () => {
  const f = fixture();
  expect(await f.service.arm()).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_RELIST_APPROVAL_REQUIRED' });
  expect((await f.service.read()).status).toBe('absent');
});

it('arms all unsold and performs one aggregate relist after the due time', async () => {
  const f = fixture();
  const armed = await f.service.arm({ approved: true, range: 'all', minutes: 1 });
  expect(armed).toMatchObject({ status: 'armed', range: 'all', minutes: 1 });
  expect(f.adapter.relistExpiredAuctions).not.toHaveBeenCalled();
  f.advance(61001);
  const result = await f.service.poll();
  expect(result).toMatchObject({ status: 'armed', runs: 1 });
  expect(f.adapter.relistExpiredAuctions).toHaveBeenCalledTimes(1);
  expect(f.adapter.acquireRequestPermit).toHaveBeenCalledTimes(1);
  expect((await f.service.poll()).status).toBe('waiting-time');
});

it('keeps an unknown relist receipt blocked and does not issue a second request', async () => {
  const f = fixture();
  await f.service.arm({ approved: true, range: 'all', minutes: 1 });
  f.adapter.relistExpiredAuctions.mockResolvedValueOnce({ status: 'ambiguous', response: { status: 200 } });
  f.advance(61001);
  const result = await f.service.poll();
  expect(result).toMatchObject({ status: 'blocked' });
  expect(f.adapter.relistExpiredAuctions).toHaveBeenCalledTimes(1);
  expect(await f.service.poll()).toMatchObject({ status: 'blocked' });
  expect(f.adapter.relistExpiredAuctions).toHaveBeenCalledTimes(1);
});
