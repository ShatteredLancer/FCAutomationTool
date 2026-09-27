import { expect, it } from 'vitest';
import { puzzleMaterialRules } from '../../src/fc27/puzzle-material-policy.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

const row = (key, values, count = -1, scope = 0) => ({ count, scope, pairs: [{ key, values }] });
const parse = rows => parseFc27SbcRequirements(rows, 11).rules;
it.each([
  { rows: [row(3, [1])], counts: [11, 0, 0] },
  { rows: [row(3, [2])], counts: [0, 11, 0] },
  { rows: [row(3, [3])], counts: [0, 0, 11] },
  { rows: [row(3, [2]), row(17, [3], 2)], counts: [0, 9, 2] },
  { rows: [row(3, [1]), row(17, [2], 3), row(17, [3], 2)], counts: [6, 3, 2] },
  { rows: [row(3, [2]), row(17, [2], 8, 1)], counts: [0, 8, 3] },
  { rows: [row(3, [1]), row(17, [2, 3], 4)], counts: [7, 4, 0] },
])('derives the cheapest tier composition from native quality rules: $counts', ({ rows, counts }) => {
  const rules = parse(rows); const before = structuredClone(rules);
  expect(puzzleMaterialRules(rules, 11).map(rule => rule.count)).toEqual(counts);
  expect(rules).toEqual(before);
});

it('keeps native eligibility distinct from the user protection against extra gold', () => {
  const rules = parse([row(3, [2]), row(17, [3], 2)]);
  const squad = Array.from({ length: 11 }, (_, i) => ({ rating: i < 3 ? 80 : 70 }));
  expect(matchFc27SbcRequirements({ requirements: rules, squad }).status).toBe('satisfied');
  expect(matchFc27SbcRequirements({ requirements: puzzleMaterialRules(rules, 11), squad }).status).toBe('unsatisfied');
});

it('does not invent an all-bronze restriction for a squad with no minimum-quality rule', () => {
  expect(puzzleMaterialRules(parse([row(19, [80])]), 11)).toEqual([]);
});
