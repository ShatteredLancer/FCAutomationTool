import { matchFc27SbcRequirements } from './sbc-requirements.js';

export const DEFAULT_PUZZLE_MAX_RATING = 82;

// User material protection, separate from EA eligibility: a minimum-quality
// squad keeps fillers at that quality and uses only the higher tiers required
// by explicit quality counts. Never upgrade fillers to solve other constraints.
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
