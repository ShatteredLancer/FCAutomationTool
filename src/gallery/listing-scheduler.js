import { nextTradeRunAt } from '../trade/schedule.js';

export const FC27_GALLERY_LISTING_SCHEDULE_SCHEMA = 1;
export const FC27_GALLERY_LISTING_SCHEDULE_KEY_PREFIX = 'fcat-fc27-gallery-listing-schedule-v1:';

const TYPES = new Set(['once', 'daily', 'interval', 'window']);
const DURATIONS = new Set([3600, 10800, 21600, 43200, 86400, 259200]);
const id = value => Number.isSafeInteger(value) && value > 0;
const tradeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw new Error(reason); };
const epoch = value => Number.isSafeInteger(value) && value >= 0;

export const galleryListingScheduleKey = scope => `${FC27_GALLERY_LISTING_SCHEDULE_KEY_PREFIX}${scope}`;

function validSchedule(value) {
  if (!value || typeof value !== 'object' || !TYPES.has(value.type)) return false;
  if (value.type === 'once' && (!Number.isFinite(Number(value.runAt)) || Number(value.runAt) <= 0)) return false;
  if (value.type === 'daily' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.time || '')) || typeof value.timezone !== 'string' || !value.timezone.trim())) return false;
  if (value.type === 'daily') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(0); } catch { return false; }
  }
  if (value.type === 'interval' && (!Number.isFinite(Number(value.intervalSeconds)) || Number(value.intervalSeconds) < 60)) return false;
  if (value.type === 'window' && (!Number.isFinite(Number(value.startAt)) || !Number.isFinite(Number(value.endAt)) || Number(value.endAt) <= Number(value.startAt))) return false;
  if (value.type === 'window' && value.timezone !== undefined && typeof value.timezone !== 'string') return false;
  return true;
}

function validEntry(entry) {
  return id(entry?.item?.id) && id(entry?.item?.definitionId) && entry.item.pile === 'club'
    && tradeId(entry.purchaseTradeId) && Number.isSafeInteger(entry.startPrice) && entry.startPrice >= 150
    && Number.isSafeInteger(entry.buyNow) && entry.buyNow >= entry.startPrice && entry.buyNow <= 15000000
    && DURATIONS.has(entry.durationSeconds);
}

export function normalizeGalleryListingSchedule(input) {
  const entries = Array.isArray(input?.entries) ? input.entries : null;
  const itemIds = entries?.map(entry => entry?.item?.id) ?? [];
  if (!input || input.schema !== FC27_GALLERY_LISTING_SCHEDULE_SCHEMA
    || typeof input.scope !== 'string' || !input.scope || !input.context
    || typeof input.purchaseOperationId !== 'string' || !input.purchaseOperationId
    || typeof input.purchaseBinding !== 'string' || !input.purchaseBinding
    || !validSchedule(input.schedule) || !entries || !entries.length || entries.length > 256
    || new Set(itemIds).size !== entries.length
    || entries.some(entry => !validEntry(entry))
    || !Number.isSafeInteger(input.runCount) || input.runCount < 0
    || !epoch(input.createdAt) || !epoch(input.updatedAt)
    || input.nextRunAt !== null && !epoch(input.nextRunAt)
    || input.lastRunAt !== null && !epoch(input.lastRunAt)
    || !['disarmed', 'armed', 'waiting-session', 'waiting-time', 'running', 'missed', 'blocked', 'completed'].includes(input.status)) return null;
  return clone({ ...input, enabled: input.enabled === true, armed: input.armed === true });
}

export function createGalleryListingScheduleRecord({ scope, context, purchase, plan, schedule, now = Date.now() } = {}) {
  if (typeof scope !== 'string' || !scope || !context || !purchase || purchase.status !== 'observed'
    || typeof purchase.operationId !== 'string' || typeof purchase.binding !== 'string'
    || !validSchedule(schedule) || !Array.isArray(plan?.entries) || !plan.entries.length) return null;
  const entries = plan.entries.map(entry => ({
    item: { id: entry?.item?.id, definitionId: entry?.item?.definitionId, pile: 'club' },
    purchaseTradeId: String(entry?.purchase?.tradeId || ''),
    startPrice: entry?.startPrice, buyNow: entry?.buyNow, durationSeconds: entry?.durationSeconds,
  }));
  if (entries.some(entry => !validEntry(entry))) return null;
  const createdAt = Number.isFinite(Number(now)) ? Math.max(0, Number(now)) : Date.now();
  const idValue = `gallery-listing-${createdAt}-${Math.random().toString(16).slice(2)}`;
  return normalizeGalleryListingSchedule({
    schema: FC27_GALLERY_LISTING_SCHEDULE_SCHEMA, id: idValue, scope, context: clone(context),
    purchaseOperationId: purchase.operationId, purchaseBinding: purchase.binding, entries,
    listingSettings: clone(plan.settings ?? { priceMode: 'fixed', durationSeconds: entries[0]?.durationSeconds ?? 3600, delaySeconds: [3, 5] }),
    schedule: clone(schedule), enabled: false, armed: false, status: 'disarmed', reason: 'not-armed',
    createdAt, updatedAt: createdAt, runCount: 0, lastRunAt: null, nextRunAt: nextTradeRunAt({ schedule, createdAt }, createdAt),
  });
}

export function createGalleryListingScheduleStore({ get, set, scope, context, now = () => Date.now() } = {}) {
  if (typeof get !== 'function' || typeof set !== 'function' || typeof scope !== 'string' || !scope || !context) throw new TypeError('Gallery listing schedule storage is required');
  const key = galleryListingScheduleKey(scope);
  const read = async () => {
    const raw = await get(key, null);
    if (raw === null) return null;
    const value = normalizeGalleryListingSchedule(raw);
    if (!value || value.scope !== scope || !same(value.context, context)) fail('FC27_GALLERY_LISTING_SCHEDULE_INVALID');
    return value;
  };
  const write = async value => {
    const normalized = normalizeGalleryListingSchedule(value);
    if (!normalized) fail('FC27_GALLERY_LISTING_SCHEDULE_INVALID');
    await set(key, clone(normalized));
    if (!same(await get(key, null), normalized)) fail('FC27_GALLERY_LISTING_SCHEDULE_UNCONFIRMED');
    return normalized;
  };
  const inspect = async ({ purchase = null, at = now(), sessionReady = true } = {}) => {
    const value = await read();
    if (!value) return { status: 'absent' };
    if (!purchase || purchase.status !== 'observed' || purchase.operationId !== value.purchaseOperationId || purchase.binding !== value.purchaseBinding) {
      return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED', schedule: value };
    }
    if (['blocked', 'completed', 'missed'].includes(value.status)) {
      return { status: value.status, reason: value.reason ?? null, schedule: value };
    }
    if (value.status === 'running') {
      return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_RECOVERY_REQUIRED', schedule: value };
    }
    if (!value.enabled || !value.armed) return { status: 'disarmed', reason: 'not-armed', schedule: value };
    if (!sessionReady) return { status: 'waiting-session', reason: 'ea-session-unavailable', schedule: value };
    const next = value.nextRunAt;
    if (next === null) return { status: 'missed', reason: 'schedule-expired', schedule: value };
    if (next > at) return { status: 'waiting-time', reason: null, schedule: value };
    const lateness = Math.max(0, at - next);
    if (value.schedule.type === 'window' && at > Number(value.schedule.endAt)) {
      return { status: 'missed', reason: 'misfire-skip', schedule: value };
    }
    // Match the existing Trade Scheduler's default skip policy and tick tolerance.
    const tolerance = 30_000;
    if (lateness > tolerance) return { status: 'missed', reason: 'misfire-skip', schedule: value };
    return { status: 'ready', reason: null, schedule: value };
  };
  return Object.freeze({
    read,
    inspect,
    async create({ purchase, plan, schedule, approved = false } = {}) {
      if (approved !== true) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_APPROVAL_REQUIRED' };
      const existing = await read();
      if (existing && (existing.armed || ['running', 'blocked'].includes(existing.status))) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_ACTIVE' };
      const record = createGalleryListingScheduleRecord({ scope, context, purchase, plan, schedule, now: now() });
      if (!record) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_INPUT_INVALID' };
      return { status: 'saved', schedule: await write(record) };
    },
    async arm({ approved = false } = {}) {
      if (approved !== true) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_APPROVAL_REQUIRED' };
      const value = await read();
      if (!value) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_ABSENT' };
      if (['armed', 'running', 'blocked', 'completed', 'missed'].includes(value.status)) {
        return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_STATE_LOCKED', schedule: value };
      }
      return { status: 'armed', schedule: await write({ ...value, enabled: true, armed: true, status: 'armed', reason: null, updatedAt: now() }) };
    },
    async disarm(reason = 'not-armed') {
      const value = await read();
      if (!value) return { status: 'absent' };
      if (value.status === 'running') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_RECOVERY_REQUIRED', schedule: value };
      if (['blocked', 'completed', 'missed'].includes(value.status)) return { status: value.status, reason: value.reason ?? null, schedule: value };
      return { status: 'disarmed', schedule: await write({ ...value, enabled: false, armed: false, status: 'disarmed',
        reason, updatedAt: now() }) };
    },
    async checkpoint({ status, reason = null, at = now(), runCount = null, nextRunAt = undefined } = {}) {
      const value = await read();
      if (!value) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_ABSENT' };
      const allowed = new Set(['armed', 'waiting-session', 'waiting-time', 'running', 'missed', 'blocked', 'completed', 'disarmed']);
      if (!allowed.has(status)) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_STATUS_INVALID' };
      const count = runCount === null ? value.runCount : runCount;
      if (!Number.isSafeInteger(count) || count < value.runCount || count > value.runCount + 1 || !epoch(at)) {
        return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_STATUS_INVALID' };
      }
      if (['blocked', 'completed', 'missed'].includes(value.status)) return { status: value.status, schedule: value };
      let next = nextRunAt === undefined ? value.nextRunAt : nextRunAt;
      if (nextRunAt === undefined && status === 'armed' && count > value.runCount) {
        next = value.schedule.type === 'window' ? null
          : nextTradeRunAt(value, Math.max(at, value.nextRunAt ?? at) + 1);
      }
      if (status === 'completed' || status === 'missed') next = null;
      return { status, schedule: await write({ ...value, status, reason, runCount: count,
        ...(['completed', 'missed', 'blocked'].includes(status) ? { armed: false, enabled: false } : {}),
        lastRunAt: count !== value.runCount || status === 'running' || status === 'completed' ? at : value.lastRunAt,
        nextRunAt: next, updatedAt: at }) };
    },
  });
}
