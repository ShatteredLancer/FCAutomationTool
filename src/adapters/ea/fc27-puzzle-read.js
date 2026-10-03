import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, readFc27CachedClub } from './fc27-local-read.js';
import { readFc27PuzzlePolicy } from './fc27-fsu-read.js';
import { DEFAULT_PUZZLE_MAX_RATING, puzzleMaterialRules } from '../../fc27/puzzle-material-policy.js';
import { inspectFc27ChallengeCatalog } from './fc27-challenge-catalog.js';
import { inspectInProgressSquad } from './fc27-sbc-read.js';
import { parseFc27SbcRequirements } from '../../fc27/sbc-requirements.js';
import { previewFc27PuzzleSquad } from '../../fc27/puzzle-preview.js';
import { evaluateFc27PuzzleSquad, boundFc27PuzzleChemistry } from '../../fc27/puzzle-evaluator.js';

const blocked = (reason, extra = {}) => ({ status: 'blocked', reason, liveExecutionEnabled: false, ...extra });
const enumNames = { 3: 'PLAYER_QUALITY', 4: 'SAME_NATION_COUNT', 5: 'SAME_LEAGUE_COUNT', 6: 'SAME_CLUB_COUNT',
  7: 'NATION_COUNT', 8: 'LEAGUE_COUNT', 9: 'CLUB_COUNT', 10: 'NATION_ID', 11: 'LEAGUE_ID', 12: 'CLUB_ID',
  17: 'PLAYER_LEVEL', 18: 'PLAYER_RARITY', 19: 'TEAM_RATING', 25: 'PLAYER_RARITY_GROUP', 26: 'PLAYER_MIN_OVR',
  27: 'PLAYER_EXACT_OVR', 28: 'PLAYER_MAX_OVR', 35: 'CHEMISTRY_POINTS' };

// Compare a read-only Puzzle plan with a fresh Club projection. The planner
// never receives refreshed EA entities, and this helper deliberately returns
// only aggregate evidence so item identities cannot escape the adapter.
export function validateFc27PuzzleSelection(selected, freshItems, plannedItems) {
  const failed = (mismatch = 'shape') => ({ status: 'blocked', reason: 'FC27_EXACT_ITEMS_CHANGED',
    mismatch: typeof mismatch === 'string' && /^[a-z-]{1,40}$/.test(mismatch) ? mismatch : 'shape' });
  const validId = value => Number.isSafeInteger(value) && value > 0;
  if (!Array.isArray(selected) || !Array.isArray(freshItems) || selected.length < 1 || selected.length > 11
      || freshItems.length >= 250 || !Array.isArray(plannedItems)
      || plannedItems.length !== selected.length) return failed();
  const fields = ['id', 'definitionId', 'type', 'pile', 'rating', 'rarity', 'nationId', 'leagueId', 'teamId',
    'positions', 'groups', 'special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled', 'activeTrade',
    'limitedUse', 'loans', 'tradeable', 'state', 'locked', 'activeSquad'];
  const expected = new Map(plannedItems.map(item => [item?.id, item]));
  const byId = new Map(freshItems.map(item => [item?.id, item]));
  if (byId.size !== freshItems.length || expected.size !== selected.length
      || freshItems.some(item => !validId(item?.id) || !validId(item?.definitionId)
        || !selected.some(ref => ref.definitionId === item.definitionId))) return failed();
  const seenIds = new Set(); const seenDefinitions = new Set();
  for (const plan of selected) {
    const current = byId.get(plan?.id);
    const before = expected.get(plan?.id);
    if (!validId(plan?.id) || !validId(plan?.definitionId) || plan.pile !== 'club'
        || seenIds.has(plan.id) || seenDefinitions.has(plan.definitionId)
        || !current || !before || current.id !== plan.id || current.definitionId !== plan.definitionId
        || fields.some(key => !Object.hasOwn(current, key) || !Object.hasOwn(before, key)
          || JSON.stringify(current[key]) !== JSON.stringify(before[key]))
        || current.type !== 'player' || current.pile !== 'club'
        || current.rating !== plan.rating || current.special !== false
        || current.evolution !== false || current.cosmetic !== false
        || current.concept !== false || current.academyEnrolled !== false
        || current.activeTrade !== false || current.limitedUse !== false
        || current.loans !== -1 || current.tradeable !== false) {
      return failed('identity');
    }
    seenIds.add(plan.id); seenDefinitions.add(plan.definitionId);
  }
  return { status: 'verified', selectedCount: selected.length, presentCount: selected.length,
    uniqueDefinitions: seenDefinitions.size === selected.length };
}

export function readFc27PuzzleClubLinks(root) {
  try {
    const map = ownData(ownData(ownData(root, 'repositories'), 'TeamConfig'), 'teamLinks');
    const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(map);
    if (size > 20000) return null;
    const links = Array.from(Map.prototype.entries.call(map));
    if (links.length !== size || links.some(pair => !pair.every(id => Number.isSafeInteger(id) && id > 0))) return null;
    return Object.freeze({ schema: 1, complete: true, links: Object.freeze(links.map(pair => Object.freeze(pair))) });
  } catch { return null; }
}

function values(value, limit) {
  const collection = ownData(value, '_collection') ?? value;
  if (!collection || typeof collection !== 'object') return null;
  const keys = Array.isArray(collection) ? Array.from({ length: collection.length }, (_, index) => String(index))
    : Object.getOwnPropertyNames(collection);
  if (keys.length > limit) return null;
  return keys.map(key => ownData(collection, key));
}

function method(object, key) {
  for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    // Do not execute or skip a shadowing accessor.
    if (descriptor) return descriptor.value;
  }
  return undefined;
}

// The ordinary base profile is the only profile used by the current safe
// candidate policy. Unknown/custom profile math remains blocked.
export function readFc27PuzzleChemistry(root, clubLinks) {
  try {
    const configuration = ownData(ownData(root, 'services'), 'Configuration');
    const serverSettings = ownData(ownData(root, 'repositories'), 'ServerSettings');
    const settingsKeys = ownData(root, 'UTServerSettingsRepository');
    const keys = ownData(settingsKeys, 'KEY');
    const feature = method(configuration, 'checkFeatureEnabled');
    const stringSetting = method(serverSettings, 'getStringSettingByKey');
    const chemistryFeatureKey = ownData(keys, 'CHEMISTRY_PROFILES_ENABLED');
    const ratingFeatureKey = ownData(keys, 'SQUAD_RATING_FLOAT_CALCULATION_ENABLED');
    const superChemistryKey = ownData(keys, 'SUPER_CHEM_RARITY_IDS');
    if (typeof feature !== 'function' || chemistryFeatureKey === undefined
        || ratingFeatureKey === undefined || typeof stringSetting !== 'function'
        || superChemistryKey === undefined) return null;
    const profilesEnabled = feature.call(configuration, chemistryFeatureKey);
    const floatCalculationEnabled = feature.call(configuration, ratingFeatureKey);
    if (typeof profilesEnabled !== 'boolean' || typeof floatCalculationEnabled !== 'boolean') return null;
    const superChemRarityText = stringSetting.call(serverSettings, superChemistryKey);
    if (typeof superChemRarityText !== 'string' || superChemRarityText.length > 60006
        || superChemRarityText !== '' && !/^\d{1,5}(,\d{1,5})*$/.test(superChemRarityText)) return null;
    const superChemRarityIds = superChemRarityText === '' ? [] : superChemRarityText.split(',').map(value => Number(value));
    if (superChemRarityIds.some(value => !Number.isSafeInteger(value) || value < 0 || value > 10000)
        || new Set(superChemRarityIds).size !== superChemRarityIds.length) return null;
    const itemEntity = ownData(root, 'UTItemEntity');
    const identities = { legendClubId: ownData(itemEntity, 'LEGENDS_CLUB_ID'),
      legendLeagueId: ownData(itemEntity, 'LEGENDS_LEAGUE_ID'),
      heroClubId: ownData(itemEntity, 'LEAGUE_HERO_CLUB_ID'),
      hallOfFutClubId: ownData(itemEntity, 'HALL_OF_FUT_CLUB_ID') };
    if (Object.values(identities).some(value => !Number.isSafeInteger(value) || value <= 0)) return null;
    const chemistry = ownData(ownData(root, 'repositories'), 'Chemistry');
    const rawParameters = values(ownData(chemistry, 'parameters'), 8);
    const parameters = rawParameters?.map(parameter => ({ id: ownData(parameter, 'id'),
      thresholds: values(ownData(parameter, 'thresholds'), 8)?.map(threshold => ({
        requirement: ownData(threshold, 'requirement'), points: ownData(threshold, 'points'),
      })) }));
    const rawProfiles = values(ownData(chemistry, 'profiles'), 128);
    const base = rawProfiles?.find(profile => ownData(profile, 'id') === 1);
    const rules = values(ownData(base, 'rules'), 8)?.map(rule => ({ parameterId: ownData(rule, 'parameterId'),
      calculationType: ownData(rule, 'calculationType'), contribution: ownData(rule, 'contribution') }));
    if (!Array.isArray(parameters) || parameters.length !== 3 || parameters.some(parameter => !Array.isArray(parameter.thresholds))
        || !base || ownData(base, 'maxChem') !== false || ownData(base, 'baseOverride') !== false
        || !Array.isArray(rules) || rules.length !== 3
        || rules.some(rule => rule.calculationType !== 1 || rule.contribution !== 1
          || ![1, 2, 3].includes(rule.parameterId))
        || new Set(rules.map(rule => rule.parameterId)).size !== 3) return null;
    const profiles = rawProfiles?.map(profile => ({ id: ownData(profile, 'id'),
      maxChem: ownData(profile, 'maxChem'), applicableRarityIds: values(ownData(profile, 'applicableRarityIds'), 10001),
      rules: values(ownData(profile, 'rules'), 8)?.map(rule => ({ parameterId: ownData(rule, 'parameterId'),
        calculationType: ownData(rule, 'calculationType'), contribution: ownData(rule, 'contribution') })) }));
    if (profilesEnabled && (!Array.isArray(profiles) || profiles.some(profile => !Array.isArray(profile.applicableRarityIds)
      || !Array.isArray(profile.rules)))) return null;
    return Object.freeze({ parameters: Object.freeze(parameters.map(parameter => Object.freeze({
      ...parameter, thresholds: Object.freeze(parameter.thresholds.map(value => Object.freeze(value))),
    }))), links: clubLinks, maxChemistryPerPlayer: 3, profilesEnabled,
      profiles: profilesEnabled ? Object.freeze({ complete: true, entries: Object.freeze(profiles.map(profile => Object.freeze(profile))) }) : null,
      identities: Object.freeze(identities), superChemRarityIds: Object.freeze(superChemRarityIds),
      rating: Object.freeze({ floatCalculationEnabled }) });
  } catch { return null; }
}

// Only the reviewed catalog GET and the already-IN_PROGRESS squad GET are used.
// Result is an aggregate diagnostic, never a transaction handle or EA item entity.
export async function inspectFc27PuzzlePlan(root, { setId, challengeId, maxRating = DEFAULT_PUZZLE_MAX_RATING,
  catalog: suppliedCatalog = null, layout: suppliedLayout = null, excludedItemIds = [],
  excludedDefinitionIds = [] } = {}, onInputs = null) {
  try {
    const context = readFc27Context(root);
    const policy = readFc27PuzzlePolicy(root, maxRating);
    const signature = JSON.stringify({ context, policy });
    const unchanged = () => signature === JSON.stringify({ context: readFc27Context(root), policy: readFc27PuzzlePolicy(root, maxRating) });
    if (!Number.isSafeInteger(challengeId) || challengeId <= 0 || challengeId >= 1e9) return blocked('FC27_CHALLENGE_UNVERIFIED');
    const started = Date.now();
    // A one-click native fill already read this Set's catalog to identify the
    // active Challenge. Reuse that exact response; repeated catalog GETs are
    // unnecessary and can trigger EA rate limiting. Callers doing standalone
    // inspection still omit it and perform the reviewed read here.
    const catalog = suppliedCatalog ?? await inspectFc27ChallengeCatalog(root, { setId });
    if (catalog.status !== 'observed') return catalog;
    const matches = catalog.challenges.filter(challenge => challenge.id === challengeId && challenge.status === 'IN_PROGRESS');
    if (matches.length !== 1 || matches[0].eligibilityOperation !== 'AND') return blocked('FC27_IN_PROGRESS_PUZZLE_REQUIRED');
    const observed = matches[0];
    const keys = ownData(root, 'SBCEligibilityKey');
    const scopes = ownData(root, 'SBCEligibilityScope');
    const quality = ownData(root, 'SBCEligibilityQualityType');
    if (Object.entries({ GREATER: 0, LOWER: 1, EXACT: 2 }).some(([key, value]) => ownData(scopes, key) !== value)
        || Object.entries({ BRONZE: 1, SILVER: 2, GOLD: 3 }).some(([key, value]) => ownData(quality, key) !== value)
        || observed.requirements.some(rule => rule.pairs.some(pair => enumNames[pair.key] && ownData(keys, enumNames[pair.key]) !== pair.key))) {
      return blocked('FC27_PUZZLE_ENUM_CHANGED');
    }
    if (!suppliedLayout) await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - started))));
    if (!unchanged()) return blocked('FC27_RUNNER_INPUTS_CHANGED');
    const layout = suppliedLayout ?? await inspectInProgressSquad({ setId, challengeId, includeFormation: true }, root, observed);
    if (layout.status !== 'observed') return layout;
    if (layout.setId !== setId || layout.challengeId !== challengeId) return blocked('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
    if (!unchanged()) return blocked('FC27_RUNNER_INPUTS_CHANGED');
    // Custom bricks can contribute chemistry; their attributes need a separate contract.
    if (layout.customBrickIndices.length) return blocked('FC27_PUZZLE_CUSTOM_BRICKS_UNVERIFIED');
    if (!Array.isArray(excludedItemIds) || !Array.isArray(excludedDefinitionIds)
        || excludedItemIds.length > 500 || excludedDefinitionIds.length > 500
        || excludedItemIds.some(value => !Number.isSafeInteger(value) || value <= 0)
        || excludedDefinitionIds.some(value => !Number.isSafeInteger(value) || value <= 0)) {
      return blocked('FC27_PUZZLE_RESERVATION_UNVERIFIED');
    }
    const excludedItems = new Set(excludedItemIds);
    const excludedDefinitions = new Set(excludedDefinitionIds);
    const cached = readFc27CachedClub(root);
    const inventory = { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', scope: 'club-only', complete: false,
      items: cached.items.filter(item => !excludedItems.has(item.id) && !excludedDefinitions.has(item.definitionId))
        .map(item => ({ ...item, protected: item.special !== false || item.evolution !== false || item.cosmetic !== false })) };
    const challenge = { schema: 1, context, mechanism: 'traditional-puzzle', requirementsOperation: 'AND',
      completed: false, setId, id: challengeId, slotCount: layout.slotCount,
      formation: layout.formation,
      brickIndices: layout.simpleBrickIndices, rawRequirements: observed.requirements };
    const parsed = parseFc27SbcRequirements(observed.requirements, layout.requiredPlayerCount);
    if (parsed.status === 'unsupported') return blocked('FC27_REQUIREMENT_UNSUPPORTED', { unsupported: parsed.unsupported });
    if (parsed.status !== 'observed') return blocked(parsed.reason);
    const clubLinks = readFc27PuzzleClubLinks(root);
    const needsTeamFacts = parsed.rules.some(rule => ['min-team-rating', 'max-team-rating', 'exact-team-rating',
      'min-chemistry', 'max-chemistry', 'exact-chemistry'].includes(rule.kind));
    const chemistry = needsTeamFacts ? readFc27PuzzleChemistry(root, clubLinks) : null;
    if (needsTeamFacts && !chemistry) return blocked('FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE');
    const evaluateSquad = needsTeamFacts ? squad => evaluateFc27PuzzleSquad({ squad, formation: layout.formation,
      chemistry, rating: chemistry.rating }) : undefined;
    const boundSquad = needsTeamFacts ? squad => boundFc27PuzzleChemistry({ squad, formation: layout.formation,
      chemistry, rating: chemistry.rating }) : undefined;
    const inputs = { context, challenge, inventory, policy, clubLinks, chemistry,
      squadEmpty: layout.squadEmpty === true, evaluateSquad, boundSquad };
    // Internal detached planning seam; the default inspection still exports
    // aggregates only. The callback never receives root or any EA entity.
    const plan = typeof onInputs === 'function' ? await onInputs(inputs) : previewFc27PuzzleSquad(inputs);
    if (!unchanged()) return blocked('FC27_RUNNER_INPUTS_CHANGED');
    return { status: plan.status, reason: plan.reason, liveExecutionEnabled: false, setId, challengeId,
      layout, rules: parsed.rules, unsupported: parsed.unsupported, inventory: { cachedPlayers: cached.items.length,
        status: 'provisional', complete: false, scope: 'club-only' }, policy: { maxRating: policy.maxRating,
        materialComposition: puzzleMaterialRules(parsed.rules, layout.requiredPlayerCount).map(rule => ({ quality: rule.qualities[0], count: rule.count })) },
      linkedClubCount: clubLinks?.links.length ?? null,
      configuration: chemistry ? { profilesEnabled: chemistry.profilesEnabled,
        floatCalculationEnabled: chemistry.rating.floatCalculationEnabled, profileCount: chemistry.profiles?.entries.length ?? 0,
        superChemRarityCount: chemistry.superChemRarityIds.length } : null,
      plan: { required: layout.requiredPlayerCount, safeCandidates: plan.safeCandidates ?? null,
        excluded: plan.excluded ?? null, excludedByReason: plan.excludedByReason ?? null,
        selectedCount: plan.selected?.length ?? 0, deficits: plan.deficits ?? [], nodes: plan.nodes ?? 0,
        search: plan.search ?? null, teamFacts: plan.teamFacts ?? null, evaluatorReason: plan.evaluatorReason ?? null,
        ratings: (plan.selected ?? []).map(item => item.rating), slots: (plan.selected ?? []).map(item => item.slot),
        exactValidation: plan.exactValidation ?? null, fillPreflight: plan.fillPreflight ?? null },
      pending: ['EA_TEAM_FACTS_DIFFERENTIAL', 'EXACT_ITEM_VALIDATION', 'PUZZLE_FILL_TRANSACTION'],
      ...(plan.marketRoute ? { marketRoute: plan.marketRoute } : {}),
      ...(plan.purchaseSuggestion ? { purchaseSuggestion: plan.purchaseSuggestion } : {}) };
  } catch (error) {
    return blocked(/^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_PUZZLE_INSPECTION_UNAVAILABLE');
  }
}
