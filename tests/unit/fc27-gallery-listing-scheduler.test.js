import { describe, expect, it } from 'vitest';
import { createGalleryListingScheduleRecord, createGalleryListingScheduleStore, normalizeGalleryListingSchedule } from '../../src/gallery/listing-scheduler.js';

const purchase = { status: 'observed', operationId: 'purchase-1', binding: 'purchase-1:bind' };
const plan = { entries: [{ item: { id: 11, definitionId: 111, pile: 'club' }, purchase: { tradeId: '9011' }, startPrice: 150, buyNow: 200, durationSeconds: 3600 }] };
const schedule = { type: 'once', runAt: 2000 };
const context = { account: 'account-1', platform: 'pc' };

function storage() {
  const values = new Map();
  return { get: async (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback,
    set: async (key, value) => values.set(key, structuredClone(value)) };
}

describe('FC27 Gallery listing schedule', () => {
  it('creates a disarmed purchase-bound schedule', () => {
    const value = createGalleryListingScheduleRecord({ scope: 's:account-1', context, purchase, plan, schedule, now: 1000 });
    expect(value).toMatchObject({ status: 'disarmed', enabled: false, armed: false, purchaseOperationId: 'purchase-1', purchaseBinding: 'purchase-1:bind' });
    expect(normalizeGalleryListingSchedule(value)).toEqual(value);
  });

  it('requires explicit approval and preserves the exact card identity', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    expect((await store.create({ purchase, plan, schedule })).reason).toBe('FC27_GALLERY_LISTING_SCHEDULE_APPROVAL_REQUIRED');
    const saved = await store.create({ purchase, plan, schedule, approved: true });
    expect(saved.status).toBe('saved');
    expect(saved.schedule.entries[0]).toMatchObject({ item: { id: 11, definitionId: 111, pile: 'club' }, purchaseTradeId: '9011' });
  });

  it('keeps new schedules disarmed and transitions time/session states without mutating', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule, approved: true });
    expect((await store.inspect({ purchase, at: 2500 })).status).toBe('disarmed');
    await store.arm({ approved: true });
    expect((await store.inspect({ purchase, at: 1500 })).status).toBe('waiting-time');
    expect((await store.inspect({ purchase, at: 1500, sessionReady: false })).status).toBe('waiting-session');
    expect((await store.inspect({ purchase, at: 2000 })).status).toBe('ready');
  });

  it('blocks account or purchase binding changes and does not re-list another batch', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule, approved: true }); await store.arm({ approved: true });
    expect((await store.inspect({ purchase: { ...purchase, operationId: 'other' }, at: 2000 })).reason).toBe('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
  });

  it.each([
    { type: 'once', runAt: 2000 },
    { type: 'interval', intervalSeconds: 60, anchorAt: 2000 },
    { type: 'daily', time: '00:01', timezone: 'UTC' },
  ])('retains a due occurrence across reload for $type instead of moving it into the future', async schedule => {
    const io = storage();
    const create = () => createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    const saved = await create().create({ purchase, plan, schedule, approved: true });
    await create().arm({ approved: true });
    const due = saved.schedule.nextRunAt;
    expect(await create().inspect({ purchase, at: due + 10 })).toMatchObject({ status: 'ready', schedule: { nextRunAt: due } });
  });

  it('reports an overdue occurrence as missed, never as a successful completion', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule, approved: true }); await store.arm({ approved: true });
    expect(await store.inspect({ purchase, at: 40000 })).toMatchObject({ status: 'missed', reason: 'misfire-skip' });
    expect(await store.inspect({ purchase, at: 40000, sessionReady: false })).toMatchObject({ status: 'waiting-session' });
  });

  it('does not execute a window after its end even inside the tick tolerance', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule: { type: 'window', startAt: 2000, endAt: 3000 }, approved: true });
    await store.arm({ approved: true });
    expect((await store.inspect({ purchase, at: 3001 })).status).toBe('missed');
  });

  it.each(['running', 'blocked', 'completed', 'missed'])('does not make a persisted %s occurrence ready again', async status => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule, approved: true }); await store.arm({ approved: true });
    await store.checkpoint({ status, at: 2000 });
    expect((await store.inspect({ purchase, at: 2010 })).status).toBe(status === 'running' ? 'blocked' : status);
    expect((await store.arm({ approved: true })).status).toBe('blocked');
  });

  it('advances a finished interval occurrence only once and preserves its actual run time', async () => {
    const io = storage(); const store = createGalleryListingScheduleStore({ ...io, scope: 's:account-1', context, now: () => 1000 });
    await store.create({ purchase, plan, schedule: { type: 'interval', anchorAt: 2000, intervalSeconds: 60 }, approved: true });
    await store.arm({ approved: true });
    await store.checkpoint({ status: 'armed', at: 2010, runCount: 1 });
    expect(await store.inspect({ purchase, at: 2020 })).toMatchObject({ status: 'waiting-time', schedule: { nextRunAt: 62000, lastRunAt: 2010, runCount: 1 } });
  });

  it('rejects malformed entries, duplicated item IDs and invalid runtime counts without throwing', () => {
    const input = { scope: 's:account-1', context, purchase, plan, schedule, now: 1000 };
    const value = createGalleryListingScheduleRecord(input);
    for (const entries of [[null], [value.entries[0], { ...value.entries[0], item: { ...value.entries[0].item, definitionId: 222 } }]]) {
      expect(normalizeGalleryListingSchedule({ ...value, entries })).toBeNull();
    }
    expect(normalizeGalleryListingSchedule({ ...value, runCount: NaN })).toBeNull();
    expect(createGalleryListingScheduleRecord({ ...input, schedule: { type: 'daily', time: '00:00', timezone: 'not-a-zone' } })).toBeNull();
  });
});
