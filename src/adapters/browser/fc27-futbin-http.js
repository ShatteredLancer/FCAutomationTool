// FSU externalRequest GET transport. Keep the request shape aligned with the
// reviewed FSU implementation: it does not set GM's anonymous flag and sends
// the browser User-Agent. The destination is still restricted to public FC27
// routes, so no EA request or credentials are involved.
export function createFc27FutbinHttp(gmRequest, { userAgent = null, onEvent = null, now = () => Date.now() } = {}) {
  const agent = userAgent ?? (typeof globalThis.navigator === 'object' && typeof globalThis.navigator.userAgent === 'string' ? globalThis.navigator.userAgent : null);
  const record = fields => {
    try { onEvent?.({ source: 'futbin', phase: 'price-read', route: 'direct', ...fields }); }
    catch { /* Diagnostics must never affect a public-price request. */ }
  };
  return url => new Promise((resolve, reject) => {
    const startedAt = now();
    const completed = fields => record({ ...fields, durationMs: Math.max(0, now() - startedAt) });
    const parsed = new URL(url);
    const endpoint = parsed.pathname.endsWith('fetchPlayerInformationMinimal') ? 'minimal' :
      parsed.pathname.endsWith('getFilteredPlayers') ? 'filtered' : 'unknown';
    if (parsed.origin !== 'https://www.futbin.org' || !/^\/futbin\/api\/27\/(getFilteredPlayers|fetchPlayerInformationMinimal)$/.test(parsed.pathname)
        || parsed.username || parsed.password || typeof gmRequest !== 'function') {
      record({ endpoint, status: 'failed', reason: 'FC27_BUY_REFERENCE_PRICE_UNAVAILABLE' });
      reject(Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE')); return;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (agent) headers['User-Agent'] = agent;
    record({ endpoint, status: 'started' });
    gmRequest({ method: 'GET', url, timeout: 15000, headers,
      onload: response => {
        if (response.finalUrl && response.finalUrl !== url) {
          completed({ endpoint, status: 'failed', reason: 'FC27_BUY_REFERENCE_REDIRECT' });
          reject(Error('FC27_BUY_REFERENCE_REDIRECT'));
        } else if (![200, 201].includes(response.status)) {
          const reason = `FC27_BUY_REFERENCE_HTTP_${Number(response.status) || 0}`;
          completed({ endpoint, status: 'received', httpStatus: Number(response.status) || 0,
            responseBytes: typeof response.responseText === 'string' ? response.responseText.length : null, reason });
          reject(Error(reason));
        } else {
          completed({ endpoint, status: 'received', httpStatus: Number(response.status) || 0,
            responseBytes: typeof response.responseText === 'string' ? response.responseText.length : null });
          resolve(response.responseText);
        }
      },
      onerror: () => { completed({ endpoint, status: 'failed', reason: 'FC27_BUY_REFERENCE_PRICE_UNAVAILABLE' }); reject(Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE')); },
      ontimeout: () => { completed({ endpoint, status: 'failed', reason: 'FC27_BUY_REFERENCE_TIMEOUT' }); reject(Error('FC27_BUY_REFERENCE_TIMEOUT')); },
    });
  });
}
