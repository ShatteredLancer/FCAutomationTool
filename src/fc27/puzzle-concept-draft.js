import { prepareFc27PuzzleConceptPlan } from './puzzle-concept-plan.js';
import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { isFc27TotwRatingOnly, parseFc27SbcRequirements, matchFc27SbcRequirements } from './sbc-requirements.js';
import { evaluateFc27PuzzleRating, evaluateFc27PuzzleSquad } from './puzzle-evaluator.js';
import { isFc27TotwCard } from '../domain/player-rarity.js';
import { collectSafePuzzleCandidates } from './puzzle-material-policy.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blocked = (reason, mismatch = null) => ({ status: 'blocked', reason, executable: false,
  ...(typeof mismatch === 'string' ? { mismatch } : {}) });
const scope = input => ({ context: input.context, challenge: input.challenge, policy: input.policy,
  clubLinks: input.clubLinks, chemistry: input.chemistry });
const fields = ['id', 'definitionId', 'pile', 'rating', 'rarity', 'nationId', 'leagueId', 'teamId', 'positions', 'groups',
  'type', 'special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled', 'activeTrade', 'limitedUse', 'loans',
  'tradeable', 'state', 'locked', 'activeSquad', 'protected'];
const project = item => Object.fromEntries(fields.map(key => [key, item?.[key]]));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export function isFc27TotwConceptDraft(plan) {
  if (plan?.kind !== 'puzzle-concept-draft' || !Array.isArray(plan.owned) || !Array.isArray(plan.purchases)
      || plan.purchaseCount < 1 || plan.purchases.length !== plan.purchaseCount || !Array.isArray(plan.challenge?.brickIndices)) return false;
  const { rules } = parseFc27SbcRequirements(plan.challenge.rawRequirements,
    plan.challenge.slotCount - plan.challenge.brickIndices.length);
  return isFc27TotwRatingOnly(rules)
    && (plan.purchaseCount === 1 && isFc27TotwCard(plan.purchases[0]) && !plan.owned.some(isFc27TotwCard)
      || plan.owned.filter(isFc27TotwCard).length === 1 && plan.purchases.every(card => card.special === false && [0, 1].includes(card.rarity)));
}

// A concept is a catalog hypothesis. Keep its facts separate from owned Club
// entities; neither Only Untradeable nor the real-material validator is relaxed.
function assess(input, slots, owned, purchases) {
  const { challenge, context, policy } = input;
  if (challenge?.mechanism !== 'traditional-puzzle' || challenge.slotCount !== 11
      || typeof policy?.onlyUntradeable !== 'boolean' || !same(challenge.context, context)) return blocked('FC27_CONCEPT_SCOPE_UNVERIFIED');
  const parsed = parseFc27SbcRequirements(challenge.rawRequirements, slots.filter(Boolean).length);
  if (parsed.status !== 'observed') return blocked(parsed.reason);
  const totwOnly = isFc27TotwRatingOnly(parsed.rules);
  const inventory = { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', items: owned };
  const pool = totwOnly ? collectSafePuzzleCandidates({ context, policy, challenge, inventory })
    : collectSafeTraditionalCandidates({ context, policy, inventory,
      challenge: { ...challenge, mechanism: 'traditional', requirements: [{ kind: 'player-count', count: slots.filter(Boolean).length }] } });
  if (pool.status !== 'candidates' || pool.candidates.length !== owned.length
      || owned.some(item => !['club', 'storage'].includes(item.pile) || item.state !== 'free' || fields.some(key => item[key] === undefined))) {
    return blocked('FC27_CONCEPT_MATERIAL_PROTECTED');
  }
  const squad = slots.map(slot => {
    if (!slot) return null;
    const item = slot.kind === 'owned' ? owned.find(item => item.id === slot.id) : purchases.find(item => item.definitionId === slot.definitionId);
    return item && { ...item, slot: slot.slot };
  });
  if (squad.some((item, slot) => slots[slot] && (!item || item.definitionId !== slots[slot].definitionId
      || item.rating !== slots[slot].rating))) return blocked('FC27_CONCEPT_ITEMS_CHANGED');
  const buyTotw = totwOnly && !owned.some(isFc27TotwCard);
  if (totwOnly && (squad.filter(isFc27TotwCard).length !== 1 || buyTotw && purchases.length !== 1)) {
    return blocked('FC27_CONCEPT_CATALOG_UNVERIFIED');
  }
  for (const item of purchases) {
    if (item.id !== undefined || item.pile !== undefined || item.catalogRef !== `fc27:${item.definitionId}`
        || item.type !== 'player' || item.evolution !== false || item.cosmetic !== false
        || item.concept !== false || item.academyEnrolled !== false
        || (buyTotw ? !isFc27TotwCard(item) : item.special !== false || ![0, 1].includes(item.rarity))
        || item.rating > policy.maxRating || item.rating >= 75 && (item.rating < policy.goldRange[0] || item.rating > policy.goldRange[1])
        || policy.excludedLeagueIds.includes(item.leagueId)
        || ![item.nationId, item.leagueId, item.teamId].every(id => Number.isSafeInteger(id) && id > 0)
        || !Array.isArray(item.positions) || !item.positions.length || item.positions.some(p => !Number.isInteger(p) || p < 0 || p > 27)
        || !Array.isArray(item.groups) || item.groups.some(id => !Number.isSafeInteger(id) || id < 0)) return blocked('FC27_CONCEPT_CATALOG_UNVERIFIED');
  }
  const needsFacts = parsed.rules.some(rule => /-(chemistry|team-rating)$/.test(rule.kind));
  const facts = totwOnly ? { ...evaluateFc27PuzzleRating({ squad: squad.filter(Boolean), rating: input.chemistry?.rating }), chemistry: null }
    : needsFacts ? evaluateFc27PuzzleSquad({ squad, formation: challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry?.rating }) : { status: 'observed', teamRating: null, chemistry: null };
  if (facts.status !== 'observed') return blocked(facts.reason);
  const validation = matchFc27SbcRequirements({ requirements: parsed.rules,
    squad: squad.filter(Boolean), clubLinks: input.clubLinks, chemistry: facts.chemistry, teamRating: facts.teamRating });
  return validation.status === 'satisfied' ? { status: 'verified', teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating } }
    : blocked(validation.reason);
}

export function prepareFc27PuzzleConceptDraft(input, suggestion) {
  try {
    const plan = prepareFc27PuzzleConceptPlan({ challenge: input.challenge,
      plan: { ...suggestion, status: 'preview', setId: input.challenge.setId, challengeId: input.challenge.id } });
    if (plan.status !== 'prepared' || plan.purchaseCount < 1) return blocked('FC27_CONCEPT_PLAN_UNVERIFIED');
    if (input.inventory?.kind !== 'normalized-inventory' || !same(input.context, input.inventory.context)) return blocked('FC27_CONCEPT_SCOPE_UNVERIFIED');
    const owned = suggestion.selectedOwned.map(ref => {
      const found = input.inventory.items.filter(item => item.id === ref.id);
      return found.length === 1 ? project(found[0]) : null;
    });
    if (owned.some(item => !item) || suggestion.purchases.some(item => input.inventory.items.some(owned => owned.definitionId === item.definitionId))) {
      return blocked('FC27_CONCEPT_ITEMS_CHANGED');
    }
    const detached = structuredClone(scope(input));
    const purchases = structuredClone(suggestion.purchases);
    const validation = assess(detached, plan.slots, owned, purchases);
    if (validation.status !== 'verified') return validation;
    return freeze({ ...plan, kind: 'puzzle-concept-draft', ...detached, owned, purchases, validation });
  } catch { return blocked('FC27_CONCEPT_PLAN_UNVERIFIED'); }
}

export function validateFc27PuzzleConceptDraft(plan, current, freshOwned) {
  try {
    if (plan?.kind !== 'puzzle-concept-draft' || plan.status !== 'prepared' || !same(scope(plan), scope(current))) return blocked('FC27_CONCEPT_INPUTS_CHANGED');
    const rebuilt = prepareFc27PuzzleConceptDraft({ ...scope(plan), inventory: { schema: 1, context: plan.context,
      kind: 'normalized-inventory', status: 'provisional', items: plan.owned } }, {
      selectedOwned: plan.slots.filter(ref => ref?.kind === 'owned').map(({ id, definitionId, rating, pile, slot }) => ({ id, definitionId, rating, pile, slot })),
      purchases: plan.purchases, purchaseCount: plan.purchaseCount,
    });
    if (rebuilt.status !== 'prepared' || !same(rebuilt.slots, plan.slots) || rebuilt.estimatedCost !== plan.estimatedCost) return blocked('FC27_CONCEPT_PLAN_UNVERIFIED', 'plan');
    if (!Array.isArray(freshOwned) || freshOwned.length >= 250 || new Set(freshOwned.map(item => item.id)).size !== freshOwned.length
        || freshOwned.some(item => !plan.owned.some(ref => ref.definitionId === item.definitionId))) return blocked('FC27_CONCEPT_ITEMS_CHANGED', 'club-shape');
    const owned = plan.owned.map(expected => {
      const fresh = freshOwned.find(item => item.id === expected.id);
      const actual = fresh && project({ ...fresh, protected: fresh.protected ?? expected.protected });
      return same(actual, expected) ? actual : null;
    });
    if (owned.some(item => !item)) return blocked('FC27_CONCEPT_ITEMS_CHANGED', 'club-identity');
    return assess(current, plan.slots, owned, plan.purchases);
  } catch { return blocked('FC27_CONCEPT_PLAN_UNVERIFIED'); }
}
