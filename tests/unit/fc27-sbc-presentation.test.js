import { expect, it } from 'vitest';
import { describeCatalogRule, describeCatalogRewards, describePreparedRequirement } from '../../src/fc27/sbc-presentation.js';

it('labels only reviewed requirement shapes and keeps unknown rows visible', () => {
  expect(describeCatalogRule({ count: -1, scope: 2, pairs: [{ key: 3, values: [3] }] })).toMatchObject({
    label: 'All players: Gold quality', recognized: true,
  });
  expect(describeCatalogRule({ count: 11, scope: 0, pairs: [{ key: 99, values: [4] }] })).toMatchObject({
    label: 'Unsupported requirement — retained for inspection', recognized: false,
  });
});

it('projects rewards without treating unknown fields as actionable', () => {
  expect(describeCatalogRewards([{ type: 'pack', value: 509, count: 1, tradable: false }]))
    .toBe('1 × pack 509 (untradeable)');
  expect(describePreparedRequirement({ kind: 'player-count', count: 11 })).toBe('11 players');
});
