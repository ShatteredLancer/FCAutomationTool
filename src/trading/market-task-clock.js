// Prepaid 60-second runtime leases prevent refresh from resetting a task limit.
// A normal pause refunds the unused tail. A lost page conservatively consumes
// its remaining lease, never the hours spent offline. No lease grants EA access.
const fail = () => { throw Error('MARKET_CLOCK_INVALID'); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
export function validateMarketClocks(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) fail();
  const seen = new Set();
  for (const row of rows) {
    if (!row || Object.keys(row).some(k => !['taskId', 'elapsedMs', 'lease', 'stopped'].includes(k))
      || typeof row.taskId !== 'string' || !row.taskId || row.taskId.length > 120 || seen.has(row.taskId)
      || !integer(row.elapsedMs) || typeof row.stopped !== 'boolean') fail();
    seen.add(row.taskId);
    if (row.lease !== null) {
      const l = row.lease;
      if (!l || Object.keys(l).some(k => !['token', 'at', 'until'].includes(k))
        || typeof l.token !== 'string' || !l.token || l.token.length > 120 || !integer(l.at) || !integer(l.until)
        || l.until <= l.at || l.until - l.at > 60000 || row.elapsedMs < l.until - l.at) fail();
    }
  }
}
export function marketElapsed(clock, now, token) {
  if (!clock) return 0;
  return clock.elapsedMs - (clock.lease?.token === token ? Math.max(0, clock.lease.until - Math.max(clock.lease.at, now)) : 0);
}
export function closeMarketClock(state, taskId, token, now, stopped = false) {
  const row = state.clocks?.find(r => r.taskId === taskId);
  if (!row || row.lease?.token !== token) return;
  row.elapsedMs = marketElapsed(row, now, token); row.lease = null; row.stopped ||= stopped;
}
export function reserveMarketClock(state, taskId, token, now, limitMs = null) {
  if (!integer(now) || limitMs !== null && (!integer(limitMs) || limitMs === 0)) fail();
  state.clocks ??= [];
  let row = state.clocks.find(r => r.taskId === taskId);
  if (!row) { row = { taskId, elapsedMs: 0, lease: null, stopped: false }; state.clocks.push(row); }
  closeMarketClock(state, taskId, token, now);
  // An abandoned lease is already charged. It cannot be refunded by a new run.
  row.lease = null;
  if (row.stopped || limitMs !== null && row.elapsedMs >= limitMs) { row.stopped = true; return; }
  const duration = Math.min(60000, limitMs === null ? 60000 : limitMs - row.elapsedMs);
  row.elapsedMs += duration; row.lease = { token, at: now, until: now + duration };
}
