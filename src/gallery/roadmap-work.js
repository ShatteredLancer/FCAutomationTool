// Read-only continuations for one frozen overall-plan input. Never persisted
// or shared across accounts. Pausing retains the exact iterator position,
// rather than asking a nested scorer to finish work that ignores the signal.
export function createGalleryRoadmapWork() {
  let groups = new WeakMap(), binding = null;
  const pending = new Set();
  const close = entry => { try { entry.steps?.return(); } finally { pending.delete(entry); entry.steps = null; } };
  const clear = () => {
    for (const entry of pending) close(entry);
    groups = new WeakMap(); binding = null;
  };
  const group = target => {
    if (!groups.has(target)) groups.set(target, { entries: new Map(), values: new Map() });
    return groups.get(target);
  };
  return {
    bind(targets, capital, planner, fast) {
      if (binding && (binding.targets !== targets || binding.capital !== capital
          || binding.planner !== planner || binding.fast !== fast)) clear();
      binding = { targets, capital, planner, fast };
    },
    memo(target, key, create) {
      const values = group(target).values;
      if (!values.has(key)) values.set(key, create());
      return values.get(key);
    },
    releaseMemos(target) {
      // Completed baseline/reference values are separate from the transient
      // scorer caches. Do not retain every collection's large scoring memo
      // while the first global verification pass visits the rest.
      groups.get(target)?.values.clear();
    },
    *run(target, key, create) {
      const entries = group(target).entries;
      if (!entries.has(key)) { const entry = { steps: create(), done: false }; entries.set(key, entry); pending.add(entry); }
      const entry = entries.get(key);
      if (entry.done) return { complete: true, value: entry.value };
      for (;;) {
        const next = entry.steps.next();
        if (next.done) {
          entry.done = true; entry.value = next.value; close(entry);
          return { complete: true, value: next.value };
        }
        if (yield next.value) return { complete: false };
      }
    },
    release(target) {
      const entries = groups.get(target)?.entries;
      if (entries) for (const entry of entries.values()) close(entry);
      groups.delete(target);
    },
    clear,
  };
}
