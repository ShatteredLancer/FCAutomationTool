// Only cooperative planning yields; never bypass transaction pacing or expiry.
export function yieldStreamlinedTask(host = globalThis) {
  if (typeof host.scheduler?.yield === 'function') return host.scheduler.yield();
  if (typeof host.MessageChannel === 'function') return new Promise((resolve, reject) => {
    const channel = new host.MessageChannel();
    const close = () => { channel.port1.close(); channel.port2.close(); };
    channel.port1.onmessage = () => { close(); resolve(); };
    try { channel.port2.postMessage(null); } catch (error) { close(); reject(error); }
  });
  return new Promise(resolve => host.setTimeout(resolve, 0));
}

export async function runStreamlinedSteps(iterator, { onProgress = () => {}, stopped = () => false,
  schedule = yieldStreamlinedTask, metricsNow = () => Date.now() } = {}) {
  let metricsValid = true;
  const sample = () => { try { const value = metricsNow(); if (Number.isFinite(value) && value >= 0) return value; }
    catch { /* Metrics cannot stop planning. */ } metricsValid = false; return 0; };
  const started = sample(); let processingMs = 0, schedulingMs = 0;
  const next = cancelled => {
    const before = sample(), step = iterator.next(cancelled);
    processingMs += Math.max(0, sample() - before); return step;
  };
  try {
    let step = next();
    while (!step.done) {
      try { onProgress(step.value); } catch { /* Display only. */ }
      const before = sample(); await schedule(); schedulingMs += Math.max(0, sample() - before);
      step = next(stopped());
    }
    const wallElapsedMs = Math.max(0, sample() - started);
    return { ...step.value, processingMs: metricsValid ? processingMs : undefined,
      schedulingMs: metricsValid ? schedulingMs : undefined, wallElapsedMs: metricsValid ? wallElapsedMs : undefined };
  } finally { iterator.return(); }
}
