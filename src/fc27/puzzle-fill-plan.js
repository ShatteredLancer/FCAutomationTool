import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { puzzleMaterialRules } from './puzzle-material-policy.js';
import { evaluateFc27PuzzleSquad } from './puzzle-evaluator.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from './sbc-requirements.js';

const itemFields = ['id', 'definitionId', 'type', 'pile', 'rating', 'rarity', 'nationId', 'leagueId', 'teamId',
  'positions', 'groups', 'special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled', 'activeTrade',
  'limitedUse', 'loans', 'tradeable', 'state', 'locked', 'activeSquad', 'protected'];
const fail = reason => ({ status: 'blocked', reason, executable: false });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const positive = value => Number.isSafeInteger(value) && value > 0;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const scopeOf = input => ({ context: input.context, challenge: input.challenge, policy: input.policy,
  clubLinks: input.clubLinks, chemistry: input.chemistry });
const project = item => Object.fromEntries(itemFields.map(key => [key, item?.[key]]));

// No solver call: re-check this exact arrangement, never find a replacement.
// Ordinary Club players in the exact non-brick slots, under the explicit policy.
// Custom bricks, managers and market placeholders are not material entities.
function assess(scope, selected, items) {
  const { context, challenge, policy, clubLinks, chemistry } = scope;
  if (challenge?.mechanism !== 'traditional-puzzle' || challenge.slotCount !== 11
      || !Array.isArray(challenge.brickIndices) || challenge.brickIndices.length >= 11
      || new Set(challenge.brickIndices).size !== challenge.brickIndices.length
      || challenge.brickIndices.some(index => !Number.isInteger(index) || index < 0 || index > 10)
      || !positive(challenge.formation?.id) || challenge.formation.positions?.length !== 11
      || Array.from(challenge.formation.positions).some(value => !Number.isInteger(value) || value < 0 || value > 27)) {
    return fail('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
  }
  const required = 11 - challenge.brickIndices.length;
  if (!policy || policy.onlyUntradeable !== true || !positive(policy.maxRating) || policy.maxRating > 99) {
    return fail('FC27_PUZZLE_FILL_POLICY_UNVERIFIED');
  }
  if (!Array.isArray(selected) || selected.length !== required || !Array.isArray(items) || items.length !== required
      || new Set(selected.map(ref => ref?.slot)).size !== required
      || selected.some(ref => !ref || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10
        || challenge.brickIndices.includes(ref.slot)
        || !positive(ref.id) || !positive(ref.definitionId) || ref.pile !== 'club' || ref.catalogRef !== undefined)
      || new Set(selected.map(ref => ref.id)).size !== required
      || new Set(selected.map(ref => ref.definitionId)).size !== required
      || new Set(items.map(item => item?.id)).size !== required) return fail('FC27_PUZZLE_FILL_SELECTION_CHANGED');
  const byId = new Map(items.map(item => [item?.id, item]));
  const squad = Array(11).fill(null);
  for (const ref of selected) {
    const item = byId.get(ref.id);
    if (!item || itemFields.some(key => item[key] === undefined)
        || item.definitionId !== ref.definitionId || item.pile !== ref.pile || item.rating !== ref.rating
        || item.state !== 'free') {
      return fail('FC27_PUZZLE_FILL_SELECTION_CHANGED');
    }
    squad[ref.slot] = { ...project(item), slot: ref.slot };
  }
  const pool = collectSafeTraditionalCandidates({ context, policy,
    challenge: { ...challenge, mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required }] },
    inventory: { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', items: squad.filter(Boolean) } });
  if (pool.status !== 'candidates' || pool.candidates.length !== required) return fail('FC27_PUZZLE_FILL_MATERIAL_PROTECTED');
  const parsed = parseFc27SbcRequirements(challenge.rawRequirements, required);
  if (parsed.status !== 'observed') return fail(parsed.reason);
  const materialRules = puzzleMaterialRules(parsed.rules, required);
  if (materialRules.length && matchFc27SbcRequirements({ requirements: materialRules, squad: squad.filter(Boolean) }).status !== 'satisfied') {
    return fail('FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED');
  }
  const needsFacts = parsed.rules.some(rule => ['min-team-rating', 'max-team-rating', 'exact-team-rating',
    'min-chemistry', 'max-chemistry', 'exact-chemistry'].includes(rule.kind));
  const facts = needsFacts ? evaluateFc27PuzzleSquad({ squad, formation: challenge.formation, chemistry, rating: chemistry?.rating })
    : { status: 'observed', teamRating: null, chemistry: null };
  if (needsFacts && (facts.status !== 'observed' || !Number.isInteger(facts.teamRating) || facts.teamRating < 0
      || !Number.isInteger(facts.chemistry) || facts.chemistry < 0 || facts.chemistry > 33)) {
    return fail('FC27_PUZZLE_FILL_FACTS_UNAVAILABLE');
  }
  const validation = matchFc27SbcRequirements({ requirements: parsed.rules, squad: squad.filter(Boolean), clubLinks,
    chemistry: facts.chemistry, teamRating: facts.teamRating });
  if (validation.status !== 'satisfied' || validation.satisfied !== true) return fail(validation.reason);
  return { status: 'verified', reason: 'FC27_PUZZLE_FILL_PREFLIGHT_VERIFIED', executable: false,
    selectedCount: required, teamFacts: { teamRating: facts.teamRating, chemistry: facts.chemistry },
    requirementCount: parsed.rules.length };
}

export function prepareFc27PuzzleFillPlan(input, preview) {
  try {
    if (preview?.status !== 'preview' || preview.setId !== input?.challenge?.setId
        || preview.challengeId !== input?.challenge?.id
        || preview.required !== input?.challenge?.slotCount - input?.challenge?.brickIndices?.length
        || !Array.isArray(input?.inventory?.items) || !same(input.inventory.context, input.context)
        || input.inventory.schema !== 1 || input.inventory.kind !== 'normalized-inventory'
        || !['provisional', 'ready'].includes(input.inventory.status)) return fail('FC27_PUZZLE_FILL_PLAN_UNVERIFIED');
    const selected = structuredClone(preview.selected);
    const scope = structuredClone(scopeOf(input));
    const items = selected.map(ref => {
      const matches = input.inventory.items.filter(item => item.id === ref.id);
      return matches.length === 1 ? project(matches[0]) : null;
    });
    const validation = assess(scope, selected, items);
    if (validation.status !== 'verified') return validation;
    // The inspection's aggregate success can never be used as a write permit.
    return freeze({ status: 'prepared', kind: 'puzzle-fill', schema: 1, executable: false,
      ...scope, selected, items: structuredClone(items), validation });
  } catch { return fail('FC27_PUZZLE_FILL_PLAN_UNVERIFIED'); }
}

// `current` must come from a new input read. `freshItems` must come from a new
// precise Club query (pre-save), or the reloaded squad (post-save). The caller
// checks source/freshness; this pure validator checks identities, fields and rules.
export function validateFc27PuzzleFillPlan(plan, current, freshItems, { saved = false } = {}) {
  try {
    if (plan?.status !== 'prepared' || plan.kind !== 'puzzle-fill' || plan.schema !== 1
        || !same(scopeOf(plan), scopeOf(current))) return fail('FC27_PUZZLE_FILL_INPUTS_CHANGED');
    if (!Array.isArray(freshItems) || freshItems.length < plan.selected.length || freshItems.length >= 250
        || new Set(freshItems.map(item => item?.id)).size !== freshItems.length
        || freshItems.some(item => !positive(item?.id) || !positive(item?.definitionId)
          || !plan.selected.some(ref => ref.definitionId === item.definitionId))
        || saved && freshItems.length !== plan.selected.length) return fail('FC27_EXACT_ITEMS_CHANGED');
    const currentById = new Map(freshItems.map(item => [item.id, item]));
    const expected = new Map(plan.items.map(item => [item.id, item]));
    const items = [];
    for (const ref of plan.selected) {
      const item = currentById.get(ref.id);
      // `protected` is a local policy field, not a server Club field. Keep the
      // planned value and rerun all source safety flags and current FSU policy.
      const normalized = item && { ...item, protected: item.protected ?? expected.get(ref.id)?.protected };
      if (!normalized || !same(project(normalized), expected.get(ref.id))
          || saved && item.slot !== ref.slot) return fail('FC27_EXACT_ITEMS_CHANGED');
      items.push(normalized);
    }
    return assess(scopeOf(current), plan.selected, items);
  } catch { return fail('FC27_PUZZLE_FILL_PLAN_UNVERIFIED'); }
}
