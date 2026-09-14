import { OBSERVED_ROOTS, projectInspectionReport } from '../../src/fc27/prelaunch-contract.js';

export function pageKind(url) {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' && ['www.ea.com', 'www.easports.com'].includes(value.hostname)
      && /\/ea-sports-fc\/ultimate-team\/web-app(?:\/|$)/.test(value.pathname) ? 'web-app' : 'unsupported';
  } catch { return 'unsupported'; }
}

export async function collectPageReport(page, { fixture = false } = {}) {
  const kind = fixture && page.url() === 'about:blank' ? 'fixture' : pageKind(page.url());
  if (kind === 'unsupported') throw new Error('UNSUPPORTED_INSPECTION_TARGET');
  // Only descriptors and a scalar season are returned from the page, never bodies or account data.
  const raw = await page.evaluate((keys) => {
    const root = globalThis;
    const observed = {};
    for (const key of keys) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(root, key);
        observed[key] = !descriptor ? 'absent' : Object.hasOwn(descriptor, 'value') ? 'data' : 'accessor';
      } catch { observed[key] = 'unknown'; }
    }
    let season = null;
    try {
      const value = Object.getOwnPropertyDescriptor(root, 'APP_YEAR_SHORT')?.value;
      if (typeof value === 'string' && /^\d{2}$/.test(value)) season = value;
      if (typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 99) season = String(value);
    } catch { /* Report unknown, without exporting the exception. */ }
    return { observed, season };
  }, [...OBSERVED_ROOTS]);
  return projectInspectionReport({ ...raw, pageKind: kind });
}

export function createNetworkSummary(page) {
  const buckets = { success: 0, unauthorized: 0, rateLimited: 0, serverError: 0, other: 0 };
  let total = 0;
  const listener = response => {
    if (total >= 200 || pageKind(page.url()) !== 'web-app') return;
    try {
      const url = new URL(response.url());
      if (url.protocol !== 'https:' || !(url.hostname === 'ea.com' || url.hostname.endsWith('.ea.com'))) return;
      const status = response.status();
      const bucket = status === 401 || status === 403 ? 'unauthorized' : status === 429 ? 'rateLimited'
        : status >= 500 ? 'serverError' : status >= 200 && status < 400 ? 'success' : 'other';
      buckets[bucket] += 1;
      total += 1;
    } catch { /* No raw error or URL in diagnostics. */ }
  };
  page.on('response', listener);
  return Object.freeze({
    snapshot: () => ({ total, capped: total === 200, ...buckets }),
    stop: () => page.off('response', listener),
  });
}
