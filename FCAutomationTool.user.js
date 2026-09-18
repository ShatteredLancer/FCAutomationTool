// ==UserScript==
// @name         FC Automation Tool
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool
// @version      27.0.0
// @description  FC27 traditional SBC preparation and recovery. Live execution pending acceptance.
// @homepageURL  https://github.com/ShatteredLancer/FCAutomationTool
// @supportURL   https://github.com/ShatteredLancer/FCAutomationTool/issues
// @updateURL    https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.meta.js
// @downloadURL  https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.user.js
// @license      MIT
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

(() => {
  // src/fc27/prelaunch-contract.js
  var BRIDGE_CAPABILITIES = Object.freeze(["policy", "locks", "club", "targetedValidation"]);
  function ownData(object, key) {
    try {
      return Object.getOwnPropertyDescriptor(object, key)?.value;
    } catch {
      return void 0;
    }
  }
  function identity(value, field) {
    if (typeof value !== "string" || !value || value !== value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value) || /^(default|unknown|null|undefined)$/i.test(value)) {
      throw new TypeError(`${field} is required and must be explicit`);
    }
    return value;
  }
  function createSeasonContext(input = {}) {
    const schema = ownData(input, "schema");
    if (schema !== void 0 && schema !== 1) throw new TypeError("Unsupported context schema");
    const season = identity(ownData(input, "season"), "season");
    if (!/^\d{2}$/.test(season)) throw new TypeError("season must be a two-digit season");
    return Object.freeze({
      schema: 1,
      season,
      accountScope: identity(ownData(input, "accountScope"), "accountScope"),
      platform: identity(ownData(input, "platform"), "platform")
    });
  }
  function contextKey(input, name, schema = 1) {
    const context = createSeasonContext(input);
    if (!Number.isSafeInteger(schema) || schema < 1) throw new TypeError("invalid schema");
    return `fcat:${JSON.stringify([schema, context.season, context.accountScope, context.platform, identity(name, "name")])}`;
  }
  var OBSERVED_ROOTS = Object.freeze([
    "APP_YEAR_SHORT",
    "repositories",
    "services",
    "UTItemEntity",
    "UTSBCService",
    "UTSBCChallengeEntity",
    "FSULocalRunnerBridge",
    "info"
  ]);

  // src/domain/player-rarity.js
  function callBoolean(item, method2) {
    try {
      const value = item?.[method2]?.();
      return typeof value === "boolean" ? value : null;
    } catch {
      return null;
    }
  }
  function readExplicitPlayerRareFlag(item = {}) {
    const explicitValues = [
      item.rareflag,
      item.rareFlag,
      item._rareflag,
      item._data?.rareflag,
      item._data?.rareFlag,
      item._staticData?.rareflag,
      item._staticData?.rareFlag
    ].map(Number).filter(Number.isFinite);
    return explicitValues.length ? Math.max(0, ...explicitValues) : null;
  }
  function readPlayerRareFlag(item = {}) {
    const explicitRareFlag = readExplicitPlayerRareFlag(item);
    if (explicitRareFlag !== null) return explicitRareFlag;
    if (item.special === true || callBoolean(item, "isSpecial") === true) return 2;
    if (item.rare === true || callBoolean(item, "isRare") === true) return 1;
    return 0;
  }
  function isSpecialPlayerCard(item = {}) {
    return readPlayerRareFlag(item) > 1;
  }

  // src/adapters/ea/fc27-local-read.js
  var identity2 = (value) => Number.isSafeInteger(value) && value > 0;
  var integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  var boolean = (value) => typeof value === "boolean" ? value : null;
  var at = (value, keys2) => keys2.reduce((next, key) => ownData(next, key), value);
  function readFc27Context(root) {
    const service = at(root, ["services", "User"]);
    const userId = ownData(service, "currentUserId");
    const user = at(service, ["repository", "_collection", String(userId)]);
    const personaId = ownData(user, "selectedPersona");
    const persona = at(user, ["_personas", "_collection", String(personaId)]);
    const sku = ownData(persona, "_sku");
    const club = at(persona, ["clubs", "_collection", String(sku)]);
    const platform = ownData(club, "platform");
    if (![27, "27"].includes(ownData(root, "APP_YEAR_SHORT")) || ownData(root, "APP_YEAR") !== 2027 || !identity2(userId) || ownData(user, "id") !== userId || !identity2(personaId) || ownData(persona, "id") !== personaId || typeof sku !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(sku) || ownData(club, "sku") !== sku || ownData(club, "year") !== 2027 || typeof platform !== "string" || !/^[A-Za-z0-9_-]{1,24}$/.test(platform) || /^(none|unknown|default)$/i.test(platform)) {
      throw new Error("FC27_CONTEXT_UNAVAILABLE");
    }
    return createSeasonContext({ season: "27", accountScope: `ea:${userId}:${personaId}`, platform: `${platform}:${sku}` });
  }
  function entries(value) {
    for (let i = 0; i < 3 && ownData(value, "_collection") !== void 0; i++) value = ownData(value, "_collection");
    if (!value || typeof value !== "object" || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("FC27_COLLECTION_UNAVAILABLE");
    const keys2 = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
    if (keys2.length > 2e4) throw new Error("FC27_COLLECTION_LIMIT");
    return keys2.map((key) => {
      const item = ownData(value, key);
      if (!item || typeof item !== "object") throw new Error("FC27_COLLECTION_UNAVAILABLE");
      return item;
    });
  }
  function snapshotFc27ClubPlayer(item, root) {
    const get = (key) => ownData(item, key);
    const id2 = get("id");
    const definitionId = get("definitionId");
    if (!identity2(id2) || !identity2(definitionId)) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
    const upgrades = get("upgrades");
    const noUpgrades = upgrades === null;
    const pile = get("utasPile");
    const clubPile = at(root, ["ItemPile", "CLUB"]);
    const evolutionPile = at(root, ["ItemPile", "EVOLUTION"]);
    const baseRarity = integer(get("_rareflag"), 0, 1e4);
    const common = at(root, ["ItemRarity", "NONE"]);
    const rare = at(root, ["ItemRarity", "RARE"]);
    const cosmetics = get("cosmetics");
    const hyper = get("_hyperCosmeticDTOs");
    const cosmetic = Array.isArray(cosmetics) && hyper && typeof hyper === "object" && !Array.isArray(hyper) ? cosmetics.length > 0 || Object.getOwnPropertyNames(hyper).length > 0 : null;
    const limitedType = integer(get("limitedUseType"), 0, 100);
    const none = at(root, ["LimitedUseType", "NONE"]);
    const startTime = integer(get("startTime"), -1, Number.MAX_SAFE_INTEGER);
    const endTime = integer(get("endTime"), -1, Number.MAX_SAFE_INTEGER);
    const auctionState = ownData(get("_auction"), "_tradeState");
    const inactive = at(root, ["AuctionTradeStateEnum", "INACTIVE"]);
    const active = at(root, ["AuctionTradeStateEnum", "ACTIVE"]);
    const snapshot = {
      id: id2,
      definitionId,
      type: "player",
      pile: clubPile !== void 0 && pile === clubPile ? "club" : null,
      rating: noUpgrades ? integer(get("_rating"), 1, 99) : null,
      rarity: noUpgrades ? baseRarity : null,
      special: noUpgrades && baseRarity !== null && common === 0 && rare === 1 ? isSpecialPlayerCard({ rareflag: baseRarity }) : null,
      evolution: evolutionPile !== void 0 && pile === evolutionPile ? true : noUpgrades ? false : upgrades === void 0 ? null : true,
      cosmetic,
      concept: boolean(get("concept")),
      academyEnrolled: noUpgrades ? false : boolean(ownData(upgrades, "enrolled")),
      tradeable: boolean(get("tradable")),
      loans: integer(get("loans"), -1, 1e4),
      limitedUse: limitedType !== null && Number.isInteger(none) && startTime !== null && endTime !== null ? limitedType !== none || startTime !== -1 || endTime !== -1 : null,
      leagueId: integer(get("leagueId"), 1, 1e9),
      state: typeof get("state") === "string" && get("state").length <= 32 ? get("state") : null,
      activeTrade: auctionState === active && active === "active" ? true : auctionState === inactive && inactive === "inactive" && get("state") === "free" ? false : null,
      // These need explicit FSU/active-squad policy evidence, not cached defaults.
      locked: null,
      activeSquad: null,
      protected: null
    };
    const marketAverage = integer(get("_marketAverage"), 1, 15e6);
    return Object.freeze({ ...snapshot, safetyFingerprint: JSON.stringify(snapshot), marketAverage });
  }
  function readFc27CachedClub(root) {
    const context = readFc27Context(root);
    const playerType = at(root, ["ItemType", "PLAYER"]);
    if (playerType !== "player") throw new Error("FC27_PLAYER_TYPE_UNVERIFIED");
    const cached = entries(at(root, ["repositories", "Item", "club", "items"]));
    const items = cached.filter((item) => ownData(item, "type") === playerType).map((item) => snapshotFc27ClubPlayer(item, root));
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
    if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)) throw new Error("FC27_CONTEXT_CHANGED");
    return Object.freeze({
      schema: 1,
      context,
      kind: "cached-club-inspection",
      status: "partial",
      complete: false,
      liveExecutionEnabled: false,
      cachedEntries: cached.length,
      items: Object.freeze(items)
    });
  }

  // src/adapters/ea/fc27-sbc-read.js
  async function inspectInProgressSquad({ setId, challengeId } = {}, root = globalThis, observedChallenge = null) {
    const stop2 = (reason) => ({ status: "blocked", reason, liveExecutionEnabled: false });
    function data(value, key) {
      try {
        for (let depth = 0; value && depth < 5; depth++, value = Object.getPrototypeOf(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : void 0;
        }
      } catch {
      }
      return void 0;
    }
    function values5(value, limit) {
      for (let i = 0; i < 3 && data(value, "_collection") !== void 0; i++) value = data(value, "_collection");
      if (!value || typeof value !== "object") return [];
      const keys2 = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
      if (keys2.length > limit) return [];
      return keys2.map((key) => data(value, key));
    }
    function find() {
      if (![27, "27"].includes(data(root, "APP_YEAR_SHORT"))) return null;
      const userService = data(data(root, "services"), "User");
      const userId = data(userService, "currentUserId");
      const user = data(data(data(userService, "repository"), "_collection"), String(userId));
      const personaId = data(user, "selectedPersona");
      const persona = data(data(data(user, "_personas"), "_collection"), String(personaId));
      const sku = data(persona, "_sku");
      const club = data(data(data(persona, "clubs"), "_collection"), String(sku));
      if (!Number.isSafeInteger(userId) || userId <= 0 || data(user, "id") !== userId || !Number.isSafeInteger(personaId) || personaId <= 0 || data(persona, "id") !== personaId || typeof sku !== "string" || !sku || data(club, "sku") !== sku || data(club, "year") !== 2027 || typeof data(club, "platform") !== "string") return null;
      const service = data(data(root, "services"), "SBC");
      const sets2 = values5(data(data(service, "repository"), "sets"), 500).filter((set) => data(set, "id") === setId);
      if (sets2.length !== 1) return null;
      const challenges = (observedChallenge ? [observedChallenge] : values5(data(sets2[0], "challenges"), 50)).filter((challenge2) => data(challenge2, "id") === challengeId);
      const challenge = challenges[0];
      if (challenges.length !== 1 || data(challenge, "setId") !== setId || data(challenge, "status") !== "IN_PROGRESS" || data(data(root, "SBCChallengeStatus"), "IN_PROGRESS") !== "IN_PROGRESS") return null;
      return {
        service,
        challenge,
        dao: data(service, "sbcDAO"),
        user,
        persona,
        club,
        scope: JSON.stringify([userId, personaId, sku, data(club, "platform")])
      };
    }
    if (![setId, challengeId].every((id2) => Number.isSafeInteger(id2) && id2 > 0 && id2 < 1e9)) return stop2("INVALID_CHALLENGE_IDENTITY");
    try {
      const initial = find();
      if (!initial) return stop2("IN_PROGRESS_CHALLENGE_UNCONFIRMED");
      const load = data(initial.dao, "loadChallenge");
      if (typeof load !== "function" || !root.crypto?.subtle) return stop2("DAO_IMPLEMENTATION_UNREVIEWED");
      const source = Function.prototype.toString.call(load);
      if (source.length > 4096) return stop2("DAO_IMPLEMENTATION_UNREVIEWED");
      const hash = Array.from(
        new Uint8Array(await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source))),
        (value) => value.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== "04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e") return stop2("DAO_IMPLEMENTATION_UNREVIEWED");
      const unchanged = () => {
        const current2 = find();
        return current2?.service === initial.service && current2?.dao === initial.dao && current2?.challenge === initial.challenge && data(initial.dao, "loadChallenge") === load && current2?.scope === initial.scope && current2?.user === initial.user && current2?.persona === initial.persona && current2?.club === initial.club;
      };
      if (!unchanged()) return stop2("CHALLENGE_CHANGED");
      return await new Promise((resolve) => {
        let observable;
        let finished = false;
        const owner = {};
        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            observable?.unobserve(owner);
          } catch {
          }
          resolve(result);
        };
        const timer = setTimeout(() => finish(stop2("SQUAD_READ_TIMEOUT")), 15e3);
        try {
          observable = load.call(initial.dao, challengeId, true);
          observable.observe(owner, (_sender, response) => {
            if (finished) return;
            try {
              if (!unchanged()) return finish(stop2("CHALLENGE_CHANGED"));
              if (data(response, "success") !== true || data(response, "status") !== 200) return finish(stop2("SQUAD_READ_UNCONFIRMED"));
              const squad = data(data(response, "response"), "squad");
              const slots = data(data(root, "UTSquadEntity"), "FIELD_PLAYERS");
              const simple = data(squad, "simpleBrickIndices");
              const custom = data(squad, "customBrickIndices");
              if (slots !== 11 || !Array.isArray(simple) || !Array.isArray(custom) || simple.length > 11 || custom.length > 11) return finish(stop2("SLOT_LAYOUT_UNVERIFIED"));
              const bricks = [...simple, ...custom];
              if (bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= slots) || new Set(bricks).size !== bricks.length || bricks.length >= slots) return finish(stop2("SLOT_LAYOUT_UNVERIFIED"));
              finish({
                status: "observed",
                reason: "IN_PROGRESS_SQUAD_READ",
                liveExecutionEnabled: false,
                setId,
                challengeId,
                slotCount: slots,
                simpleBrickIndices: [...simple],
                customBrickIndices: [...custom],
                requiredPlayerCount: slots - bricks.length
              });
            } catch {
              finish(stop2("SQUAD_READ_UNCONFIRMED"));
            }
          });
        } catch {
          finish(stop2("SQUAD_READ_UNCONFIRMED"));
        }
      });
    } catch {
      return stop2("SQUAD_INSPECTION_UNAVAILABLE");
    }
  }

  // src/adapters/ea/fc27-traditional-read.js
  function values(collection, limit) {
    const raw = ownData(collection, "_collection") ?? collection;
    if (!raw || typeof raw !== "object") throw new Error("FC27_CHALLENGE_COLLECTION_UNAVAILABLE");
    const keys2 = Object.keys(raw);
    if (keys2.length > limit) throw new Error("FC27_CHALLENGE_COLLECTION_LIMIT");
    return keys2.map((key) => ownData(raw, key));
  }
  function sets(root) {
    const repository = ownData(ownData(ownData(root, "services"), "SBC"), "repository");
    return values(ownData(repository, "sets"), 500);
  }
  function listFc27InProgressChallenges(root) {
    readFc27Context(root);
    const targets = [];
    for (const set of sets(root)) {
      const collection = ownData(set, "challenges");
      if (!collection) continue;
      for (const challenge of values(collection, 50)) {
        const id2 = ownData(challenge, "id");
        const setId = ownData(set, "id");
        if (ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "setId") !== setId || !Number.isSafeInteger(id2) || id2 <= 0 || !Number.isSafeInteger(setId) || setId <= 0) continue;
        const name = ownData(challenge, "name");
        targets.push({ id: id2, setId, name: typeof name === "string" && name.length <= 160 ? name : `Challenge ${id2}` });
      }
    }
    return targets;
  }
  function normalizeFc27TraditionalChallenge({ context, setId, challenge, layout, keys: keys2, scopes, qualities }) {
    const id2 = ownData(challenge, "id");
    if (ownData(challenge, "setId") !== setId || ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "eligibilityOperation") !== "AND" || layout.status !== "observed" || layout.setId !== setId || layout.challengeId !== id2 || layout.slotCount !== 11 || ownData(keys2, "PLAYER_MIN_OVR") !== 26 || ownData(keys2, "PLAYER_MAX_OVR") !== 28 || ownData(scopes, "GREATER") !== 0 || ownData(scopes, "EXACT") !== 2) {
      throw new Error("FC27_CHALLENGE_UNVERIFIED");
    }
    const count2 = layout.requiredPlayerCount;
    const raw = values(ownData(challenge, "eligibilityRequirements"), 16);
    if (!raw.length || !Number.isInteger(count2) || count2 < 1 || count2 > 11) throw new Error("FC27_REQUIREMENTS_UNVERIFIED");
    const requirements = [{ kind: "player-count", count: count2 }];
    for (const rule of raw) {
      const pairs = ownData(ownData(rule, "kvPairs"), "_collection");
      const codes = pairs && Object.keys(pairs);
      if (codes?.length === 1 && codes[0] === "3") {
        const quality = ownData(pairs, "3");
        const scope = ownData(rule, "scope");
        if (ownData(keys2, "PLAYER_QUALITY") !== 3 || ownData(rule, "count") !== -1 || ownData(qualities, "BRONZE") !== 1 || ownData(qualities, "SILVER") !== 2 || ownData(qualities, "GOLD") !== 3 || !Array.isArray(quality) || quality.length !== 1 || ![1, 2, 3].includes(quality[0]) || !(scope === 2 || scope === 0 && quality[0] === 3)) {
          throw new Error("FC27_REQUIREMENT_UNSUPPORTED");
        }
        const [min, max] = [[1, 64], [65, 74], [75, 99]][quality[0] - 1];
        requirements.push({ kind: "player-min-overall", count: count2, value: min }, { kind: "player-max-overall", count: count2, value: max });
        continue;
      }
      if (ownData(rule, "count") !== count2 || ![0, 2].includes(ownData(rule, "scope"))) throw new Error("FC27_REQUIREMENT_UNSUPPORTED");
      if (codes?.length !== 1 || !["26", "28"].includes(codes[0])) throw new Error("FC27_REQUIREMENT_UNSUPPORTED");
      const range = ownData(pairs, codes[0]);
      if (!Array.isArray(range) || range.length !== 1 || !Number.isInteger(range[0]) || range[0] < 1 || range[0] > 99) {
        throw new Error("FC27_REQUIREMENT_UNSUPPORTED");
      }
      requirements.push({ kind: codes[0] === "26" ? "player-min-overall" : "player-max-overall", count: count2, value: range[0] });
    }
    return {
      schema: 1,
      context,
      mechanism: "traditional",
      requirementsOperation: "AND",
      completed: false,
      setId,
      id: id2,
      slotCount: layout.slotCount,
      brickIndices: [...layout.simpleBrickIndices, ...layout.customBrickIndices],
      requirements
    };
  }

  // src/adapters/ea/fc27-challenge-catalog.js
  var id = (value) => Number.isSafeInteger(value) && value > 0 && value < 1e9;
  var text = (value) => typeof value === "string" && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : null;
  var number = (value) => Number.isSafeInteger(value) && value >= 0 && value < 1e9 ? value : null;
  var fail = (reason) => {
    throw new Error(reason);
  };
  function values2(input, limit) {
    const raw = ownData(input, "_collection") ?? input;
    if (!raw || typeof raw !== "object") return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    const keys2 = Object.getOwnPropertyNames(raw).filter((key) => key !== "length");
    if (keys2.length > limit) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    return keys2.map((key) => ownData(raw, key));
  }
  function projectRewards(awards) {
    return values2(awards, 6).map((reward) => ({
      type: text(ownData(reward, "type")),
      value: number(ownData(reward, "value")),
      count: number(ownData(reward, "count")),
      tradable: typeof ownData(reward, "tradable") === "boolean" ? ownData(reward, "tradable") : null
    }));
  }
  function projectFc27CatalogChallenge(challenge, setId) {
    const challengeId = ownData(challenge, "id");
    if (!id(challengeId) || ownData(challenge, "setId") !== setId) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    const requirements = values2(ownData(challenge, "eligibilityRequirements"), 16).map((rule) => {
      const pairs = ownData(ownData(rule, "kvPairs"), "_collection");
      if (!pairs || typeof pairs !== "object" || Object.keys(pairs).length > 8) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
      return {
        count: ownData(rule, "count") === -1 ? -1 : number(ownData(rule, "count")),
        scope: number(ownData(rule, "scope")),
        pairs: Object.keys(pairs).map((key) => {
          if (!/^\d{1,6}$/.test(key)) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
          const raw = ownData(pairs, key);
          if (!Array.isArray(raw) || raw.length > 32) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
          return { key: Number(key), values: Array.from({ length: raw.length }, (_, index) => number(ownData(raw, String(index)))) };
        })
      };
    });
    const rewards2 = projectRewards(ownData(challenge, "awards"));
    return {
      id: challengeId,
      setId,
      name: text(ownData(challenge, "name")),
      status: text(ownData(challenge, "status")),
      type: text(ownData(challenge, "type")) ?? number(ownData(challenge, "type")),
      eligibilityOperation: text(ownData(challenge, "eligibilityOperation")),
      requirements,
      rewards: rewards2
    };
  }

  // src/fc27/traditional-preview.js
  var integer2 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  var identity3 = (value) => integer2(value, 1, Number.MAX_SAFE_INTEGER);
  var stop = (reason) => ({ status: "blocked", reason, liveExecutionEnabled: false, selected: [] });
  function previewTraditionalSquad({ context, challenge, inventory, policy } = {}) {
    let scope;
    try {
      scope = createSeasonContext(context);
    } catch {
      return stop("CONTEXT_UNAVAILABLE");
    }
    if (scope.season !== "27") return stop("UNSUPPORTED_SEASON");
    for (const input of [challenge, inventory, policy]) {
      let other;
      try {
        other = createSeasonContext(input?.context);
      } catch {
        return stop("CONTEXT_UNAVAILABLE");
      }
      if (["season", "accountScope", "platform"].some((key) => other[key] !== scope[key])) return stop("CONTEXT_MISMATCH");
    }
    if (challenge.schema !== 1 || challenge.mechanism !== "traditional" || challenge.requirementsOperation !== "AND" || !identity3(challenge.setId) || !identity3(challenge.id) || challenge.completed !== false) {
      return stop("CHALLENGE_UNVERIFIED");
    }
    if (!Array.isArray(challenge.requirements) || !challenge.requirements.length || challenge.requirements.length > 16) {
      return stop("REQUIREMENTS_UNAVAILABLE");
    }
    const countRules = challenge.requirements.filter((rule) => rule?.kind === "player-count");
    const required = countRules[0]?.count;
    if (countRules.length !== 1 || !integer2(required, 1, 11)) return stop("PLAYER_COUNT_UNVERIFIED");
    let minRating = 1;
    let maxRating = 99;
    for (const rule of challenge.requirements) {
      if (!rule || !["player-count", "player-min-overall", "player-max-overall"].includes(rule.kind) || rule.count !== required || Object.keys(rule).some((key) => !["kind", "count", "value"].includes(key))) {
        return stop("UNSUPPORTED_REQUIREMENT");
      }
      if (rule.kind === "player-count") {
        if (rule.value !== void 0) return stop("UNSUPPORTED_REQUIREMENT");
      } else {
        if (!integer2(rule.value, 1, 99)) return stop("UNSUPPORTED_REQUIREMENT");
        if (rule.kind === "player-min-overall") minRating = Math.max(minRating, rule.value);
        else maxRating = Math.min(maxRating, rule.value);
      }
    }
    if (minRating > maxRating) return stop("CONTRADICTORY_REQUIREMENTS");
    const { slotCount, brickIndices } = challenge;
    if (!integer2(slotCount, 1, 11) || !Array.isArray(brickIndices) || brickIndices.some((index) => !integer2(index, 0, slotCount - 1)) || new Set(brickIndices).size !== brickIndices.length || slotCount - brickIndices.length !== required) {
      return stop("SLOT_LAYOUT_UNVERIFIED");
    }
    if (policy.schema !== 1 || policy.reviewed !== true || !integer2(policy.maxRating, 1, 99) || ["onlyUntradeable", "protectFsuLockedPlayers", "protectActiveSquad", "storageFirst"].some((key) => typeof policy[key] !== "boolean") || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2 || policy.goldRange.some((value) => !integer2(value, 75, 99)) || policy.goldRange[0] > policy.goldRange[1] || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200 || policy.excludedLeagueIds.some((id2) => !identity3(id2))) return stop("PROTECTION_POLICY_UNVERIFIED");
    if (inventory.schema !== 1 || inventory.kind !== "normalized-inventory" || !["ready", "provisional"].includes(inventory.status) || !Array.isArray(inventory.items) || inventory.items.length > 2e4) return stop("INVENTORY_UNVERIFIED");
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    let excluded = 0;
    const excludedByReason = {};
    for (const item of inventory.items) {
      if (!item || !identity3(item.id) || !identity3(item.definitionId) || seen.has(item.id)) return stop("INVENTORY_IDENTITY_CONFLICT");
      seen.add(item.id);
      const checks = [
        ["type-or-pile-unverified", item.type === "player" && ["club", "storage"].includes(item.pile)],
        ["rating-outside-range", integer2(item.rating, minRating, Math.min(maxRating, policy.maxRating))],
        ["fsu-gold-range", item.rating < 75 || integer2(item.rating, policy.goldRange[0], policy.goldRange[1])],
        ["special-or-unknown", item.special === false],
        ["evolution-or-unknown", item.evolution === false],
        ["cosmetic-or-unknown", item.cosmetic === false],
        ["concept-or-unknown", item.concept === false],
        ["academy-or-unknown", item.academyEnrolled === false],
        ["active-trade-or-unknown", item.activeTrade === false],
        ["limited-use-or-unknown", item.limitedUse === false && item.loans === -1],
        ["protected-or-unknown", item.protected === false],
        ["tradeable-or-unknown", typeof item.tradeable === "boolean" && (!policy.onlyUntradeable || item.tradeable === false)],
        ["league-excluded-or-unknown", identity3(item.leagueId) && !policy.excludedLeagueIds.includes(item.leagueId)],
        ["locked-or-unknown", !policy.protectFsuLockedPlayers || item.locked === false],
        ["active-squad-or-unknown", !policy.protectActiveSquad || item.activeSquad === false]
      ];
      const rejection = checks.find(([, passed]) => !passed)?.[0];
      if (!rejection) candidates.push(item);
      else {
        excluded++;
        excludedByReason[rejection] = (excludedByReason[rejection] ?? 0) + 1;
      }
    }
    candidates.sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || a.rating - b.rating || a.id - b.id);
    const definitions = /* @__PURE__ */ new Set();
    const selected = [];
    for (const item of candidates) {
      if (definitions.has(item.definitionId)) continue;
      definitions.add(item.definitionId);
      selected.push({ id: item.id, definitionId: item.definitionId, pile: item.pile, rating: item.rating });
      if (selected.length === required) break;
    }
    if (selected.length !== required) return {
      ...stop("SAFE_MATERIAL_SHORTAGE"),
      required,
      safeCandidates: candidates.length,
      uniqueDefinitions: definitions.size,
      excluded,
      excludedByReason
    };
    const slots = Array.from({ length: slotCount }, (_, index) => index).filter((index) => !brickIndices.includes(index));
    return {
      status: "preview",
      reason: "READ_ONLY_PLAN",
      liveExecutionEnabled: false,
      setId: challenge.setId,
      challengeId: challenge.id,
      required,
      minRating,
      maxRating,
      selected: selected.map((item, index) => ({ ...item, slot: slots[index] })),
      safeCandidates: candidates.length,
      excluded,
      excludedByReason,
      inventoryStatus: inventory.status,
      pending: ["FC27_RUNTIME_CONTRACT", "EXACT_ITEM_REVALIDATION", "REWARD_IDENTITY", "EXPLICIT_TRANSACTION_APPROVAL"]
    };
  }

  // src/adapters/ea/fc27-fsu-read.js
  function readFc27RunnerPolicy(root, maxRating = 74) {
    if (![74, 83].includes(maxRating)) throw new Error("FC27_PREVIEW_POLICY_UNAPPROVED");
    const report = inspectFc27RunnerInputs(root);
    if (report.status !== "observed") throw new Error(report.reason);
    const leagues = ownData(ownData(ownData(root, "info"), "set"), "shield_league");
    return {
      schema: 1,
      context: readFc27Context(root),
      reviewed: true,
      maxRating: Math.min(maxRating, report.fsu.policy.goldRange[1]),
      onlyUntradeable: true,
      protectFsuLockedPlayers: false,
      protectActiveSquad: false,
      storageFirst: report.fsu.policy.storageFirst,
      goldRange: report.fsu.policy.goldRange,
      excludedLeagueIds: report.fsu.policy.excludeDesignatedLeagues ? Array.from({ length: leagues.length }, (_, index) => ownData(leagues, String(index))) : []
    };
  }
  function readFc27RunnerPanel(root) {
    const inputs = inspectFc27RunnerInputs(root);
    if (inputs.status !== "observed") return { inputs, targets: [] };
    try {
      const sets2 = ownData(ownData(ownData(ownData(root, "services"), "SBC"), "repository"), "sets");
      const collection = ownData(sets2, "_collection");
      if (!collection || typeof collection !== "object") throw new Error();
      const keys2 = Object.getOwnPropertyNames(collection);
      if (keys2.length > 500) throw new Error();
      const targets = keys2.map((key) => {
        const set = ownData(collection, key);
        const setId = ownData(set, "id");
        const name = ownData(set, "name");
        if (!Number.isSafeInteger(setId) || setId <= 0 || setId >= 1e9 || typeof name !== "string" || !name.trim() || name.length > 160 || /[\u0000-\u001f]/.test(name)) throw new Error();
        return { setId, name };
      });
      if (new Set(targets.map((target) => target.setId)).size !== targets.length) throw new Error();
      return { inputs, targets };
    } catch {
      return { inputs: { ...inputs, status: "blocked", reason: "FC27_CATALOG_SET_UNVERIFIED" }, targets: [] };
    }
  }
  function inspectFc27RunnerInputs(root) {
    const report = {
      schema: 1,
      status: "blocked",
      reason: "FC27_CONTEXT_UNAVAILABLE",
      liveExecutionEnabled: false,
      contextVerified: false,
      fsu: null,
      club: null,
      inProgressChallenges: null
    };
    try {
      const context = readFc27Context(root);
      report.contextVerified = true;
      const info = ownData(root, "info");
      const base = ownData(info, "base");
      const build = ownData(info, "build");
      const set = ownData(info, "set");
      const events = ownData(root, "events");
      const cache = ownData(ownData(base, "clubCache"), "status");
      const initialized = ownData(base, "initialized") === true;
      const provisional = ["trusted-provisional", "validating", "validation-failed"].includes(cache);
      const ready = ownData(base, "state") === true && ["ready", "finalizing"].includes(cache);
      report.fsu = {
        initialized,
        readiness: initialized && provisional ? "provisional" : initialized && ready ? "ready" : "not-ready",
        targetedValidationAvailable: typeof ownData(events, "validateClubPlayers") === "function",
        policy: null
      };
      if (![27, "27"].includes(ownData(base, "year"))) throw new Error("FC27_FSU_SEASON_MISMATCH");
      if (report.fsu.readiness === "not-ready") throw new Error("FC27_FSU_NOT_READY");
      const flags = ["untradeable", "academy", "league", "firststorage"].map((key) => ownData(build, key));
      const goldenMax = ownData(set, "goldenrange");
      const rawLeagues = ownData(set, "shield_league");
      const leagues = Array.isArray(rawLeagues) && rawLeagues.length <= 200 ? Array.from({ length: rawLeagues.length }, (_, index) => ownData(rawLeagues, String(index))) : null;
      if (flags.some((value) => typeof value !== "boolean") || !Number.isInteger(goldenMax) || goldenMax < 75 || goldenMax > 99 || !leagues || leagues.some((id2) => !Number.isSafeInteger(id2) || id2 < 1)) throw new Error("FC27_FSU_POLICY_UNVERIFIED");
      report.fsu.policy = {
        onlyUntradeable: flags[0],
        excludeEvolution: flags[1],
        excludeDesignatedLeagues: flags[2],
        storageFirst: flags[3],
        goldRange: [75, goldenMax],
        excludedLeagueCount: flags[2] ? new Set(leagues).size : 0
      };
      if (!report.fsu.targetedValidationAvailable) throw new Error("FC27_FSU_VALIDATION_UNAVAILABLE");
      const club = readFc27CachedClub(root);
      report.club = { status: club.status, complete: club.complete, cachedEntries: club.cachedEntries, cachedPlayers: club.items.length };
      report.inProgressChallenges = listFc27InProgressChallenges(root).length;
      if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)) throw new Error("FC27_CONTEXT_CHANGED");
      return {
        ...report,
        status: "observed",
        reason: "FC27_TRANSACTION_UNVERIFIED",
        pending: ["REVIEWED_RUNNER_POLICY", "EXACT_ITEM_VALIDATION", "SBC_PLAN_AND_REWARD", "LIVE_TRANSACTION_ACCEPTANCE"]
      };
    } catch (error) {
      return { ...report, reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : "FC27_RUNNER_INSPECTION_UNAVAILABLE" };
    }
  }

  // src/adapters/ea/fc27-sbc-contract.js
  var hashes = Object.freeze({
    getSets: "17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c",
    getChallengesForSet: "238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693",
    saveChallenge: "5273c0f32805c49e91ca26e924a442048dcc5bc763d979c34c0919793a02d851",
    submitChallenge: "38539de9ad8d2aad8e429029f2cfc87539dc91ef662c0a892dcec5c67220afef"
  });
  var fail2 = (reason) => {
    throw new Error(reason);
  };
  var integer3 = (value) => Number.isSafeInteger(value) && value >= 0;
  function method(object, key) {
    for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return descriptor.value;
    }
  }
  function values3(input, limit) {
    const raw = ownData(input, "_collection") ?? input;
    if (!raw || typeof raw !== "object") return fail2("FC27_CONTRACT_SHAPE_UNVERIFIED");
    const keys2 = Object.getOwnPropertyNames(raw).filter((key) => key !== "length");
    if (keys2.length > limit) return fail2("FC27_CONTRACT_SHAPE_UNVERIFIED");
    return keys2.map((key) => ownData(raw, key));
  }
  function rewards(input, scope) {
    return values3(input, 6).map((reward) => {
      const result = Object.fromEntries(["type", "value", "count", "tradable"].map((key) => [key, ownData(reward, key)]));
      if (result.type !== "pack" || !integer3(result.value) || result.value <= 0 || !integer3(result.count) || result.count < 1 || result.count > 10 || typeof result.tradable !== "boolean") {
        return fail2("FC27_CONTRACT_REWARD_UNSUPPORTED");
      }
      return { scope, ...result };
    });
  }
  async function readFc27SbcContract(root, { setId } = {}) {
    try {
      if (!integer3(setId) || setId <= 0 || setId >= 1e9) return fail2("FC27_CONTRACT_TARGET_UNVERIFIED");
      const context = readFc27Context(root);
      const service = ownData(ownData(root, "services"), "SBC");
      const dao = ownData(service, "sbcDAO");
      const functions = Object.fromEntries(Object.keys(hashes).map((key) => [key, method(dao, key)]));
      const methods = {};
      for (const [key, fn] of Object.entries(functions)) {
        methods[key] = false;
        if (typeof fn !== "function" || !root.crypto?.subtle) continue;
        const source = Function.prototype.toString.call(fn);
        if (source.length > 4096) continue;
        const digest = await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source));
        const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
        methods[key] = hash === hashes[key];
      }
      if (!methods.getSets || !methods.getChallengesForSet) return fail2("FC27_CONTRACT_READ_METHOD_UNREVIEWED");
      const unchanged = () => {
        try {
          if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context) || ownData(ownData(root, "services"), "SBC") !== service || ownData(service, "sbcDAO") !== dao || Object.keys(functions).some((key) => method(dao, key) !== functions[key])) return fail2("FC27_CONTRACT_CONTEXT_CHANGED");
        } catch {
          return fail2("FC27_CONTRACT_CONTEXT_CHANGED");
        }
      };
      let lastRequestAt = -Infinity;
      const pace = async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 800 - (Date.now() - lastRequestAt))));
        unchanged();
        lastRequestAt = Date.now();
      };
      const read = async (name, args) => {
        await pace();
        return new Promise((resolve, reject) => {
          let observable;
          let finished = false;
          const owner = {};
          const finish = (error, response) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try {
              observable?.unobserve(owner);
            } catch {
            }
            if (error) reject(error);
            else resolve(response);
          };
          const timer = setTimeout(() => finish(new Error("FC27_CONTRACT_READ_TIMEOUT")), 15e3);
          try {
            observable = functions[name].apply(dao, args);
            observable.observe(owner, (_sender, reply) => {
              if (finished) return;
              try {
                unchanged();
                if (ownData(reply, "success") !== true || ownData(reply, "status") !== 200) return fail2("FC27_CONTRACT_READ_UNCONFIRMED");
                finish(null, ownData(reply, "response"));
              } catch (error) {
                finish(error);
              }
            });
          } catch {
            finish(new Error("FC27_CONTRACT_READ_UNCONFIRMED"));
          }
        });
      };
      unchanged();
      const setReply = await read("getSets", []);
      const sets2 = values3(ownData(setReply, "sets"), 500).filter((set2) => ownData(set2, "id") === setId);
      if (sets2.length !== 1) return fail2("FC27_CONTRACT_TARGET_UNVERIFIED");
      const set = Object.fromEntries([
        "id",
        "name",
        "challengesCount",
        "challengesCompletedCount",
        "timesCompleted",
        "repeats",
        "repeatabilityMode",
        "startTime",
        "endTime"
      ].map((key) => [key, ownData(sets2[0], key)]));
      if (set.challengesCount !== 1 || set.challengesCompletedCount !== 0) return fail2("FC27_CONTRACT_SINGLE_CHALLENGE_REQUIRED");
      if (typeof set.name !== "string" || set.name.length > 160 || /[\u0000-\u001f]/.test(set.name) || ["timesCompleted", "repeats", "startTime", "endTime"].some((key) => !integer3(set[key])) || typeof set.repeatabilityMode !== "string" || !/^[A-Z_]{1,32}$/.test(set.repeatabilityMode)) {
        return fail2("FC27_CONTRACT_SHAPE_UNVERIFIED");
      }
      const awardList = rewards(ownData(sets2[0], "awards"), "set");
      const challengeReply = await read("getChallengesForSet", [setId]);
      const challenges = values3(ownData(challengeReply, "challenges"), 50);
      if (challenges.length !== 1) return fail2("FC27_CONTRACT_SINGLE_CHALLENGE_REQUIRED");
      const observed = projectFc27CatalogChallenge(challenges[0], setId);
      if (observed.status !== "IN_PROGRESS") return fail2("FC27_CONTRACT_IN_PROGRESS_REQUIRED");
      awardList.push(...rewards(ownData(challenges[0], "awards"), "challenge"));
      if (awardList.length !== 1) return fail2("FC27_CONTRACT_SINGLE_PACK_REQUIRED");
      await pace();
      const layout = await inspectInProgressSquad({ setId, challengeId: observed.id }, root, observed);
      unchanged();
      if (layout.status !== "observed") return layout;
      const challenge = normalizeFc27TraditionalChallenge({
        context,
        setId,
        challenge: challenges[0],
        layout,
        keys: ownData(root, "SBCEligibilityKey"),
        scopes: ownData(root, "SBCEligibilityScope"),
        qualities: ownData(root, "SBCEligibilityQualityType")
      });
      return {
        status: "observed",
        reason: "FC27_FRESH_SBC_CONTRACT_READ",
        liveExecutionEnabled: false,
        methods,
        writeContractVerified: false,
        contract: { schema: 1, source: "fresh-dao", context, observedAt: Date.now(), set, challenge, rewards: awardList }
      };
    } catch (error) {
      return {
        status: "blocked",
        liveExecutionEnabled: false,
        reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : "FC27_CONTRACT_UNAVAILABLE"
      };
    }
  }

  // src/adapters/ea/fc27-club-read.js
  var FC27_CLUB_READ_METHODS = Object.freeze([
    ["UTHttpRequest", "539d97d365d2dce284ff22dc8d0bca7d3516549dc0b4f0e1c27b204a0910687b"],
    ["EAHttpRequest", "efa1dc29b6b1709f95ad9ed90daed5658f822d014c9762ef575d0642cc2bf3d8"],
    ["UTHttpRequest.prototype.setPath", "c560a9ed5afc9c93cbca649f1ee1d68209fef661b68229ea935554f3cfddc0ff"],
    ["UTHttpRequest.prototype.send", "eb385e4af6bb6dfd7cd19ef89d6b22104fc76e103aac962a4b3e15c0bb1384bc"],
    ["EAHttpRequest.prototype.send", "11aa8103d89421128bf4781d77e906a61cec32d4b3c52b5046ed4dca69143334"],
    ["EAHttpRequest.prototype.setRequestBody", "6de3cb3455cead05cce8c08e74cbdc231ba9083b144215f06220ce67bec50ef9"],
    ["EAHttpRequest.prototype.abort", "431fe6f829c0f932686e851cfc850d90a4f85f67521527ebe68c820a8453658d"],
    ["UTItemEntityFactory.prototype.createItem", "fc0713a05642d8d4fcebac3d20ebee458edd59f6d44e4a8a3ed84ae237391491"]
  ]);
  var at2 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var validId = (value) => Number.isSafeInteger(value) && value > 0;
  async function createFc27ClubReadTransport(root) {
    const context = readFc27Context(root);
    const reviewed = /* @__PURE__ */ new Map();
    const assertScope = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_CLUB_SCOPE_CHANGED");
    };
    for (const [index, [path, expected]] of FC27_CLUB_READ_METHODS.entries()) {
      const fn = at2(root, path);
      if (typeof fn !== "function") throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_MISSING`);
      const bytes = new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn));
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== expected) throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_CHANGED`);
      reviewed.set(path, fn);
    }
    const assertRuntime = () => {
      for (const [path, fn] of reviewed) if (at2(root, path) !== fn) throw new Error("FC27_CLUB_RUNTIME_UNVERIFIED");
    };
    assertRuntime();
    const Request = ownData(root, "UTHttpRequest");
    const factory = at2(root, "factories.Item");
    const createItem = at2(root, "UTItemEntityFactory.prototype.createItem");
    const authDelegate = at2(root, "services.Club.clubDao.authDelegate");
    const game = ownData(root, "GAME_NAME");
    if (!authDelegate || typeof game !== "string" || !/^[a-z0-9_-]{1,24}$/i.test(game) || at2(root, "HttpRequestMethod.GET") !== "GET" || at2(root, "HttpRequestMethod.POST") !== "POST" || at2(root, "ItemType.PLAYER") !== "player" || !factory || factory.createItem !== createItem) {
      throw new Error("FC27_CLUB_RUNTIME_UNVERIFIED_DEPENDENCIES");
    }
    assertScope();
    let busy = false;
    let stopped = false;
    let lastRequestAt = 0;
    let requests = 0;
    async function request(kind, body) {
      if (busy || stopped) throw new Error("FC27_CLUB_READ_BLOCKED");
      busy = true;
      try {
        const delay = Math.max(0, 800 - (Date.now() - lastRequestAt));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        assertScope();
        assertRuntime();
        const req = new Request(authDelegate);
        if (req.send !== reviewed.get("UTHttpRequest.prototype.send") || req.setPath !== reviewed.get("UTHttpRequest.prototype.setPath") || req.setRequestBody !== reviewed.get("EAHttpRequest.prototype.setRequestBody") || req.abort !== reviewed.get("EAHttpRequest.prototype.abort")) throw new Error("FC27_CLUB_RUNTIME_UNVERIFIED");
        req.doRetry = false;
        req.doReauth = false;
        req.timeout = 15e3;
        req.requestType = kind === "stats" ? "GET" : "POST";
        const endpoint = `/ut/game/${game}/club${kind === "stats" ? "/stats/club" : ""}`;
        req.setPath(endpoint);
        const url = new URL(ownData(req, "url"));
        if (url.protocol !== "https:" || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) {
          throw new Error("FC27_CLUB_ENDPOINT_UNVERIFIED");
        }
        if (body) req.setRequestBody(body);
        lastRequestAt = Date.now();
        requests++;
        const dto = await new Promise((resolve, reject) => {
          const observer = {};
          let done = false;
          const finish = (error, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              req.unobserve(observer);
            } catch {
            }
            if (error) reject(error);
            else resolve(value);
          };
          const timer = setTimeout(() => {
            stopped = true;
            finish(new Error("FC27_CLUB_READ_TIMEOUT"));
            try {
              req.abort();
            } catch {
            }
          }, 16e3);
          try {
            req.observe(observer, (sender, value) => {
              if (sender !== req) {
                finish(new Error("FC27_CLUB_RESPONSE_OWNER_MISMATCH"));
                return;
              }
              finish(null, value);
            });
            req.send();
          } catch {
            finish(new Error("FC27_CLUB_REQUEST_FAILED"));
          }
        });
        assertScope();
        const status = ownData(dto, "status");
        if (ownData(dto, "success") !== true || status !== 200) {
          throw new Error(Number.isInteger(status) && status >= 100 && status <= 599 ? `FC27_CLUB_HTTP_${status}` : "FC27_CLUB_RESPONSE_UNVERIFIED");
        }
        const response = ownData(dto, "response");
        if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("FC27_CLUB_RESPONSE_UNVERIFIED");
        return response;
      } catch (error) {
        stopped = true;
        throw error;
      } finally {
        busy = false;
      }
    }
    return Object.freeze({
      getRequestCount: () => requests,
      readCount: async () => {
        const response = await request("stats");
        const stats = ownData(response, "stat");
        if (!Array.isArray(stats) || stats.length > 100) throw new Error("FC27_CLUB_STATS_UNVERIFIED");
        const players = stats.filter((entry) => ownData(entry, "type") === "players");
        const count2 = players.length === 1 ? ownData(players[0], "typeValue") : null;
        if (!Number.isSafeInteger(count2) || count2 < 0 || count2 > 2e4) throw new Error("FC27_CLUB_STATS_UNVERIFIED");
        return count2;
      },
      readPage: async ({ start, count: count2, definitionIds }) => {
        if (!Number.isInteger(start) || start < 0 || start > 2e4 || !Number.isInteger(count2) || count2 < 1 || count2 > 250 || !Array.isArray(definitionIds) || definitionIds.length > 50 || definitionIds.some((id2) => !validId(id2)) || new Set(definitionIds).size !== definitionIds.length) throw new Error("FC27_CLUB_QUERY_INVALID");
        const body = { type: "player", start, count: count2 };
        if (definitionIds.length) body.defId = definitionIds.join(",");
        const response = await request("players", body);
        const payload = ownData(response, "itemData");
        if (!Array.isArray(payload) || payload.length > count2) throw new Error("FC27_CLUB_PAYLOAD_UNVERIFIED");
        if (!payload.length && Object.keys(response).some((key) => key !== "itemData" && Array.isArray(ownData(response, key)) && ownData(response, key).length > 0)) {
          throw new Error("FC27_CLUB_PAYLOAD_UNVERIFIED");
        }
        return payload.map((data) => {
          if (!validId(ownData(data, "id")) || !validId(ownData(data, "resourceId")) || ![void 0, "player"].includes(ownData(data, "itemType")) || ownData(data, "count") !== void 0 || ownData(data, "cardassetid") !== void 0) throw new Error("FC27_CLUB_PAYLOAD_UNVERIFIED");
          const entity = createItem.call(factory, { ...data });
          if (ownData(entity, "type") !== "player" || ownData(entity, "id") !== ownData(data, "id") || ownData(entity, "definitionId") !== ownData(data, "resourceId")) throw new Error("FC27_CLUB_ENTITY_UNVERIFIED");
          return snapshotFc27ClubPlayer(entity, root);
        });
      }
    });
  }

  // src/adapters/ea/fc27-transaction-transport.js
  var at3 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var fail3 = (reason) => {
    throw new Error(reason);
  };
  async function verifyFc27Methods(root, definitions) {
    const methods = /* @__PURE__ */ new Map();
    for (const [path, expected] of definitions) {
      const fn = at3(root, path);
      if (typeof fn !== "function") return fail3("FC27_TRANSACTION_METHOD_UNREVIEWED");
      const source = Function.prototype.toString.call(fn).replace(/\r\n/g, "\n");
      if (source.length > 2e4) return fail3("FC27_TRANSACTION_METHOD_UNREVIEWED");
      const digest = await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== expected) return fail3("FC27_TRANSACTION_METHOD_UNREVIEWED");
      methods.set(path, fn);
    }
    return () => {
      for (const [path, fn] of methods) if (at3(root, path) !== fn) return fail3("FC27_TRANSACTION_RUNTIME_CHANGED");
    };
  }
  async function createFc27TransactionTransport(root, { canWrite = () => false } = {}) {
    const context = readFc27Context(root);
    const runtime = await verifyFc27Methods(root, FC27_CLUB_READ_METHODS);
    const Request = ownData(root, "UTHttpRequest");
    const auth = at3(root, "services.SBC.sbcDAO.authDelegate");
    const game = ownData(root, "GAME_NAME");
    if (!auth || typeof game !== "string" || !/^[a-z0-9_-]{1,24}$/i.test(game)) return fail3("FC27_TRANSACTION_RUNTIME_CHANGED");
    let active = null;
    let stopped = false;
    let busy = false;
    let last = -Infinity;
    const assert = () => {
      runtime();
      if (stopped || JSON.stringify(context) !== JSON.stringify(readFc27Context(root)) || at3(root, "services.SBC.sbcDAO.authDelegate") !== auth) return fail3("FC27_TRANSACTION_CONTEXT_CHANGED");
    };
    async function request(action, target = {}) {
      if (busy || stopped) return fail3("FC27_TRANSACTION_TRANSPORT_BLOCKED");
      const id2 = target.challengeId;
      const mutation = action === "save" || action === "submit";
      if (!["unassigned", "packs", "save", "submit"].includes(action) || mutation && (!Number.isSafeInteger(id2) || id2 <= 0 || canWrite() !== true)) return fail3("FC27_LIVE_DISABLED");
      if (action === "save" && (!Array.isArray(target.players) || target.players.length < 11 || target.players.length > 32 || new Set(target.players.map((player) => player.index)).size !== target.players.length || new Set(target.players.slice(0, 11).map((player) => player.itemData?.id)).size !== 11 || target.players.some((player, index) => player.index !== index || !Number.isSafeInteger(player.itemData?.id) || (index < 11 ? player.itemData.id < 1 : ![0, -1].includes(player.itemData.id)) || player.itemData.dream !== false))) {
        return fail3("FC27_SAVE_INPUT_UNVERIFIED");
      }
      busy = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 800 - (Date.now() - last))));
        assert();
        if (mutation && canWrite() !== true) return fail3("FC27_LIVE_DISABLED");
        const req = new Request(auth);
        if (req.send !== at3(root, "UTHttpRequest.prototype.send") || req.setPath !== at3(root, "UTHttpRequest.prototype.setPath") || req.setRequestBody !== at3(root, "EAHttpRequest.prototype.setRequestBody") || req.abort !== at3(root, "EAHttpRequest.prototype.abort")) return fail3("FC27_TRANSACTION_RUNTIME_CHANGED");
        req.doRetry = false;
        req.doReauth = false;
        req.timeout = 1e4;
        req.requestType = mutation ? "PUT" : "GET";
        const endpoint = `/ut/game/${game}/${action === "unassigned" ? "purchased/items" : action === "packs" ? "store/purchaseGroup/all" : `sbs/challenge/${id2}${action === "save" ? "/squad" : ""}`}`;
        req.setPath(endpoint);
        const url = new URL(ownData(req, "url"));
        if (url.protocol !== "https:" || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) return fail3("FC27_TRANSACTION_ENDPOINT_UNVERIFIED");
        if (action === "save") req.setRequestBody({ players: target.players.map((player) => ({
          index: player.index,
          itemData: { id: player.itemData.id, dream: false }
        })) });
        if (action === "submit") {
          url.searchParams.set("skipUserSquadValidation", "false");
          req.url = url.href;
        }
        last = Date.now();
        return await new Promise((resolve, reject) => {
          const owner = {};
          let done = false;
          const finish = (error, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            active = null;
            try {
              req.unobserve(owner);
            } catch {
            }
            if (error) reject(error);
            else resolve(value);
          };
          active = () => {
            stopped = true;
            finish(new Error("FC27_TRANSACTION_REQUEST_UNCONFIRMED"));
            try {
              req.abort();
            } catch {
            }
          };
          const timer = setTimeout(() => active?.(), 11e3);
          try {
            req.observe(owner, (sender, reply) => {
              if (done) return;
              try {
                assert();
                if (sender !== req) return fail3("FC27_TRANSACTION_RESPONSE_OWNER");
                finish(null, reply);
              } catch {
                stopped = true;
                finish(new Error("FC27_TRANSACTION_REQUEST_UNCONFIRMED"));
              }
            });
            assert();
            if (mutation && canWrite() !== true) return fail3("FC27_LIVE_DISABLED");
            req.send();
          } catch {
            stopped = true;
            finish(new Error("FC27_TRANSACTION_REQUEST_UNCONFIRMED"));
          }
        });
      } finally {
        busy = false;
      }
    }
    return Object.freeze({ request, assert, cancel() {
      stopped = true;
      active?.();
    } });
  }

  // src/adapters/ea/fc27-traditional-provider.js
  var fail4 = (reason) => {
    throw new Error(reason);
  };
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var at4 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var protectedItem = (item) => ({ ...item, protected: item.special !== false || item.evolution !== false || item.cosmetic !== false });
  var identity4 = (value) => Number.isSafeInteger(value) && value > 0;
  var count = (value) => Number.isSafeInteger(value) && value >= 0;
  var FC27_SBC_EXECUTION_METHODS = Object.freeze([
    ["UTSquadBuildingChallengeDAO.prototype.getSets", "17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c"],
    ["UTSquadBuildingChallengeDAO.prototype.getChallengesForSet", "238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693"],
    ["UTSquadBuildingChallengeDAO.prototype.loadChallenge", "04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e"],
    ["UTSquadBuildingChallengeDAO.prototype.saveChallenge", "5273c0f32805c49e91ca26e924a442048dcc5bc763d979c34c0919793a02d851"],
    ["UTSquadBuildingChallengeDAO.prototype.submitChallenge", "38539de9ad8d2aad8e429029f2cfc87539dc91ef662c0a892dcec5c67220afef"]
  ]);
  var FC27_SBC_CACHE_METHODS = Object.freeze([
    ["UTItemRepository.prototype.remove", "e9e10aeb4b55d20100f4003c34df53d90cb2e9f2d21335419a2b5283d084c2e7"],
    ["UTClubRepository.prototype.resetStatsCacheTimestamp", "a6bb2952a0915a650af1358a4e43d5b3baed01df16fa054652828c82a19bb776"],
    ["events.markClubCacheDirty", "9059b7d8d555643b025c9c6f2e956436da952e3e857720bdce9b4bff70e1de53"]
  ]);
  function values4(input, limit = 500) {
    const collection = ownData(input, "_collection") ?? input;
    if (!collection || typeof collection !== "object") return fail4("FC27_PROVIDER_RESPONSE_UNVERIFIED");
    const keys2 = Object.getOwnPropertyNames(collection).filter((key) => key !== "length");
    if (keys2.length > limit) return fail4("FC27_PROVIDER_RESPONSE_UNVERIFIED");
    return keys2.map((key) => ownData(collection, key));
  }
  function success(reply) {
    if (ownData(reply, "success") !== true || ownData(reply, "status") !== 200) return fail4("FC27_PROVIDER_READ_UNCONFIRMED");
    const data = ownData(reply, "response");
    if (!data || typeof data !== "object") return fail4("FC27_PROVIDER_RESPONSE_UNVERIFIED");
    return data;
  }
  function projectFc27OwnedPackCount(root, response, reward) {
    const packs = ownData(response, "purchase");
    if (!Array.isArray(packs) || packs.length > 1e4 || at4(root, "PurchaseDisplayGroup.MYPACKS") !== "mypacks") {
      return fail4("FC27_REWARD_BASELINE_UNVERIFIED");
    }
    let total = 0;
    for (const pack of packs) {
      const group = ownData(ownData(pack, "displayGroup"), "value");
      if (typeof group !== "string") return fail4("FC27_REWARD_BASELINE_UNVERIFIED");
      if (group !== "mypacks") continue;
      if (!identity4(ownData(pack, "id"))) return fail4("FC27_REWARD_BASELINE_UNVERIFIED");
      if (pack.id !== reward.value) continue;
      if (ownData(pack, "packType") !== "CARDPACK" || ownData(pack, "untradeable") !== !reward.tradable || !count(ownData(pack, "quantity")) || pack.quantity > 1e4) return fail4("FC27_REWARD_BASELINE_UNVERIFIED");
      total += pack.quantity;
    }
    if (total > 1e4) return fail4("FC27_REWARD_BASELINE_UNVERIFIED");
    return total;
  }
  function projectFc27Submission(reply, target) {
    const data = ownData(reply, "response");
    const status = ownData(reply, "status");
    const squads = ownData(data, "squads");
    const rawWarnings = ownData(data, "itemViolations");
    let warnings = [];
    if (Array.isArray(squads)) warnings = squads.map((warning) => ({ name: ownData(warning, "squad"), itemIds: ownData(warning, "playerList") }));
    else if (Array.isArray(rawWarnings)) warnings = rawWarnings;
    warnings = warnings.slice(0, 30).map((warning) => ({
      name: typeof ownData(warning, "name") === "string" && /^[A-Za-z0-9_ -]{1,80}$/.test(warning.name) ? warning.name : "UNKNOWN",
      itemIds: Array.isArray(ownData(warning, "itemIds")) ? warning.itemIds.filter(identity4).slice(0, 30) : []
    }));
    if (ownData(reply, "success") === true && status === 200 && squads === void 0 && rawWarnings === void 0 && ownData(data, "setId") === target.setId && ownData(data, "challengeId") === target.challengeId) {
      return { status: "confirmed", ...target };
    }
    if ([400, 401, 403, 404, 409, 429].includes(status) && ownData(reply, "success") === false || ownData(reply, "success") === true && status === 200 && Array.isArray(squads) && squads.length > 0) {
      return { status: "rejected", ...target, code: status, warnings };
    }
    return { status: "unknown", ...target, code: Number.isInteger(status) ? status : null, warnings };
  }
  async function createFc27TraditionalProvider(root, { canWrite = () => false } = {}) {
    const context = readFc27Context(root);
    const runtime = await verifyFc27Methods(root, FC27_SBC_EXECUTION_METHODS);
    const cacheRuntime = await verifyFc27Methods(root, FC27_SBC_CACHE_METHODS);
    const transport = await createFc27TransactionTransport(root, { canWrite });
    const club = await createFc27ClubReadTransport(root);
    const dao = at4(root, "services.SBC.sbcDAO");
    const functions = Object.fromEntries(FC27_SBC_EXECUTION_METHODS.map(([path]) => {
      const key = path.split(".").at(-1);
      const fn = at4(root, path);
      if (dao?.[key] !== fn) return fail4("FC27_TRANSACTION_RUNTIME_CHANGED");
      return [key, fn];
    }));
    let lastRead = -Infinity;
    let stopped = false;
    const assert = () => {
      if (stopped || !same(context, readFc27Context(root)) || at4(root, "services.SBC.sbcDAO") !== dao || Object.keys(functions).some((key) => dao[key] !== functions[key])) return fail4("FC27_TRANSACTION_CONTEXT_CHANGED");
      runtime();
      cacheRuntime();
      transport.assert();
    };
    const dirtyCache = () => {
      assert();
      root.events.markClubCacheDirty("FC27 traditional SBC");
      if (at4(root, "info.base.clubCache.localDirty") !== true) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
    };
    const reconcileCache = (refs2) => {
      assert();
      const repo = at4(root, "repositories.Item.club");
      const items = ownData(repo, "items");
      const collection = ownData(items, "_collection");
      if (!collection || items.remove !== at4(root, "UTItemRepository.prototype.remove") || repo.resetStatsCacheTimestamp !== at4(root, "UTClubRepository.prototype.resetStatsCacheTimestamp")) {
        return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
      }
      const cached = refs2.map((ref) => ({ ref, item: ownData(collection, String(ref.id)) }));
      if (cached.some(({ ref, item }) => item && (ownData(item, "id") !== ref.id || ownData(item, "definitionId") !== ref.definitionId))) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
      dirtyCache();
      for (const { ref, item } of cached) if (item) items.remove(ref.id);
      repo.resetStatsCacheTimestamp();
      if (refs2.some((ref) => ownData(collection, String(ref.id)) !== void 0)) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
    };
    const readDao = async (key, args) => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 800 - (Date.now() - lastRead))));
      assert();
      lastRead = Date.now();
      return new Promise((resolve, reject) => {
        let observable;
        let done = false;
        const owner = {};
        const finish = (error, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            observable?.unobserve(owner);
          } catch {
          }
          if (error) reject(error);
          else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error("FC27_PROVIDER_READ_TIMEOUT")), 11e3);
        try {
          observable = functions[key].apply(dao, args);
          observable.observe(owner, (_sender, reply) => {
            if (done) return;
            try {
              assert();
              finish(null, success(reply));
            } catch (error) {
              finish(error);
            }
          });
        } catch {
          finish(new Error("FC27_PROVIDER_READ_UNCONFIRMED"));
        }
      });
    };
    const freshRefs = async (refs2) => {
      assert();
      if (!Array.isArray(refs2) || refs2.length < 1 || refs2.length > 11 || refs2.some((ref) => !identity4(ref.id) || !identity4(ref.definitionId) || ref.pile !== "club") || new Set(refs2.map((ref) => ref.id)).size !== refs2.length || new Set(refs2.map((ref) => ref.definitionId)).size !== refs2.length) return fail4("FC27_EXACT_ITEMS_CHANGED");
      const items = await club.readPage({ start: 0, count: 250, definitionIds: refs2.map((ref) => ref.definitionId) });
      assert();
      if (items.length >= 250 || new Set(items.map((item) => item.id)).size !== items.length || items.some((item) => !refs2.some((ref) => ref.definitionId === item.definitionId))) return fail4("FC27_EXACT_ITEMS_CHANGED");
      return items.filter((item) => refs2.some((ref) => ref.id === item.id && ref.definitionId === item.definitionId)).map(protectedItem);
    };
    const rewardCount = async (reward) => projectFc27OwnedPackCount(root, success(await transport.request("packs")), reward);
    const unassigned = async () => {
      const response = success(await transport.request("unassigned"));
      const items = ownData(response, "itemData");
      if (!Array.isArray(items) || items.length > 1e4) return fail4("FC27_UNASSIGNED_UNVERIFIED");
      return items.length === 0;
    };
    const readInputs = async (plan) => {
      assert();
      const maxRating = plan.policy?.maxRating ?? plan.maxRating ?? 74;
      const before = readFc27RunnerPolicy(root, maxRating);
      const result = await readFc27SbcContract(root, { setId: plan.set?.id ?? plan.setId });
      assert();
      if (result.status !== "observed" || !result.methods.saveChallenge || !result.methods.submitChallenge) return fail4("FC27_PROVIDER_CONTRACT_UNVERIFIED");
      const unassignedClear = await unassigned();
      const policy = readFc27RunnerPolicy(root, maxRating);
      if (!same(before, policy)) return fail4("FC27_ATTEMPT_INPUTS_CHANGED");
      return { contract: result.contract, policy, unassignedClear };
    };
    const targetOf = (plan) => ({ setId: plan.set.id, challengeId: plan.challenge.id });
    const observeRecovery = async (record) => {
      const present = await freshRefs(record.itemRefs);
      const data = await readDao("getSets", []);
      const sets2 = values4(ownData(data, "sets")).filter((set) => ownData(set, "id") === record.setId);
      if (sets2.length !== 1 || !count(ownData(sets2[0], "timesCompleted"))) return fail4("FC27_RECONCILIATION_UNCONFIRMED");
      const challenges = values4(ownData(await readDao("getChallengesForSet", [record.setId]), "challenges"), 50);
      if (challenges.length !== 1 || ownData(challenges[0], "id") !== record.challengeId || ownData(challenges[0], "setId") !== record.setId) return fail4("FC27_RECONCILIATION_UNCONFIRMED");
      const awards = [["set", sets2[0]], ["challenge", challenges[0]]].flatMap(([scope, entity]) => values4(ownData(entity, "awards"), 6).map((reward) => ({
        scope,
        ...Object.fromEntries(["type", "value", "count", "tradable"].map((key) => [key, ownData(reward, key)]))
      })));
      if (awards.length !== 1 || !same(awards[0], record.reward)) return fail4("FC27_RECONCILIATION_UNCONFIRMED");
      const packCount = await rewardCount(record.reward);
      const unassignedClear = await unassigned();
      assert();
      return {
        context,
        fresh: true,
        observedAt: Date.now(),
        setId: record.setId,
        challengeId: record.challengeId,
        present: present.map(({ id: id2, definitionId, pile }) => ({ id: id2, definitionId, pile })),
        setTimesCompleted: sets2[0].timesCompleted,
        packId: record.reward.value,
        packCount,
        unassignedClear
      };
    };
    return Object.freeze({
      capabilities: Object.freeze({ verified: true, submitWithoutSave: true, liveAcceptanceVerified: false }),
      async prepareInputs(options) {
        const input = await readInputs(options);
        if (!input.unassignedClear) return fail4("FC27_UNASSIGNED_NOT_CLEAR");
        const cached = readFc27CachedClub(root);
        return { ...input, inventory: {
          schema: 1,
          context,
          kind: "normalized-inventory",
          status: "provisional",
          items: cached.items.map(protectedItem)
        } };
      },
      readInputs,
      async validateItems(plan) {
        return { context, fresh: true, items: await freshRefs(plan.selected) };
      },
      async readRewardBaseline(plan) {
        return { context, fresh: true, packId: plan.rewards[0].value, count: await rewardCount(plan.rewards[0]) };
      },
      async save(plan) {
        assert();
        if (canWrite() !== true || plan.challenge.brickIndices.length) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const loaded = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const slots = ownData(loaded, "_players");
        if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !same(ownData(loaded, "simpleBrickIndices"), []) || !same(ownData(loaded, "customBrickIndices"), [])) {
          return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        }
        const players = slots.map((slot, index) => {
          const selected = plan.selected.find((item) => item.slot === index);
          const emptyId = ownData(ownData(slot, "_item"), "id");
          if (ownData(slot, "index") !== index || index < 11 && !selected || index >= 11 && ![0, -1].includes(emptyId)) {
            return fail4("FC27_SAVE_INPUT_UNVERIFIED");
          }
          return { index, itemData: { id: selected?.id ?? emptyId, dream: false } };
        });
        const reply = await transport.request("save", {
          challengeId: plan.challenge.id,
          players
        });
        assert();
        return { ...targetOf(plan), status: ownData(reply, "success") === true && ownData(reply, "status") === 200 ? "confirmed" : "unknown" };
      },
      async readSavedSquad(plan) {
        const response = await readDao("loadChallenge", [plan.challenge.id, true]);
        const squad = ownData(response, "squad");
        const slots = ownData(squad, "_players");
        if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !same(ownData(squad, "simpleBrickIndices"), []) || !same(ownData(squad, "customBrickIndices"), []) || plan.challenge.brickIndices.length) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
        const items = [];
        for (let index = 0; index < slots.length; index++) {
          if (ownData(slots[index], "index") !== index) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
          const item = ownData(slots[index], "_item");
          if (index < 11) items.push({ ...protectedItem(snapshotFc27ClubPlayer(item, root)), slot: index });
          else if (![0, -1].includes(ownData(item, "id"))) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
        }
        return { context, fresh: true, ...targetOf(plan), ready: items.length === 11, items };
      },
      async submit(plan, options) {
        assert();
        if (options?.skipValidation !== false || canWrite() !== true) return fail4("FC27_LIVE_DISABLED");
        dirtyCache();
        return projectFc27Submission(await transport.request("submit", targetOf(plan)), targetOf(plan));
      },
      async reconcile(plan, _receipt, baseline) {
        const record = { ...targetOf(plan), itemRefs: plan.selected, reward: plan.rewards[0] };
        const evidence = await observeRecovery(record);
        if (evidence.present.length === 0 && evidence.setTimesCompleted === plan.set.timesCompleted + 1) reconcileCache(plan.selected);
        if (evidence.unassignedClear !== true) return fail4("FC27_RECONCILIATION_UNCONFIRMED");
        return {
          ...evidence,
          progressConfirmed: evidence.setTimesCompleted === plan.set.timesCompleted + 1,
          consumed: evidence.present.length === 0 ? plan.selected.map(({ id: id2, definitionId, pile }) => ({ id: id2, definitionId, pile })) : [],
          rewardDelta: evidence.packCount - baseline.count
        };
      },
      observeRecovery,
      async reconcileRecoveredCache(record, evidence) {
        assert();
        if (evidence.context !== context || evidence.fresh !== true || evidence.present.length !== 0 || Date.now() - evidence.observedAt > 15e3 || evidence.setId !== record.setId || evidence.challengeId !== record.challengeId || evidence.setTimesCompleted !== record.setTimesCompleted + 1) {
          return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
        }
        reconcileCache(record.itemRefs);
      },
      cancel() {
        stopped = true;
        transport.cancel();
      }
    });
  }

  // src/fc27/traditional-journal.js
  var keys = [
    "schema",
    "scope",
    "operationId",
    "setId",
    "challengeId",
    "itemRefs",
    "reward",
    "rewardBaselineCount",
    "phase",
    "updatedAt",
    "submitted"
  ];
  var outcomes = Object.freeze({
    "save-pending": false,
    saved: false,
    "submit-pending": null,
    submitted: true,
    completed: true,
    rejected: false,
    abandoned: false
  });
  var transitions = Object.freeze({
    "save-pending": ["saved"],
    saved: ["submit-pending"],
    "submit-pending": ["submitted", "rejected"],
    submitted: ["completed"]
  });
  var positive = (value) => Number.isSafeInteger(value) && value > 0;
  var nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
  var same2 = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  var fail5 = (reason) => {
    throw new Error(reason);
  };
  function traditionalJournalScope(input) {
    try {
      const context = createSeasonContext(input);
      if (context.season !== "27") return fail5("FC27_JOURNAL_SCOPE_UNVERIFIED");
      return contextKey(context, "traditional-sbc-journal");
    } catch {
      return fail5("FC27_JOURNAL_SCOPE_UNVERIFIED");
    }
  }
  function fields(input, names) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Reflect.ownKeys(input).length !== names.length) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
    return Object.fromEntries(names.map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
      return [name, descriptor.value];
    }));
  }
  function normalizeTraditionalJournal(scope, input) {
    const schema = Object.getOwnPropertyDescriptor(input ?? {}, "schema")?.value;
    const value = fields(input, schema === 2 ? [...keys, "setTimesCompleted"] : keys);
    if (![1, 2].includes(value.schema) || value.schema === 2 && !nonnegative(value.setTimesCompleted) || typeof scope !== "string" || value.scope !== scope || typeof value.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.operationId) || !positive(value.setId) || !positive(value.challengeId) || !nonnegative(value.updatedAt) || typeof value.phase !== "string" || !Object.hasOwn(outcomes, value.phase) || outcomes[value.phase] !== value.submitted || !nonnegative(value.rewardBaselineCount) || !Array.isArray(value.itemRefs) || value.itemRefs.length < 1 || value.itemRefs.length > 11 || Reflect.ownKeys(value.itemRefs).length !== value.itemRefs.length + 1) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
    value.itemRefs = Array.from({ length: value.itemRefs.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value.itemRefs, index);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
      const ref = fields(descriptor.value, ["id", "definitionId", "pile"]);
      if (!positive(ref.id) || !positive(ref.definitionId) || ref.pile !== "club") return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
      return ref;
    });
    if (new Set(value.itemRefs.map((ref) => ref.id)).size !== value.itemRefs.length || new Set(value.itemRefs.map((ref) => ref.definitionId)).size !== value.itemRefs.length) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
    value.reward = fields(value.reward, ["scope", "type", "value", "count", "tradable"]);
    const reward = value.reward;
    if (!["set", "challenge"].includes(reward.scope) || reward.type !== "pack" || !positive(reward.value) || !positive(reward.count) || reward.count > 10 || typeof reward.tradable !== "boolean") return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
    return value;
  }
  function isTerminalTraditionalJournal(record) {
    return ["completed", "rejected", "abandoned"].includes(record.phase);
  }
  function assessTraditionalRecovery(scope, input, evidence, now = Date.now()) {
    const record = normalizeTraditionalJournal(scope, input);
    if (isTerminalTraditionalJournal(record)) return "terminal";
    if (record.schema !== 2 || evidence?.fresh !== true || traditionalJournalScope(evidence.context) !== scope || !nonnegative(evidence.observedAt) || now < evidence.observedAt || now - evidence.observedAt > 15e3 || evidence.setId !== record.setId || evidence.challengeId !== record.challengeId || evidence.packId !== record.reward.value || evidence.unassignedClear !== true || !Array.isArray(evidence.present)) return "unresolved";
    const sorted = (values5) => [...values5].sort((a, b) => a.id - b.id);
    if (["save-pending", "saved"].includes(record.phase) && same2(sorted(evidence.present), sorted(record.itemRefs)) && evidence.setTimesCompleted === record.setTimesCompleted && evidence.packCount === record.rewardBaselineCount) return "abandoned";
    if (["submit-pending", "submitted"].includes(record.phase) && evidence.present.length === 0 && evidence.setTimesCompleted === record.setTimesCompleted + 1 && evidence.packCount === record.rewardBaselineCount + record.reward.count) return "completed";
    return "unresolved";
  }
  function canAdvance(previous, next) {
    if (!previous) return next.phase === "save-pending";
    if (next.updatedAt < previous.updatedAt) return false;
    if (isTerminalTraditionalJournal(previous)) {
      return next.operationId !== previous.operationId && next.phase === "save-pending";
    }
    return transitions[previous.phase]?.includes(next.phase) === true && [...keys, "setTimesCompleted"].filter((key) => !["phase", "updatedAt", "submitted"].includes(key)).every((key) => same2(previous[key], next[key]));
  }
  function createTraditionalJournal({ context, gmGetValue, gmSetValue, hasExclusiveAccess, now = Date.now } = {}) {
    const expectedScope = traditionalJournalScope(context);
    if (typeof gmGetValue !== "function" || typeof gmSetValue !== "function") return fail5("FC27_JOURNAL_STORAGE_UNAVAILABLE");
    if (typeof hasExclusiveAccess !== "function") return fail5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
    const guard = (scope) => {
      if (scope !== expectedScope) return fail5("FC27_JOURNAL_SCOPE_UNVERIFIED");
      if (hasExclusiveAccess(scope) !== true) return fail5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
    };
    async function read(scope) {
      guard(scope);
      let raw;
      try {
        raw = await gmGetValue(expectedScope, null);
      } catch {
        return fail5("FC27_JOURNAL_READ_UNCONFIRMED");
      }
      guard(scope);
      if (raw === null) return null;
      try {
        return normalizeTraditionalJournal(expectedScope, raw);
      } catch {
        return fail5("FC27_RECOVERY_REQUIRED");
      }
    }
    async function write(scope, value) {
      guard(scope);
      const next = normalizeTraditionalJournal(expectedScope, value);
      const previous = await read(scope);
      if (!canAdvance(previous, next)) return fail5("FC27_JOURNAL_TRANSITION_UNVERIFIED");
      guard(scope);
      try {
        await gmSetValue(expectedScope, globalThis.structuredClone(next));
        if (!same2(await read(scope), next)) return fail5("FC27_JOURNAL_UNCONFIRMED");
      } catch {
        return fail5("FC27_JOURNAL_UNCONFIRMED");
      }
    }
    async function resolve(scope, expected, evidence, approval) {
      guard(scope);
      const previous = await read(scope);
      if (!same2(previous, expected) || approval?.approved !== true || approval.operationId !== previous?.operationId) {
        return fail5("FC27_RECOVERY_APPROVAL_INVALID");
      }
      const outcome = assessTraditionalRecovery(scope, previous, evidence, now());
      if (!["completed", "abandoned"].includes(outcome) || approval.outcome !== outcome) return fail5("FC27_RECOVERY_REQUIRED");
      const next = normalizeTraditionalJournal(scope, { ...previous, phase: outcome, submitted: outcome === "completed", updatedAt: now() });
      if (next.updatedAt < previous.updatedAt) return fail5("FC27_RECOVERY_REQUIRED");
      guard(scope);
      try {
        await gmSetValue(expectedScope, globalThis.structuredClone(next));
        if (!same2(await read(scope), next)) return fail5("FC27_JOURNAL_UNCONFIRMED");
      } catch {
        return fail5("FC27_JOURNAL_UNCONFIRMED");
      }
      return { status: "resolved", outcome, submitted: next.submitted };
    }
    return Object.freeze({ read, write, resolve });
  }

  // src/fc27/traditional-lock.js
  var FC27_TRADITIONAL_WEB_LOCK = "fca-fc27-traditional-sbc-v1";
  var fail6 = (reason) => {
    throw new Error(reason);
  };
  function createTraditionalExclusive({ context, lockManager } = {}) {
    const scope = traditionalJournalScope(context);
    let active = false;
    let held = false;
    const supported = () => typeof lockManager?.request === "function";
    async function run(requestedScope, task) {
      if (requestedScope !== scope) return fail6("FC27_JOURNAL_SCOPE_UNVERIFIED");
      if (typeof task !== "function") return fail6("FC27_EXCLUSIVE_TASK_UNVERIFIED");
      if (active || !supported()) return null;
      active = true;
      let accepting = true;
      let entered = false;
      let taskError;
      try {
        return await lockManager.request(FC27_TRADITIONAL_WEB_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!accepting || entered) return fail6("FC27_EXCLUSIVE_ACCESS_LOST");
          entered = true;
          if (!lock) return null;
          if (lock.name !== FC27_TRADITIONAL_WEB_LOCK || lock.mode !== "exclusive") return fail6("FC27_EXCLUSIVE_ACCESS_LOST");
          held = true;
          try {
            return await task();
          } catch (error) {
            taskError = error;
            throw error;
          } finally {
            held = false;
          }
        });
      } catch (error) {
        if (error === taskError) throw error;
        return fail6("FC27_EXCLUSIVE_ACCESS_LOST");
      } finally {
        accepting = false;
        held = false;
        active = false;
      }
    }
    return Object.freeze({
      run,
      hasExclusiveAccess: (requestedScope) => requestedScope === scope && held,
      inspect: () => ({ supported: supported(), active })
    });
  }

  // src/adapters/browser/fc27-transaction-persistence.js
  function createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager } = {}) {
    const lock = createTraditionalExclusive({ context, lockManager });
    const pendingWrites = /* @__PURE__ */ new Set();
    const write = async (key, value) => {
      const pending = Promise.resolve().then(() => gmSetValue(key, value));
      pendingWrites.add(pending);
      try {
        return await pending;
      } finally {
        pendingWrites.delete(pending);
      }
    };
    const journal = createTraditionalJournal({
      context,
      gmGetValue,
      gmSetValue: typeof gmSetValue === "function" ? write : gmSetValue,
      hasExclusiveAccess: lock.hasExclusiveAccess
    });
    const exclusive = (scope, task) => lock.run(scope, async () => {
      try {
        return await task();
      } finally {
        while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
      }
    });
    return Object.freeze({ journal, exclusive, inspect: () => {
      const state = lock.inspect();
      return { storageAvailable: true, lockSupported: state.supported, active: state.active };
    } });
  }

  // src/domain/contracts.js
  var INVENTORY_PILES = Object.freeze(["unassigned", "storage", "transfer", "club"]);
  function finiteNumber(value, fallback = 0) {
    const number2 = Number(value);
    return Number.isFinite(number2) ? number2 : fallback;
  }
  function cloneSerializable(value) {
    return value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));
  }
  function createSubmissionResult(input = {}) {
    return Object.freeze({
      status: String(input.status || "blocked"),
      submitted: input.submitted === true,
      challengeRef: cloneSerializable(input.challengeRef ?? null),
      consumedItemRefs: Object.freeze(cloneSerializable(input.consumedItemRefs || [])),
      rewardPackId: input.rewardPackId === void 0 || input.rewardPackId === null ? null : finiteNumber(input.rewardPackId),
      reason: input.reason ? String(input.reason) : null,
      reasonCode: input.reasonCode ? String(input.reasonCode) : null,
      details: Object.freeze(cloneSerializable(input.details || {}))
    });
  }

  // src/sbc/submit-attempt.js
  async function runValidators(validators, context, phase) {
    for (const validator of validators || []) {
      const result = await validator(context);
      if (result === false) throw new Error(`${phase} validator rejected the SBC attempt`);
      if (result?.ok === false) throw new Error(result.reason || `${phase} validator rejected the SBC attempt`);
    }
  }
  async function resolveSubmitReadiness(options, context) {
    const maxAttempts = Math.max(1, Math.min(5, Number(options.submitReadyAttempts || 1) || 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ready = options.isSubmitReady ? await options.isSubmitReady(context) : true;
      if (ready || attempt >= maxAttempts) return ready;
      await options.onSubmitNotReady?.({ context, attempt, maxAttempts });
    }
    return false;
  }
  async function publishResult(options, result, context = {}) {
    if (typeof options.onResult !== "function") return result;
    try {
      await options.onResult(result, context);
    } catch (error) {
      try {
        await options.onResultError?.(error, { result, context });
      } catch {
      }
    }
    return result;
  }
  async function submitSbcAttempt(options = {}) {
    const challengeContext = await options.challengeProvider?.();
    if (!challengeContext?.challenge || !challengeContext?.set) {
      return publishResult(options, createSubmissionResult({
        status: "unavailable",
        submitted: false,
        reason: challengeContext?.reason || "no available SBC challenge"
      }), { phase: "challenge" });
    }
    const context = {
      ...challengeContext,
      label: options.label || challengeContext.set?.name || "SBC",
      dryRun: options.dryRun === true
    };
    const squadPlan = await options.squadProvider?.(context);
    if (!squadPlan?.ok) {
      return publishResult(options, createSubmissionResult({
        status: "blocked",
        submitted: false,
        challengeRef: context.challengeRef || { id: context.challenge?.id || null },
        reason: squadPlan?.reason || "squad provider did not produce a valid plan"
      }), { phase: "squad", context });
    }
    context.squadPlan = squadPlan;
    context.players = squadPlan.players || [];
    if (context.dryRun) {
      await runValidators(options.preSaveValidators, context, "pre-save");
      return publishResult(options, createSubmissionResult({
        status: "planned",
        submitted: false,
        challengeRef: context.challengeRef || { id: context.challenge?.id || null },
        consumedItemRefs: squadPlan.itemRefs || []
      }), { phase: "dry-run", context });
    }
    let accessToken;
    try {
      if (options.prepareRuntimeAccess) {
        const access = await options.prepareRuntimeAccess(context);
        context.runtimeAccess = access || null;
        if (access?.ok === false) {
          return publishResult(options, createSubmissionResult({
            status: "blocked",
            submitted: false,
            challengeRef: context.challengeRef || { id: context.challenge?.id || null },
            consumedItemRefs: squadPlan.itemRefs || [],
            reason: access.reason || "runtime inventory validation failed"
          }), { phase: "runtime-access", context });
        }
        if (Array.isArray(access?.players)) {
          context.players = access.players;
          context.squadPlan = {
            ...context.squadPlan,
            players: access.players,
            itemRefs: access.itemRefs || context.squadPlan.itemRefs
          };
        }
        accessToken = access?.token;
      }
      if (options.preparePlayers) {
        const prepared = await options.preparePlayers(context);
        context.playerPreparation = prepared || null;
        if (prepared?.ok === false) {
          return publishResult(options, createSubmissionResult({
            status: "blocked",
            submitted: false,
            challengeRef: context.challengeRef || { id: context.challenge?.id || null },
            consumedItemRefs: context.squadPlan.itemRefs || [],
            reason: prepared.reason || "SBC player preparation failed",
            reasonCode: prepared.reasonCode || "PLAYER_PREPARATION_BLOCKED",
            details: prepared.details
          }), { phase: "player-preparation", context });
        }
        if (prepared?.replan === true || prepared?.status === "replan") {
          return publishResult(options, createSubmissionResult({
            status: "replan",
            submitted: false,
            challengeRef: context.challengeRef || { id: context.challenge?.id || null },
            consumedItemRefs: context.squadPlan.itemRefs || [],
            reason: prepared.reason || "inventory changed during player preparation; replan required",
            reasonCode: prepared.reasonCode || "PLAYER_PREPARATION_REPLAN",
            details: prepared.details
          }), { phase: "player-preparation-replan", context });
        }
        if (Array.isArray(prepared?.players)) {
          context.players = prepared.players;
          context.squadPlan = {
            ...context.squadPlan,
            players: prepared.players,
            itemRefs: prepared.itemRefs || context.squadPlan.itemRefs,
            ...prepared.selection ? { selection: prepared.selection } : {}
          };
        }
      }
      await runValidators(options.preSaveValidators, context, "pre-save");
      await options.saveSquad?.(context);
      if (options.reloadSquad) await options.reloadSquad(context);
      if (options.readSavedPlayers) context.savedPlayers = await options.readSavedPlayers(context);
      await runValidators(options.postSaveValidators, context, "post-save");
      if (options.prepareOnly === true) {
        return publishResult(options, createSubmissionResult({
          status: "prepared",
          submitted: false,
          challengeRef: context.challengeRef || { id: context.challenge?.id || null },
          consumedItemRefs: context.squadPlan.itemRefs || []
        }), { phase: "prepared", context });
      }
      const submitReady = await resolveSubmitReadiness(options, context);
      if (!submitReady) {
        return publishResult(options, createSubmissionResult({
          status: "blocked",
          submitted: false,
          challengeRef: context.challengeRef || { id: context.challenge?.id || null },
          consumedItemRefs: context.squadPlan.itemRefs || [],
          reason: "saved squad is not submit ready"
        }), { phase: "readiness", context });
      }
      if (options.readFinalPlayers) {
        context.finalPlayers = await options.readFinalPlayers(context);
      }
      await runValidators(options.finalValidators, context, "final");
      let submissionRevalidated = false;
      context.revalidateSubmission = async () => {
        if (submissionRevalidated) {
          throw new Error("submission revalidation is already consumed");
        }
        submissionRevalidated = true;
        const readLatestPlayers = options.readFinalPlayers || options.readSavedPlayers;
        if (readLatestPlayers) {
          const latestPlayers = await readLatestPlayers(context);
          if (!Array.isArray(latestPlayers) || !latestPlayers.length) {
            throw new Error("submission revalidation could not read the saved squad");
          }
          context.finalPlayers = latestPlayers;
          context.players = latestPlayers;
          context.savedPlayers = latestPlayers;
        }
        await runValidators(options.preSaveValidators, context, "confirmation pre-save");
        await runValidators(options.postSaveValidators, context, "confirmation post-save");
        await runValidators(options.finalValidators, context, "confirmation final");
        return {
          ok: true,
          players: context.finalPlayers?.length ? context.finalPlayers : context.savedPlayers?.length ? context.savedPlayers : context.players
        };
      };
      const runCommittedSubmit = typeof options.runCommittedSubmit === "function" ? options.runCommittedSubmit : async (operation) => operation();
      return await runCommittedSubmit(async () => {
        const transportResult = await options.submitTransport?.(context);
        if (transportResult?.submitted === false || transportResult?.ok === false) {
          return publishResult(options, createSubmissionResult({
            status: transportResult?.status || "blocked",
            submitted: false,
            challengeRef: context.challengeRef || { id: context.challenge?.id || null },
            consumedItemRefs: context.squadPlan.itemRefs || [],
            reason: transportResult?.reason || "SBC submit transport failed",
            reasonCode: transportResult?.reasonCode,
            details: transportResult?.details
          }), { phase: "transport", context, transportResult });
        }
        const result = createSubmissionResult({
          status: "submitted",
          submitted: true,
          challengeRef: context.challengeRef || { id: context.challenge?.id || null },
          consumedItemRefs: context.squadPlan.itemRefs || [],
          rewardPackId: transportResult?.rewardPackId
        });
        await publishResult(options, result, { phase: "submitted", context, transportResult });
        if (options.afterSubmit) {
          const afterSubmit = await options.afterSubmit({ ...context, result, transportResult });
          if (afterSubmit?.ok === false) {
            return {
              ...result,
              postSubmitBlocked: true,
              reason: afterSubmit.reason || "post-submit inventory finalization failed",
              reasonCode: afterSubmit.reasonCode || "POST_SUBMIT_FINALIZATION_BLOCKED",
              details: afterSubmit.details || result.details
            };
          }
        }
        return result;
      }, context);
    } finally {
      if (options.releaseRuntimeAccess) await options.releaseRuntimeAccess({ ...context, token: accessToken });
    }
  }

  // src/fc27/traditional-transaction.js
  var lifetime = 6e4;
  var positive2 = (value) => Number.isSafeInteger(value) && value > 0;
  var nonnegative2 = (value) => Number.isSafeInteger(value) && value >= 0;
  var fail7 = (reason) => {
    throw new Error(reason);
  };
  var blocked = (reason) => ({ status: "blocked", reason, submitted: false, recoveryRequired: false });
  var clone = (value) => globalThis.structuredClone(value);
  var pick = (value, keys2) => Object.fromEntries(keys2.map((key) => [key, value?.[key] ?? null]));
  var same3 = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  var refs = (items) => items.map((item) => pick(item, ["id", "definitionId", "pile"]));
  var safetyKeys = [
    "id",
    "definitionId",
    "type",
    "pile",
    "rating",
    "rarity",
    "special",
    "evolution",
    "cosmetic",
    "concept",
    "academyEnrolled",
    "tradeable",
    "loans",
    "limitedUse",
    "leagueId",
    "state",
    "activeTrade",
    "locked",
    "activeSquad",
    "protected"
  ];
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function scopeMatches(left, right) {
    try {
      return same3(createSeasonContext(left), createSeasonContext(right));
    } catch {
      return false;
    }
  }
  function validReward(reward) {
    return ["set", "challenge"].includes(reward?.scope) && reward.type === "pack" && positive2(reward.value) && positive2(reward.count) && reward.count <= 10 && typeof reward.tradable === "boolean";
  }
  function facts(contract, policy, now) {
    if (!nonnegative2(now)) return fail7("FC27_ATTEMPT_TIME_UNVERIFIED");
    const context = createSeasonContext(contract?.context);
    if (context.season !== "27" || contract.schema !== 1 || contract.source !== "fresh-dao" || !nonnegative2(contract.observedAt) || now < contract.observedAt || now - contract.observedAt > lifetime || !scopeMatches(context, contract.challenge?.context) || !scopeMatches(context, policy?.context)) {
      return fail7("FC27_ATTEMPT_CONTEXT_UNVERIFIED");
    }
    const set = pick(contract.set, [
      "id",
      "name",
      "challengesCount",
      "challengesCompletedCount",
      "timesCompleted",
      "repeats",
      "repeatabilityMode",
      "startTime",
      "endTime"
    ]);
    if (!positive2(set.id) || set.id !== contract.challenge.setId || set.challengesCount !== 1 || set.challengesCompletedCount !== 0 || typeof set.name !== "string" || set.name.length > 160 || /[\u0000-\u001f]/.test(set.name) || ["timesCompleted", "repeats", "startTime", "endTime"].some((key) => !nonnegative2(set[key])) || !["NON_REPEATABLE", "UNLIMITED", "LIMITED"].includes(set.repeatabilityMode) || set.repeatabilityMode === "LIMITED" && set.timesCompleted >= set.repeats || set.repeatabilityMode === "NON_REPEATABLE" && set.timesCompleted !== 0 || set.startTime * 1e3 > now || set.endTime !== 0 && set.endTime * 1e3 <= now) return fail7("FC27_ATTEMPT_SET_UNVERIFIED");
    if (!Array.isArray(contract.rewards) || contract.rewards.length !== 1) return fail7("FC27_ATTEMPT_REWARD_UNVERIFIED");
    const reward = pick(contract.rewards[0], ["scope", "type", "value", "count", "tradable"]);
    if (!validReward(reward)) return fail7("FC27_ATTEMPT_REWARD_UNVERIFIED");
    if (!positive2(policy.maxRating) || policy.maxRating > 83 || policy.onlyUntradeable !== true || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200 || !Array.isArray(contract.challenge.requirements) || contract.challenge.requirements.length > 16 || !Array.isArray(contract.challenge.brickIndices) || contract.challenge.brickIndices.length > 11) return fail7("FC27_ATTEMPT_POLICY_UNVERIFIED");
    return clone({
      context,
      set,
      rewards: [reward],
      challenge: { ...pick(contract.challenge, [
        "schema",
        "mechanism",
        "requirementsOperation",
        "completed",
        "setId",
        "id",
        "slotCount",
        "brickIndices",
        "requirements"
      ]), context },
      policy: { ...pick(policy, [
        "schema",
        "reviewed",
        "maxRating",
        "onlyUntradeable",
        "goldRange",
        "protectFsuLockedPlayers",
        "protectActiveSquad",
        "storageFirst",
        "excludedLeagueIds"
      ]), context }
    });
  }
  function prepare(input, now) {
    const bound = facts(input.contract, input.policy, now);
    const plan = previewTraditionalSquad({ ...bound, inventory: input.inventory });
    if (plan.status !== "preview") return blocked(plan.reason);
    const byId = new Map(input.inventory.items.map((item) => [item.id, item]));
    const selected = plan.selected.map((ref) => ({ ...pick(byId.get(ref.id), safetyKeys), slot: ref.slot }));
    if (selected.some((item) => item.pile !== "club" || ![0, 1].includes(item.rarity) || item.state !== "free")) {
      return blocked("FC27_ATTEMPT_ITEM_UNVERIFIED");
    }
    return freeze({ status: "prepared", ...bound, createdAt: now, selected });
  }
  function validateItems(plan, snapshot, saved = false) {
    if (snapshot?.fresh !== true || !scopeMatches(snapshot.context, plan.context) || !Array.isArray(snapshot.items) || snapshot.items.length !== plan.selected.length) return fail7("FC27_EXACT_ITEMS_CHANGED");
    if (saved && (snapshot.setId !== plan.set.id || snapshot.challengeId !== plan.challenge.id || snapshot.ready !== true)) {
      return fail7("FC27_SAVED_SQUAD_UNVERIFIED");
    }
    const byId = new Map(snapshot.items.map((item) => [item?.id, item]));
    if (byId.size !== plan.selected.length) return fail7("FC27_EXACT_ITEMS_CHANGED");
    for (const expected of plan.selected) {
      const current2 = byId.get(expected.id);
      if (!same3(pick(current2, safetyKeys), pick(expected, safetyKeys)) || saved && current2.slot !== expected.slot) {
        return fail7("FC27_EXACT_ITEMS_CHANGED");
      }
    }
    const check = previewTraditionalSquad({
      context: plan.context,
      challenge: plan.challenge,
      policy: plan.policy,
      inventory: { schema: 1, context: plan.context, kind: "normalized-inventory", status: "ready", items: snapshot.items }
    });
    if (check.status !== "preview" || !same3(check.selected, plan.selected.map((item) => pick(item, ["id", "definitionId", "pile", "rating", "slot"])))) {
      return fail7("FC27_EXACT_ITEMS_CHANGED");
    }
  }
  async function bounded(operation) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("FC27_OPERATION_TIMEOUT")), 15e3);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  function safeReason(error) {
    return /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : "FC27_ATTEMPT_UNCONFIRMED";
  }
  function terminalRecord(record, scope) {
    try {
      return isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, record));
    } catch {
      return false;
    }
  }
  function createTraditionalTransaction({
    enabled = false,
    adapter,
    journal,
    exclusive,
    now = Date.now,
    createOperationId,
    shouldStop = () => false
  } = {}) {
    const plans = /* @__PURE__ */ new WeakSet();
    const approved = /* @__PURE__ */ new WeakSet();
    const permits = /* @__PURE__ */ new WeakMap();
    let busy = false;
    const api = {
      prepare(input) {
        try {
          const plan = prepare(input, now());
          if (plan.status === "prepared") plans.add(plan);
          return plan;
        } catch (error) {
          return blocked(safeReason(error));
        }
      },
      approve(plan, approval) {
        if (enabled !== true) return blocked("FC27_LIVE_DISABLED");
        if (!plans.has(plan) || approved.has(plan) || approval?.approved !== true || approval.count !== 1 || approval.setId !== plan.set.id || approval.challengeId !== plan.challenge.id || approval.maxPlayers !== plan.selected.length || approval.maxRating !== plan.policy.maxRating) {
          return blocked("FC27_APPROVAL_INVALID");
        }
        if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return blocked("FC27_APPROVAL_EXPIRED");
        const permit = Object.freeze({});
        approved.add(plan);
        permits.set(permit, plan);
        return { status: "approved", permit };
      },
      async execute(permit) {
        if (enabled !== true) return blocked("FC27_LIVE_DISABLED");
        if (busy) return blocked("FC27_ATTEMPT_BUSY");
        const plan = permits.get(permit);
        if (!plan) return blocked("FC27_APPROVAL_INVALID");
        permits.delete(permit);
        if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return blocked("FC27_APPROVAL_EXPIRED");
        const effects = ["readInputs", "validateItems", "readRewardBaseline", "save", "readSavedSquad", "submit", "reconcile"];
        if (adapter?.capabilities?.verified !== true || adapter.capabilities.submitWithoutSave !== true || effects.some((name) => typeof adapter[name] !== "function") || typeof exclusive !== "function" || typeof createOperationId !== "function" || typeof journal?.read !== "function" || typeof journal.write !== "function") {
          return blocked("FC27_TRANSACTION_ADAPTER_UNVERIFIED");
        }
        busy = true;
        const scope = contextKey(plan.context, "traditional-sbc-journal");
        let entered = false;
        let held = false;
        let operation;
        let outcome;
        let lockFailed = false;
        try {
          try {
            await exclusive(scope, async () => {
              if (entered) return blocked("FC27_ATTEMPT_BUSY");
              entered = true;
              held = true;
              operation = executeLocked(plan, scope, () => held);
              outcome = await operation;
              return outcome;
            });
            if (entered && !outcome) lockFailed = true;
          } catch {
            lockFailed = true;
          } finally {
            held = false;
          }
          if (operation) outcome = await operation;
          if (lockFailed) return {
            ...blocked("FC27_EXCLUSIVE_ACCESS_LOST"),
            ...outcome,
            status: "blocked",
            reason: "FC27_EXCLUSIVE_ACCESS_LOST"
          };
          return outcome ?? blocked("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        } catch (error) {
          return { ...blocked(safeReason(error)), ...outcome, status: "blocked", reason: safeReason(error) };
        } finally {
          busy = false;
        }
      }
    };
    async function executeLocked(plan, scope, lockHeld) {
      let saveInvoked = false;
      let submitInvoked = false;
      let submitted = false;
      let rejected = false;
      let rejectionPersisted = false;
      let journalReadConfirmed = false;
      let completed = false;
      let journalFailed = false;
      let record;
      let baseline;
      let saved;
      let receipt;
      const target = (result) => result?.setId === plan.set.id && result?.challengeId === plan.challenge.id;
      const stopCheck = () => {
        if (!lockHeld()) return fail7("FC27_EXCLUSIVE_ACCESS_LOST");
        if (shouldStop() === true) return fail7("FC27_STOP_REQUESTED");
        if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return fail7("FC27_APPROVAL_EXPIRED");
      };
      const currentInputs = async () => {
        stopCheck();
        if (adapter.capabilities?.verified !== true || adapter.capabilities.submitWithoutSave !== true) {
          return fail7("FC27_TRANSACTION_ADAPTER_UNVERIFIED");
        }
        const input = await bounded(() => adapter.readInputs(plan));
        const current2 = facts(input?.contract, input?.policy, now());
        if (input.unassignedClear !== true || !same3(current2, pick(plan, ["context", "set", "rewards", "challenge", "policy"]))) {
          return fail7("FC27_ATTEMPT_INPUTS_CHANGED");
        }
        stopCheck();
      };
      const persist = async (phase) => {
        record = normalizeTraditionalJournal(scope, { ...record, phase, updatedAt: now(), submitted: submitted ? true : phase === "submit-pending" || submitInvoked && !rejected ? null : false });
        try {
          await bounded(() => journal.write(scope, clone(record)));
          if (!same3(await bounded(() => journal.read(scope)), record)) return fail7("FC27_JOURNAL_UNCONFIRMED");
        } catch {
          return fail7("FC27_JOURNAL_UNCONFIRMED");
        }
      };
      try {
        const previous = await bounded(() => journal.read(scope));
        journalReadConfirmed = true;
        if (previous !== null && !terminalRecord(previous, scope)) return fail7("FC27_RECOVERY_REQUIRED");
        const operationId = createOperationId();
        if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) return fail7("FC27_OPERATION_ID_UNVERIFIED");
        record = {
          schema: 2,
          scope,
          operationId,
          setId: plan.set.id,
          challengeId: plan.challenge.id,
          setTimesCompleted: plan.set.timesCompleted,
          itemRefs: refs(plan.selected),
          reward: plan.rewards[0]
        };
        await submitSbcAttempt({
          challengeProvider: async () => {
            await currentInputs();
            return { set: plan.set, challenge: plan.challenge };
          },
          squadProvider: async () => ({ ok: true, players: plan.selected, itemRefs: refs(plan.selected) }),
          prepareRuntimeAccess: async () => {
            const snapshot = await bounded(() => adapter.validateItems(plan));
            validateItems(plan, snapshot);
            return { ok: true, players: plan.selected };
          },
          preSaveValidators: [currentInputs],
          saveSquad: async () => {
            baseline = await bounded(() => adapter.readRewardBaseline(plan));
            if (baseline?.fresh !== true || !scopeMatches(baseline.context, plan.context) || baseline.packId !== plan.rewards[0].value || !nonnegative2(baseline.count)) return fail7("FC27_REWARD_BASELINE_UNVERIFIED");
            record.rewardBaselineCount = baseline.count;
            await persist("save-pending");
            await currentInputs();
            saveInvoked = true;
            const result = await bounded(() => adapter.save(plan));
            if (result?.status !== "confirmed" || !target(result)) return fail7("FC27_SAVE_UNCONFIRMED");
            await persist("saved");
          },
          reloadSquad: async () => {
            stopCheck();
            saved = await bounded(() => adapter.readSavedSquad(plan));
          },
          readSavedPlayers: async () => saved?.items,
          postSaveValidators: [() => validateItems(plan, saved, true)],
          isSubmitReady: async () => saved?.ready === true,
          readFinalPlayers: async () => {
            await currentInputs();
            saved = await bounded(() => adapter.readSavedSquad(plan));
            return saved?.items;
          },
          finalValidators: [() => validateItems(plan, saved, true)],
          submitTransport: async () => {
            await persist("submit-pending");
            await currentInputs();
            validateItems(plan, await bounded(() => adapter.validateItems(plan)));
            saved = await bounded(() => adapter.readSavedSquad(plan));
            validateItems(plan, saved, true);
            await currentInputs();
            stopCheck();
            submitInvoked = true;
            receipt = await bounded(() => adapter.submit(plan, { skipValidation: false }));
            if (receipt?.status === "rejected" && target(receipt)) {
              rejected = true;
              await persist("rejected");
              rejectionPersisted = true;
              return fail7("FC27_SUBMIT_REJECTED");
            }
            if (receipt?.status !== "confirmed" || !target(receipt)) return fail7("FC27_SUBMIT_UNCONFIRMED");
            submitted = true;
            try {
              await persist("submitted");
            } catch {
              journalFailed = true;
            }
            return { submitted: true, rewardPackId: plan.rewards[0].value };
          },
          afterSubmit: async () => {
            const result = await bounded(() => adapter.reconcile(plan, receipt, baseline));
            const consumed = Array.isArray(result?.consumed) ? [...result.consumed].sort((a, b) => a.id - b.id) : null;
            const expected = refs(plan.selected).sort((a, b) => a.id - b.id);
            if (!target(result) || result.fresh !== true || !scopeMatches(result.context, plan.context) || result.progressConfirmed !== true || !same3(consumed, expected) || result.packId !== plan.rewards[0].value || result.packCount !== baseline.count + plan.rewards[0].count) {
              return fail7("FC27_RECONCILIATION_UNCONFIRMED");
            }
            if (journalFailed) return fail7("FC27_JOURNAL_UNCONFIRMED");
            await persist("completed");
            completed = true;
          }
        });
        if (!completed) return fail7("FC27_ATTEMPT_UNCONFIRMED");
        return {
          status: "completed",
          submitted: true,
          recoveryRequired: false,
          consumedCount: plan.selected.length,
          rewardCount: plan.rewards[0].count
        };
      } catch (error) {
        const reason = safeReason(error);
        return {
          status: "blocked",
          reason,
          submitted: submitted ? true : submitInvoked && !rejected ? null : false,
          recoveryRequired: !journalReadConfirmed || reason === "FC27_RECOVERY_REQUIRED" || !completed && !rejectionPersisted && (saveInvoked || submitInvoked || !!record?.phase)
        };
      } finally {
        try {
          adapter.cancel?.();
        } catch {
        }
      }
    }
    return Object.freeze(api);
  }

  // src/adapters/browser/fc27-acceptance-session.js
  var blocked2 = (reason) => ({ status: "blocked", reason });
  var safeReason2 = (error) => /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : "FC27_ACCEPTANCE_UNCONFIRMED";
  function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, lockManager, liveEnabled = false }) {
    const context = readFc27Context(root);
    const scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
    let prepared = null;
    let recovery = null;
    let armed = false;
    let busy = false;
    const unchanged = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_TRANSACTION_CONTEXT_CHANGED");
    };
    const provider = () => createFc27TraditionalProvider(root, { canWrite: () => {
      unchanged();
      return liveEnabled === true && armed && persistence.inspect().active;
    } });
    const run = async (task) => {
      if (busy) return blocked2("FC27_ATTEMPT_BUSY");
      busy = true;
      try {
        unchanged();
        return await task();
      } catch (error) {
        return blocked2(safeReason2(error));
      } finally {
        busy = false;
        armed = false;
      }
    };
    const inspect = async () => persistence.exclusive(scope, async () => {
      const record = await persistence.journal.read(scope);
      recovery = null;
      if (!record || isTerminalTraditionalJournal(record)) return { status: "idle", phase: record?.phase ?? null };
      const adapter = await provider();
      try {
        const evidence = await adapter.observeRecovery(record);
        const outcome = assessTraditionalRecovery(scope, record, evidence);
        if (["abandoned", "completed"].includes(outcome)) recovery = { record, outcome };
        return {
          status: recovery ? "recoverable" : "blocked",
          reason: recovery ? "FC27_RECOVERY_CONFIRMATION_REQUIRED" : "FC27_RECOVERY_REQUIRED",
          phase: record.phase,
          outcome,
          submitted: record.submitted,
          setId: record.setId,
          challengeId: record.challengeId,
          selectedCount: record.itemRefs.length,
          presentCount: evidence.present.length,
          packCount: evidence.packCount
        };
      } finally {
        adapter.cancel();
      }
    });
    return Object.freeze({
      prepare: (options) => run(async () => {
        prepared?.adapter.cancel();
        prepared = null;
        return await persistence.exclusive(scope, async () => {
          const record = await persistence.journal.read(scope);
          if (record && !isTerminalTraditionalJournal(record)) return blocked2("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const input = await adapter.prepareInputs(options);
            if (input.contract.challenge.brickIndices.length) return blocked2("FC27_ACCEPTANCE_BRICKS_UNSUPPORTED");
            const engine = createTraditionalTransaction({
              enabled: liveEnabled,
              adapter,
              ...persistence,
              createOperationId: () => root.crypto.randomUUID()
            });
            const plan = engine.prepare(input);
            if (plan.status !== "prepared") {
              adapter.cancel();
              return plan;
            }
            const exact = await adapter.validateItems(plan);
            if (exact.items.length !== plan.selected.length || !plan.selected.every((item) => exact.items.some((current2) => current2.id === item.id && current2.definitionId === item.definitionId && Object.keys(item).filter((key) => key !== "slot").every((key) => item[key] === current2[key])))) {
              adapter.cancel();
              return blocked2("FC27_EXACT_ITEMS_CHANGED");
            }
            const baseline = await adapter.readRewardBaseline(plan);
            unchanged();
            prepared = { engine, plan, adapter };
            return {
              status: "prepared",
              liveEnabled: liveEnabled === true,
              setId: plan.set.id,
              challengeId: plan.challenge.id,
              setName: plan.set.name,
              maxRating: plan.policy.maxRating,
              selectedCount: plan.selected.length,
              ratings: plan.selected.map((item) => item.rating),
              packId: baseline.packId,
              packCount: baseline.count
            };
          } catch (error) {
            adapter.cancel();
            throw error;
          }
        }) ?? blocked2("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      }),
      execute: (approval) => run(async () => {
        if (!prepared || liveEnabled !== true) return blocked2("FC27_LIVE_DISABLED");
        const current2 = prepared;
        prepared = null;
        const result = current2.engine.approve(current2.plan, approval);
        if (result.status !== "approved") {
          current2.adapter.cancel();
          return result;
        }
        armed = true;
        return current2.engine.execute(result.permit);
      }),
      inspectRecovery: () => run(async () => await inspect() ?? blocked2("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE")),
      resolveRecovery: (approved) => run(async () => {
        if (approved !== true || !recovery) return blocked2("FC27_RECOVERY_APPROVAL_INVALID");
        const expected = recovery;
        recovery = null;
        return await persistence.exclusive(scope, async () => {
          const record = await persistence.journal.read(scope);
          if (JSON.stringify(record) !== JSON.stringify(expected.record)) return blocked2("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const evidence = await adapter.observeRecovery(record);
            unchanged();
            if (expected.outcome === "completed") {
              if (assessTraditionalRecovery(scope, record, evidence) !== "completed") return blocked2("FC27_RECOVERY_REQUIRED");
              await adapter.reconcileRecoveredCache(record, evidence);
            }
            return await persistence.journal.resolve(
              scope,
              record,
              evidence,
              { approved: true, operationId: record.operationId, outcome: expected.outcome }
            );
          } finally {
            adapter.cancel();
          }
        }) ?? blocked2("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      })
    });
  }
  async function checkFc27GmInstallation({ gmGetValue, gmSetValue, lockManager, hold = false }) {
    const context = { season: "27", accountScope: "acceptance-self-test", platform: "local" };
    const scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
    const result = await persistence.exclusive(scope, async () => {
      const previous = await persistence.journal.read(scope);
      if (!previous) await persistence.journal.write(scope, {
        schema: 2,
        scope,
        operationId: "installation-probe",
        setId: 1,
        challengeId: 1,
        itemRefs: [{ id: 1, definitionId: 1, pile: "club" }],
        reward: { scope: "set", type: "pack", value: 1, count: 1, tradable: false },
        rewardBaselineCount: 0,
        phase: "save-pending",
        updatedAt: Date.now(),
        submitted: false,
        setTimesCompleted: 0
      });
      if (hold === true) await new Promise((resolve) => setTimeout(resolve, 4e3));
      const record = await persistence.journal.read(scope);
      return { status: "verified", persistedPreviously: !!previous, phase: record.phase, synthetic: true, eaRequests: 0 };
    });
    return result ?? blocked2("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
  }

  // src/adapters/browser/fc27-acceptance-panel.js
  function mountFc27AcceptancePanel({
    document,
    targets,
    prepare: prepare2,
    execute,
    inspectRecovery,
    resolveRecovery,
    checkInstallation,
    hostId = "fcat-fc27-acceptance",
    title = "FC Automation Tool - FC27 Acceptance",
    version = null
  }) {
    if (!document?.body || document.getElementById(hostId)) return;
    const host = document.createElement("aside");
    host.id = hostId;
    if (version) host.dataset.version = version;
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:100002;font:13px/1.45 Arial,sans-serif;color:#edf1ef;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}details{width:min(370px,calc(100vw - 24px));background:#202724;border:1px solid #67736c;border-radius:6px}
    summary{padding:12px;cursor:pointer;font-weight:600}.body{padding:0 12px 12px;max-height:calc(100dvh - 100px);overflow:auto}
    label{display:grid;gap:4px;margin:8px 0}select,button{font:inherit;min-height:36px;padding:7px;border:1px solid #67736c;border-radius:4px;color:inherit;background:#303b35;max-width:100%}
    select{width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
    output{display:block;min-height:38px;overflow-wrap:anywhere;border-top:1px solid #526159;padding-top:8px;color:#f3d89a}
    #detail{margin-top:6px;overflow-wrap:anywhere;color:#c2d9cb}dialog{max-width:min(360px,calc(100vw - 24px));color:#edf1ef;background:#202724;border:1px solid #67736c;border-radius:6px}dialog::backdrop{background:#0009}
  </style><details><summary></summary><div class="body">
    <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">&#8635;</button><button id="gm">Check GM</button><button id="hold">Check tab lock</button></div>
    <label>SBC<select id="target"></select></label><label>Max OVR<select id="rating"><option>74</option><option>83</option></select></label>
    <div class="row"><button id="prepare">Verify squad</button><button id="execute" disabled>Submit once</button></div>
    <div class="row"><button id="recovery">Check recovery</button><button id="resolve" disabled>Confirm recovery</button></div>
    <output id="status">Live execution disabled</output><div id="detail"></div>
  </div></details><dialog><p id="approval"></p><div class="row"><button id="cancel">Cancel</button><button id="confirm">Confirm</button></div></dialog>`;
    const node = (id2) => shadow.getElementById(id2);
    shadow.querySelector("summary").textContent = title;
    let busy = false;
    let plan = null;
    let recovery = null;
    let action = null;
    const renderTargets = () => {
      const previous = node("target").value;
      node("target").replaceChildren();
      for (const target of targets()) {
        const option = document.createElement("option");
        option.value = String(target.setId);
        option.textContent = target.name;
        node("target").append(option);
      }
      if ([...node("target").options].some((option) => option.value === previous)) node("target").value = previous;
    };
    const update = () => {
      for (const button of shadow.querySelectorAll("button,select")) button.disabled = busy;
      node("execute").disabled = busy || plan?.liveEnabled !== true;
      node("resolve").disabled = busy || recovery?.status !== "recoverable";
    };
    const run = async (task) => {
      if (busy) return;
      busy = true;
      update();
      node("status").textContent = "Checking...";
      host.dataset.busy = "true";
      try {
        const result = await task();
        if (result.status === "prepared") plan = result;
        if (result.status === "recoverable") recovery = result;
        node("status").textContent = result.reason ?? result.status;
        node("detail").textContent = result.status === "prepared" ? `${result.setName}: ${result.selectedCount} players; OVR ${result.ratings.join(", ")}; pack ${result.packId}` : result.synthetic ? `GM ${result.persistedPreviously ? "restored" : "written"}; ${result.phase}` : "";
        host.dataset.result = JSON.stringify(result);
      } catch (error) {
        const reason = /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : "FC27_ACCEPTANCE_UNCONFIRMED";
        node("status").textContent = reason;
        host.dataset.result = JSON.stringify({ status: "blocked", reason });
      } finally {
        busy = false;
        host.dataset.busy = "false";
        update();
      }
    };
    const on = (id2, callback) => node(id2).addEventListener("click", (event) => {
      if (event.isTrusted && !busy) callback();
    });
    on("refresh", () => {
      plan = null;
      recovery = null;
      renderTargets();
      update();
    });
    on("gm", () => {
      void run(() => checkInstallation(false));
    });
    on("hold", () => {
      void run(() => checkInstallation(true));
    });
    on("prepare", () => {
      plan = null;
      recovery = null;
      void run(() => prepare2({ setId: Number(node("target").value), maxRating: Number(node("rating").value) }));
    });
    on("recovery", () => {
      plan = null;
      recovery = null;
      void run(inspectRecovery);
    });
    const dialog = shadow.querySelector("dialog");
    on("execute", () => {
      if (plan?.liveEnabled !== true) return;
      action = "execute";
      node("approval").textContent = `${plan.setName}: submit ${plan.selectedCount} players, max OVR ${plan.maxRating}, once.`;
      dialog.showModal();
    });
    on("resolve", () => {
      if (!recovery) return;
      action = "resolve";
      node("approval").textContent = `Record ${recovery.outcome} for SBC ${recovery.setId}. No save or submit request.`;
      dialog.showModal();
    });
    on("cancel", () => {
      action = null;
      dialog.close();
    });
    on("confirm", () => {
      dialog.close();
      if (action === "execute" && plan) {
        const current2 = plan;
        plan = null;
        void run(() => execute({
          approved: true,
          count: 1,
          setId: current2.setId,
          challengeId: current2.challengeId,
          maxRating: current2.maxRating,
          maxPlayers: current2.selectedCount
        }));
      } else if (action === "resolve" && recovery) {
        recovery = null;
        void run(() => resolveRecovery(true));
      }
      action = null;
    });
    for (const id2 of ["target", "rating"]) node(id2).addEventListener("change", () => {
      plan = null;
      recovery = null;
      update();
    });
    document.body.append(host);
    renderTargets();
    update();
  }

  // src/fc27/production-entry.js
  var dependencies = {
    root: unsafeWindow,
    gmGetValue: GM_getValue,
    gmSetValue: GM_setValue,
    lockManager: unsafeWindow.navigator.locks,
    liveEnabled: false
  };
  var session;
  var current = () => session ??= createFc27AcceptanceSession(dependencies);
  mountFc27AcceptancePanel({
    document: unsafeWindow.document,
    hostId: "fcat-fc27-production",
    title: `FC Automation Tool ${"27.0.0"}`,
    version: "27.0.0",
    targets: () => readFc27RunnerPanel(unsafeWindow).targets,
    prepare: (options) => current().prepare(options),
    execute: (approval) => current().execute(approval),
    inspectRecovery: () => current().inspectRecovery(),
    resolveRecovery: (approved) => current().resolveRecovery(approved),
    checkInstallation: (hold) => checkFc27GmInstallation({ ...dependencies, hold })
  });
})();
