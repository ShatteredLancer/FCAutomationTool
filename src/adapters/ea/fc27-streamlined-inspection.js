import { readFc27StreamlinedInputs } from './fc27-streamlined-read.js';
import { createFc27StreamlinedProgressReader } from './fc27-streamlined-progress.js';
import { createFc27StreamlinedValidator } from './fc27-streamlined-validation.js';
import { runStreamlinedPlan } from '../../streamlined/planner.js';
import { createStreamlinedPlan } from '../../streamlined/plan.js';
import { same, fail } from '../../streamlined/contract.js';

// Explicit inspection only: one fresh Challenge read and the first selected
// Club/Storage batch, not a whole-club scan. No quote requests, journal or writer.
export async function inspectFc27StreamlinedFresh(root, { now = () => Date.now() } = {}) {
  const report = { status: 'blocked', liveExecutionEnabled: false, eaMutationsPerformed: false };
  try {
    const input = readFc27StreamlinedInputs(root);
    const progress = await createFc27StreamlinedProgressReader(root, { now }).read(input.challenge);
    input.assertCurrent();
    report.progress = { fresh: progress.fresh, submittedScore: progress.challenge.submittedScore,
      targetScore: progress.challenge.targetScore, timesCompleted: progress.timesCompleted,
      setMetadataFresh: progress.setMetadataFresh, rewardConfirmed: false };
    if (!same(progress.challenge, input.challenge)) fail('PROGRESS_CHANGED');
    const result = await runStreamlinedPlan({ ...input, mode: 'inventory', now });
    input.assertCurrent();
    report.planning = { status: result.status, candidateCount: result.candidateCount,
      batches: result.batches?.length ?? 0, selected: result.items?.length ?? 0,
      score: result.score ?? null, searchComplete: result.searchComplete === true };
    report.planning.sources = Object.fromEntries(['club', 'storage'].map(pile => [pile,
      result.items?.filter(item => item.pile === pile).length ?? 0]));
    if (!['ready', 'partial'].includes(result.status) || !result.batches?.length) {
      return { ...report, reason: result.reason ?? 'FC27_STREAMLINED_NO_MATERIALS' };
    }
    const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy, result });
    const batch = { index: 0, refs: plan.batches[0].map(({ id, definitionId, points, pile }) => ({ id, definitionId, points, pile })) };
    // This explicitly initiated Streamlined read follows native session renewal
    // (as Gallery does); the shared transport and all mutation defaults stay off.
    report.materials = await createFc27StreamlinedValidator(root, { now, nativeReauth: true }).verify(plan, batch, input.challenge.submittedScore);
    input.assertCurrent();
    return { ...report, status: 'verified', requests: report.materials.requests + 1 };
  } catch (error) {
    const evidence = error?.evidence;
    return { ...report, reason: /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_INSPECTION_UNAVAILABLE',
      ...(evidence?.phase === 'selected-club-read' ? { evidence: {
        phase: evidence.phase, rows: evidence.rows, unexpectedVersion: evidence.unexpectedVersion,
        wrongPile: evidence.wrongPile, factoryMismatch: evidence.factoryMismatch,
      } } : {}) };
  }
}
