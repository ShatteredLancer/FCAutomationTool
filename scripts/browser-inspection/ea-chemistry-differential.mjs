import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';

const sourceFile = new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url);
// Reviewed public methods matched the dedicated browser on 2026-09-26.
// No EA source is bundled or downloaded by this helper.
export const EA_CHEMISTRY_METHOD_HASHES = Object.freeze({
  isRestrictedLeague: '44921134909647aab46bf03d427bb34330c20ba0bd45b7ec0667faf51e46b485',
  isRestrictedClub: '564ebbfe8841f528153768959d09c5e9252b27a15b075d27ad544ad01b3752da',
  getContribution: 'efb5dd671f5551c98ffe29fa7a64c9a2f218a2ff39407d9e9bac46fa50e6217c',
  addContributions: 'f8a63e9335361b52db46dbc5ad4790837ed40e42fbb86d68208d2702156e60ba',
  addLeagueContributions: '55b0dc167d41b37f05489496ad047bcc3c539b5ddf2134d8788d0698517ad5cc',
  canContribute: 'b907c7784ee2540bed30674cfa36a46c2a02589b874c55dd8c995bfc32194ad8',
  normalizeClubId: 'df5adf655c5cff0f99476b69b7f1f667df3967cacd1de4acad81ff8d291ea020',
  getChemProfileForPlayer: 'bc3e65ecc2ad4b45b1ad27ac8a293b49fa748c9ce7f472410fe033d307a9d3da',
  isMaxChem: '281b62c14ddcb5c7bbf5164ad2fc10983bf0ff3118741c1c0486d01bf2d42c50',
  getProfileContribution: '9aeca82bde12a42ded7712568caad1917c329440bd0ef8ebaf73c3c165275ba5',
  addProfileContributions: '5b80a274bcc7edd865e8849b008af349e32827884bf096e9ce522ee309ebf0aa',
  addUniversalContribution: '3b73ef6812fac88e651a90c9a4363c56f13a4da131ab35c6fed5242b3bc5a807',
  calculate: '57c5ae711b073e0144e01ba7e8d4d475f0f96419c22155860f1b206918ea986e',
});

const stop = reason => ({ status: 'unverified', reason, scope: 'isolated-ea-ordinary-chemistry-algorithm',
  executable: false, liveExecutionEnabled: false, reusableForExecution: false, requirementsVerified: false,
  dependencyMode: 'detached-data-facades', chemistryVerified: false });

function reviewedMethods(source) {
  const methods = {};
  for (const [name, hash] of Object.entries(EA_CHEMISTRY_METHOD_HASHES)) {
    const marker = `UTSquadChemCalculatorUtils.prototype.${name}=`;
    const start = source.indexOf(marker);
    const endMarker = name === 'calculate' ? ',UTSquadChemCalculatorUtils.FIELD_PLAYERS=' : ',UTSquadChemCalculatorUtils.prototype.';
    const end = source.indexOf(endMarker, start + marker.length);
    if (start < 0 || end < 0 || end - start > 16384 || source.indexOf(marker, start + 1) >= 0) return null;
    const fn = source.slice(start + marker.length, end).replace(/\r\n/g, '\n');
    if (createHash('sha256').update(fn).digest('hex') !== hash) return null;
    methods[name] = fn;
  }
  return methods;
}

// All facades and inputs are created inside the VM; no host/page functions or
// objects enter it. Service/VO facades model ordinary-card data access only.
// This is algorithm comparison, not full entity or server acceptance evidence.
function runIsolated(input, methods) {
  const serialized = JSON.stringify(input);
  if (serialized.length > 250000) throw new Error('bounded input');
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  return new Script(`'use strict';
    const input = ${serialized};
    const config = input.chemistry;
    const ChemistryParamId = Object.freeze({ NATION: 1, LEAGUE: 2, CLUB: 3 });
    const ChemistryProfileId = Object.freeze({ BASE: 1, HERO: 2, ICON: 3 });
    const ChemistryProfileRuleCalculationType = Object.freeze({ UNIVERSAL_WITH_PLAYER_COUNT: 2 });
    const UTSquadChemCalculatorUtils = Object.freeze({ FIELD_PLAYERS: 11, SLOT_MAX_CHEMISTRY: 3 });
    const UTItemEntity = Object.freeze({ LEGENDS_LEAGUE_ID: config.identities.legendLeagueId,
      LEGENDS_CLUB_ID: config.identities.legendClubId, LEAGUE_HERO_CLUB_ID: config.identities.heroClubId,
      HALL_OF_FUT_CLUB_ID: config.identities.hallOfFutClubId });
    const DebugUtils = { Assert(condition) { if (!condition) throw new Error('assert'); } };
    class EAHashTable extends Map { values() { return Array.from(super.values()); } }
    // calculate already computed every slot's points; retain its output only.
    class UTSquadChemistryVO { constructor(data) { this.slots = data.slots; } }
    const profiles = (config.profiles?.entries ?? []).map(profile => ({ ...profile,
      getRuleByParamId(id) { const rule = profile.rules.find(rule => rule.parameterId === id);
        return rule ? { ...rule, value: () => rule.contribution } : null; } }));
    const parameters = config.parameters.map(parameter => ({ ...parameter,
      requirement: Math.max(...parameter.thresholds.map(threshold => threshold.requirement)) }));
    const links = new Map(config.links.links);
    const receiver = {
      chemService: { isFeatureEnabled: () => config.profilesEnabled,
        getParameter: id => parameters.find(parameter => parameter.id === id),
        getProfileById: id => profiles.find(profile => profile.id === id),
        getRarityProfile: id => profiles.find(profile => profile.applicableRarityIds.includes(id)) },
      teamConfigRepo: { getLinkedTeam: id => links.get(id) ?? id },
      ${Object.entries(methods).map(([name, source]) => `${name}: (${source})`).join(',\n')}
    };
    const items = input.squad.map(item => ({ ...item, rareflag: item.rarity, possiblePositions: item.positions,
      isValid: () => true, isCustomBrick: () => false, isManager: () => false,
      isSuperChem: () => false, isLeagueHeroItem: () => false, isLegend: () => false,
      getBaseRarity: () => item.rarity }));
    const formation = { getPosition: index => ({ typeId: input.formation.positions[index] }) };
    receiver.calculate(formation, items, []).slots.map(slot => slot.points);
  `).runInContext(context, { timeout: 150 });
}

export async function inspectEaChemistryDifferential(report, transientInput,
  { readSource = () => readFile(sourceFile, 'utf8') } = {}) {
  try {
    const plan = report?.plan;
    if (report?.status !== 'preview' || report.reason !== 'READ_ONLY_PLAN' || report.executable !== false
        || report.liveExecutionEnabled !== false || plan?.exactValidation?.status !== 'verified'
        || plan.selectedCount !== 11 || plan.exactValidation.presentCount !== 11
        || typeof report.configuration?.floatCalculationEnabled !== 'boolean'
        || !Array.isArray(transientInput?.squad) || transientInput.squad.length !== 11
        || transientInput.squad.some(item => !item || !Number.isSafeInteger(item.rating) || item.rating > 74)
        || report.layout?.slotCount !== 11 || report.layout.requiredPlayerCount !== 11
        || report.layout.simpleBrickIndices?.length !== 0 || report.layout.customBrickIndices?.length !== 0
        || JSON.stringify(report.layout.formation) !== JSON.stringify(transientInput.formation)
        || !Array.isArray(plan.slots) || plan.slots.length !== 11 || new Set(plan.slots).size !== 11
        || plan.slots.some(slot => !Number.isSafeInteger(slot) || slot < 0 || slot > 10)
        || !Array.isArray(plan.ratings) || plan.ratings.length !== 11
        || plan.slots.some((slot, i) => transientInput.squad[slot].rating !== plan.ratings[i])
        || report.configuration.profilesEnabled !== transientInput.chemistry?.profilesEnabled
        || report.configuration.floatCalculationEnabled !== transientInput.chemistry?.rating?.floatCalculationEnabled) {
      return stop('FC27_EA_CHEMISTRY_INPUT_UNVERIFIED');
    }
    const targets = report.eaTeamFactsProbe?.targets?.filter(target => target.path === 'UTSquadChemCalculatorUtils.prototype');
    const target = targets?.length === 1 ? targets[0] : null;
    if (!target || target.present !== true || target.truncated !== false
        || Object.entries(EA_CHEMISTRY_METHOD_HASHES).some(([name, hash]) => {
          const matches = target.methods?.filter(method => method.name === name);
          return matches?.length !== 1 || matches[0].kind !== 'function' || matches[0].sha256 !== hash;
        })) return stop('FC27_EA_CHEMISTRY_METHOD_UNREVIEWED');
    const input = structuredClone(transientInput);
    const local = evaluateFc27PuzzleSquad({ ...input, rating: input.chemistry.rating });
    if (local.status !== 'observed' || local.chemistry !== plan.teamFacts?.chemistry
        || local.teamRating !== plan.teamFacts?.teamRating) return stop('FC27_EA_CHEMISTRY_INPUT_UNVERIFIED');
    const source = await readSource();
    if (typeof source !== 'string' || source.length > 15000000) return stop('FC27_EA_CHEMISTRY_SOURCE_UNAVAILABLE');
    const methods = reviewedMethods(source);
    if (!methods) return stop('FC27_EA_CHEMISTRY_SOURCE_UNREVIEWED');
    const actual = runIsolated(input, methods);
    if (!Array.isArray(actual) || actual.length !== 11
        || actual.some(points => !Number.isSafeInteger(points) || points < 0 || points > 3)) {
      return stop('FC27_EA_CHEMISTRY_RESULT_UNVERIFIED');
    }
    const match = actual.every((points, index) => points === local.slotChemistry[index]);
    return { ...stop(match ? 'FC27_EA_CHEMISTRY_DIFFERENTIAL_MATCH' : 'FC27_EA_CHEMISTRY_DIFFERENTIAL_MISMATCH'),
      status: match ? 'verified' : 'mismatch', chemistryVerified: match,
      local: local.chemistry, ea: actual.reduce((sum, points) => sum + points, 0),
      perSlotMatch: match, selectedCount: 11, checkedMethodCount: 13,
      methodSha256: EA_CHEMISTRY_METHOD_HASHES.calculate };
  } catch { return stop('FC27_EA_CHEMISTRY_CHECK_UNAVAILABLE'); }
}
