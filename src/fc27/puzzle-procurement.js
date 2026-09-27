import { previewFc27PuzzleSquad } from './puzzle-preview.js';
import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { evaluateFc27PuzzleSquad } from './puzzle-evaluator.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements, createFc27ClubResolver } from './sbc-requirements.js';
import { puzzleMaterialRules } from './puzzle-material-policy.js';

const seeds = new WeakMap();
const stop = reason => ({ status: 'blocked', reason, executable: false, plans: [] });
const positive = value => Number.isSafeInteger(value) && value > 0;
const signature = input => JSON.stringify([input.context, input.challenge, input.policy, input.inventory, input.chemistry, input.clubLinks]);
const required = input => input.challenge.slotCount - input.challenge.brickIndices.length;
const poolOf = input => collectSafeTraditionalCandidates({ ...input, challenge: { ...input.challenge,
  mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required(input) }] } });
const factsOf = (input, squad) => evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
  chemistry: input.chemistry, rating: input.chemistry?.rating });
const quality = rating => rating < 65 ? 1 : rating < 75 ? 2 : 3;
const validSeed = (input, seed) => seeds.get(seed) === signature(input);

// A search anchor is explicitly NOT an eligible squad or a fill plan. Relax
// only a detached chemistry minimum to locate a near-solution; preserve the
// actual Challenge and every material/quality rule for candidate verification.
export function findFc27PuzzleRepairSeed(input) {
  const parsed = parseFc27SbcRequirements(input?.challenge?.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const chemistry = parsed.rules.filter(rule => rule.kind.endsWith('-chemistry'));
  if (chemistry.length !== 1 || chemistry[0].kind !== 'min-chemistry') return stop('FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE');
  const original = chemistry[0].value;
  for (let difference = 1; difference <= Math.min(4, original); difference++) {
    const challenge = structuredClone(input.challenge);
    const index = parsed.rules.indexOf(chemistry[0]);
    challenge.rawRequirements[index].pairs[0].values = [original - difference];
    const preview = previewFc27PuzzleSquad({ ...input, challenge, maxNodes: 50000 });
    if (preview.status !== 'preview') continue;
    const squad = Array(input.challenge.slotCount).fill(null);
    for (const ref of preview.selected) squad[ref.slot] = { ...structuredClone(input.inventory.items.find(item => item.id === ref.id)), slot: ref.slot };
    const facts = factsOf(input, squad);
    if (facts.status !== 'observed') return stop(facts.reason);
    const seed = { status: 'ready', executable: false, squad, teamFacts: facts, requiredChemistry: original };
    seeds.set(seed, signature(input));
    return seed;
  }
  return stop('FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE');
}

export function planFc27PuzzleRepairQueries(input, seed) {
  if (!validSeed(input, seed)) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  const players = seed.squad.filter(Boolean);
  const resolveClub = createFc27ClubResolver(input.clubLinks);
  const count = read => {
    const counts = new Map();
    for (const item of players) { const key = read(item); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  };
  const tier = count(item => quality(item.rating))[0]?.[0];
  const level = ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[tier];
  const clubs = count(item => resolveClub?.(item.teamId));
  const leagues = count(item => item.leagueId);
  const queries = [];
  if (positive(clubs[0]?.[0]) && clubs[0][1] >= 2) queries.push({ start: 0, count: 20, level, team: clubs[0][0] });
  for (const [league] of leagues) {
    if (queries.length >= 3) break;
    if (positive(league) && !input.policy.excludedLeagueIds.includes(league)) queries.push({ start: 0, count: 20, level, league });
  }
  return { status: 'ready', executable: false, queries, complete: false };
}

// Public catalog cards are hypothetical replacements, never owned entities.
// Owned cards continue through the unchanged untradeable-only safety filter.
// A resulting suggestion still needs exact purchase/material approval and a
// new inventory plan; it cannot be passed to the save transaction.
export function suggestFc27PuzzlePurchases(input, seed, entries, { maxChecks = 20000 } = {}) {
  if (!validSeed(input, seed)) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  if (!Array.isArray(entries) || entries.length > 60 || !Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 50000) return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  const pool = poolOf(input);
  if (pool.status !== 'candidates') return stop(pool.reason);
  if (seed.squad.some(item => item && !pool.candidates.some(candidate => candidate.id === item.id
      && JSON.stringify({ ...candidate, slot: item.slot }) === JSON.stringify(item)))) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const material = puzzleMaterialRules(parsed.rules, required(input));
  const owned = new Set(input.inventory.items.map(item => item.definitionId));
  const seen = new Set();
  const candidates = entries.filter(item => {
    if (!positive(item?.definitionId) || owned.has(item.definitionId) || seen.has(item.definitionId)) return false;
    seen.add(item.definitionId);
    return item.special === false && item.evolution === false && item.cosmetic === false && [0, 1].includes(item.rarity)
      && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= input.policy.maxRating
      && (item.rating < 75 || item.rating >= input.policy.goldRange[0] && item.rating <= input.policy.goldRange[1])
      && [item.nationId, item.leagueId, item.teamId].every(positive) && !input.policy.excludedLeagueIds.includes(item.leagueId)
      && Array.isArray(item.positions) && item.positions.length > 0 && item.positions.every(position => Number.isInteger(position) && position >= 0 && position <= 27)
      && Array.isArray(item.groups) && item.groups.every(group => Number.isInteger(group) && group >= 0);
  }).map(item => ({ definitionId: item.definitionId, rating: item.rating, rarity: item.rarity, nationId: item.nationId,
    ...(typeof item.displayName === 'string' && item.displayName.length <= 201 && !/[\u0000-\u001f]/.test(item.displayName)
      ? { displayName: item.displayName } : {}),
    leagueId: item.leagueId, teamId: item.teamId, positions: [...item.positions], groups: [...item.groups],
    special: false, evolution: false, cosmetic: false, type: 'player', concept: false, academyEnrolled: false,
    catalogRef: `fc27:${item.definitionId}` }));
  const slots = seed.squad.flatMap((item, index) => item ? [index] : []);
  const plans = []; const combinations = new Set(); let checks = 0;
  const assess = squad => {
    if (checks >= maxChecks) return;
    checks++;
    const players = squad.filter(Boolean);
    if (new Set(players.map(item => item.definitionId)).size !== players.length) return;
    if (material.length && matchFc27SbcRequirements({ requirements: material, squad: players }).status !== 'satisfied') return;
    const facts = factsOf(input, squad);
    if (facts.status !== 'observed') return;
    const validation = matchFc27SbcRequirements({ requirements: parsed.rules, squad: players,
      clubLinks: input.clubLinks, chemistry: facts.chemistry, teamRating: facts.teamRating });
    if (validation.status !== 'satisfied') return;
    const purchases = squad.flatMap((item, slot) => item?.catalogRef ? [{ ...item, slot, quantity: 1 }] : []);
    const key = purchases.map(item => item.definitionId).sort((a, b) => a - b).join(',');
    if (combinations.has(key)) return;
    combinations.add(key);
    plans.push({ executable: false, liveExecutionEnabled: false, purchaseCount: purchases.length,
      purchases, selectedOwned: squad.flatMap((item, slot) => item && !item.catalogRef ? [{ id: item.id,
        definitionId: item.definitionId, pile: item.pile, rating: item.rating, slot }] : []),
      teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating },
      requirementCount: parsed.rules.length, requiresPurchasedMaterialApproval: true, marketAvailabilityVerified: false });
  };
  for (const card of candidates) for (const removed of slots) for (const target of slots) {
    if (checks >= maxChecks) break;
    const squad = seed.squad.slice();
    squad[removed] = squad[target]; squad[target] = card;
    assess(squad);
  }
  // Only search two-card substitutions when one-card substitutions failed.
  // A bounded sample never proves a globally minimal purchase count.
  if (!plans.length) for (let a = 0; a < Math.min(12, candidates.length); a++) for (let b = a + 1; b < Math.min(12, candidates.length); b++) {
    for (const first of slots) for (const second of slots) {
      if (first === second || checks >= maxChecks) continue;
      const squad = seed.squad.slice(); squad[first] = candidates[a]; squad[second] = candidates[b]; assess(squad);
    }
  }
  plans.sort((a, b) => a.purchaseCount - b.purchaseCount || b.teamFacts.chemistry - a.teamFacts.chemistry
    || a.purchases.reduce((n, card) => n + card.rating, 0) - b.purchases.reduce((n, card) => n + card.rating, 0));
  return { status: plans.length ? 'suggested' : 'blocked', reason: plans.length ? 'FC27_PURCHASE_SUGGESTIONS_READY' : 'FC27_PURCHASE_REPAIR_NO_PLAN',
    executable: false, plans: plans.slice(0, 8), checks, truncated: checks >= maxChecks || plans.length > 8,
    marketWideInfeasibilityProven: false };
}
