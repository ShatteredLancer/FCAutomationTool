import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

// Exercise the actual entry wiring without starting the userscript or EA calls.
const source = readFileSync(new URL('../../src/fc27/production-entry.js', import.meta.url), 'utf8');
const start = source.indexOf('const galleryAssets = Object.freeze({');
const end = source.indexOf('// Presentation only:', start);
const assets = runInNewContext(`${source.slice(start, end)}; galleryAssets`, {
  unsafeWindow: { AssetLocationUtils: {
    FILTER: { LEAGUE: 'league', RARITY: 'rarity', CLUB: 'club' },
    getFilterImage: (kind, id) => `https://ea.test/${kind}/${id}.png`,
    getShellUri: (size, type, id, tier, guid) => `https://ea.test/shell/${size}/${type}/${id}/${tier}/${guid}.png`,
  }, ItemViewSize: { LARGE: 'large' }, ItemRatingTier: { GOLD: 'gold', NONE: 'none' },
  repositories: { TeamConfig: { getTeams: () => [{ id: 1, name: 'Arsenal' }, { id: 10, name: 'Premier League' }] },
    Rarity: { get: id => id === 404 ? null : ({ id, levels: false, getGuid: () => 'guid' }) } },
  factories: { DataProvider: { getLeagueDP: () => [{ id: 888, label: 'New Local League' }] } } },
});

// Public FUT.GG Gallery client yR: Bundesliga=19, Frauen-Bundesliga=2215.
// 2221 is the NWSL emblem reported in the failing category screenshot.
it('shows Bundesliga and Frauen-Bundesliga emblems in the German category', () => {
  expect(assets.category('bundesliga', 'Bundesliga / Frauen-Bundesliga')).toEqual([
    'https://ea.test/league/19.png', 'https://ea.test/league/2215.png',
  ]);
  expect(assets.category('germany')).toEqual(assets.category('bundesliga'));
});

it('uses the German women league emblem in the Leagues overview too', () => {
  expect(assets.category('leagues')).toContain('https://ea.test/league/2215.png');
  expect(assets.category('leagues')).not.toContain('https://ea.test/league/2221.png');
});

it('keeps explicit league IDs separate and preserves other categories', () => {
  expect(assets.league(2221)).toBe('https://ea.test/league/2221.png');
  expect(assets.league(2215)).toBe('https://ea.test/league/2215.png');
  expect(assets.category('england')).toEqual([
    'https://ea.test/league/13.png', 'https://ea.test/league/2216.png',
  ]);
  expect(assets.category('unknown')).toEqual([]);
});

it('uses league icons for league sets before pools load, never a matching team name', () => {
  expect(assets.set('Premier League', { slug: 'leagues' }, { slug: 'premier-league' })).toEqual(['https://ea.test/league/13.png']);
  expect(assets.set('Frauen-Bundesliga', { slug: 'leagues' }, { slug: 'frauen-bundesliga' })).toEqual(['https://ea.test/league/2215.png']);
});

it('uses Enhancer shell assets for the Rarities category overview', () => {
  const icons = assets.category('rarities', 'Rarities', [
    { name: 'Heroes', slug: 'heroes' }, { name: 'Holographics', slug: 'holographics' },
    { name: 'Heroes duplicate', slug: 'heroes' },
  ]);
  expect(Array.from(icons)).toEqual(['https://ea.test/shell/large/1/72/none/guid.png', 'https://ea.test/shell/large/1/12/none/guid.png']);
  expect(icons.every(value => value.startsWith('https://ea.test/shell/large/1/'))).toBe(true);
  expect(icons).not.toContain('https://ea.test/rarity/1.png');
  expect(Array.from(assets.category('rarities', 'Rarities'))).toEqual([]);
  expect(Array.from(assets.category('rarities', 'Rarities', [{ name: 'Future', conditions: { rareflags: [180] } }])) )
    .toEqual(['https://ea.test/shell/large/1/180/none/guid.png']);
});

it('preserves club sets and uses rarity icons for rarity sets', () => {
  expect(assets.set('Arsenal', { slug: 'england' }, { slug: 'arsenal' })).toEqual(['https://ea.test/club/1.png']);
  expect(assets.set('Heroes', { slug: 'rarities' }, { slug: 'heroes' })).toEqual(['https://ea.test/shell/large/1/72/none/guid.png']);
  expect(assets.set('Holographics', { slug: 'rarities' }, { slug: 'holographics' })).toEqual(['https://ea.test/shell/large/1/12/none/guid.png']);
});

it('resolves new league sets from a uniform loaded pool and leaves unknown/mixed sets as text', () => {
  const category = { slug: 'leagues' }, set = { slug: 'new-league' };
  expect(assets.set('New League', category, set, [{ leagueEaId: 999, clubEaId: 1 }, { leagueEaId: 999, clubEaId: 2 }]))
    .toEqual(['https://ea.test/league/999.png']);
  expect(assets.set('New League', category, set, [{ leagueEaId: 999, clubEaId: 1 }, { leagueEaId: 13, clubEaId: 2 }])).toEqual([]);
  expect(assets.set('New League', category, set)).toEqual([]);
  expect(assets.set('New Local League', category, { slug: 'new-local-league' })).toEqual(['https://ea.test/league/888.png']);
});

it('uses public condition IDs and falls back to text for missing EA rarity definitions', () => {
  expect(assets.set('Localized league', { slug: 'leagues' }, { conditions: { leagues: [777] } })).toEqual(['https://ea.test/league/777.png']);
  expect(assets.set('Unknown rarity', { slug: 'rarities' }, { conditions: { rareflags: [404] } })).toEqual([]);
});
