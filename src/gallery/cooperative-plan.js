import { DEFAULT_GALLERY_PLANNING_TIMEOUT_MS } from './planning-settings.js';

// Preserve the planner's evaluation sequence while yielding to the browser.
// A deadline asks the generator to finish with its best partial candidates;
// invalidation discards the computation instead of publishing stale results.
export async function runGalleryPlan(steps, { current = () => true, progress = () => {},
  now = () => performance.now(), schedule = () => new Promise(resolve => setTimeout(resolve, 0)),
  sliceMs = 12, maxMs = DEFAULT_GALLERY_PLANNING_TIMEOUT_MS, checkpoint = null, onTiming = null } = {}) {
  const started = now(); let slice = started, finish = false;
  const timing = onTiming ? { processingMs: 0, schedulingMs: 0, validationMs: 0, microSteps: 0, checkpointCount: 0 } : null;
  const wallStarted = timing ? performance.now() : 0;
  const check = () => {
    if (!checkpoint) return true;
    if (!timing) return checkpoint();
    const at = performance.now();
    try { timing.checkpointCount++; return checkpoint(); }
    finally { timing.validationMs += performance.now() - at; }
  };
  try {
    if (!check()) return null;
    for (;;) {
      const at = timing ? performance.now() : 0;
      if (!current()) return null;
      const next = steps.next(finish);
      if (timing) { timing.processingMs += performance.now() - at; timing.microSteps++; }
      if (next.done) return current() && check() ? next.value : null;
      const time = now(), deadlineReached = !finish && time - started >= maxMs;
      finish ||= deadlineReached;
      // Ask the nested iterator to finish once, then retain normal slicing.
      // A latched deadline is not a reason to await a timer on every yield.
      if (time - slice >= sliceMs || deadlineReached) {
        if (!check()) return null;
        // Scoring uses bare yields solely as cooperative checkpoints. Keep
        // scheduling/cancellation, without publishing an absent UI record.
        if (next.value !== undefined) progress(next.value);
        const beforeWait = timing ? performance.now() : 0;
        await schedule();
        if (timing) timing.schedulingMs += performance.now() - beforeWait;
        if (!check()) return null;
        slice = now();
      }
    }
  } finally {
    steps.return();
    if (timing) try { onTiming({ ...timing, durationMs: performance.now() - wallStarted }); } catch { /* Observations cannot change a plan. */ }
  }
}
