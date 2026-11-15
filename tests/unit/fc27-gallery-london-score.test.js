import { expect, it } from 'vitest';
import london from '../fixtures/fc27-gallery-london-score.json';
import { compileGalleryScoringRules, evaluateGalleryLineup, summarizeGalleryScore,
  createGalleryScoreSummarizer } from '../../src/gallery/scoring.js';

const catalog = { source: 'futgg', tags: london.tags };
const compiled = compileGalleryScoringRules(catalog);
const rowsFor = silverId => {
  const firstOwned = new Set([...london.scenario.sharedFirstOwnedIds, silverId]);
  return london.rows.map(values => {
    const row = Object.fromEntries(london.columns.map((field, i) => [field, values[i]]));
    return { ...row, gradingScore: row.score, collected: true, firstOwned: firstOwned.has(row.eaId) };
  });
};
const inputFor = rows => ({ catalog, set: london.set,
  progress: { season: '27', setId: 25, complete: true, rows } });

it.each(london.scenario.oneSilverFirstOwnedAlternatives)(
  'reconstructs both London screenshot totals with explicit alternative FO input %s, without asserting account ownership', silverId => {
    const rows = rowsFor(silverId), before = structuredClone(rows);
    const ea = evaluateGalleryLineup(rows, compiled);
    const changed = rows.map(row => row.eaId === london.scenario.extraFirstOwnedId ? { ...row, firstOwned: true } : row);
    const fcat = evaluateGalleryLineup(changed, compiled);
    for (const [score, expected] of [[ea, london.expected.ea], [fcat, london.expected.fcat]]) {
      expect({ base: score.base, bonus: score.bonus, total: score.total })
        .toEqual({ base: expected.base, bonus: expected.bonus, total: expected.total });
      expect(score.tags.filter(tag => tag.counted)).toHaveLength(10);
      expect(score.tags.filter(tag => tag.counted && tag.id !== 1).reduce((sum, tag) => sum + tag.bonus, 0))
        .toBe(london.expected.otherCountedBonuses);
    }
    expect(ea.tags.find(tag => tag.id === 1)).toMatchObject({ count: 8, matched: 12065, pct: 150, bonus: 18097 });
    expect(fcat.tags.find(tag => tag.id === 1)).toMatchObject({ count: 9, matched: 17565, pct: 150, bonus: 26347 });
    expect(fcat.total - ea.total).toBe(london.expected.difference);
    expect(fcat.tags.filter(tag => tag.id !== 1)).toEqual(ea.tags.filter(tag => tag.id !== 1));
    expect(summarizeGalleryScore(inputFor(rows))).toMatchObject({ full: true, grade: 'A', selection: 'all-collected' });
    expect(summarizeGalleryScore(inputFor(changed))).toMatchObject({ full: true, grade: 'S', selection: 'all-collected' });
    expect(rows).toEqual(before);
  });

it('keeps uncertain Diani ownership as the same-lineup A–S interval instead of a confirmed S', () => {
  const rows = rowsFor(london.scenario.oneSilverFirstOwnedAlternatives[0]).map(row =>
    row.eaId === london.scenario.extraFirstOwnedId ? { ...row, firstOwned: null } : row);
  const result = summarizeGalleryScore(inputFor(rows));
  expect(result).toMatchObject({ status: 'uncertain', full: true, grade: null, lowGrade: 'A', highGrade: 'S',
    low: { total: 37662 }, high: { total: 45912 }, unknownFields: ['firstOwned'] });
  expect(result.low.lineupIds).toEqual(result.high.lineupIds);
});

it('shows a wide interval when only four first-owner cards remain verified, without claiming the lower bound is the EA score', () => {
  // Sparse-history characterization using public cards; not a recovery of account ownership.
  const unknownIds = new Set([236479, 227361, 232202, 272213, 272185]);
  const rows = rowsFor(272185).map(row => unknownIds.has(row.eaId) ? { ...row, firstOwned: null } : row);
  const result = summarizeGalleryScore(inputFor(rows));
  expect(result).toMatchObject({ status: 'uncertain', grade: null, lowGrade: 'C', highGrade: 'S',
    low: { base: 17745, bonus: 1826, total: 19571 }, high: { total: 45912 } });
  expect(result.low.tags.find(tag => tag.id === 1)).toMatchObject({ count: 4, unknown: 5, bonus: 0, next: { at: 5 } });
  expect(result.low.total).toBeLessThan(37662);
  expect(result.high.total).toBeGreaterThan(37662);
});

it('recomputes a changed FO input in a reused scorer without changing the 15-card base or relying on a score cache', () => {
  const score = createGalleryScoreSummarizer(catalog, { summaryCacheSize: 64, fastTotals: true });
  const rows = rowsFor(london.scenario.oneSilverFirstOwnedAlternatives[0]);
  const input = inputFor(rows);
  expect(score(input).low.total).toBe(37662);
  rows.find(row => row.eaId === london.scenario.extraFirstOwnedId).firstOwned = true;
  expect(score(input).low).toMatchObject({ base: 17745, total: 45912 });
  rows.find(row => row.eaId === london.scenario.extraFirstOwnedId).firstOwned = null;
  expect(score(input)).toMatchObject({ grade: null, low: { total: 37662 }, high: { total: 45912 } });
});
