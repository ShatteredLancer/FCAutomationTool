import { matchFc27SbcRequirements } from './sbc-requirements.js';

export const DEFAULT_PUZZLE_MAX_RATING = 82;

// Preferred low-quality composition, not an extra EA eligibility requirement.
// Search this vector first; a native-quality fallback can use higher safe
// materials when necessary. Never use it to reject a final native-valid squad.
export function puzzleMaterialRules(rules, required) {
  return puzzleMaterialRuleVectors(rules, required)[0] ?? [];
}

// All native-eligible quality compositions, ordered from lowest quality cost
// upward. A single preferred vector is only a useful hint: chemistry can make
// (for example) an all-silver squad impossible while a silver/gold mix works.
// Keep the native requirements untouched and let the full evaluator decide.
export function puzzleMaterialRuleVectors(rules, required) {
  const qualityRules = rules.filter(rule => ['all-quality', 'min-quality', 'max-quality', 'quality-count'].includes(rule.kind));
  const overallRules = rules.filter(rule => ['player-min-overall', 'player-max-overall'].includes(rule.kind));
  const fullOverallRules = overallRules.filter(rule => rule.count === required);
  // A full-squad overall floor/ceiling also expresses the allowed quality
  // tiers. Compute it before deciding whether there is a useful preference:
  // many EA "minimum Silver" puzzles have only key 26 and no key 3/17 rule.
  // Returning early for those requirements made the ordinary preview pick
  // any feasible all-gold squad.
  const minimumTier = Math.max(1, ...fullOverallRules
    .filter(rule => rule.kind === 'player-min-overall')
    .map(rule => rule.value >= 75 ? 3 : rule.value >= 65 ? 2 : 1));
  const maximumTier = Math.min(3, ...fullOverallRules
    .filter(rule => rule.kind === 'player-max-overall')
    .map(rule => rule.value < 65 ? 1 : rule.value < 75 ? 2 : 3));
  // Key 17 represents "at least N gold/silver" and key 3 represents the
  // older quality selector. Either that rule set or a full-squad overall
  // floor/ceiling can guide a low-tier-first search. This remains only a
  // preference; native eligibility is still checked against the original
  // rules and full EA evaluator.
  if (!qualityRules.length && !fullOverallRules.length) return [];
  // At most 78 quality-count vectors for eleven slots, not player combinations.
  // Minimize gold first, then silver, without changing the native rule objects.
  const vectors = [];
  for (let gold = 0; gold <= required; gold++) {
    for (let silver = 0; silver <= required - gold; silver++) {
      const counts = [required - silver - gold, silver, gold];
      if (counts.slice(0, minimumTier - 1).some(count => count > 0)
          || counts.slice(maximumTier).some(count => count > 0)) continue;
      // Overall floors/ceilings participate in the *preference vector* only
      // when they apply to every slot. Use tier boundary ratings so this is a
      // conservative mapping (bronze 64, silver 65, gold 75); the original EA
      // evaluator still validates the actual chosen cards later.
      const representativeRating = [64, 65, 75];
      const squad = counts.flatMap((count, index) => Array.from({ length: count }, () => ({
        quality: index + 1, rating: representativeRating[index],
      })));
      if (matchFc27SbcRequirements({ requirements: [...qualityRules, ...fullOverallRules], squad }).status !== 'satisfied') continue;
      vectors.push(counts.map((count, index) => ({ kind: 'quality-count', qualities: [index + 1], mode: 'exact', count,
        source: { policy: 'minimum-quality-fillers', quality: index + 1, required } })));
    }
  }
  // Inconsistent native quality rules remain unsatisfiable in the native matcher.
  return vectors;
}

// Bounded quality-vector feasibility only. Do not spend another search slice
// if native exact/max counts or the safe pool already rule out every upgrade.
export function puzzleHasQualityAlternative(rules, required, candidates, preferred) {
  if (!preferred.length) return false;
  const counts = [1,2,3].map(quality => new Set(candidates.filter(item =>
    (item.rating < 65 ? 1 : item.rating < 75 ? 2 : 3) === quality).map(item => item.definitionId)).size);
  const native = rules.filter(rule => ['all-quality','min-quality','max-quality','quality-count',
    'player-min-overall','player-max-overall'].includes(rule.kind));
  for (let gold = 0; gold <= Math.min(required, counts[2]); gold++) for (let silver = 0; silver <= Math.min(required-gold,counts[1]); silver++) {
    const vector = [required-gold-silver,silver,gold];
    if (vector[0] > counts[0] || vector.every((count,index) => count === preferred[index].count)) continue;
    const representativeRating = [64, 65, 75];
    const squad = vector.flatMap((count,index) => Array.from({length:count},()=>({quality:index+1,rating:representativeRating[index]})));
    if (matchFc27SbcRequirements({requirements:native,squad}).status === 'satisfied') return true;
  }
  return false;
}
