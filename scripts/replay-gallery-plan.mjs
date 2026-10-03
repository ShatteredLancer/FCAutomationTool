import { readFile } from 'node:fs/promises';
import { createGalleryPlanReplay } from '../src/gallery/plan-replay.js';
import { planGalleryGrade } from '../src/gallery/planner.js';
import { planGalleryJoint } from '../src/gallery/joint-planner.js';

const path = process.argv[2];
if (!path) throw Error('Usage: node scripts/replay-gallery-plan.mjs <diagnostics.json>');
const payload = JSON.parse(await readFile(path, 'utf8'));
const records = payload.planning ?? [];
for (const [index, row] of records.entries()) {
  const replay = createGalleryPlanReplay(row.replay?.input);
  if (!replay) { console.log(JSON.stringify({ index, status: 'invalid-replay' })); continue; }
  const result = replay.mode === 'joint' ? planGalleryJoint(replay.input) : planGalleryGrade(replay.input);
  console.log(JSON.stringify({ index, mode: replay.mode, status: result.status, reason: result.reason,
    evaluations: result.evaluations, searchComplete: result.searchComplete,
    plans: result.plans?.map(plan => ({ price: plan.totalPrice, score: plan.score,
      targets: plan.targets?.map(target => ({ setId: target.setId, score: target.score })),
      versions: plan.items.map(item => item.eaId) })) }));
}
if (!records.length) console.log('No Gallery planning replay in this diagnostic file.');
