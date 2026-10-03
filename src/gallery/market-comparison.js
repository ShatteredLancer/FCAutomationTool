// Exact-version, user-triggered read-only comparisons. Concurrent consumers
// share one query and the cache is bound to the active account/platform scope.
export function createGalleryMarketComparison({ createTransport, scope, now = () => Date.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), ttlMs = 30000, diagnosticLog = null } = {}) {
  const cache = new Map(), pending = new Map();
  let tail = Promise.resolve(), lastRequestAt = null, cooldownUntil = 0, identity = null;
  const blocked = reason => ({ status: 'blocked', reason, executable: false });
  const inspectScope = () => { try { return scope(); } catch { return null; } };
  const diag = input => {
    try { return Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', ...input })).catch(() => false); }
    catch { return Promise.resolve(false); }
  };
  const changedScope = phase => {
    void diag({ event: 'market-compare', phase, status: 'blocked', reason: 'FC27_GALLERY_COMPARE_SCOPE_CHANGED' });
    return blocked('FC27_GALLERY_COMPARE_SCOPE_CHANGED');
  };
  return Object.freeze({
    compare: definitionId => {
      const account = inspectScope();
      if (!account || !Number.isSafeInteger(definitionId) || definitionId < 1) {
        void diag({ event: 'market-compare', phase: 'input', status: 'blocked', reason: 'FC27_GALLERY_COMPARE_INPUT_INVALID' });
        return Promise.resolve(blocked('FC27_GALLERY_COMPARE_INPUT_INVALID'));
      }
      if (identity !== account) { cache.clear(); identity = account; cooldownUntil = 0; }
      const key = `${account}:${definitionId}`, stored = cache.get(key);
      if (stored && stored.expiresAt > now()) {
        void diag({ event: 'market-compare', phase: 'cache', status: stored.result.status === 'observed' ? 'success' : 'blocked',
          cached: true, reason: stored.result.reason });
        return Promise.resolve({ ...stored.result, cached: true });
      }
      if (pending.has(key)) return pending.get(key);
      const task = tail.catch(() => {}).then(async () => {
        if (inspectScope() !== account) return changedScope('preflight');
        if (cooldownUntil > now()) {
          void diag({ event: 'market-compare', phase: 'preflight', status: 'blocked', reason: 'FC27_GALLERY_COMPARE_COOLDOWN', retryAt: cooldownUntil });
          return { ...blocked('FC27_GALLERY_COMPARE_COOLDOWN'), retryAt: cooldownUntil };
        }
        if (lastRequestAt !== null) await wait(Math.max(0, 800 - (now() - lastRequestAt)));
        if (inspectScope() !== account) return changedScope('preflight');
        try {
          void diag({ event: 'market-compare', phase: 'request', status: 'started' });
          const transport = await createTransport({ maxRequests: 1, quotesOnly: true });
          if (inspectScope() !== account) return changedScope('request');
          lastRequestAt = now();
          const result = await transport.readQuotePage({ definitionId, start: 0, count: 20, maxBuy: null });
          if (inspectScope() !== account) return changedScope('response');
          if (result?.status !== 'observed' || result.definitionId !== definitionId || result.executable !== false) {
            void diag({ event: 'market-compare', phase: 'response', status: 'blocked', reason: 'FC27_GALLERY_COMPARE_RESPONSE_UNVERIFIED' });
            return blocked('FC27_GALLERY_COMPARE_RESPONSE_UNVERIFIED');
          }
          cache.set(key, { result, expiresAt: now() + ttlMs });
          while (cache.size > 100) cache.delete(cache.keys().next().value);
          void diag({ event: 'market-compare', phase: 'response', status: 'success' });
          return { ...result, cached: false };
        } catch (error) {
          if (inspectScope() !== account) return changedScope('response');
          const reason = /^FC27_(?:MARKET_[A-Z0-9_]+|CONTEXT_UNAVAILABLE)$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_COMPARE_FAILED';
          const result = blocked(reason);
          cache.set(key, { result, expiresAt: now() + ttlMs });
          if (/HTTP_429$/.test(reason)) cooldownUntil = now() + ttlMs;
          void diag({ event: 'market-compare', phase: 'response', status: 'blocked', reason });
          return result;
        }
      }).finally(() => pending.delete(key));
      pending.set(key, task); tail = task;
      return task;
    },
  });
}
