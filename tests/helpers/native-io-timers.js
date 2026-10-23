import { vi } from 'vitest';

const realTimeout = globalThis.setTimeout;
// CompressionStream finishes on native I/O, not Vitest's clock. Keep advancing
// subsequently scheduled business timers without stubbing compression or raising
// production/test deadlines. Observe rejection immediately to avoid orphan tasks.
export async function finishNativeIo(task) {
  let done = false;
  task.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; !done && i < 1000; i++) {
    await new Promise(resolve => realTimeout(resolve, 1));
    await vi.runAllTimersAsync();
  }
  if (!done) throw Error('Native I/O and fake timers did not settle');
  return task;
}
