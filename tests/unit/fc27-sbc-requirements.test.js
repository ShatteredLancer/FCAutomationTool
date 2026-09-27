import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

const catalog = JSON.parse(readFileSync(new URL('../fixtures/fc27-production-panel-catalog-observation.json', import.meta.url), 'utf8'));
const raw = challenge => challenge.requirements;
const clubLinks = { schema: 1, complete: true, links: [] };

it('parses the observed Marquee Matchups nation, distinct-club, silver and chemistry rules', () => {
  const challenge = catalog.catalog.challenges.find(value => value.id === 43);
  const result = parseFc27SbcRequirements(raw(challenge), 11);
  expect(result.status).toBe('observed');
  expect(result.rules).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'from-nations', ids: [27, 7], count: 1 }),
    expect.objectContaining({ kind: 'distinct-clubs', value: 3, mode: 'min' }),
    expect.objectContaining({ kind: 'quality-count', qualities: [2], mode: 'min', count: 3 }),
    expect.objectContaining({ kind: 'min-quality', quality: 1, minRating: 1, count: 11 }),
    expect.objectContaining({ kind: 'min-chemistry', value: 14 }),
  ]));
});

const row = (key, value, count = -1, scope = 0) => ({ count, scope, pairs: [{ key, values: [value] }] });
const match = (raw, squad, facts = {}) => matchFc27SbcRequirements({
  requirements: parseFc27SbcRequirements(raw, squad.length).rules, squad, clubLinks, ...facts,
});

it.each([10, 11, 12, 17, 18, 25, 26, 27, 28])('honours max/exact counts for key %s', key => {
  const value = { 10: 1, 11: 1, 12: 1, 17: 2, 18: 1, 25: 83, 26: 65, 27: 65, 28: 65 }[key];
  const player = { rating: 65, nationId: 1, leagueId: 1, clubId: 1, rarity: 1, groups: [83] };
  expect(match([row(key, value, 1, 1)], [player, player]).satisfied).toBe(false);
  expect(match([row(key, value, 1, 2)], [player, player]).satisfied).toBe(false);
  expect(match([row(key, value, 2, 2)], [player, player]).satisfied).toBe(true);
});

it.each([19, 35])('honours max/exact team facts for key %s', key => {
  const fact = key === 19 ? 'teamRating' : 'chemistry';
  expect(match([row(key, 20, -1, 1)], [{}], { [fact]: 21 }).satisfied).toBe(false);
  expect(match([row(key, 20, -1, 2)], [{}], { [fact]: 21 }).satisfied).toBe(false);
  expect(match([row(key, 20, -1, 2)], [{}], { [fact]: 20 }).satisfied).toBe(true);
});

it.each([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 25, 26, 27, 28])('blocks missing attributes for key %s', key => {
  const count = [3, 4, 5, 6, 7, 8, 9].includes(key) ? -1 : 1;
  expect(match([row(key, 1, count, 1)], [{}]).reason).toBe('FC27_REQUIREMENT_VALUE_UNAVAILABLE');
});

it('does not substitute Gold for a Silver count or trust stale groups over a live matcher', () => {
  expect(match([row(17, 2, 1)], [{ rating: 80 }]).satisfied).toBe(false);
  expect(match([row(25, 83, 1)], [{ groups: [83] }], { groupMatcher: () => false }).satisfied).toBe(false);
  expect(match([row(25, 83, 1)], [{ groups: [83] }], { groupMatcher: () => undefined }).reason)
    .toBe('FC27_REQUIREMENT_VALUE_UNAVAILABLE');
});

it('counts the largest same-club group and checks zero/exact upper limits', () => {
  const squad = [1, 1, 2].map(clubId => ({ clubId }));
  expect(match([row(6, 1, -1, 1)], squad).satisfied).toBe(false);
  expect(match([row(6, 2, -1, 2)], squad).satisfied).toBe(true);
  expect(match([row(12, 3, 0, 2)], squad).satisfied).toBe(true);
  expect(match([row(12, 1, 0, 1)], squad).satisfied).toBe(false);
});

it('retains every pair of a combined rule without interpreting it as a single predicate', () => {
  const combined = { count: 2, scope: 0, pairs: [{ key: 10, values: [27] }, { key: 17, values: [2] }] };
  const result = parseFc27SbcRequirements([combined], 11);
  expect(result.status).toBe('unsupported');
  expect(result.rules[0].source.pairs).toEqual(combined.pairs);
  expect(combined).toEqual({ count: 2, scope: 0, pairs: [{ key: 10, values: [27] }, { key: 17, values: [2] }] });
});

it.each([row(10, 1), row(17, 2), row(19, 75, 1), row(9, 3, 1),
  { ...row(9, 3), pairs: [{ key: 9, values: [3, 4] }] }, row(3, 1, -1, 3)])('rejects an unreviewed rule shape', rule => {
  expect(parseFc27SbcRequirements([rule], 11).status).toBe('unsupported');
});

it('never passes empty requirements, a partial squad or missing slots', () => {
  expect(parseFc27SbcRequirements([], 11).status).toBe('blocked');
  const requirements = parseFc27SbcRequirements([row(3, 1)], 11).rules;
  expect(matchFc27SbcRequirements({ requirements, squad: [{ rating: 60 }] }).satisfied).toBe(false);
  expect(matchFc27SbcRequirements({ requirements: [], squad: [] }).satisfied).toBe(false);
  expect(matchFc27SbcRequirements({ requirements, squad: Array(11) }).satisfied).toBe(false);
});

it.each([null, { count: 1, scope: 0, pairs: [{ key: 10, values: 7 }] },
  { count: 1, scope: 0, pairs: [{ key: 10, values: [7, 7] }] }])('blocks malformed or double-counting input without throwing', raw => {
  expect(parseFc27SbcRequirements([raw], 11).status).toBe('unsupported');
});

it('retains unknown EA rules as unsupported instead of guessing from names', () => {
  const result = parseFc27SbcRequirements([{ count: -1, scope: 0, pairs: [{ key: 999, values: [1] }] }], 11);
  expect(result).toMatchObject({ status: 'unsupported', reason: 'FC27_REQUIREMENT_UNSUPPORTED' });
  expect(result.unsupported[0].source).toMatchObject({ key: 999, values: [1], count: -1 });
});

it('matches exact item attributes and injected team facts without side effects', () => {
  const parsed = parseFc27SbcRequirements([
    { count: 1, scope: 0, pairs: [{ key: 10, values: [27, 7] }] },
    { count: -1, scope: 0, pairs: [{ key: 9, values: [3] }] },
    { count: 3, scope: 0, pairs: [{ key: 17, values: [2] }] },
    { count: -1, scope: 0, pairs: [{ key: 3, values: [1] }] },
    { count: -1, scope: 0, pairs: [{ key: 35, values: [14] }] },
  ], 11);
  const squad = [
    { rating: 60, nationId: 27, clubId: 1 }, { rating: 65, nationId: 7, clubId: 2 },
    { rating: 66, nationId: 8, clubId: 3 }, { rating: 67, nationId: 9, clubId: 4 },
    { rating: 68, nationId: 10, clubId: 5 }, { rating: 64, nationId: 11, clubId: 6 },
    { rating: 64, nationId: 12, clubId: 7 }, { rating: 63, nationId: 13, clubId: 8 },
    { rating: 62, nationId: 14, clubId: 9 }, { rating: 61, nationId: 15, clubId: 10 },
    { rating: 60, nationId: 16, clubId: 11 },
  ];
  expect(matchFc27SbcRequirements({ requirements: parsed.rules, squad, clubLinks, chemistry: 14 }).status).toBe('satisfied');
  expect(matchFc27SbcRequirements({ requirements: parsed.rules, squad, clubLinks, chemistry: 13 }).reason)
    .toBe('FC27_REQUIREMENTS_NOT_MET');
  expect(matchFc27SbcRequirements({ requirements: parsed.rules, squad, clubLinks }).reason)
    .toBe('FC27_REQUIREMENT_VALUE_UNAVAILABLE');
});

it('merges linked clubs for counts and identities, and rejects absent or partial maps', () => {
  const squad = [{ teamId: 11 }, { teamId: 1111 }];
  const linked = { schema: 1, complete: true, links: [[1111, 11]] };
  expect(match([row(9, 2)], squad, { clubLinks: linked }).satisfied).toBe(false);
  expect(match([row(6, 1, -1, 1)], squad, { clubLinks: linked }).satisfied).toBe(false);
  expect(match([row(12, 1111, 2)], squad, { clubLinks: linked }).satisfied).toBe(true);
  expect(match([row(9, 2)], squad, { clubLinks: null }).reason).toBe('FC27_REQUIREMENT_VALUE_UNAVAILABLE');
  expect(match([row(9, 2)], squad, { clubLinks: { ...linked, complete: false } }).satisfied).toBe(false);
});
