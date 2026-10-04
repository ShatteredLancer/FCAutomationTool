import { describe, expect, it } from 'vitest';
import { createGalleryBulkListSession } from '../../src/gallery/bulk-list-session.js';

const entry = (id, definitionId = id + 1000, startPrice = 150, buyNow = 200) => ({
  item: { id, definitionId, pile: 'club' }, purchase: { tradeId: id + 5000 },
  startPrice, buyNow, durationSeconds: 3600,
});

function harness({ listResults = [], transferMatches = true, limits = true, context = { account: 'a' } } = {}) {
  const values = new Map(); const calls = { list: 0, refresh: 0, inspect: 0, permits: 0 };
  let cursor = 0;
  const adapter = {
    inspectListingItem(ref) {
      calls.inspect += 1;
      const pile = ref.pile || 'club';
      if (pile === 'transfer' && !transferMatches) return { status: 'loaded', candidate: { item: { ...ref, pile }, auction: { state: 'inactive' } } };
      return { status: 'loaded', candidate: { item: { ...ref, pile }, auction: pile === 'transfer' ? {
        state: 'active', tradeId: ref.id + 9000, startingBid: 150, buyNowPrice: 200,
      } : { state: 'none' }, tradeable: true, evolution: false, limitedUse: false, concept: false, academyEnrolled: false } };
    },
    inspectCapabilities() { return { transferCapacity: { free: 100 } }; },
    async inspectPriceLimits() { return limits ? { status: 'loaded', refreshStatus: 'completed', after: { minimum: 150, maximum: 1000 } } : { status: 'unknown' }; },
    async acquireRequestPermit() { calls.permits += 1; return { status: 'acquired', permit: {} }; },
    async listItem(ref, listing) { calls.list += 1; return listResults[cursor++] || { status: 'accepted', response: { success: true, status: 200 } }; },
    async refreshTransferItems() { calls.refresh += 1; return { status: 'completed' }; },
  };
  const session = createGalleryBulkListSession({ scope: 's:a', context,
    get: async (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback,
    set: async (key, value) => { values.set(key, structuredClone(value)); },
    exclusive: async (_scope, task) => task(), tradeAdapter: adapter,
    assertCurrent: () => {}, sleep: async () => {}, random: () => 0,
    operationId: () => 'run-1',
  });
  return { session, calls, values };
}

describe('FC27 Gallery bulk list session', () => {
  it('reports storage write failure without listing or discarding the previous journal', async () => {
    const h = harness({ listResults: [{ status: 'unknown' }] });
    await h.session.execute({ approved: true, binding: 'old', entries: [entry(1)] });
    const before = structuredClone([...h.values]);
    const session = createGalleryBulkListSession({ scope: 's:a', context: { account: 'a' },
      get: async (key, fallback) => h.values.get(key) ?? fallback,
      set: async () => { throw Error('storage full'); }, exclusive: async (_scope, task) => task(),
      tradeAdapter: { listItem: () => { throw Error('must not list'); } },
    });
    expect(await session.execute({ approved: true, binding: 'new', entries: [entry(2)] }))
      .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_WRITE_FAILED' });
    expect([...h.values]).toEqual(before);
    expect(h.calls.list).toBe(1);
  });

  it.each([401, 403, 427, 429])('records an explicit %i service rejection as rejected and leaves later cards for a later run', async code => {
    const h = harness({ listResults: [{ status: 'rejected', response: { success: false, status: code }, error: { code } }] });
    const result = await h.session.execute({ approved: true, binding: 'b', entries: [entry(1), entry(2)] });
    expect(result).toMatchObject({ status: 'partial', rejected: 1, pending: 1, reason: 'FC27_GALLERY_LISTING_SERVICE_STOP' });
    expect(result.entries[0]).toMatchObject({ status: 'rejected', reason: 'FC27_GALLERY_LISTING_SERVICE_STOP' });
    expect(h.calls.list).toBe(1);
    expect((await h.session.inspect()).state).toBe('active');
  });

  it('processes every selected item without the legacy four item limit', async () => {
    const h = harness();
    const result = await h.session.execute({ approved: true, binding: 'b', entries: [1, 2, 3, 4, 5].map(id => entry(id)) });
    expect(result.status).toBe('completed');
    expect(result.accepted).toBe(5);
    expect(h.calls.list).toBe(5);
  });

  it('continues after a rejected item', async () => {
    const h = harness({ listResults: [
      { status: 'rejected', error: { kind: 'auction-operation-rejected' } },
      { status: 'accepted', response: { success: true, status: 200 } },
    ] });
    const result = await h.session.execute({ approved: true, binding: 'b', entries: [entry(1), entry(2)] });
    expect(result.status).toBe('completed');
    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(1);
    expect(h.calls.list).toBe(2);
  });

  it('stops on an unknown mutation and resumes without repeating it', async () => {
    const h = harness({ listResults: [{ status: 'error', error: { kind: 'unknown' } }] });
    const first = await h.session.execute({ approved: true, binding: 'b', entries: [entry(1), entry(2)] });
    expect(first.status).toBe('partial');
    expect(first.reason).toBe('FC27_GALLERY_LISTING_RESULT_UNKNOWN');
    expect(h.calls.list).toBe(1);
    const resumed = await h.session.execute({ approved: true, resume: true, expectedRunId: 'run-1', binding: 'ignored' });
    expect(resumed.status).toBe('completed');
    expect(h.calls.list).toBe(2);
  });

  it('skips entries outside EA price limits', async () => {
    const h = harness();
    const result = await h.session.execute({ approved: true, binding: 'b', entries: [entry(1, 1001, 150, 2000), entry(2)] });
    expect(result.accepted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(h.calls.list).toBe(1);
  });

  it('archives an unrelated unfinished batch and lists only the new purchase batch', async () => {
    const h = harness({ listResults: [{ status: 'unknown' }] });
    await h.session.execute({ approved: true, binding: 'old', entries: [entry(1)] });
    const old = structuredClone(h.values.get('fcat-fc27-gallery-bulk-list-v1:s:a'));
    expect(await h.session.execute({ approved: true, binding: 'new', entries: [entry(2)] }))
      .toMatchObject({ status: 'completed', accepted: 1 });
    expect(h.values.get('fcat-fc27-gallery-bulk-list-v1:s:a:archive:run-1')).toEqual(old);
    expect(h.calls.list).toBe(2);
  });

  it('still requires recovery for the same batch or the same unresolved exact item', async () => {
    const h = harness({ listResults: [{ status: 'unknown' }] });
    await h.session.execute({ approved: true, binding: 'old', entries: [entry(1)] });
    for (const binding of ['old', 'new']) {
      expect(await h.session.execute({ approved: true, binding, entries: [entry(1)] }))
        .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED' });
    }
    expect(h.calls.list).toBe(1);
  });

  it('recovers an old explicit rejection locally and does not repeat its listing', async () => {
    const h = harness({ listResults: [{ status: 'unknown' }] });
    await h.session.execute({ approved: true, binding: 'old', entries: [entry(1), entry(2)] });
    const raw = h.values.get('fcat-fc27-gallery-bulk-list-v1:s:a');
    Object.assign(raw.entries[0], { reason: 'FC27_GALLERY_LISTING_SERVICE_STOP', response: { success: false, status: 403 } });
    expect(await h.session.execute({ approved: true, resume: true, expectedRunId: 'run-1' }))
      .toMatchObject({ status: 'completed', accepted: 1, rejected: 1 });
    expect(h.calls.list).toBe(2);
    expect(h.calls.refresh).toBe(1);
  });

  it('enters recovery when transfer readback does not match', async () => {
    const h = harness({ transferMatches: false });
    const result = await h.session.execute({ approved: true, binding: 'b', entries: [entry(1)] });
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('FC27_GALLERY_LISTING_READBACK_UNCONFIRMED');
    expect(h.calls.list).toBe(1);
    const inspect = await h.session.inspect();
    expect(inspect.entries[0].status).toBe('unknown');
  });

  it('stops when the context changes before a mutation', async () => {
    const h = harness();
    const guarded = createGalleryBulkListSession({ scope: 's:a', context: { account: 'a' },
      get: async (key, fallback) => h.values.has(key) ? h.values.get(key) : fallback,
      set: async (key, value) => h.values.set(key, value), exclusive: async (_s, task) => task(),
      tradeAdapter: h.session && { inspectListingItem: () => { throw new Error('FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED'); } },
      assertCurrent: () => { throw new Error('FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED'); },
    });
    const result = await guarded.execute({ approved: true, binding: 'b', entries: [entry(1)] });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED');
  });
});
