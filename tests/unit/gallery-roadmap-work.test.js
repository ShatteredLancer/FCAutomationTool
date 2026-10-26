import { expect, it } from 'vitest';
import { createGalleryRoadmapWork } from '../../src/gallery/roadmap-work.js';
const finish = steps => { let next; do { next = steps.next(); } while (!next.done); return next.value; };

it('continues the exact nested checkpoint without replaying completed CPU work', () => {
  const work = createGalleryRoadmapWork(), target = {}, seen = []; let starts = 0, closed = 0;
  function* create() { starts++; try { for (let i = 0; i < 4; i++) { seen.push(i); yield; } return 7; } finally { closed++; } }
  const first = work.run(target, 'baseline', create); first.next();
  expect(first.next(true).value).toEqual({ complete: false });
  expect(closed).toBe(0);
  expect(finish(work.run(target, 'baseline', create))).toEqual({ complete: true, value: 7 });
  expect(finish(work.run(target, 'baseline', create))).toEqual({ complete: true, value: 7 });
  expect(starts).toBe(1); expect(seen).toEqual([0,1,2,3]); expect(closed).toBe(1);
});

it.each(['targets', 'capital', 'planner', 'mode'])('invalidates paused work when %s changes', change => {
  const work = createGalleryRoadmapWork(), target = {}, targets = [target], planner = () => {}; let closed = 0;
  work.bind(targets, null, planner, true);
  const steps = work.run(target, 'reference', function* () { try { yield; } finally { closed++; } });
  steps.next(); steps.next(true);
  work.bind(change === 'targets' ? [...targets] : targets, change === 'capital' ? 1000 : null,
    change === 'planner' ? () => {} : planner, change === 'mode' ? false : true);
  expect(closed).toBe(1);
});

it('reuses only target-local memo and releases completed target and account-scoped work', () => {
  const work = createGalleryRoadmapWork(), a = {}, b = {}; let count = 0;
  const create = () => ++count;
  expect(work.memo(a, 'score', create)).toBe(1); expect(work.memo(a, 'score', create)).toBe(1);
  expect(work.memo(b, 'score', create)).toBe(2);
  work.release(a); expect(work.memo(a, 'score', create)).toBe(3);
  work.clear(); expect(work.memo(b, 'score', create)).toBe(4);
});
