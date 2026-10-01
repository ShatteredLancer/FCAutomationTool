// Preserve the planner's evaluation sequence while yielding to the browser.
// A deadline asks the generator to finish with its best partial candidates;
// invalidation discards the computation instead of publishing stale results.
export async function runGalleryPlan(steps, { current = () => true, progress = () => {},
  now = () => performance.now(), schedule = () => new Promise(resolve => setTimeout(resolve, 0)),
  sliceMs = 12, maxMs = 10000 } = {}) {
  const started = now(); let slice = started, finish = false;
  try {
    for (;;) {
      if (!current()) return null;
      const next = steps.next(finish);
      if (next.done) return current() ? next.value : null;
      const time = now(); finish = time - started >= maxMs;
      if (time - slice >= sliceMs || finish) {
        progress(next.value); await schedule(); slice = now();
      }
    }
  } finally { steps.return(); }
}
