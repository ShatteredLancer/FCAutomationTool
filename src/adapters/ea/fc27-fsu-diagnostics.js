import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, readFc27CachedClub, snapshotFc27ClubPlayer } from './fc27-local-read.js';

// Reviewed original Local 26.09.6/26.09.7 method; this does not authorize a submission.
const validationHash = 'ee004d70ec2cbb5e05da61493d3c9afb1ebd39485a89b47f01201d45fd1ac149';
const stop = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false });
const at = (value, keys) => keys.reduce((next, key) => ownData(next, key), value);
async function methodHash(method, root) {
  if (typeof method !== 'function') return null;
  const source = Function.prototype.toString.call(method).replace(/\r\n/g, '\n');
  if (source.length > 12000) return null;
  return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source))),
    value => value.toString(16).padStart(2, '0')).join('');
}

export async function inspectFc27FsuSettings(root) {
  try {
    const context = readFc27Context(root);
    const info = ownData(root, 'info');
    if (at(info, ['base', 'initialized']) !== true || ![27, '27'].includes(at(info, ['base', 'year']))) {
      return stop('FC27_FSU_NOT_READY');
    }
    let count = 0;
    const normalize = (value, depth = 0) => {
      if (++count > 10000 || depth > 6) throw new Error();
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string' && value.length <= 4096) return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (!value || typeof value !== 'object' || !Array.isArray(value)
          && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
      if (Array.isArray(value)) {
        if (value.length > 10000) throw new Error();
        return Array.from({ length: value.length }, (_, i) => normalize(ownData(value, String(i)), depth + 1));
      }
      const keys = Object.getOwnPropertyNames(value);
      if (keys.length > 10000) throw new Error();
      return Object.fromEntries(keys.sort().map(key => [key, normalize(ownData(value, key), depth + 1)]));
    };
    const snapshots = ['build', 'set', 'lock'].map(key => normalize(ownData(info, key)));
    const hashes = [];
    for (const value of snapshots) {
      const bytes = new globalThis.TextEncoder().encode(JSON.stringify(value));
      if (bytes.length > 65536) throw new Error();
      hashes.push(Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)),
        byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    count = 0;
    if (info !== ownData(root, 'info') || JSON.stringify(context) !== JSON.stringify(readFc27Context(root))
        || JSON.stringify(snapshots) !== JSON.stringify(['build', 'set', 'lock'].map(key => normalize(ownData(info, key))))) {
      return stop('FC27_FSU_INPUTS_CHANGED');
    }
    return { status: 'observed', reason: 'FC27_FSU_SETTINGS_FINGERPRINT', liveExecutionEnabled: false,
      hashes: Object.fromEntries(['build', 'set', 'lock'].map((key, index) => [key, hashes[index]])),
      runtimeSettingsOnly: true, settingsChanged: false };
  } catch { return stop('FC27_FSU_SETTINGS_UNAVAILABLE'); }
}

export async function inspectFc27FsuSupport(root) {
  try {
    const context = readFc27Context(root);
    const base = at(root, ['info', 'base']);
    const events = ownData(root, 'events');
    const validate = ownData(events, 'validateClubPlayers');
    const price = ownData(events, 'getPriceForUrl');
    const source = typeof price === 'function' ? Function.prototype.toString.call(price) : '';
    const hash = await methodHash(validate, root);
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) return stop('FC27_CONTEXT_CHANGED');
    const club = readFc27CachedClub(root);
    const provider = at(root, ['info', 'apiPlatform']);
    return { status: 'observed', reason: 'FC27_FSU_SUPPORT_INSPECTION', liveExecutionEnabled: false,
      validation: { methodHash: hash, reviewedMethod: hash === validationHash,
        busy: !!ownData(base, 'reloadPlayersPromise') || !!ownData(base, 'clubValidationDraining'),
        queueCount: Array.isArray(ownData(base, 'clubValidationQueue')) ? base.clubValidationQueue.length : null,
        captureCount: Array.isArray(ownData(base, 'clubPayloadCaptureSessions')) ? base.clubPayloadCaptureSessions.length : null,
        captureCollectionAbsent: !Object.getOwnPropertyDescriptor(base, 'clubPayloadCaptureSessions'),
        captureHookPresent: ownData(base, 'clubPayloadCaptureContextHooked') === true },
      prices: { methodPresent: !!source, provider: [1, 2, 3].includes(provider) ? provider : null,
        legacyFc26Path: source.includes('player-prices/26/'),
        seasonBoundPath: source.includes('player-prices/${season}/'),
        cachedEaAverageCount: club.items.filter(item => item.marketAverage !== null).length,
        networkExecuted: false, displayVerified: false },
      cachedPlayers: club.items.length, inventoryComplete: false };
  } catch { return stop('FC27_FSU_SUPPORT_UNAVAILABLE'); }
}

export async function validateFc27FsuSample(root) {
  let timer;
  try {
    const context = readFc27Context(root);
    const info = ownData(root, 'info');
    const base = ownData(info, 'base');
    const events = ownData(root, 'events');
    const validate = ownData(events, 'validateClubPlayers');
    if (ownData(base, 'initialized') !== true || ![27, '27'].includes(ownData(base, 'year'))
        || !['trusted-provisional', 'validation-failed', 'ready'].includes(at(base, ['clubCache', 'status']))) {
      return stop('FC27_FSU_NOT_READY');
    }
    const idle = () => !ownData(base, 'reloadPlayersPromise') && !ownData(base, 'clubValidationDraining')
      && Array.isArray(ownData(base, 'clubValidationQueue')) && ownData(base, 'clubValidationQueue').length === 0
      && (!Object.getOwnPropertyDescriptor(base, 'clubPayloadCaptureSessions')
        || Array.isArray(ownData(base, 'clubPayloadCaptureSessions')) && ownData(base, 'clubPayloadCaptureSessions').length === 0);
    if (!idle()) return stop('FC27_FSU_VALIDATION_BUSY');
    if (ownData(base, 'clubPayloadCaptureContextHooked') !== true || await methodHash(validate, root) !== validationHash) {
      return stop('FC27_FSU_VALIDATION_UNREVIEWED');
    }
    const unchanged = () => {
      try {
        return ownData(root, 'info') === info && ownData(root, 'events') === events
          && ownData(events, 'validateClubPlayers') === validate
          && JSON.stringify(context) === JSON.stringify(readFc27Context(root));
      } catch { return false; }
    };
    if (!unchanged() || !idle()) return stop('FC27_FSU_INPUTS_CHANGED');
    const selected = readFc27CachedClub(root).items.filter(item => item.special === false && item.evolution === false
      && item.rating <= 83 && item.pile === 'club').sort((a, b) => a.rating - b.rating || a.id - b.id).slice(0, 2);
    if (!selected.length) return stop('FC27_FSU_SAMPLE_UNAVAILABLE');
    // FSU owns its scoped capture and bounded retry. Never start a second diagnostic on timeout.
    const result = await Promise.race([
      validate.call(events, selected.map(({ id, definitionId }) => ({ id, definitionId })), { label: 'FC27 read-only sample' }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FC27_FSU_VALIDATION_TIMEOUT')), 100000); }),
    ]);
    if (!unchanged()) return stop('FC27_FSU_INPUTS_CHANGED');
    if (ownData(result, 'ok') !== true || !Array.isArray(ownData(result, 'missing')) || result.missing.length) {
      return stop('FC27_FSU_SAMPLE_MISSING');
    }
    const items = ownData(result, 'items');
    if (!Array.isArray(items) || items.length !== selected.length) return stop('FC27_FSU_RESULT_UNVERIFIED');
    const snapshots = items.map(item => snapshotFc27ClubPlayer(item, root));
    if (new Set(snapshots.map(item => item.id)).size !== snapshots.length) return stop('FC27_FSU_RESULT_UNVERIFIED');
    if (!selected.every(before => snapshots.some(after => before.id === after.id
        && before.definitionId === after.definitionId && before.safetyFingerprint === after.safetyFingerprint))) {
      return stop('FC27_FSU_SAMPLE_CHANGED');
    }
    const cached = ownData(result, 'cached') === true;
    const payloads = ownData(result, 'responsePayloads');
    if (!cached && (!(payloads instanceof Map) || !selected.every(item => {
      const payload = payloads.get(item.id);
      return ownData(payload, 'id') === item.id
        && (ownData(payload, 'resourceId') ?? ownData(payload, 'definitionId')) === item.definitionId;
    }))) return stop('FC27_FSU_FRESH_EVIDENCE_UNAVAILABLE');
    return { status: 'observed', reason: cached ? 'FC27_FSU_CACHE_MATCH_ONLY' : 'FC27_FSU_EXACT_SAMPLE_VERIFIED',
      liveExecutionEnabled: false, requested: selected.length, matched: snapshots.length,
      safetyAttributesUnchanged: true, fresh: !cached, inventoryComplete: false,
      cacheStatus: ['ready', 'trusted-provisional', 'validation-failed'].includes(at(base, ['clubCache', 'status']))
        ? at(base, ['clubCache', 'status']) : null };
  } catch (error) {
    return stop(error?.message === 'FC27_FSU_VALIDATION_TIMEOUT' ? error.message : 'FC27_FSU_VALIDATION_FAILED');
  } finally { clearTimeout(timer); }
}
