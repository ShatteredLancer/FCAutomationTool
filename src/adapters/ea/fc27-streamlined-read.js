import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, snapshotFc27ClubPlayer, isFc27PlayerItem } from './fc27-local-read.js';
import { normalizeStreamlinedChallenge, normalizeStreamlinedItem, integer, fail, same } from '../../streamlined/contract.js';
import { createStreamlinedEligibility } from '../../streamlined/eligibility.js';

const at = (root, path) => path.split('.').reduce((v, key) => ownData(v, key), root);
function values(input, limit) {
  for (let i = 0; i < 3 && ownData(input, '_collection') !== undefined; i++) input = ownData(input, '_collection');
  if (!input || typeof input !== 'object') fail('COLLECTION_UNKNOWN');
  const keys = Object.getOwnPropertyNames(input).filter(key => key !== 'length');
  if (keys.length > limit) fail('COLLECTION_LIMIT');
  return keys.map(key => ownData(input, key));
}

const verifiedActiveSquads = new WeakMap();
const ids = (value, max = 20000) => {
  if (!Array.isArray(value) || value.length > max) fail('PROTECTION_UNVERIFIED');
  const numbers = Array.from({ length: value.length }, (_, index) => ownData(value, String(index)));
  if (numbers.some(id => !integer(id))) fail('PROTECTION_UNVERIFIED');
  return [...new Set(numbers.filter(id => id > 0))].sort((a, b) => a - b);
};

// FSU Local lock.save uses exact item IDs. The native active squad supplies
// all 23 slots, not just the starting XI. Never infer "unprotected" from an
// absent list. A native SBC cache eviction may reuse only a previously bound
// roster with the same account/squad and matching FSU roster, never a guess.
export function readFc27StreamlinedProtection(root) {
  const context = readFc27Context(root), lockedItemIds = ids(at(root, 'info.lock'));
  const activeSquadId = at(root, 'services.Squad.activeSquad');
  if (!integer(activeSquadId, 1)) fail('PROTECTION_UNVERIFIED');
  const userId = at(root, 'services.User.currentUserId');
  const personaId = at(root, `services.User.repository._collection.${userId}.selectedPersona`);
  const squad = at(root, `repositories.Squad.squads._collection.${personaId}._collection.${activeSquadId}`);
  const slots = ownData(squad, '_players'), total = ownData(ownData(root, 'UTSquadEntity'), 'TOTAL_PLAYERS');
  const fsuRoster = at(root, 'info.squad');
  let activeSquadItemIds;
  if (squad !== undefined) {
    if (ownData(squad, '_id') !== activeSquadId || !integer(total, 11, 100)
        || !Array.isArray(slots) || slots.length !== total) fail('PROTECTION_UNVERIFIED');
    activeSquadItemIds = ids(Array.from({ length: slots.length }, (_, index) =>
      ownData(ownData(ownData(slots, String(index)), '_item'), 'id')), 100);
    // Keep FSU's last known members protected too if the native cache has
    // just updated; a stale protection list may overprotect, never expose.
    const fsuIds = fsuRoster === undefined ? [] : ids(fsuRoster, 100);
    verifiedActiveSquads.set(root, { context, activeSquadId, activeSquadItemIds, fsuIds });
    activeSquadItemIds = [...new Set([...activeSquadItemIds, ...fsuIds])].sort((a, b) => a - b);
  } else {
    const previous = verifiedActiveSquads.get(root), fsuIds = ids(fsuRoster, 100);
    if (!previous || !same(previous.context, context) || previous.activeSquadId !== activeSquadId
        || !same(previous.fsuIds, fsuIds)) fail('PROTECTION_UNVERIFIED');
    activeSquadItemIds = [...new Set([...previous.activeSquadItemIds, ...fsuIds])].sort((a, b) => a - b);
  }
  return { lockedItemIds, activeSquadId, activeSquadItemIds };
}

export function assertFc27StreamlinedPolicy(root, expected, items = []) {
  const current = readFc27StreamlinedPolicy(root, expected.maxRating, expected.marketMaxRating);
  if (!same(current, expected)) {
    // Old journals remain frozen and readback stays available. The sole
    // migration exception adds current protection to old false/false plans;
    // it never restores their old permission to consume protected items.
    const { lockedItemIds: _locks, activeSquadId: _squad, activeSquadItemIds: _members, ...base } = current;
    if (expected.protectFsuLockedPlayers !== false || expected.protectActiveSquad !== false
        || !same({ ...base, protectFsuLockedPlayers: false, protectActiveSquad: false }, expected)) fail('POLICY_CHANGED');
  }
  const locked = new Set(current.lockedItemIds), active = new Set(current.activeSquadItemIds);
  if (items.some(item => item.source === 'inventory' && (locked.has(item.id) || active.has(item.id)))) fail('MATERIAL_CHANGED');
  return current;
}

// Observed One Click controller chain, independent of FSU/Futto hooks.
// No service method, navigation, selection or network call is made here.
export function locateFc27StreamlinedPage(root) {
  try {
    let controller = root.getAppMain().getRootViewController();
    for (let depth = 0; depth < 8 && controller; depth++) {
      if (typeof root.UTOneClickSBCWorkAreaSplitViewController === 'function'
          && controller instanceof root.UTOneClickSBCWorkAreaSplitViewController) {
        const work = ownData(controller, 'workAreaController'), vm = ownData(work, 'viewModel');
        const challenge = vm?.getChallenge?.(), set = vm?.getSet?.();
        if (challenge?.isOneClickChallenge?.() !== true || challenge.setId !== set?.id
            || !integer(challenge.id, 1) || !integer(set.id, 1)) return null;
        const anchor = work.getView?.()?.getRootElement?.();
        if (!anchor?.isConnected || anchor.ownerDocument !== root.document) return null;
        return { controller, vm, challenge, set, anchor, setId: set.id, challengeId: challenge.id };
      }
      controller = ownData(controller, 'currentController');
    }
  } catch { /* Native page not ready. */ }
  return null;
}

export function projectFc27StreamlinedChallenge(page, context) {
  const { challenge, set, vm } = page;
  if (challenge?.isOneClickChallenge?.() !== true || challenge.setId !== set?.id) fail('CONTRACT_UNVERIFIED');
  const eligibility = values(ownData(challenge, 'eligibilityRequirements'), 32).map(rule => {
    const pairs = ownData(ownData(rule, 'kvPairs'), '_collection');
    if (!pairs || typeof pairs !== 'object') fail('ELIGIBILITY_UNVERIFIED');
    return { count: ownData(rule, 'count'), scope: ownData(rule, 'scope'),
      pairs: Object.keys(pairs).map(key => ({ key: Number(key), values: ownData(pairs, key) })) };
  });
  return normalizeStreamlinedChallenge({ context, id: challenge.id, setId: set.id, isOneClick: true,
    name: challenge.name ?? set.name, status: challenge.status, scoreRequirement: challenge.scoreRequirement,
    submittedScore: challenge.submittedScore, selectionLimit: vm.getSelectionLimit(),
    eligibility, eligibilityOperation: challenge.eligibilityOperation,
    repeats: set.repeats, repeatabilityMode: set.repeatabilityMode, endTime: set.endTime });
}

// Fodder rO observation: pairs 41=attribute, 40=targets, 42=extra targets.
// Delegate semantics to EA's VO, including OR. Unknown structures stop.
export function createFc27StreamlinedMatcher(root, contract, entities) {
  const rules = contract.eligibility.map(rule => {
    const pairs = new Map(rule.pairs.map(p => [p.key, p.values]));
    if (rule.count !== -1 || rule.scope === -1 || pairs.get(41)?.length !== 1 || !pairs.has(40)
        || [...pairs.keys()].some(key => ![40, 41, 42].includes(key))
        || typeof root.UTEvolutionEligibilityVO !== 'function') fail('ELIGIBILITY_UNVERIFIED');
    const vo = new root.UTEvolutionEligibilityVO({ attribute: pairs.get(41)[0], scope: rule.scope,
      targets: [...pairs.get(40), ...(pairs.get(42) ?? [])] });
    if (vo.isValid !== true || typeof vo.meetsRequirements !== 'function') fail('ELIGIBILITY_UNVERIFIED');
    return vo;
  });
  return createStreamlinedEligibility({ rules, matcher: item => {
    const entity = entities.get(item.source === 'market' ? `market:${item.definitionId}` : item.id);
    if (!entity || entity.definitionId !== item.definitionId) return null;
    const matched = rules.map(vo => vo.meetsRequirements(entity));
    if (matched.some(v => typeof v !== 'boolean')) return null;
    return contract.eligibilityOperation === 'OR' ? matched.some(Boolean) : matched.every(Boolean);
  } });
}

export function projectFc27StreamlinedItem(item, root, pile, protection = readFc27StreamlinedProtection(root)) {
  const base = snapshotFc27ClubPlayer(item, root);
  const staticData = ownData(item, '_staticData');
  const ownString = (object, key) => {
    const value = ownData(object, key);
    const text = typeof value === 'string' ? value.trim() : '';
    // EA uses `---` when a card has no known-as alias. It is a display
    // placeholder, not a player name; continue to the loaded full-name fields.
    return text && text !== '---' ? text : null;
  };
  // FC27 stores the display name on the static card payload. Keep this
  // projection read-only: no model getters or EA calls are invoked here.
  const name = ownString(item, 'displayName')
    ?? ownString(item, 'name')
    ?? ownString(staticData, 'knownAs')
    ?? ([ownString(staticData, 'firstName'), ownString(staticData, 'lastName')].filter(Boolean).join(' ') || null)
    ?? ownString(staticData, 'name')
    ?? ownString(item, 'lastName');
  // sbsScore is the native preview accessor, intentionally read (no rating formula).
  let points = null; try { points = item.sbsScore; } catch { /* Unknown remains null. */ }
  return normalizeStreamlinedItem({ ...base, pile, points, scoreVerified: integer(points, 1),
    locked: protection.lockedItemIds.includes(base.id), activeSquad: protection.activeSquadItemIds.includes(base.id),
    protected: base.special !== false || base.evolution !== false || base.cosmetic !== false,
    duplicateId: ownData(item, 'duplicateId'), name, price: null, source: 'inventory' });
}

export function readFc27StreamlinedInputs(root, settings = {}) {
  const page = locateFc27StreamlinedPage(root);
  if (!page) fail('PAGE_UNAVAILABLE');
  const context = readFc27Context(root);
  const challenge = projectFc27StreamlinedChallenge(page, context);
  // Streamlined has no Puzzle 82 ceiling. Read the FSU protection state, then
  // apply the explicit Streamlined ceiling; FSU's range still protects stock.
  const policy = readFc27StreamlinedPolicy(root, settings.maxRating ?? 99, settings.marketMaxRating ?? 99);
  const entities = new Map(), inventory = [];
  const sources = settings.sources ?? ['club', 'storage'];
  const allowedPiles = ['club', 'storage', 'unassigned', 'transfer'];
  const inventoryByPile = Object.fromEntries(allowedPiles.map(pile => [pile, 0]));
  const rawByPile = Object.fromEntries(allowedPiles.map(pile => [pile, 0]));
  const skippedNonPlayerByPile = Object.fromEntries(allowedPiles.map(pile => [pile, 0]));
  const inventoryTradeability = { tradeable: 0, untradeable: 0, unknown: 0 };
  for (const pile of sources) {
    if (!allowedPiles.includes(pile)) fail('PILE_UNVERIFIED');
    const repository = at(root, 'repositories.Item');
    const repo = at(root, `repositories.Item.${pile}`);
    let raw;
    try {
      const getter = pile === 'unassigned' ? repository?.getUnassignedItems
        : pile === 'transfer' ? repository?.getTransferItems : null;
      raw = typeof getter === 'function' ? getter.call(repository) : ownData(repo, 'items') ?? repo;
    } catch { fail('PILE_UNAVAILABLE'); }
    if (raw == null) { if (pile === 'storage') continue; fail('PILE_UNAVAILABLE'); }
    for (const item of values(raw, 20000)) {
      rawByPile[pile]++;
      if (!isFc27PlayerItem(item)) { skippedNonPlayerByPile[pile]++; continue; }
      if (entities.has(item.id)) fail('IDENTITY_CONFLICT');
      entities.set(item.id, item);
      const projected = projectFc27StreamlinedItem(item, root, pile, policy);
      if (!projected) fail('IDENTITY_CONFLICT');
      inventory.push(projected);
      inventoryByPile[pile]++;
      if (projected.tradeable === true) inventoryTradeability.tradeable++;
      else if (projected.tradeable === false) inventoryTradeability.untradeable++;
      else inventoryTradeability.unknown++;
    }
  }
  const eligibility = createFc27StreamlinedMatcher(root, challenge, entities);
  const assertCurrent = () => {
    const current = locateFc27StreamlinedPage(root);
    if (!current || current.controller !== page.controller || !same(readFc27Context(root), context)
        || !same(projectFc27StreamlinedChallenge(current, context), challenge)
        || !same(readFc27StreamlinedPolicy(root, settings.maxRating ?? 99, settings.marketMaxRating ?? 99), policy)) fail('CONTEXT_CHANGED');
  };
  assertCurrent();
  return { context, challenge, policy, inventory, inventoryStats: {
      count: inventory.length, rawByPile, skippedNonPlayerByPile, byPile: inventoryByPile, tradeability: inventoryTradeability,
      sources: [...sources], transferSupported: sources.includes('transfer'), unassignedSupported: sources.includes('unassigned'),
    }, eligibility, assertCurrent,
    registerMarketEntity(item, entity) {
      assertCurrent();
      if (item?.source !== 'market' || entity?.definitionId !== item.definitionId || entity.concept !== true) fail('MARKET_IDENTITY_INVALID');
      entities.set(`market:${item.definitionId}`, entity);
    },
    // UI-only reference, never included in a plan/Journal or diagnostic export.
    resolveDisplayItem(ref) {
      assertCurrent();
      const key = ref?.source === 'market' ? `market:${ref.definitionId}` : ref?.id;
      const raw = entities.get(key);
      if (raw?.definitionId !== ref?.definitionId) return null;
      if (ref?.source === 'market') return raw?.concept === true ? raw : null;
      return raw?.concept === false ? raw : null;
    },
    // Repository presence is provisional, never proof of a fresh full inventory.
    inventoryComplete: false, priceRows: inventory.map(item => {
      const raw = entities.get(item.id);
      return { definitionId: item.definitionId, rating: item.rating, nationId: raw.nationId,
        leagueId: raw.leagueId, teamId: raw.teamId, preferredPosition: raw.preferredPosition };
    }) };
}

export function readFc27StreamlinedPolicy(root, maxRating = 99, marketMaxRating = undefined) {
  if (!integer(maxRating, 1, 99) || marketMaxRating !== undefined && !integer(marketMaxRating, 1, 99)) fail('POLICY_INVALID');
  const context = readFc27Context(root), base = at(root, 'info.base');
  const flags = ['untradeable', 'academy', 'league', 'firststorage'].map(key => at(root, `info.build.${key}`));
  const goldenMax = at(root, 'info.set.goldenrange'), leagues = at(root, 'info.set.shield_league');
  if (![27, '27'].includes(ownData(base, 'year')) || ownData(base, 'initialized') !== true
      || !['ready', 'finalizing', 'trusted-provisional', 'validating', 'validation-failed'].includes(at(base, 'clubCache.status'))) fail('FSU_NOT_READY');
  if (flags.some(v => typeof v !== 'boolean') || !integer(goldenMax, 75, 99)
      || !Array.isArray(leagues) || leagues.length > 200 || leagues.some(v => !integer(v, 1))) fail('POLICY_UNVERIFIED');
  return { schema: 1, context, reviewed: true,
    // Market demand uses the explicit Streamlined ceiling. Keep the FSU
    // range separately so expanding procurement never exposes protected stock.
    maxRating, ...(marketMaxRating !== undefined ? { marketMaxRating } : {}), onlyUntradeable: flags[0],
    protectFsuLockedPlayers: true, protectActiveSquad: true,
    storageFirst: flags[3], goldRange: [75, goldenMax], excludedLeagueIds: flags[2] ? [...leagues] : [],
    // Snapshot relevant upstream settings even where FCAT is stricter.
    fsuOnlyUntradeable: flags[0], fsuExcludeEvolution: flags[1], ...readFc27StreamlinedProtection(root) };
}

export function inspectFc27Streamlined(root) {
  try {
    const page = locateFc27StreamlinedPage(root);
    if (!page) fail('PAGE_UNAVAILABLE');
    const challenge = projectFc27StreamlinedChallenge(page, readFc27Context(root));
    const { context: _context, ...safe } = challenge;
    return { status: 'observed', challenge: safe, liveExecutionEnabled: false,
      pending: ['SUBMIT_RESPONSE', 'ALLOWED_PILES', 'OVERFLOW', 'REWARD', 'CROSS_BATCH'] };
  } catch (error) {
    return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_READ_UNAVAILABLE', liveExecutionEnabled: false };
  }
}
