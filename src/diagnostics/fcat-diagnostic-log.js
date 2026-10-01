const DEFAULT_MAX_ENTRIES = 300;
const MAX_STRING_LENGTH = 160;

const STRING_FIELDS = Object.freeze(['area', 'event', 'source', 'phase', 'status', 'reason', 'route']);
const NUMBER_FIELDS = Object.freeze(['httpStatus', 'batchSize', 'count', 'retryAt', 'durationMs',
  'requestedCount', 'responseCount', 'retainedCount', 'expandedCount', 'foreignCount', 'offset']);
const BOOLEAN_FIELDS = Object.freeze(['cached', 'stale', 'recheck']);

const boundedString = (value, max = MAX_STRING_LENGTH) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(value)) return null;
  return value.slice(0, max);
};

function sanitizeEntry(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const at = now();
  if (!Number.isSafeInteger(at) || at < 0) return null;
  const entry = { at };
  for (const key of STRING_FIELDS) {
    const value = key === 'reason'
      ? typeof input.reason === 'string' && /^(?:HTTP [1-5]\d{2}|FC(?:AT|27)_[A-Z0-9_]{1,140}|request-failed)$/.test(input.reason) ? input.reason : null
      : boundedString(input[key]);
    if (value !== null) entry[key] = value;
  }
  for (const key of NUMBER_FIELDS) {
    const value = input[key];
    if (Number.isSafeInteger(value) && value >= 0) entry[key] = value;
  }
  for (const key of BOOLEAN_FIELDS) {
    if (typeof input[key] === 'boolean') entry[key] = input[key];
  }
  if (typeof input.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.version)) entry.version = input.version;
  if (!entry.area || !entry.event) return null;
  return Object.freeze(entry);
}

function validSavedEntry(value) {
  return sanitizeEntry(value, () => value?.at);
}

export function createFcatDiagnosticLog({ gmGetValue, gmSetValue, key = 'fcat-fc27-diagnostic-log-v1',
  version = null, now = () => Date.now(), maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function'
      || typeof key !== 'string' || !key || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 2000) {
    throw new TypeError('FCAT_DIAGNOSTIC_LOG_INVALID');
  }
  let entries = [];
  let loaded = false;
  let loading = null;
  let writing = Promise.resolve();
  const load = () => loading ??= (async () => {
    if (loaded) return;
    try {
      const saved = await gmGetValue(key, null);
      if (saved?.schema === 1 && Array.isArray(saved.entries)) {
        entries = saved.entries.slice(-maxEntries).map(validSavedEntry).filter(Boolean);
      }
    } catch { /* Diagnostics are optional and must never block business actions. */ }
    loaded = true;
  })().finally(() => { loading = null; });
  const persist = () => {
    const payload = { schema: 1, product: 'FC Automation Tool', season: '27', version: version ?? null,
      entries: entries.map(entry => ({ ...entry })) };
    return Promise.resolve().then(() => gmSetValue(key, payload)).catch(() => undefined);
  };
  const record = input => {
    let entry;
    try { entry = sanitizeEntry({ ...input, version }, now); } catch { return Promise.resolve(false); }
    if (!entry) return Promise.resolve(false);
    writing = writing.then(async () => {
      await load();
      entries = [...entries, entry].slice(-maxEntries);
      await persist();
    }).catch(() => undefined);
    return writing.then(() => true);
  };
  const snapshot = async () => {
    await writing; await load();
    return entries.map(entry => ({ ...entry }));
  };
  const exportPayload = async () => ({
    schema: 1,
    product: 'FC Automation Tool',
    season: '27',
    version: version ?? null,
    exportedAt: now(),
    redaction: 'Only bounded event/status/count fields are included. URLs, response bodies, credentials, account identifiers and card objects are excluded.',
    entries: await snapshot(),
  });
  return Object.freeze({ record, snapshot, exportPayload, count: () => entries.length, key });
}
