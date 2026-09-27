import { inspectFc27PuzzlePlan, readFc27PuzzleClubLinks, readFc27PuzzleChemistry,
  validateFc27PuzzleSelection } from './fc27-puzzle-read.js';
import { readFc27Context, readFc27CachedClub } from './fc27-local-read.js';
import { readFc27PuzzlePolicy } from './fc27-fsu-read.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { previewFc27PuzzleSquad } from '../../fc27/puzzle-preview.js';
import { prepareFc27PuzzleFillPlan, validateFc27PuzzleFillPlan } from '../../fc27/puzzle-fill-plan.js';

// An independent development check, not a prepare/submit permit. The selected
// refs stay inside the planning callback; no EA cache or squad is changed.
export async function inspectFc27VerifiedPuzzlePlan(root, options = {}, onVerifiedInputs = null) {
  const report = await inspectFc27PuzzlePlan(root, options, async inputs => {
    const plan = previewFc27PuzzleSquad(inputs);
    if (plan.status !== 'preview') return plan;
    const stop = reason => ({ ...plan, status: 'blocked', reason, selected: [],
      exactValidation: { status: 'blocked', reason } });
    try {
      const selected = plan.selected;
      const plannedItems = structuredClone(selected.map(ref => inputs.inventory.items.find(item =>
        item.id === ref.id && item.definitionId === ref.definitionId)));
      if (selected.some(item => item.pile !== 'club') || plannedItems.some(item => !item)) {
        return stop('FC27_EXACT_ITEMS_CHANGED');
      }
      const inputScope = JSON.stringify({ context: inputs.context, policy: inputs.policy });
      const signature = () => {
        const context = readFc27Context(root);
        const policy = readFc27PuzzlePolicy(root, options.maxRating ?? 74);
        if (inputScope !== JSON.stringify({ context, policy })) throw new Error('FC27_RUNNER_INPUTS_CHANGED');
        const cached = readFc27CachedClub(root);
        const links = readFc27PuzzleClubLinks(root);
        return JSON.stringify({ context, policy, links, chemistry: readFc27PuzzleChemistry(root, links),
          selected: selected.map(ref => cached.items.find(item => item.id === ref.id && item.definitionId === ref.definitionId)) });
      };
      const before = signature();
      const transport = await createFc27ClubReadTransport(root);
      if (signature() !== before) return stop('FC27_RUNNER_INPUTS_CHANGED');
      const fresh = await transport.readPage({ start: 0, count: 250,
        definitionIds: selected.map(item => item.definitionId) });
      if (signature() !== before) return stop('FC27_RUNNER_INPUTS_CHANGED');
      const exactValidation = validateFc27PuzzleSelection(selected, fresh, plannedItems);
      if (exactValidation.status !== 'verified') return stop(exactValidation.reason);
      const fillPlan = prepareFc27PuzzleFillPlan(inputs, plan);
      const fillPreflight = fillPlan.status === 'prepared'
        ? validateFc27PuzzleFillPlan(fillPlan, inputs, fresh) : fillPlan;
      if (typeof onVerifiedInputs === 'function') {
        // Transient local inspection only. Explicit projection prevents account,
        // item/definition refs and unrelated inventory from entering the seam.
        const fields = ['type', 'rating', 'rarity', 'nationId', 'leagueId', 'teamId', 'positions', 'groups',
          'special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled'];
        const squad = Array(11).fill(null);
        selected.forEach((ref, index) => {
          if (!Number.isSafeInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || squad[ref.slot]) {
            throw new Error('FC27_PUZZLE_SLOT_UNVERIFIED');
          }
          squad[ref.slot] = Object.fromEntries(fields.map(key => [key, plannedItems[index][key]]));
        });
        await onVerifiedInputs(structuredClone({ squad, formation: inputs.challenge.formation,
          chemistry: readFc27PuzzleChemistry(root, readFc27PuzzleClubLinks(root)),
          clubLinks: readFc27PuzzleClubLinks(root),
          requirements: inputs.challenge.rawRequirements }), { inputs, preview: plan,
          fillPlan, fresh: structuredClone(fresh) });
        if (signature() !== before) return stop('FC27_RUNNER_INPUTS_CHANGED');
      }
      return { ...plan, fillPreflight, exactValidation: { ...exactValidation, observedAt: Date.now(),
        scope: 'selected-club-items-only', reusableForExecution: false } };
    } catch (error) {
      return stop(/^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')
        ? error.message : 'FC27_PUZZLE_EXACT_CHECK_UNAVAILABLE');
    }
  });
  return { ...report, executable: false, liveExecutionEnabled: false,
    pending: (report.pending ?? []).filter(reason =>
      reason !== 'EXACT_ITEM_VALIDATION' || report.plan?.exactValidation?.status !== 'verified') };
}
