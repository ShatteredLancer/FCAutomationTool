import { OBSERVED_ROOTS, projectInspectionReport } from '../../src/fc27/prelaunch-contract.js';
import { observeRuntime } from './runtime-observation.mjs';

export async function collectRuntimeObservation(page, { fixture = false } = {}) {
  if (!(fixture && page.url() === 'about:blank') && pageKind(page.url()) !== 'web-app') {
    throw new Error('UNSUPPORTED_INSPECTION_TARGET');
  }
  return page.evaluate(observeRuntime);
}

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

export function createNetworkSummary(page, options = {}) {
  const buckets = { success: 0, unauthorized: 0, rateLimited: 0, serverError: 0, other: 0, failed: 0 };
  let total = 0;
  const budget = options.budget || { remaining: 200 };
  const isOfficialHost = hostname => hostname === 'ea.com' || hostname.endsWith('.ea.com')
    || hostname === 'easports.com' || hostname.endsWith('.easports.com');
  const listener = response => {
    if (budget.remaining <= 0 || pageKind(page.url()) !== 'web-app') return;
    try {
      const url = new URL(response.url());
      if (url.protocol !== 'https:' || !isOfficialHost(url.hostname)) return;
      const status = response.status();
      const bucket = status === 401 || status === 403 ? 'unauthorized' : status === 429 ? 'rateLimited'
        : status >= 500 ? 'serverError' : status >= 200 && status < 400 ? 'success' : 'other';
      buckets[bucket] += 1;
      total += 1;
      budget.remaining -= 1;
    } catch { /* No raw error or URL in diagnostics. */ }
  };
  const failedListener = request => {
    if (budget.remaining <= 0 || pageKind(page.url()) !== 'web-app') return;
    try {
      const url = new URL(request.url());
      if (url.protocol !== 'https:' || !isOfficialHost(url.hostname)) return;
      buckets.failed += 1;
      total += 1;
      budget.remaining -= 1;
    } catch { /* No raw error or URL in diagnostics. */ }
  };
  page.on('response', listener);
  page.on('requestfailed', failedListener);
  return Object.freeze({
    snapshot: () => ({ total, capped: budget.remaining === 0, ...buckets }),
    stop: () => {
      page.off('response', listener);
      page.off('requestfailed', failedListener);
    },
  });
}

// Keep one bounded response collector alive for the whole manual inspection session.
// A page can navigate or open a new tab after login, so collecting only the current
// page at the moment Enter is pressed misses the responses we need to inspect.
export function createNetworkCollector(context) {
  const budget = { remaining: 200 };
  const summaries = new Map();
  const attach = page => {
    if (summaries.has(page)) return;
    summaries.set(page, createNetworkSummary(page, { budget }));
  };
  for (const page of context.pages()) attach(page);
  const onPage = page => attach(page);
  context.on('page', onPage);
  return Object.freeze({
    snapshot: () => {
      const result = { total: 0, capped: budget.remaining === 0,
        success: 0, unauthorized: 0, rateLimited: 0, serverError: 0, other: 0, failed: 0 };
      for (const summary of summaries.values()) {
        const snapshot = summary.snapshot();
        result.total += snapshot.total;
        result.success += snapshot.success;
        result.unauthorized += snapshot.unauthorized;
        result.rateLimited += snapshot.rateLimited;
        result.serverError += snapshot.serverError;
        result.other += snapshot.other;
        result.failed += snapshot.failed;
      }
      return result;
    },
    stop: () => {
      context.off('page', onPage);
      for (const summary of summaries.values()) summary.stop();
    },
  });
}
