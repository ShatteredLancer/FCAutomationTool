import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';

const sourceFile = new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url);
export const EA_REQUIREMENT_METHOD_HASHES = Object.freeze({
  isRequirementMet: 'd8dcfe4ea78cbdcc899971855dd13db78fe9775da1537c70bd345b395ac5a31c',
  meetsRequirements: '86450ce2af8209594e5f5ab3d6ab3222cf0cf1c53544efc8c03a6c643ee14ac2',
  hasMultipleValues: '05ab30fdb6eb92cfbdcbf6d6bdee447215bad41b299e1ddf2cb5f3e31a471794',
  getPlayersForCounters: 'c84a8c3f6440f0c71a5a4af678a061d31c9b4ae31176ca4f2214cb3d65d58194',
  qualityCounter: '43d39e70141cccc9f39ea20543a43968f5ad02100c8bce6565c9cb4d72d890b9',
  leagueCounter: '677920d9c2c6535f0beee1a43240808bf4361e777a51e04b57ff9f835e652751',
  clubCounter: 'aa4a310157d80e049c815982f8cf68c27c29084be15333fdbb1b5cc2be0f9b37',
  nationCounter: 'defdb7720e6b26db8bc6dcaaaa0eaa88d46bebb9cbe40728e281060639dd27ec',
  playerCountHelper: '90473b8c16526a2df65dd73796b75cedb5aebfbdb31ba9ed3cc2daa7a58f282f',
  getPlayersPerQualityTier: '735d12df061b09096498dab4001fe4bb3e8139b5223df5431a84a98edc42e32f',
  getNumberOfPlayersByRarity: '0b799f2b0f5747089d59c3eaffd3f82792d114dcb62e99334fd4c520194decc9',
  getNumberOfPlayersByGroup: 'd09c80b1ee0b7bf05733c408d54db5d17269d975ba9b2e5d136c0ed1ca85c04f',
  getNumberOfPlayersByQualityTier: '1d38c82675b0a362f8ce03f4a8acedbeeec1010fed35d936ece21189528fe212',
  getNumberOfPlayersByOVR: '168da9564c9e0bf82a32d405aa776b04e7b487609927d59bbf5a3a7e93b9bc85',
  getPlayersPerLeague: '9b6ff01caf6ffd7a39929a48aebf107313de84bd390a4d4b42e73dc16475d042',
  getPopularLeagues: 'c42041d33222cb0ffe009ad7e682b9a9eba20a6d004bd569abaa29658f85369d',
  getNumberOfPlayersByLeague: '20a7b060ad522160e2257d00d4b7d79e75731daa6ff9077f8084c69f394224f3',
  getPopularClubs: 'b423f188c0a6a531e3e2570135a299dd49a53ca11bd753fdbb6e7fed0edbfd20',
  getPlayersPerClub: '716c2a1871a1a644d37e9c7635220440b7eff6767113ca15c51096d2166fd492',
  getNumberOfPlayersByClub: '7a3a936b94660982c9ab634e07e2e69e361dd11adc75d08b04003db8ad7cef40',
  getPopularNationalities: '304b052b7fe53d66593b239c43508cfe17abae917c3cd7a79e93a9a123269a51',
  getPlayersPerNation: '7231b81102b652f94686164d4114d46a2b0c19b133e853a5c8e52861c921e0bd',
  getNumberOfPlayersByNation: 'cbb031b39b0ffa970b1a121d6b640ca06cefcea072560db703953a58b73b5104',
});
const hashes = EA_REQUIREMENT_METHOD_HASHES;
const stop = reason => ({ status: 'unverified', reason, scope: 'isolated-ea-requirement-algorithm',
  requirementsVerified: false, executable: false, liveExecutionEnabled: false, reusableForExecution: false });
const integer = value => Number.isSafeInteger(value);

function reviewedMethods(bundle) {
  const methods = {};
  for (const [name, hash] of Object.entries(hashes)) {
    const marker = `UTSBCChallengeEntity.prototype.${name}=`;
    const start = bundle.indexOf(marker);
    const end = bundle.indexOf(',UTSBCChallengeEntity.prototype.', start + marker.length);
    if (start < 0 || end < 0 || end - start > 8192 || bundle.indexOf(marker, start + 1) >= 0) return null;
    const source = bundle.slice(start + marker.length, end).replace(/\r\n/g, '\n');
    if (createHash('sha256').update(source).digest('hex') !== hash) return null;
    methods[name] = source;
  }
  return methods;
}

function compare(input, methods) {
  const serialized = JSON.stringify(input);
  if (serialized.length > 100000) throw new Error('bounded input');
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  return new Script(`'use strict';
    const input = ${serialized};
    const SBCEligibilityKey = Object.freeze({ PLAYER_QUALITY: 3, PLAYER_LEVEL: 17,
      SAME_NATION_COUNT: 4, SAME_LEAGUE_COUNT: 5, SAME_CLUB_COUNT: 6,
      NATION_COUNT: 7, LEAGUE_COUNT: 8, CLUB_COUNT: 9, NATION_ID: 10,
      LEAGUE_ID: 11, CLUB_ID: 12, PLAYER_RARITY: 18, TEAM_RATING: 19,
      PLAYER_RARITY_GROUP: 25, PLAYER_MIN_OVR: 26, PLAYER_EXACT_OVR: 27,
      PLAYER_MAX_OVR: 28, CHEMISTRY_POINTS: 35 });
    const SBCEligibilityScope = Object.freeze({ GREATER: 0, LOWER: 1, EXACT: 2 });
    const SBCEligibilityOperation = Object.freeze({ OR: 1 });
    const UTSquadEntity = Object.freeze({ FIELD_PLAYERS: 11 });
    const DebugUtils = { Assert() { throw new Error('unsupported EA branch'); } };
    const links = new Map(input.clubLinks.links);
    const repositories = { TeamConfig: { getLinkedTeam: id => links.get(id) ?? id } };
    class EAHashTable extends Map { constructor(value) { super(Object.entries(value)); }
      keys() { return Array.from(super.keys()); }
      values() { return Array.from(super.values()); } }
    const players = input.squad.map((item, index) => {
      const entity = { ...item, rareflag: item.rarity,
        getTier: () => item.rating <= 64 ? 1 : item.rating <= 74 ? 2 : 3,
        belongsToGroup: id => item.groups.includes(id) };
      return { item: entity, getItem: () => entity, getIndex: () => index, isValid: () => true };
    });
    const squad = { simpleBrickIndices: [], isSquadFull: () => players.length === 11,
      getNonBrickSlots: () => players, getChemistry: () => input.chemistry,
      getRating: () => input.teamRating };
    const requirements = input.requirements.map(raw => {
      const pair = raw.pairs[0];
      return { scope: raw.scope, count: raw.count, isCombinedRequirement: false,
        keys: () => [pair.key], getFirstKey: () => pair.key,
        getValue: () => pair.values, getFirstValue: () => pair.values[0] };
    });
    const receiver = { squad, eligibilityRequirements: requirements, eligibilityOperation: 0,
      ${Object.entries(methods).map(([name, source]) => `${name}: (${source})`).join(',\n')} };
    [requirements.map(rule => receiver.isRequirementMet(rule)), receiver.meetsRequirements()];
  `).runInContext(context, { timeout: 150 });
}

export async function inspectEaRequirementDifferential(report, transient,
  { readSource = () => readFile(sourceFile, 'utf8') } = {}) {
  try {
    const plan = report?.plan;
    const squad = transient?.squad;
    const raw = transient?.requirements;
    if (report?.eaRatingDifferential?.status !== 'verified' || report?.eaChemistryDifferential?.status !== 'verified') {
      return stop('FC27_EA_REQUIREMENT_FACTS_PREREQUISITE');
    }
    if (report?.status !== 'preview' || report.reason !== 'READ_ONLY_PLAN' || report.executable !== false
        || report.liveExecutionEnabled !== false || plan?.exactValidation?.status !== 'verified'
        || plan.selectedCount !== 11 || plan.exactValidation.presentCount !== 11
        || report.layout?.slotCount !== 11 || report.layout?.requiredPlayerCount !== 11
        || report.layout?.simpleBrickIndices?.length !== 0 || report.layout?.customBrickIndices?.length !== 0
        || JSON.stringify(report.layout.formation) !== JSON.stringify(transient?.formation)
        || !Array.isArray(squad) || squad.length !== 11 || squad.some(item => !item || !integer(item.rating)
          || item.rating < 1 || item.rating > 74 || !integer(item.nationId) || item.nationId <= 0
          || !integer(item.leagueId) || item.leagueId <= 0 || !integer(item.teamId) || item.teamId <= 0
          || ![0, 1].includes(item.rarity) || !Array.isArray(item.groups) || item.groups.length > 256
          || item.groups.some(group => !integer(group) || group < 0))
        || !Array.isArray(raw) || raw.length < 1 || raw.length > 16
        || !Array.isArray(report.rules) || report.rules.length !== raw.length
        || !Array.isArray(plan.slots) || plan.slots.length !== 11 || new Set(plan.slots).size !== 11
        || plan.slots.some((slot, index) => !integer(slot) || slot < 0 || slot > 10
          || squad[slot].rating !== plan.ratings?.[index])
        || !integer(plan.teamFacts?.chemistry) || !integer(plan.teamFacts?.teamRating)
        || transient?.clubLinks?.complete !== true || !Array.isArray(transient.clubLinks.links)
        || transient.clubLinks.links.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(integer))) {
      return stop('FC27_EA_REQUIREMENT_INPUT_UNVERIFIED');
    }
    const facts = evaluateFc27PuzzleSquad({ squad, formation: transient.formation,
      chemistry: transient.chemistry, rating: transient.chemistry?.rating });
    if (facts.status !== 'observed' || facts.chemistry !== plan.teamFacts.chemistry
        || facts.teamRating !== plan.teamFacts.teamRating
        || JSON.stringify(transient.clubLinks) !== JSON.stringify(transient.chemistry?.links)) {
      return stop('FC27_EA_REQUIREMENT_INPUT_UNVERIFIED');
    }
    const parsed = parseFc27SbcRequirements(raw, 11);
    if (parsed.status !== 'observed' || JSON.stringify(parsed.rules) !== JSON.stringify(report.rules)
        || raw.some(rule => rule.pairs?.length !== 1 || rule.pairs[0].values?.length < 1
          || rule.pairs[0].values.length > 32 || !rule.pairs[0].values.every(integer))) {
      return stop('FC27_EA_REQUIREMENT_INPUT_UNVERIFIED');
    }
    const target = report.eaTeamFactsProbe?.targets?.filter(t => t.path === 'UTSBCChallengeEntity.prototype');
    if (target?.length !== 1 || target[0].present !== true || target[0].truncated !== false
        || Object.entries(hashes).some(([name, hash]) => {
          const methods = target[0].methods?.filter(method => method.name === name);
          return methods?.length !== 1 || methods[0].kind !== 'function' || methods[0].sha256 !== hash;
        })) return stop('FC27_EA_REQUIREMENT_METHOD_UNREVIEWED');
    const local = parsed.rules.map(rule => matchFc27SbcRequirements({ requirements: [rule], squad,
      chemistry: plan.teamFacts.chemistry, teamRating: plan.teamFacts.teamRating,
      clubLinks: transient.clubLinks }));
    if (local.some(result => !['satisfied', 'unsatisfied'].includes(result.status))) return stop('FC27_EA_REQUIREMENT_INPUT_UNVERIFIED');
    const source = await readSource();
    if (typeof source !== 'string' || source.length > 15000000) return stop('FC27_EA_REQUIREMENT_SOURCE_UNAVAILABLE');
    const methods = reviewedMethods(source);
    if (!methods) return stop('FC27_EA_REQUIREMENT_SOURCE_UNREVIEWED');
    // Keep only public algorithm attributes inside the VM; never forward arbitrary input fields.
    const fields = ['rating', 'rarity', 'nationId', 'leagueId', 'teamId', 'groups'];
    const [ea, eaOverall] = compare({ squad: squad.map(item => Object.fromEntries(fields.map(key => [key, item[key]]))),
      requirements: raw.map(rule => ({ scope: rule.scope, count: rule.count,
        pairs: rule.pairs.map(pair => ({ key: pair.key, values: pair.values })) })), clubLinks: transient.clubLinks,
      chemistry: plan.teamFacts.chemistry, teamRating: plan.teamFacts.teamRating }, methods);
    const expected = local.map(result => result.satisfied);
    if (!Array.isArray(ea) || ea.length !== expected.length || ea.some(value => typeof value !== 'boolean')
        || typeof eaOverall !== 'boolean') return stop('FC27_EA_REQUIREMENT_RESULT_UNVERIFIED');
    const match = ea.every((value, index) => value === expected[index]) && eaOverall === expected.every(Boolean);
    return { ...stop(match ? 'FC27_EA_REQUIREMENT_DIFFERENTIAL_MATCH' : 'FC27_EA_REQUIREMENT_DIFFERENTIAL_MISMATCH'),
      status: match ? 'verified' : 'mismatch', requirementsVerified: match, perRequirementMatch: match,
      local: expected, ea, localOverall: expected.every(Boolean), eaOverall, checkedMethodCount: Object.keys(hashes).length };
  } catch { return stop('FC27_EA_REQUIREMENT_CHECK_UNAVAILABLE'); }
}
