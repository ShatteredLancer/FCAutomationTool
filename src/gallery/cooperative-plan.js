import { DEFAULT_GALLERY_PLANNING_TIMEOUT_MS } from './planning-settings.js';

// Preserve the planner's evaluation sequence while yielding to the browser.
// A deadline asks the generator to finish with its best partial candidates;
// invalidation discards the computation instead of publishing stale results.
export async function runGalleryPlan(steps, { current = () => true, progress = () => {},
  now = () => performance.now(), schedule = () => new Promise(resolve => setTimeout(resolve, 0)),
  sliceMs = 12, maxMs = DEFAULT_GALLERY_PLANNING_TIMEOUT_MS, checkpoint = null } = {}) {
  const started = now(); let slice = started, finish = false;
  try {
    if (checkpoint && !checkpoint()) return null;
    for (;;) {
      if (!current()) return null;
      const next = steps.next(finish);
      if (next.done) return current() && (!checkpoint || checkpoint()) ? next.value : null;
      const time = now(), deadlineReached = !finish && time - started >= maxMs;
      finish ||= deadlineReached;
      // Ask the nested iterator to finish once, then retain normal slicing.
      // A latched deadline is not a reason to await a timer on every yield.
      if (time - slice >= sliceMs || deadlineReached) {
        if (checkpoint && !checkpoint()) return null;
        // Scoring uses bare yields solely as cooperative checkpoints. Keep
        // scheduling/cancellation, without publishing an absent UI record.
        if (next.value !== undefined) progress(next.value);
        await schedule();
        if (checkpoint && !checkpoint()) return null;
        slice = now();
      }
    }
  } finally { steps.return(); }
}
