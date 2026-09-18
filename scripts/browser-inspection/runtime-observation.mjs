// Self-contained for Playwright serialization. Never call EA/FSU methods or getters.
// These FC26 field paths are observation candidates, not verified FC27 contracts.
export function observeRuntime(root = globalThis) {
  function descriptor(value, key) {
    try {
      for (let depth = 0; value && depth < 5; depth++, value = Object.getPrototypeOf(value)) {
        const found = Object.getOwnPropertyDescriptor(value, key);
        if (found) return found;
      }
    } catch { /* Unknown is safer than executing an accessor. */ }
    return null;
  }
  function data(value, key) {
    const found = descriptor(value, key);
    return found && Object.hasOwn(found, 'value') ? found.value : undefined;
  }
  function at(value, keys) {
    for (const key of keys) value = data(value, key);
    return value;
  }
  function state(value, key) {
    const found = descriptor(value, key);
    return !found ? 'absent' : !Object.hasOwn(found, 'value') ? 'accessor'
      : typeof found.value === 'function' ? 'function' : found.value == null ? 'null' : 'data';
  }
  function number(value, min = 0, max = 1e9) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  }
  const bool = value => typeof value === 'boolean' ? value : null;
  const enumValue = value => number(value, 0, 10000) ??
    (typeof value === 'string' && /^[A-Za-z][A-Za-z_-]{0,31}$/.test(value) ? value : null);
  const label = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
  const publicText = value => typeof value === 'string' && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : null;
  function numericArray(value, limit = 32) {
    if (!Array.isArray(value)) return null;
    const length = data(value, 'length');
    if (!Number.isInteger(length) || length > limit) return null;
    const result = [];
    for (let i = 0; i < length; i++) {
      const entry = number(data(value, String(i)), -1);
      if (entry === null) return null;
      result.push(entry);
    }
    return result;
  }
  function collection(value, limit, project) {
    for (let depth = 0; depth < 3 && data(value, '_collection') !== undefined; depth++) value = data(value, '_collection');
    if (!value || typeof value !== 'object') return { count: null, truncated: false, samples: [] };
    try {
      // Collection keys may be private item IDs. They are never included in output.
      const array = Array.isArray(value);
      if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        return { count: null, truncated: false, samples: [] };
      }
      const keys = array ? null : Object.getOwnPropertyNames(value);
      const count = array ? number(data(value, 'length')) : keys.length;
      if (count === null) return { count: null, truncated: false, samples: [] };
      const samples = [];
      for (let i = 0; i < Math.min(count, limit); i++) {
        const key = array ? String(i) : keys[i];
        samples.push(project(data(value, key), key));
      }
      return { count, truncated: count > limit, samples };
    } catch { return { count: null, truncated: false, samples: [] }; }
  }
  const refs = { item: new Map(), definition: new Map() };
  function alias(value, kind) {
    if (!(number(value, 1, Number.MAX_SAFE_INTEGER) !== null
        || typeof value === 'string' && /^\d{1,20}$/.test(value) && !/^0+$/.test(value))) return null;
    const key = String(value);
    if (!refs[kind].has(key)) refs[kind].set(key, `${kind}-${refs[kind].size + 1}`);
    return refs[kind].get(key);
  }
  function itemField(item, key) {
    for (const candidate of [item, data(item, '_data'), data(item, '_staticData')]) {
      const value = data(candidate, key);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  function item(value) {
    const read = key => itemField(value, key);
    const type = ['PLAYER', 'MANAGER', 'CONSUMABLE', 'MISC'].find(key => {
      const known = at(root, ['ItemType', key]);
      return known !== undefined && known === read('type');
    });
    return { itemRef: alias(read('id'), 'item'), definitionRef: alias(read('definitionId'), 'definition'),
      type: type ? type.toLowerCase() : ['player', 'manager', 'staff', 'consumable', 'misc'].includes(read('type')) ? read('type') : number(read('type'), 0, 1000),
      rating: number(read('rating'), 1, 99), rareflag: number(read('rareflag'), 0, 10000),
      loans: number(read('loans'), -1, 10000), untradeable: bool(read('untradeable')),
      tradable: bool(read('tradable')), limitedUseType: number(read('limitedUseType'), 0, 100),
      upgradesPresent: data(value, 'upgrades') === null ? false : typeof data(value, 'upgrades') === 'object' ? true : null,
      academyFlags: { enrolled: bool(at(value, ['upgrades', 'enrolled'])),
        activeInEvolution: bool(at(value, ['upgrades', 'activeInEvolution'])) },
      evolution: bool(read('evolution')), concept: bool(read('concept')),
      academyEnrolled: bool(read('academyEnrolled')), activeTrade: bool(read('activeTrade')),
      cosmeticCount: collection(data(value, 'cosmetics'), 0, () => null).count,
      hyperCosmeticCount: collection(data(value, '_hyperCosmeticDTOs'), 0, () => null).count,
      state: enumValue(read('state')), pile: enumValue(read('pile')),
      utasPile: number(read('utasPile'), 0, 100),
      endTime: number(read('endTime'), -1, Number.MAX_SAFE_INTEGER),
      auction: { source: state(value, '_auction'), state: enumValue(at(value, ['_auction', 'tradeState'])),
        fields: Object.fromEntries(['tradeId', 'id', 'state', 'tradeState', 'expires']
          .map(key => [key, state(data(value, '_auction'), key)])) },
      fieldStates: Object.fromEntries(['id', 'definitionId', 'rating', '_rating', 'rareflag', '_rareflag',
        'untradeable', '_untradeable', 'tradeable', '_tradeable', '_data', '_staticData',
        'type', 'leagueId', 'pile', 'state', 'endTime', 'cosmetics', '_hyperCosmeticDTOs', 'auctionData', '_auctionData']
        .map(key => [key, state(value, key)])),
      backingFields: { rating: number(data(value, '_rating'), 1, 99),
        rareflag: number(data(value, '_rareflag'), 0, 10000),
        untradeable: bool(data(value, '_untradeable')), tradeable: bool(data(value, '_tradeable')) },
      methods: Object.fromEntries(['isPlayer', 'isSpecial', 'isLoan', 'isConcept', 'isEnrolledInAcademy']
        .map(key => [key, state(value, key)])) };
  }
  const eligibility = data(root, 'SBCEligibilityKey');
  const keyNames = ['PLAYER_MIN_OVR', 'PLAYER_MAX_OVR', 'PLAYER_EXACT_OVR', 'PLAYER_QUALITY',
    'PLAYER_LEVEL', 'PLAYER_RARITY', 'PLAYER_RARITY_GROUP', 'TEAM_RATING', 'CHEMISTRY_POINTS',
    'ALL_PLAYERS_CHEMISTRY_POINTS', 'SQUAD_PLAYER_COUNT', 'PLAYER_COUNT', 'TEAM_SIZE'];
  function requirementKey(value) {
    return number(value) ?? (typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : label(value));
  }
  function keyName(value) {
    if (typeof value === 'string') return label(value);
    return value === null ? null : keyNames.find(key => data(eligibility, key) === value) ?? null;
  }
  function requirement(value) {
    const key = requirementKey(data(value, 'key'));
    const pairs = collection(data(value, 'kvPairs'), 8, (entry, rawKey) => {
      const parsed = requirementKey(rawKey);
      return { key: parsed, keyName: keyName(parsed), values: numericArray(entry) };
    });
    return { key, keyName: keyName(key), count: number(data(value, 'count'), 0, 99),
      scope: label(data(value, 'scope')) ?? number(data(value, 'scope')),
      values: numericArray(data(value, 'values')), pairs: pairs.samples,
      pairsCount: pairs.count, truncated: pairs.truncated };
  }
  function reward(value) {
    return { type: publicText(data(value, 'type')) ?? number(data(value, 'type')), id: number(data(value, 'id')),
      value: number(data(value, 'value')), name: publicText(data(value, 'name')),
      packId: number(data(value, 'packId')), count: number(data(value, 'count'), 0, 1000),
      untradeable: bool(data(value, 'untradeable')), tradable: bool(data(value, 'tradable')) };
  }
  function challenge(value) {
    return { id: number(data(value, 'id')), setId: number(data(value, 'setId')), name: publicText(data(value, 'name')),
      status: label(data(value, 'status')) ?? number(data(value, 'status')),
      eligibilityOperation: label(data(value, 'eligibilityOperation')) ?? number(data(value, 'eligibilityOperation')),
      completed: bool(data(value, 'completed')), requiredPlayerCount: number(data(value, 'requiredPlayerCount'), 1, 11),
      formation: number(data(value, 'formation')), brickIndices: numericArray(at(value, ['squad', 'simpleBrickIndices']), 11),
      customBrickIndices: numericArray(at(value, ['squad', 'customBrickIndices']), 11),
      fieldPlayerSlots: number(at(root, ['UTSquadEntity', 'FIELD_PLAYERS']), 1, 11),
      requirements: collection(data(value, 'eligibilityRequirements'), 16, requirement),
      rewards: collection(data(value, 'awards'), 6, reward) };
  }
  function sbcSet(value) {
    return { id: number(data(value, 'id')), name: publicText(data(value, 'name')), complete: bool(data(value, 'complete')),
      repeats: number(data(value, 'repeats')), timesCompleted: number(data(value, 'timesCompleted')),
      challengeIds: numericArray(data(value, 'challengeIds')),
      fieldStates: Object.fromEntries(['name', '_name', 'challenges', '_challenges', 'challengeIds', 'awards', 'data', '_data']
        .map(key => [key, state(value, key)])),
      rewards: collection(data(value, 'awards'), 6, reward),
      challenges: collection(data(value, 'challenges') ?? data(value, '_challenges'), 8, challenge) };
  }
  const service = at(root, ['services', 'SBC']);
  const repo = data(service, 'repository') ?? at(root, ['repositories', 'SBC']);
  const itemRepo = at(root, ['repositories', 'Item']);
  const inventory = Object.fromEntries(['club', 'storage', 'unassigned', 'transfer'].map(pile => {
    const source = data(itemRepo, pile);
    const entries = pile === 'club' ? data(source, 'items') : source;
    const observed = collection(entries, 6, item);
    let cachedPlayers = null;
    const playerSamples = [];
    const playerType = at(root, ['ItemType', 'PLAYER']);
    if (observed.count !== null && observed.count <= 20000 && enumValue(playerType) !== null) {
      cachedPlayers = 0;
      collection(entries, 20000, value => {
        if (itemField(value, 'type') === playerType) {
          cachedPlayers++;
          if (playerSamples.length < 6) playerSamples.push(item(value));
        }
        return null;
      });
    }
    return [pile, { source: state(itemRepo, pile), ...observed,
      cachedPlayers, typesComplete: cachedPlayers !== null, playerSamples }];
  }));
  const info = data(root, 'info');
  const bridge = data(root, 'FSULocalRunnerBridge');
  const userService = at(root, ['services', 'User']);
  const userId = data(userService, 'currentUserId');
  const user = at(userService, ['repository', '_collection', String(userId)]);
  const personaId = data(user, 'selectedPersona');
  const persona = at(user, ['_personas', '_collection', String(personaId)]);
  const sku = data(persona, '_sku');
  const club = at(persona, ['clubs', '_collection', String(sku)]);
  const rawCacheStatus = at(info, ['base', 'clubCache', 'status']);
  return { schema: 1, evidence: 'passive-data-descriptors', liveExecutionEnabled: false,
    itemTypeEnums: Object.fromEntries(['PLAYER', 'MANAGER', 'CONSUMABLE', 'MISC']
      .map(key => [key, enumValue(at(root, ['ItemType', key]))])),
    eligibilityScopeEnums: Object.fromEntries(['GREATER', 'LOWER', 'EXACT'].map(key => [key, number(at(root, ['SBCEligibilityScope', key]))])),
    itemSafetyEnums: { limitedUseNone: enumValue(at(root, ['LimitedUseType', 'NONE'])),
      common: enumValue(at(root, ['ItemRarity', 'NONE'])), rare: enumValue(at(root, ['ItemRarity', 'RARE'])),
      free: enumValue(at(root, ['ItemState', 'FREE'])), club: enumValue(at(root, ['ItemPile', 'CLUB'])) },
    contextFields: { userService: state(data(root, 'services'), 'User'),
      userMatched: number(userId, 1, Number.MAX_SAFE_INTEGER) !== null && data(user, 'id') === userId,
      personaMatched: number(personaId, 1, Number.MAX_SAFE_INTEGER) !== null && data(persona, 'id') === personaId,
      skuMatched: typeof sku === 'string' && data(club, 'sku') === sku,
      clubYear: number(data(club, 'year'), 2024, 2100), platform: enumValue(data(club, 'platform')),
      fields: Object.fromEntries(['currentUserId', 'repository', 'getUser'].map(key => [key, state(userService, key)])) },
    inventory, sbc: { repository: state(service, 'repository'),
      methods: Object.fromEntries(['requestSets', 'requestChallengesForSet', 'loadChallenge', 'loadChallengeData',
        'saveChallenge', 'submitChallenge'].map(key => [key, state(service, key)])),
      sets: collection(data(repo, 'sets'), 12, sbcSet),
      challenges: collection(data(repo, 'challenges'), 24, challenge) },
    fsu: { verified: false, info: state(root, 'info'),
      clubState: bool(at(info, ['base', 'state'])),
      cacheStatus: ['miss', 'invalid', 'validating', 'trusted-provisional', 'validation-failed', 'finalizing', 'ready']
        .includes(rawCacheStatus) ? rawCacheStatus : null,
      policy: Object.fromEntries(['untradeable', 'academy', 'league', 'firststorage']
        .map(key => [key, bool(at(info, ['build', key]))])),
      goldenMax: number(at(info, ['set', 'goldenrange']), 75, 99),
      locks: state(info, 'lock'),
      targetedValidation: state(data(root, 'events'), 'validateClubPlayers'),
      bridge: Object.fromEntries(['describe', 'getPolicy', 'getLocks', 'getClubState', 'validateClubPlayers']
        .map(key => [key, state(bridge, key)])) },
    limitations: ['NO_METHODS_INVOKED', 'NO_ACCOUNT_SCOPE_VERIFICATION', 'SAMPLES_NOT_COMPLETE_INVENTORY',
      'NO_LIVE_ELIGIBILITY_VERIFICATION', 'NO_TRANSACTION_AUTHORIZATION'] };
}
