import { expect, it } from 'vitest';
import { puzzleBuyMatchesSlots, puzzleBuySlotRefs } from '../../src/fc27/puzzle-buy-slots.js';

it('accepts all asynchronous subsets of six acknowledged native replacements, not just all or none', () => {
  const record = { base: { slots: Array.from({ length: 6 }, (_, slot) => ({ slot, kind: 'concept', definitionId: 100 + slot })) },
    applied: [], entries: Array.from({ length: 6 }, (_, slot) => ({ slot, state: 'club', definitionId: 100 + slot, itemId: 200 + slot })) };
  const old = puzzleBuySlotRefs(record.base), next = puzzleBuySlotRefs(record.base, record.entries);
  for (let mask = 0; mask < 64; mask++) {
    expect(puzzleBuyMatchesSlots(record, old.map((slot, i) => mask & (1 << i) ? next[i] : slot))).toBe(true);
  }
  expect(puzzleBuyMatchesSlots(record, [{ ...next[0], id: 999 }, ...old.slice(1)])).toBe(false);
  expect(puzzleBuyMatchesSlots(record, [null, ...old.slice(1)])).toBe(false);
  expect(puzzleBuyMatchesSlots(record, [old[1], old[0], ...old.slice(2)])).toBe(false);
});
