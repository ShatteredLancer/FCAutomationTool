import { matchFc27SbcRequirements } from './sbc-requirements.js';

export const DEFAULT_PUZZLE_MAX_RATING = 82;

// Preferred low-quality composition, not an extra EA eligibility requirement.
// Search this vector first; a native-quality fallback can use higher safe
// materials when necessary. Never use it to reject a final native-valid squad.
export function puzzleMaterialRules(rules, required) {
  if (!rules.some(rule => rule.kind === 'min-quality')) return [];
  const qualityRules = rules.filter(rule => ['all-quality', 'min-quality', 'max-quality', 'quality-count'].includes(rule.kind));
  // At most 78 quality-count vectors for eleven slots, not player combinations.
  // Minimize gold first, then silver, without changing the native rule objects.
  for (let gold = 0; gold <= required; gold++) {
    for (let silver = 0; silver <= required - gold; silver++) {
      const counts = [required - silver - gold, silver, gold];
      const squad = counts.flatMap((count, index) => Array.from({ length: count }, () => ({ quality: index + 1 })));
      if (matchFc27SbcRequirements({ requirements: qualityRules, squad }).status !== 'satisfied') continue;
      return counts.map((count, index) => ({ kind: 'quality-count', qualities: [index + 1], mode: 'exact', count,
        source: { policy: 'minimum-quality-fillers', quality: index + 1, required } }));
    }
  }
  // Inconsistent native quality rules remain unsatisfiable in the native matcher.
  return [];
}

// Bounded quality-vector feasibility only. Do not spend another search slice
// if native exact/max counts or the safe pool already rule out every upgrade.
export function puzzleHasQualityAlternative(rules, required, candidates, preferred) {
  if (!preferred.length) return false;
  const counts = [1,2,3].map(quality => new Set(candidates.filter(item =>
    (item.rating < 65 ? 1 : item.rating < 75 ? 2 : 3) === quality).map(item => item.definitionId)).size);
  const native = rules.filter(rule => ['all-quality','min-quality','max-quality','quality-count'].includes(rule.kind));
  for (let gold = 0; gold <= Math.min(required, counts[2]); gold++) for (let silver = 0; silver <= Math.min(required-gold,counts[1]); silver++) {
    const vector = [required-gold-silver,silver,gold];
    if (vector[0] > counts[0] || vector.every((count,index) => count === preferred[index].count)) continue;
    const squad = vector.flatMap((count,index) => Array.from({length:count},()=>({quality:index+1})));
    if (matchFc27SbcRequirements({requirements:native,squad}).status === 'satisfied') return true;
  }
  return false;
}
