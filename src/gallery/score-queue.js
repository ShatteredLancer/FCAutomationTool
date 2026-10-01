import { summarizeGalleryScoreSteps } from './scoring.js';
import { runGalleryPlan } from './cooperative-plan.js';

// Rendering never runs a lineup search. Cache by data rather than freshly
// projected object identity, and run only one cooperative search at a time.
export function createGalleryScoreQueue({ onUpdate = () => {}, now = () => performance.now(),
  schedule = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const entries = new Map();
  let task = null, epoch = 0, disposed = false;
  const start = () => {
    if (task || disposed || ![...entries.values()].some(value => value.pending)) return;
    const generation = epoch;
    task = (async () => {
      // Allow the tab and collection counts to paint before any search work.
      await schedule();
      while (!disposed && generation === epoch) {
        const entry = [...entries.values()].find(value => value.pending);
        if (!entry) break;
        const current = () => !disposed && generation === epoch && entries.get(entry.id) === entry;
        let summary;
        try { summary = await runGalleryPlan(summarizeGalleryScoreSteps(entry.input), {
          current, now, schedule, sliceMs: 8, maxMs: Infinity }); }
        catch { summary = {status:'unavailable',reason:'input-invalid'}; }
        if (!current() || !summary) break;
        entry.summary = summary; entry.pending = false;
        try { onUpdate(entry.input.set.id); } catch { /* Presentation cannot stop the queue. */ }
        await schedule();
      }
    })().finally(() => { task = null; if ([...entries.values()].some(value => value.pending)) start(); });
  };
  const cancel = () => {
    epoch++;
    for (const [key, entry] of entries) if (entry.pending) entries.delete(key);
  };
  return Object.freeze({
    read(scope, input) {
      if (disposed) return null;
      const id = `${scope}:${input.set.id}`;
      const key = JSON.stringify([input.set, input.catalog.source, input.catalog.tags, input.progress]);
      let entry = entries.get(id);
      if (entry?.key !== key) {
        entry = { id, key, input, pending: true, summary: {status:'calculating'} }; entries.set(id, entry);
        while (entries.size > 256) entries.delete(entries.keys().next().value);
      }
      start(); return entry.summary;
    },
    idle: async () => { while (task) await task; },
    cancel,
    dispose: () => { disposed = true; cancel(); entries.clear(); },
  });
}
