import { createGalleryPlanReplay } from '../gallery/plan-replay.js';

const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MAX_CRITICAL_ENTRIES = 120;
const MAX_TRANSACTION_RESULTS = 40;
const MAX_STRING_LENGTH = 160;

const STRING_FIELDS = Object.freeze(['area', 'event', 'source', 'phase', 'transportPhase', 'status', 'reason', 'localReason', 'route', 'mismatch', 'priceSource']);
const NUMBER_FIELDS = Object.freeze(['httpStatus', 'batchSize', 'count', 'spent', 'retryAt', 'durationMs', 'setId', 'challengeId', 'requests',
  'definitionId', 'referencePrice', 'futggPrice', 'futbinPrice', 'maxBuy', 'actualPrice', 'attempt', 'attemptLimit', 'fetchedAt', 'sourceUpdatedAt', 'expiresAt',
  'catalogAttempts', 'quoteAttempts', 'safeCandidates', 'usableCandidates', 'excludedUnavailable', 'estimatedCost', 'purchaseCount', 'ownedCount',
  'requestedCount', 'responseCount', 'acceptedCount', 'rejectedCount', 'skippedCount', 'unknownCount', 'retainedCount', 'expandedCount', 'foreignCount', 'offset', 'evaluations',
  'targetScore', 'currentScore', 'requiredSlots', 'quotedCount', 'eaScoreCount', 'catalogScoreCount',
  'cheapestPrice', 'cheapestScore', 'bestPrice', 'bestScore', 'searchDepth', 'candidateLimit', 'beamWidth', 'maxEvaluations']);
const BOOLEAN_FIELDS = Object.freeze(['cached', 'stale', 'recheck', 'searchComplete', 'optimalWithinPool', 'scopeTruncated', 'beamTruncated', 'budgetExhausted', 'timeExhausted']);

const boundedString = (value, max = MAX_STRING_LENGTH) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(value)) return null;
  return value.slice(0, max);
};

function sanitizeEntry(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const at = now();
  if (!Number.isSafeInteger(at) || at < 0) return null;
  const entry = { at };
  if (['service.bid', 'service.move', 'UTHttpRequest', 'EAHttpRequest', 'UTHttpRequest.prototype.setPath',
    'UTHttpRequest.prototype.send', 'EAHttpRequest.prototype.send', 'EAHttpRequest.prototype.setRequestBody',
    'EAHttpRequest.prototype.abort'].includes(input.method)) entry.method = input.method;
  if (typeof input.observedHash === 'string' && /^[a-f0-9]{64}$/.test(input.observedHash)) entry.observedHash = input.observedHash;
  for (const key of STRING_FIELDS) {
    const value = key === 'reason' || key === 'localReason'
      ? typeof input[key] === 'string' && /^(?:HTTP [1-5]\d{2}|FC(?:AT|27)_[A-Z0-9_]{1,140}|SAFE_MATERIAL_SHORTAGE|request-failed)$/.test(input[key]) ? input[key] : null
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
  version = null, now = () => Date.now(), maxEntries = DEFAULT_MAX_ENTRIES,
  maxCriticalEntries = DEFAULT_MAX_CRITICAL_ENTRIES } = {}) {
  if (typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function'
      || typeof key !== 'string' || !key || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 2000) {
    throw new TypeError('FCAT_DIAGNOSTIC_LOG_INVALID');
  }
  if (!Number.isSafeInteger(maxCriticalEntries) || maxCriticalEntries < 1 || maxCriticalEntries > 500) {
    throw new TypeError('FCAT_DIAGNOSTIC_LOG_INVALID');
  }
  let entries = [];
  let criticalEntries = [];
  let transactionResults = [];
  let planning = [];
  let loaded = false;
  let loading = null;
  let writing = Promise.resolve();
  const load = () => loading ??= (async () => {
    if (loaded) return;
    try {
      const saved = await gmGetValue(key, null);
      if (saved?.schema === 1 && Array.isArray(saved.entries)) {
        entries = saved.entries.slice(-maxEntries).map(validSavedEntry).filter(Boolean);
        criticalEntries = (Array.isArray(saved.criticalEntries) ? saved.criticalEntries : [])
          .slice(-maxCriticalEntries).map(validSavedEntry).filter(Boolean);
        transactionResults = (Array.isArray(saved.transactionResults) ? saved.transactionResults : [])
          .slice(-MAX_TRANSACTION_RESULTS).map(validSavedEntry).filter(Boolean);
        planning = (Array.isArray(saved.planning) ? saved.planning : []).slice(-4).map(row => {
          const event = validSavedEntry(row.event), replay = createGalleryPlanReplay(row.replay?.input);
          return event && replay ? { event, replay } : null;
        }).filter(Boolean);
      }
    } catch { /* Diagnostics are optional and must never block business actions. */ }
    loaded = true;
  })().finally(() => { loading = null; });
  const persist = () => {
    const payload = { schema: 1, product: 'FC Automation Tool', season: '27', version: version ?? null,
      entries: entries.map(entry => ({ ...entry })), criticalEntries: criticalEntries.map(entry => ({ ...entry })),
      transactionResults: transactionResults.map(entry => ({ ...entry })),
      planning: structuredClone(planning) };
    return Promise.resolve().then(() => gmSetValue(key, payload)).catch(() => undefined);
  };
  const record = input => {
    let entry, replay;
    try {
      entry = sanitizeEntry({ ...input, version }, now);
      if (input.area === 'gallery' && ['grade-plan', 'joint-plan'].includes(input.event)) replay = createGalleryPlanReplay(input.replayInput);
    } catch { return Promise.resolve(false); }
    if (!entry) return Promise.resolve(false);
    writing = writing.then(async () => {
      await load();
      entries = [...entries, entry].slice(-maxEntries);
      // Directory polling can be very chatty and used to evict the only
      // useful listing/market failure from the export. Keep a separate small
      // bounded stream for trade and purchase lifecycle events. It carries the
      // same allowlisted, redacted fields and never affects business control.
      if (entry.area === 'pricing' || entry.area === 'puzzle' || entry.area === 'gallery' && (/listing|purchase|market|bulk-list/.test(entry.event) ||
          ['prepare', 'execute', 'mutation', 'readback'].includes(entry.phase))) {
        criticalEntries = [...criticalEntries, entry].slice(-maxCriticalEntries);
      }
      if (entry.area === 'gallery' && ['purchase-result', 'listing-result'].includes(entry.event)) {
        transactionResults = [...transactionResults, entry].slice(-MAX_TRANSACTION_RESULTS);
      }
      if (replay) planning = [...planning, { event: entry, replay }].slice(-4);
      await persist();
    }).catch(() => undefined);
    return writing.then(() => true);
  };
  const snapshot = async () => {
    await writing; await load();
    return entries.map(entry => ({ ...entry }));
  };
  const exportPayload = async () => {
    const exportedEntries = await snapshot();
    return {
    schema: 1,
    product: 'FC Automation Tool',
    season: '27',
    version: version ?? null,
    exportedAt: now(),
    redaction: 'Bounded events, critical Gallery trade events and four Gallery planning replays. URLs, credentials, account identifiers and raw card objects are excluded.',
    entries: exportedEntries, criticalEntries: criticalEntries.map(entry => ({ ...entry })),
    transactionResults: transactionResults.map(entry => ({ ...entry })), planning: structuredClone(planning),
  }; };
  return Object.freeze({ record, snapshot, exportPayload, count: () => entries.length, key });
}
