import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const observers = new WeakMap();
// Passive HTTP status evidence only: no bodies, headers, query strings,
// account identifiers or credential values. Observe existing page requests;
// do not initiate renewal, a trade, or a native read as a side effect.
export function marketSessionRoute(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname)) return null;
  if (/^\/ut\/game\/fc27\/user\/credits\/?$/.test(url.pathname)) return 'credits';
  if (/^\/ut\/game\/fc27\/tradepile\/?$/.test(url.pathname)) return 'transfer-read';
  if (/^\/ut\/game\/fc27\/purchased\/items\/?$/.test(url.pathname)) return 'unassigned-read';
  if (/^\/ut\/game\/fc27\/auctionhouse\/?$/.test(url.pathname)) return 'listing';
  if (/^\/ut\/game\/fc27\/trade\/\d+\/bid\/?$/.test(url.pathname)) return 'bid-or-buy';
  if (/^\/ut\/auth\/?$/.test(url.pathname)) return 'utas-auth';
  if (url.hostname === 'accounts.ea.com' && /^\/connect\/(auth|token)\/?$/.test(url.pathname)) return 'identity-auth';
  return null;
}

export function observeMarketSessionEvidence(page, directory) {
  if (observers.has(page)) return observers.get(page);
  const rows = []; let persisted = Promise.resolve();
  const started = new WeakMap();
  const save = row => {
    rows.push(row); if (rows.length > 100) rows.shift();
    const text = JSON.stringify(snapshot(), null, 2);
    persisted = persisted.then(() => writeFile(path.join(directory, 'market-session-http-evidence.json'), text)).catch(() => {});
  };
  const begin = request => {
    try { if (marketSessionRoute(request.url())) started.set(request, Date.now()); } catch { /* Passive only. */ }
  };
  const timing = request => {
    const at = started.get(request);
    return Number.isFinite(at) ? { startedAt: at, durationMs: Math.max(0, Date.now() - at) } : {};
  };
  const snapshot = () => ({ schema: 1, passive: true, rawHttpStatuses: true, requestsInitiated: 0, rows: rows.map(row => ({ ...row })) });
  const receive = response => {
    try {
      const route = marketSessionRoute(response.url()); if (!route) return;
      const status = response.status(), request = response.request(), method = request.method();
      if (!Number.isSafeInteger(status) || status < 100 || status > 599 || !['GET','POST','PUT','DELETE'].includes(method)) return;
      save({ at: Date.now(), route, method, status, ...timing(request) });
    } catch { /* Inspection must never affect page requests. */ }
  };
  const failed = request => {
    try {
      const route = marketSessionRoute(request.url()), method = request.method();
      if (!route || !['GET','POST','PUT','DELETE'].includes(method)) return;
      const raw = request.failure()?.errorText;
      const networkError = typeof raw === 'string' && /^net::ERR_[A-Z_]{1,80}$/.test(raw) ? raw : 'NETWORK_FAILED';
      save({ at: Date.now(), route, method, status: null, networkError, ...timing(request) });
    } catch { /* Never log arbitrary error messages. */ }
  };
  page.on('request', begin); page.on('requestfailed', failed);
  page.on('response', receive);
  const observer = { snapshot, stop() { page.off('response', receive); page.off('request', begin); page.off('requestfailed', failed); observers.delete(page); } };
  page.once('close', () => observer.stop()); observers.set(page, observer);
  return observer;
}
