import { expect, it, vi } from 'vitest';
import { readFc27PuzzleChemistry, validateFc27PuzzleSelection } from '../../src/adapters/ea/fc27-puzzle-read.js';

function fixture({ inherited = false, profilesEnabled = true, floatCalculationEnabled = false } = {}) {
  const keys = { CHEMISTRY_PROFILES_ENABLED: 'chemistry', SQUAD_RATING_FLOAT_CALCULATION_ENABLED: 'rating', SUPER_CHEM_RARITY_IDS: 'super' };
  const feature = vi.fn(function (key) { return this.flags[key]; });
  const stringSetting = vi.fn(function (key) { return this.strings[key]; });
  const configuration = Object.assign(inherited ? Object.create({ checkFeatureEnabled: feature }) : { checkFeatureEnabled: feature },
    { flags: { chemistry: profilesEnabled, rating: floatCalculationEnabled } });
  const serverSettings = Object.assign(inherited ? Object.create({ getStringSettingByKey: stringSetting }) : { getStringSettingByKey: stringSetting },
    { strings: { super: '' } });
  const root = { UTServerSettingsRepository: { KEY: keys }, services: { Configuration: configuration },
    UTItemEntity: { LEGENDS_CLUB_ID: 9001, LEGENDS_LEAGUE_ID: 9002, LEAGUE_HERO_CLUB_ID: 9003, HALL_OF_FUT_CLUB_ID: 9004 },
    repositories: { ServerSettings: serverSettings, Chemistry: {
      parameters: [1, 2, 3].map(id => ({ id, thresholds: [{ requirement: 2, points: 1 }] })),
      profiles: [{ id: 1, maxChem: false, baseOverride: false, applicableRarityIds: [],
        rules: [1, 2, 3].map(parameterId => ({ parameterId, calculationType: 1, contribution: 1 })) }],
    } } };
  const links = { schema: 1, complete: true, links: [] };
  return { root, links, feature, stringSetting, configuration, serverSettings };
}

it.each([false, true])('reads explicit chemistry and rating flags with inherited methods=%s', inherited => {
  const value = fixture({ inherited, floatCalculationEnabled: true });
  expect(readFc27PuzzleChemistry(value.root, value.links)).toMatchObject({ profilesEnabled: true,
    rating: { floatCalculationEnabled: true }, profiles: { complete: true }, superChemRarityIds: [] });
  expect(value.feature.mock.calls).toEqual([['chemistry'], ['rating']]);
  expect(value.stringSetting.mock.calls).toEqual([['super']]);
});

it('preserves explicit false feature flags rather than inferring missing flags as false', () => {
  const value = fixture({ profilesEnabled: false });
  expect(readFc27PuzzleChemistry(value.root, value.links)).toMatchObject({ profilesEnabled: false,
    rating: { floatCalculationEnabled: false }, profiles: null });
  delete value.configuration.flags.rating;
  expect(readFc27PuzzleChemistry(value.root, value.links)).toBeNull();
});

it('does not invoke accessor methods or bypass a shadowing accessor', () => {
  for (const key of ['checkFeatureEnabled', 'getStringSettingByKey']) {
    const value = fixture({ inherited: true }); const getter = vi.fn();
    Object.defineProperty(key === 'checkFeatureEnabled' ? value.configuration : value.serverSettings, key, { get: getter });
    expect(readFc27PuzzleChemistry(value.root, value.links)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(value.feature).not.toHaveBeenCalled();
    expect(value.stringSetting).not.toHaveBeenCalled();
  }
});

it('rejects missing identity, incomplete profiles, invalid flags and malformed super-chemistry settings', () => {
  for (const mutate of [
    x => { delete x.root.UTItemEntity.HALL_OF_FUT_CLUB_ID; },
    x => { x.root.repositories.Chemistry.profiles[0].rules.pop(); },
    x => { x.configuration.flags.chemistry = 1; },
    x => { x.serverSettings.strings.super = '1,,2'; },
    x => { x.serverSettings.strings.super = '1,1'; },
    x => { x.serverSettings.strings.super = null; },
  ]) {
    const value = fixture(); mutate(value);
    expect(readFc27PuzzleChemistry(value.root, value.links)).toBeNull();
  }
});

it('requires fresh exact Club facts before a Puzzle plan can proceed', () => {
  const plan = [{ id: 101, definitionId: 201, rating: 61, pile: 'club', slot: 0 },
    { id: 102, definitionId: 202, rating: 62, pile: 'club', slot: 1 }];
  const current = plan.map(item => ({ ...item, type: 'player', pile: 'club', special: false,
    evolution: false, cosmetic: false, concept: false, academyEnrolled: false, activeTrade: false,
    limitedUse: false, loans: -1, tradeable: false, rarity: 0, nationId: 27, leagueId: 1,
    teamId: 1, positions: [5], groups: [], state: 'free', locked: null, activeSquad: null, protected: false }));
  expect(validateFc27PuzzleSelection(plan, current, current)).toMatchObject({ status: 'verified', selectedCount: 2,
    presentCount: 2, uniqueDefinitions: true });
  for (const mutate of [
    items => { items[0].rating = 74; },
    items => { items[0].definitionId = 999; },
    items => { items[0].tradeable = true; },
    items => { items[1].pile = 'storage'; },
    items => { items[1].loans = 0; },
    items => { items[0].nationId = 7; },
    items => { items[0].leagueId = 2; },
    items => { items[0].teamId = 2; },
    items => { items[0].positions = [3]; },
    items => { items[0].groups = [83]; },
    items => { items[0].rarity = 1; },
    items => { items[0].locked = true; },
    items => { items[0].activeSquad = true; },
    items => { items.push({ ...items[0] }); },
    items => { items.push({ ...items[0], id: 999, definitionId: 999 }); },
    items => { items.splice(0, 1); },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    expect(validateFc27PuzzleSelection(plan, changed, current)).toMatchObject({ status: 'blocked', reason: 'FC27_EXACT_ITEMS_CHANGED' });
  }
  expect(validateFc27PuzzleSelection(plan, current)).toMatchObject({ status: 'blocked' });
  expect(validateFc27PuzzleSelection(plan, [...current, { ...current[0], id: 999 }], current).status).toBe('verified');
  const fullPage = Array.from({ length: 250 }, (_, i) => ({ ...current[0], id: 1000 + i }));
  fullPage[0] = current[0]; fullPage[1] = current[1];
  expect(validateFc27PuzzleSelection(plan, fullPage, current).status).toBe('blocked');
});
