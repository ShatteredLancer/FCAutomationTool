// This driver cannot authorize jobs. Each service reads its own durable,
// account-bound approval and skips absent/disarmed/not-yet-due records.
export function startGalleryTradingPoll({ timers, listing, relist, onUpdate = () => {}, intervalMs = 15000 }) {
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const service of [() => listing.pollSchedule(), () => relist.poll()]) {
        if (stopped) break;
        try { const state = await service(); if (!stopped) onUpdate(state); }
        catch { /* Services retain their durable intent; never replay here. */ }
      }
    } finally { running = false; }
  };
  const timer = timers.setInterval(() => { void tick(); }, intervalMs);
  return Object.freeze({ tick, dispose() { stopped = true; timers.clearInterval(timer); relist.stop(); listing.stop(); } });
}
