import { normalizeFodderPlanningReference } from '../../gallery/fodder-planning-reference.js';

const INDEX = 'https://fodder.gg/api/gallery';
const OPPORTUNITIES = 'https://fodder.gg/api/gallery/all/opportunities';

// No arbitrary endpoint, credentials, identity headers, collection or FO input.
// The calculation POST is fixed to an empty collection, not the user's cards.
export function createFc27FodderReference({ gmRequest, readContext, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  const request = (url, platform) => new Promise((resolve, reject) => {
    if (typeof gmRequest !== 'function') { reject(Error('FC27_FODDER_REFERENCE_UNAVAILABLE')); return; }
    gmRequest({ url, method: platform ? 'POST' : 'GET', anonymous: true, timeout: 15000,
      ...(platform ? { headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: JSON.stringify({ platform, owned: [] }) } : {}),
      onload: response => {
        if (response.status !== 200 || response.finalUrl && response.finalUrl !== url) { reject(Error('FC27_FODDER_REFERENCE_READ_FAILED')); return; }
        if (typeof response.responseText !== 'string' || response.responseText.length > 3000000) { reject(Error('FC27_FODDER_REFERENCE_INVALID')); return; }
        try { resolve(JSON.parse(response.responseText)); } catch { reject(Error('FC27_FODDER_REFERENCE_INVALID')); }
      }, onerror: () => reject(Error('FC27_FODDER_REFERENCE_READ_FAILED')),
      ontimeout: () => reject(Error('FC27_FODDER_REFERENCE_TIMEOUT')) });
  });
  return Object.freeze({ async load({ isCurrent = () => true } = {}) {
    const context = readContext(), identity = JSON.stringify(context);
    const current = () => isCurrent() && JSON.stringify(readContext()) === identity;
    if (!current() || !['pc', 'console'].includes(context.platform)) throw Error('FC27_FODDER_REFERENCE_CONTEXT_CHANGED');
    const old = cache.get(context.platform);
    if (old?.expiresAt > now()) return structuredClone(old);
    if (!pending.has(context.platform)) {
      const task = Promise.all([request(INDEX), request(OPPORTUNITIES, context.platform)])
        .then(([index, proposals]) => normalizeFodderPlanningReference(index, proposals, { platform: context.platform, fetchedAt: now() }))
        .then(value => { cache.set(context.platform, value); return value; }).finally(() => pending.delete(context.platform));
      pending.set(context.platform, task);
    }
    const value = await pending.get(context.platform);
    if (!current()) throw Error('FC27_FODDER_REFERENCE_CONTEXT_CHANGED');
    return structuredClone(value);
  } });
}
