// ==UserScript==
// @name         FC Automation Tool
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool
// @version      27.0.2
// @description  FC27 traditional SBC preparation, confirmed single submission and recovery.
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
// @grant        GM_xmlhttpRequest
// @connect      www.futbin.org
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
  function callBoolean(item, method5) {
    try {
      const value = item?.[method5]?.();
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
  function numbers(value, limit, min, max) {
    if (!Array.isArray(value) || value.length > limit) return null;
    const result = Array.from({ length: value.length }, (_, index) => integer(ownData(value, String(index)), min, max));
    return result.includes(null) || new Set(result).size !== result.length ? null : Object.freeze(result);
  }
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
    const id4 = get("id");
    const definitionId = get("definitionId");
    if (!identity2(id4) || !identity2(definitionId)) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
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
      id: id4,
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
      // Observed FC27 data properties. No getters or upgrade-position fallback.
      nationId: integer(get("nationId"), 1, 1e9),
      teamId: integer(get("teamId"), 1, 1e9),
      positions: noUpgrades ? numbers(get("basePossiblePositions"), 28, 0, 27) : null,
      groups: noUpgrades ? numbers(get("groups"), 128, 0, 1e9) : null,
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

  // src/adapters/ea/fc27-challenge-catalog.js
  var reviewedHash = "238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693";
  var id = (value) => Number.isSafeInteger(value) && value > 0 && value < 1e9;
  var text = (value) => typeof value === "string" && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : null;
  var number = (value) => Number.isSafeInteger(value) && value >= 0 && value < 1e9 ? value : null;
  var fail = (reason) => {
    throw new Error(reason);
  };
  var stop = (reason, extra = {}) => ({ status: "blocked", reason, liveExecutionEnabled: false, ...extra });
  function values(input, limit) {
    const raw = ownData(input, "_collection") ?? input;
    if (!raw || typeof raw !== "object") return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    const keys2 = Object.getOwnPropertyNames(raw).filter((key) => key !== "length");
    if (keys2.length > limit) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    return keys2.map((key) => ownData(raw, key));
  }
  function method(object, key) {
    for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return descriptor.value;
    }
    return void 0;
  }
  function projectRewards(awards) {
    return values(awards, 6).map((reward) => ({
      type: text(ownData(reward, "type")),
      value: number(ownData(reward, "value")),
      count: number(ownData(reward, "count")),
      tradable: typeof ownData(reward, "tradable") === "boolean" ? ownData(reward, "tradable") : null
    }));
  }
  function cachedSetRewards(set) {
    let rewards2 = null;
    try {
      rewards2 = projectRewards(ownData(set, "awards"));
    } catch {
    }
    return { source: "cached-set", fresh: false, rewards: rewards2 };
  }
  function projectFc27CatalogChallenge(challenge, setId) {
    const challengeId = ownData(challenge, "id");
    if (!id(challengeId) || ownData(challenge, "setId") !== setId) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
    const requirements = values(ownData(challenge, "eligibilityRequirements"), 16).map((rule) => {
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
  async function inspectFc27ChallengeCatalog(root, { setId } = {}) {
    try {
      if (!id(setId)) return stop("FC27_CATALOG_SET_UNVERIFIED");
      const context = JSON.stringify(readFc27Context(root));
      const service = ownData(ownData(root, "services"), "SBC");
      const findSet = () => values(ownData(ownData(service, "repository"), "sets"), 500).filter((set) => ownData(set, "id") === setId);
      const sets2 = findSet();
      if (sets2.length !== 1) return stop("FC27_CATALOG_SET_UNVERIFIED");
      const setRewards = cachedSetRewards(sets2[0]);
      const dao = ownData(service, "sbcDAO");
      const read = method(dao, "getChallengesForSet");
      if (typeof read !== "function" || !root.crypto?.subtle) return stop("FC27_CATALOG_DAO_UNREVIEWED");
      const source = Function.prototype.toString.call(read);
      if (source.length > 4096) return stop("FC27_CATALOG_DAO_UNREVIEWED");
      const hash = Array.from(
        new Uint8Array(await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source))),
        (value) => value.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== reviewedHash) return stop("FC27_CATALOG_DAO_UNREVIEWED");
      const unchanged = () => {
        try {
          const current2 = findSet();
          return JSON.stringify(readFc27Context(root)) === context && ownData(ownData(root, "services"), "SBC") === service && ownData(service, "sbcDAO") === dao && method(dao, "getChallengesForSet") === read && current2.length === 1 && current2[0] === sets2[0] && JSON.stringify(cachedSetRewards(current2[0])) === JSON.stringify(setRewards);
        } catch {
          return false;
        }
      };
      if (!unchanged()) return stop("FC27_CATALOG_CONTEXT_CHANGED");
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
        const timer = setTimeout(() => finish(stop("FC27_CATALOG_READ_TIMEOUT")), 15e3);
        try {
          observable = read.call(dao, setId);
          observable.observe(owner, (_sender, reply) => {
            if (finished) return;
            if (!unchanged()) return finish(stop("FC27_CATALOG_CONTEXT_CHANGED"));
            const httpStatus = number(ownData(reply, "status"));
            if (ownData(reply, "success") !== true || httpStatus !== 200) {
              return finish(stop("FC27_CATALOG_READ_UNCONFIRMED", { httpStatus }));
            }
            try {
              const challenges = values(ownData(ownData(reply, "response"), "challenges"), 50).map((challenge) => projectFc27CatalogChallenge(challenge, setId));
              if (new Set(challenges.map((challenge) => challenge.id)).size !== challenges.length) return fail("FC27_CATALOG_SHAPE_UNVERIFIED");
              finish({
                status: "observed",
                reason: "FC27_CHALLENGE_CATALOG_READ",
                liveExecutionEnabled: false,
                setId,
                setName: text(ownData(sets2[0], "name")),
                setRewards,
                challengeRewardsSource: "catalog-response",
                rewardIdentityVerified: false,
                challenges
              });
            } catch {
              finish(stop("FC27_CATALOG_SHAPE_UNVERIFIED"));
            }
          });
        } catch {
          finish(stop("FC27_CATALOG_READ_UNCONFIRMED"));
        }
      });
    } catch (error2) {
      return stop(/^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_CATALOG_UNAVAILABLE");
    }
  }

  // src/adapters/ea/fc27-sbc-read.js
  async function inspectInProgressSquad({ setId, challengeId, includeFormation = false } = {}, root = globalThis, observedChallenge = null) {
    const stop6 = (reason) => ({ status: "blocked", reason, liveExecutionEnabled: false });
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
    function values6(value, limit) {
      for (let i = 0; i < 3 && data(value, "_collection") !== void 0; i++) value = data(value, "_collection");
      if (!value || typeof value !== "object") return [];
      const keys2 = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
      if (keys2.length > limit) return [];
      return keys2.map((key) => data(value, key));
    }
    function formationSnapshot(squad) {
      const formation = data(squad, "_formation");
      const id4 = data(formation, "id");
      const raw = data(formation, "positions");
      let positions2 = null;
      if (Array.isArray(raw) && data(raw, "length") === 11) {
        const copied = Array.from({ length: 11 }, (_, index) => data(data(raw, String(index)), "typeId"));
        if (copied.every((value) => Number.isInteger(value) && value >= 0 && value <= 27)) positions2 = copied;
      }
      return { id: Number.isSafeInteger(id4) && id4 >= 0 && id4 < 1e9 ? id4 : null, positions: positions2 };
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
      const sets2 = values6(data(data(service, "repository"), "sets"), 500).filter((set) => data(set, "id") === setId);
      if (sets2.length !== 1) return null;
      const currentChallenges = values6(data(sets2[0], "challenges"), 50).filter((challenge2) => data(challenge2, "id") === challengeId);
      const currentChallenge = currentChallenges[0];
      const challenges = observedChallenge ? [observedChallenge] : currentChallenges;
      const challenge = challenges[0];
      if (currentChallenges.length > 1 || currentChallenges.length === 1 && (data(currentChallenge, "setId") !== setId || data(currentChallenge, "status") !== "IN_PROGRESS") || currentChallenges.length === 0 && !observedChallenge || challenges.length !== 1 || data(challenge, "setId") !== setId || data(challenge, "status") !== "IN_PROGRESS" || data(data(root, "SBCChallengeStatus"), "IN_PROGRESS") !== "IN_PROGRESS") return null;
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
    if (![setId, challengeId].every((id4) => Number.isSafeInteger(id4) && id4 > 0 && id4 < 1e9)) return stop6("INVALID_CHALLENGE_IDENTITY");
    try {
      const initial = find();
      if (!initial) return stop6("IN_PROGRESS_CHALLENGE_UNCONFIRMED");
      const load = data(initial.dao, "loadChallenge");
      if (typeof load !== "function" || !root.crypto?.subtle) return stop6("DAO_IMPLEMENTATION_UNREVIEWED");
      const source = Function.prototype.toString.call(load);
      if (source.length > 4096) return stop6("DAO_IMPLEMENTATION_UNREVIEWED");
      const hash = Array.from(
        new Uint8Array(await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source))),
        (value) => value.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== "04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e") return stop6("DAO_IMPLEMENTATION_UNREVIEWED");
      const unchanged = () => {
        const current2 = find();
        return current2?.service === initial.service && current2?.dao === initial.dao && current2?.challenge === initial.challenge && data(initial.dao, "loadChallenge") === load && current2?.scope === initial.scope && current2?.user === initial.user && current2?.persona === initial.persona && current2?.club === initial.club;
      };
      if (!unchanged()) return stop6("CHALLENGE_CHANGED");
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
        const timer = setTimeout(() => finish(stop6("SQUAD_READ_TIMEOUT")), 15e3);
        try {
          observable = load.call(initial.dao, challengeId, true);
          observable.observe(owner, (_sender, response) => {
            if (finished) return;
            try {
              if (!unchanged()) return finish(stop6("CHALLENGE_CHANGED"));
              if (data(response, "success") !== true || data(response, "status") !== 200) return finish(stop6("SQUAD_READ_UNCONFIRMED"));
              const squad = data(data(response, "response"), "squad");
              const slots = data(data(root, "UTSquadEntity"), "FIELD_PLAYERS");
              const simple = data(squad, "simpleBrickIndices");
              const custom = data(squad, "customBrickIndices");
              if (slots !== 11 || !Array.isArray(simple) || !Array.isArray(custom) || simple.length > 11 || custom.length > 11) return finish(stop6("SLOT_LAYOUT_UNVERIFIED"));
              const bricks = [...simple, ...custom];
              if (bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= slots) || new Set(bricks).size !== bricks.length || bricks.length >= slots) return finish(stop6("SLOT_LAYOUT_UNVERIFIED"));
              finish({
                status: "observed",
                reason: "IN_PROGRESS_SQUAD_READ",
                liveExecutionEnabled: false,
                setId,
                challengeId,
                slotCount: slots,
                simpleBrickIndices: [...simple],
                customBrickIndices: [...custom],
                requiredPlayerCount: slots - bricks.length,
                ...includeFormation === true ? { formation: formationSnapshot(squad) } : {}
              });
            } catch {
              finish(stop6("SQUAD_READ_UNCONFIRMED"));
            }
          });
        } catch {
          finish(stop6("SQUAD_READ_UNCONFIRMED"));
        }
      });
    } catch {
      return stop6("SQUAD_INSPECTION_UNAVAILABLE");
    }
  }

  // src/adapters/ea/fc27-traditional-read.js
  function values2(collection, limit) {
    const raw = ownData(collection, "_collection") ?? collection;
    if (!raw || typeof raw !== "object") throw new Error("FC27_CHALLENGE_COLLECTION_UNAVAILABLE");
    const keys2 = Object.keys(raw);
    if (keys2.length > limit) throw new Error("FC27_CHALLENGE_COLLECTION_LIMIT");
    return keys2.map((key) => ownData(raw, key));
  }
  function sets(root) {
    const repository = ownData(ownData(ownData(root, "services"), "SBC"), "repository");
    return values2(ownData(repository, "sets"), 500);
  }
  function listFc27InProgressChallenges(root) {
    readFc27Context(root);
    const targets = [];
    for (const set of sets(root)) {
      const collection = ownData(set, "challenges");
      if (!collection) continue;
      for (const challenge of values2(collection, 50)) {
        const id4 = ownData(challenge, "id");
        const setId = ownData(set, "id");
        if (ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "setId") !== setId || !Number.isSafeInteger(id4) || id4 <= 0 || !Number.isSafeInteger(setId) || setId <= 0) continue;
        const name = ownData(challenge, "name");
        targets.push({ id: id4, setId, name: typeof name === "string" && name.length <= 160 ? name : `Challenge ${id4}` });
      }
    }
    return targets;
  }
  function normalizeFc27TraditionalChallenge({ context, setId, challenge, layout, keys: keys2, scopes, qualities }) {
    const id4 = ownData(challenge, "id");
    if (ownData(challenge, "setId") !== setId || ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "eligibilityOperation") !== "AND" || layout.status !== "observed" || layout.setId !== setId || layout.challengeId !== id4 || layout.slotCount !== 11 || ownData(keys2, "PLAYER_MIN_OVR") !== 26 || ownData(keys2, "PLAYER_MAX_OVR") !== 28 || ownData(scopes, "GREATER") !== 0 || ownData(scopes, "EXACT") !== 2) {
      throw new Error("FC27_CHALLENGE_UNVERIFIED");
    }
    const count2 = layout.requiredPlayerCount;
    const raw = values2(ownData(challenge, "eligibilityRequirements"), 16);
    if (!raw.length || !Number.isInteger(count2) || count2 < 1 || count2 > 11) throw new Error("FC27_REQUIREMENTS_UNVERIFIED");
    const requirements = [{ kind: "player-count", count: count2 }];
    for (const rule of raw) {
      const pairs = ownData(ownData(rule, "kvPairs"), "_collection");
      const codes = pairs && Object.keys(pairs);
      if (codes?.length === 1 && codes[0] === "3") {
        const quality2 = ownData(pairs, "3");
        const scope2 = ownData(rule, "scope");
        if (ownData(keys2, "PLAYER_QUALITY") !== 3 || ownData(rule, "count") !== -1 || ownData(qualities, "BRONZE") !== 1 || ownData(qualities, "SILVER") !== 2 || ownData(qualities, "GOLD") !== 3 || !Array.isArray(quality2) || quality2.length !== 1 || ![1, 2, 3].includes(quality2[0]) || !(scope2 === 2 || scope2 === 0 && quality2[0] === 3)) {
          throw new Error("FC27_REQUIREMENT_UNSUPPORTED");
        }
        const [min, max] = [[1, 64], [65, 74], [75, 99]][quality2[0] - 1];
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
      id: id4,
      slotCount: layout.slotCount,
      brickIndices: [...layout.simpleBrickIndices, ...layout.customBrickIndices],
      requirements
    };
  }

  // src/fc27/traditional-preview.js
  var integer2 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  var identity3 = (value) => integer2(value, 1, Number.MAX_SAFE_INTEGER);
  var stop2 = (reason) => ({ status: "blocked", reason, liveExecutionEnabled: false, selected: [] });
  function collectSafeTraditionalCandidates({ context, challenge, inventory, policy } = {}) {
    let scope2;
    try {
      scope2 = createSeasonContext(context);
    } catch {
      return stop2("CONTEXT_UNAVAILABLE");
    }
    if (scope2.season !== "27") return stop2("UNSUPPORTED_SEASON");
    for (const input of [challenge, inventory, policy]) {
      let other;
      try {
        other = createSeasonContext(input?.context);
      } catch {
        return stop2("CONTEXT_UNAVAILABLE");
      }
      if (["season", "accountScope", "platform"].some((key) => other[key] !== scope2[key])) return stop2("CONTEXT_MISMATCH");
    }
    if (challenge.schema !== 1 || challenge.mechanism !== "traditional" || challenge.requirementsOperation !== "AND" || !identity3(challenge.setId) || !identity3(challenge.id) || challenge.completed !== false) {
      return stop2("CHALLENGE_UNVERIFIED");
    }
    if (!Array.isArray(challenge.requirements) || !challenge.requirements.length || challenge.requirements.length > 16) {
      return stop2("REQUIREMENTS_UNAVAILABLE");
    }
    const countRules = challenge.requirements.filter((rule) => rule?.kind === "player-count");
    const required2 = countRules[0]?.count;
    if (countRules.length !== 1 || !integer2(required2, 1, 11)) return stop2("PLAYER_COUNT_UNVERIFIED");
    let minRating = 1;
    let maxRating = 99;
    for (const rule of challenge.requirements) {
      if (!rule || !["player-count", "player-min-overall", "player-max-overall"].includes(rule.kind) || rule.count !== required2 || Object.keys(rule).some((key) => !["kind", "count", "value"].includes(key))) {
        return stop2("UNSUPPORTED_REQUIREMENT");
      }
      if (rule.kind === "player-count") {
        if (rule.value !== void 0) return stop2("UNSUPPORTED_REQUIREMENT");
      } else {
        if (!integer2(rule.value, 1, 99)) return stop2("UNSUPPORTED_REQUIREMENT");
        if (rule.kind === "player-min-overall") minRating = Math.max(minRating, rule.value);
        else maxRating = Math.min(maxRating, rule.value);
      }
    }
    if (minRating > maxRating) return stop2("CONTRADICTORY_REQUIREMENTS");
    const { slotCount, brickIndices } = challenge;
    if (!integer2(slotCount, 1, 11) || !Array.isArray(brickIndices) || brickIndices.some((index) => !integer2(index, 0, slotCount - 1)) || new Set(brickIndices).size !== brickIndices.length || slotCount - brickIndices.length !== required2) {
      return stop2("SLOT_LAYOUT_UNVERIFIED");
    }
    if (policy.schema !== 1 || policy.reviewed !== true || !integer2(policy.maxRating, 1, 99) || ["onlyUntradeable", "protectFsuLockedPlayers", "protectActiveSquad", "storageFirst"].some((key) => typeof policy[key] !== "boolean") || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2 || policy.goldRange.some((value) => !integer2(value, 75, 99)) || policy.goldRange[0] > policy.goldRange[1] || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200 || policy.excludedLeagueIds.some((id4) => !identity3(id4))) return stop2("PROTECTION_POLICY_UNVERIFIED");
    if (inventory.schema !== 1 || inventory.kind !== "normalized-inventory" || !["ready", "provisional"].includes(inventory.status) || !Array.isArray(inventory.items) || inventory.items.length > 2e4) return stop2("INVENTORY_UNVERIFIED");
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    let excluded = 0;
    const excludedByReason = {};
    for (const item of inventory.items) {
      if (!item || !identity3(item.id) || !identity3(item.definitionId) || seen.has(item.id)) return stop2("INVENTORY_IDENTITY_CONFLICT");
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
    return { status: "candidates", candidates, required: required2, minRating, maxRating, excluded, excludedByReason };
  }
  function previewTraditionalSquad(input = {}) {
    const pool = collectSafeTraditionalCandidates(input);
    if (pool.status !== "candidates") return pool;
    const { candidates, required: required2, minRating, maxRating, excluded, excludedByReason } = pool;
    const { challenge, inventory } = input;
    const { slotCount, brickIndices } = challenge;
    const definitions = /* @__PURE__ */ new Set();
    const selected = [];
    for (const item of candidates) {
      if (definitions.has(item.definitionId)) continue;
      definitions.add(item.definitionId);
      selected.push({ id: item.id, definitionId: item.definitionId, pile: item.pile, rating: item.rating });
      if (selected.length === required2) break;
    }
    if (selected.length !== required2) return {
      ...stop2("SAFE_MATERIAL_SHORTAGE"),
      required: required2,
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
      required: required2,
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
    return readFc27PuzzlePolicy(root, maxRating);
  }
  function readFc27PuzzlePolicy(root, maxRating = 82) {
    if (!Number.isSafeInteger(maxRating) || maxRating < 1 || maxRating > 99) throw new Error("FC27_PUZZLE_POLICY_INVALID");
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
  function readFc27ChallengeTargets(root) {
    try {
      readFc27Context(root);
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
      return targets;
    } catch {
      return [];
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
      if (flags.some((value) => typeof value !== "boolean") || !Number.isInteger(goldenMax) || goldenMax < 75 || goldenMax > 99 || !leagues || leagues.some((id4) => !Number.isSafeInteger(id4) || id4 < 1)) throw new Error("FC27_FSU_POLICY_UNVERIFIED");
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
    } catch (error2) {
      return { ...report, reason: /^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_RUNNER_INSPECTION_UNAVAILABLE" };
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
  function method2(object, key) {
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
  function rewards(input, scope2) {
    return values3(input, 6).map((reward) => {
      const result = Object.fromEntries(["type", "value", "count", "tradable"].map((key) => [key, ownData(reward, key)]));
      if (result.type !== "pack" || !integer3(result.value) || result.value <= 0 || !integer3(result.count) || result.count < 1 || result.count > 10 || typeof result.tradable !== "boolean") {
        return fail2("FC27_CONTRACT_REWARD_UNSUPPORTED");
      }
      return { scope: scope2, ...result };
    });
  }
  async function readFc27SbcContract(root, { setId } = {}) {
    try {
      if (!integer3(setId) || setId <= 0 || setId >= 1e9) return fail2("FC27_CONTRACT_TARGET_UNVERIFIED");
      const context = readFc27Context(root);
      const service = ownData(ownData(root, "services"), "SBC");
      const dao = ownData(service, "sbcDAO");
      const functions = Object.fromEntries(Object.keys(hashes).map((key) => [key, method2(dao, key)]));
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
          if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context) || ownData(ownData(root, "services"), "SBC") !== service || ownData(service, "sbcDAO") !== dao || Object.keys(functions).some((key) => method2(dao, key) !== functions[key])) return fail2("FC27_CONTRACT_CONTEXT_CHANGED");
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
          const finish = (error2, response) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try {
              observable?.unobserve(owner);
            } catch {
            }
            if (error2) reject(error2);
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
              } catch (error2) {
                finish(error2);
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
    } catch (error2) {
      return {
        status: "blocked",
        liveExecutionEnabled: false,
        reason: /^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_CONTRACT_UNAVAILABLE"
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
          const finish = (error2, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              req.unobserve(observer);
            } catch {
            }
            if (error2) reject(error2);
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
      } catch (error2) {
        stopped = true;
        throw error2;
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
        if (!Number.isInteger(start) || start < 0 || start > 2e4 || !Number.isInteger(count2) || count2 < 1 || count2 > 250 || !Array.isArray(definitionIds) || definitionIds.length > 50 || definitionIds.some((id4) => !validId(id4)) || new Set(definitionIds).size !== definitionIds.length) throw new Error("FC27_CLUB_QUERY_INVALID");
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
    async function request(action, target = {}, beforeDispatch = null) {
      if (busy || stopped) return fail3("FC27_TRANSACTION_TRANSPORT_BLOCKED");
      const id4 = target.challengeId;
      const mutation = action === "save" || action === "save-concept" || action === "save-purchase" || action === "submit";
      if (!["unassigned", "packs", "save", "save-concept", "save-purchase", "submit"].includes(action) || mutation && (!Number.isSafeInteger(id4) || id4 <= 0 || canWrite() !== true)) return fail3("FC27_LIVE_DISABLED");
      if (action === "save" || action === "save-concept" || action === "save-purchase") {
        const declaredBricks = target.simpleBrickIndices === void 0 ? [] : target.simpleBrickIndices;
        const empty = action === "save-purchase" ? target.emptySlotIndices : [];
        if (!Array.isArray(declaredBricks) || !Array.isArray(empty) || new Set(declaredBricks).size !== declaredBricks.length || declaredBricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11) || new Set(empty).size !== empty.length || empty.some((index) => !Number.isInteger(index) || index < 0 || index >= 11)) return fail3("FC27_SAVE_INPUT_UNVERIFIED");
        const bricks = action === "save-purchase" ? [.../* @__PURE__ */ new Set([...declaredBricks, ...empty])] : declaredBricks;
        const concepts = action === "save-concept" || action === "save-purchase" ? target.conceptSlots : [];
        if (!Array.isArray(concepts) || action === "save-concept" && !concepts.length || concepts.some((ref) => !Number.isInteger(ref?.slot) || ref.slot < 0 || ref.slot >= 11 || !Number.isSafeInteger(ref.definitionId) || ref.definitionId <= 0) || new Set(concepts.map((ref) => ref.slot)).size !== concepts.length || new Set(concepts.map((ref) => ref.definitionId)).size !== concepts.length) return fail3("FC27_SAVE_INPUT_UNVERIFIED");
        if (!Array.isArray(bricks) || bricks.length >= 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11) || !Array.isArray(target.players) || target.players.length < 11 || target.players.length > 32 || new Set(target.players.slice(0, 11).filter((_, index) => !bricks.includes(index)).map((player) => `${player?.itemData?.dream}:${player?.itemData?.id}`)).size !== 11 - bricks.length || target.players.some((player, index) => player?.index !== index || !Number.isSafeInteger(player?.itemData?.id) || (index < 11 && !bricks.includes(index) ? player.itemData.id < 1 : ![0, -1].includes(player.itemData.id)) || player.itemData.dream !== concepts.some((ref) => ref.slot === index) || concepts.some((ref) => ref.slot === index && (bricks.includes(index) || player.itemData.id !== ref.definitionId))) || concepts.some((ref) => !target.players[ref.slot]?.itemData?.dream)) return fail3("FC27_SAVE_INPUT_UNVERIFIED");
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
        const endpoint = `/ut/game/${game}/${action === "unassigned" ? "purchased/items" : action === "packs" ? "store/purchaseGroup/all" : `sbs/challenge/${id4}${["save", "save-concept", "save-purchase"].includes(action) ? "/squad" : ""}`}`;
        req.setPath(endpoint);
        const url = new URL(ownData(req, "url"));
        if (url.protocol !== "https:" || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) return fail3("FC27_TRANSACTION_ENDPOINT_UNVERIFIED");
        if (["save", "save-concept", "save-purchase"].includes(action)) req.setRequestBody({ players: target.players.map((player) => ({
          index: player.index,
          itemData: { id: player.itemData.id, dream: action !== "save" ? player.itemData.dream === true : false }
        })) });
        if (action === "submit") {
          url.searchParams.set("skipUserSquadValidation", "false");
          req.url = url.href;
        }
        if (beforeDispatch !== null) {
          if (!["save", "save-concept", "save-purchase"].includes(action) || typeof beforeDispatch !== "function") return fail3("FC27_SAVE_INPUT_UNVERIFIED");
          await beforeDispatch();
          assert();
        }
        last = Date.now();
        return await new Promise((resolve, reject) => {
          const owner = {};
          let done = false;
          const finish = (error2, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            active = null;
            try {
              req.unobserve(owner);
            } catch {
            }
            if (error2) reject(error2);
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

  // src/adapters/ea/fc27-puzzle-layout.js
  function projectFc27PuzzleLayout(root, squad, { setId, challengeId }) {
    const fail15 = () => {
      throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
    };
    const slots = ownData(squad, "_players");
    const simple = ownData(squad, "simpleBrickIndices");
    const custom = ownData(squad, "customBrickIndices");
    if (ownData(ownData(root, "UTSquadEntity"), "FIELD_PLAYERS") !== 11 || !Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !Array.isArray(simple) || !Array.isArray(custom)) return fail15();
    const bricks = [...simple, ...custom];
    if (bricks.length >= 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11)) return fail15();
    const ids = Array.from({ length: slots.length }, (_, index) => {
      const slot = ownData(slots, String(index));
      const id5 = ownData(ownData(slot, "_item"), "id");
      if (ownData(slot, "index") !== index || !Number.isSafeInteger(id5) || id5 < -1 || (index >= 11 || simple.includes(index)) && id5 > 0) return fail15();
      return id5;
    });
    const formation = ownData(squad, "_formation");
    const id4 = ownData(formation, "id");
    const raw = ownData(formation, "positions");
    if (!Number.isSafeInteger(id4) || id4 <= 0 || !Array.isArray(raw) || raw.length !== 11) return fail15();
    const positions2 = Array.from({ length: 11 }, (_, index) => ownData(ownData(raw, String(index)), "typeId"));
    if (positions2.some((value) => !Number.isInteger(value) || value < 0 || value > 27)) return fail15();
    return {
      status: "observed",
      setId,
      challengeId,
      slotCount: 11,
      simpleBrickIndices: [...simple],
      customBrickIndices: [...custom],
      requiredPlayerCount: 11 - bricks.length,
      formation: { id: id4, positions: positions2 },
      squadEmpty: ids.every((value) => value === 0 || value === -1)
    };
  }
  function assertFc27PuzzleLayout(plan, layout) {
    if (layout.setId !== plan.challenge.setId || layout.challengeId !== plan.challenge.id || layout.slotCount !== plan.challenge.slotCount || layout.customBrickIndices.length || JSON.stringify(layout.simpleBrickIndices) !== JSON.stringify(plan.challenge.brickIndices) || JSON.stringify(layout.formation) !== JSON.stringify(plan.challenge.formation)) {
      throw new Error("FC27_PUZZLE_FILL_LAYOUT_CHANGED");
    }
  }
  function projectFc27PuzzleSquadBaseline(root, squad, target) {
    projectFc27PuzzleLayout(root, squad, target);
    const slots = ownData(squad, "_players");
    return slots.map((slot, index) => {
      if (ownData(slot, "index") !== index) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      const item = ownData(slot, "_item");
      const id4 = ownData(item, "id");
      if (!Number.isSafeInteger(id4) || id4 < -1) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      if (id4 <= 0) return null;
      const definitionId = ownData(item, "definitionId");
      const concept = ownData(item, "concept");
      if (!Number.isSafeInteger(definitionId) || definitionId <= 0 || typeof concept !== "boolean" || concept && id4 !== definitionId) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      return { id: id4, definitionId, concept };
    });
  }

  // src/adapters/ea/fc27-puzzle-page.js
  var FC27_PUZZLE_SYNC_METHODS = Object.freeze([
    ["UTSquadEntity.prototype.update", "6d9e923d3ab48e5a8bcd3def4ac8505bb649ccc7c5e14725cfc42b11b08f161b"],
    ["EAObservable.prototype.notify", "1e483385deb8aa65cce0dfa60efb7344d85a8caa8dff9e443a1c6ae9bab8559c"]
  ]);
  function locate(root) {
    try {
      let controller = root.getAppMain().getRootViewController();
      for (let depth = 0; depth < 3; depth++) controller = ownData(controller, "currentController");
      if (typeof root.UTSBCSquadSplitViewController !== "function" || !(controller instanceof root.UTSBCSquadSplitViewController)) return null;
      const setId = ownData(ownData(controller, "_set"), "id");
      const challengeId = ownData(controller, "_challengeId");
      if (![setId, challengeId].every((value) => Number.isSafeInteger(value) && value > 0)) return null;
      const navigation = ownData(controller, "_challengeDetailsController");
      const detail = ownData(navigation, "currentController");
      if (typeof root.UTSBCSquadDetailPanelViewController !== "function" || !(detail instanceof root.UTSBCSquadDetailPanelViewController) || ownData(ownData(detail, "_set"), "id") !== setId || ownData(ownData(detail, "_challenge"), "id") !== challengeId || ownData(ownData(detail, "_challenge"), "setId") !== setId) return null;
      const anchor = detail?.getView?.()?._btnExchange?.getRootElement?.();
      if (!anchor?.isConnected || anchor.ownerDocument !== root.document) return null;
      return {
        setId,
        challengeId,
        anchor,
        challenge: ownData(detail, "_challenge"),
        purchaseAnchor: detail?.getView?.()?._challengeDetails?.getRootElement?.() ?? null
      };
    } catch {
      return null;
    }
  }
  function readFc27PuzzlePage(root) {
    const target = locate(root);
    return target ? {
      setId: target.setId,
      challengeId: target.challengeId,
      anchor: target.anchor,
      ...target.purchaseAnchor ? { purchaseAnchor: target.purchaseAnchor } : {}
    } : null;
  }
  function readFc27PurchasePage(root, target) {
    const page = locate(root);
    if (!page || page.setId !== target.setId || page.challengeId !== target.challengeId) return null;
    const squad = page.challenge.squad;
    const players = squad.getPlayers();
    return {
      squad,
      items: players.map((slot) => slot.item ?? slot._item),
      slots: players.map((slot, index) => {
        const item = slot.item ?? slot._item;
        return !item || [0, -1].includes(item.id) ? null : { slot: index, id: item.id, definitionId: item.definitionId, concept: item.concept };
      })
    };
  }
  function readFc27PurchasePageSlots(root, target, record = null) {
    const slots = readFc27PurchasePage(root, target)?.slots ?? null;
    return slots && record?.base?.kind !== "native-concept-purchase" && record?.base?.slots ? slots.slice(0, record.base.slots.length) : slots;
  }
  function readFc27PuzzlePageSlots(root, target) {
    const page = locate(root);
    if (!page || page.setId !== target.setId || page.challengeId !== target.challengeId) return null;
    const slots = ownData(ownData(page.challenge, "squad"), "_players");
    if (!Array.isArray(slots) || slots.length < 11) return null;
    return slots.slice(0, 11).map((slot, index) => {
      const item = ownData(slot, "_item");
      const id4 = ownData(item, "id");
      return [0, -1].includes(id4) ? null : { slot: index, id: id4, definitionId: ownData(item, "definitionId"), concept: ownData(item, "concept") };
    });
  }
  function readFc27PuzzlePageSnapshot(root, { setId, challengeId }) {
    try {
      const target = locate(root);
      if (!target || target.setId !== setId || target.challengeId !== challengeId) return null;
      return {
        challenge: projectFc27CatalogChallenge(target.challenge, setId),
        layout: projectFc27PuzzleLayout(root, ownData(target.challenge, "squad"), { setId, challengeId })
      };
    } catch {
      return null;
    }
  }
  function readFc27CurrentPuzzleChallenge(root, { setId, challengeId }) {
    const entity = currentChallengeEntity(root, { setId, challengeId });
    try {
      return entity ? projectFc27CatalogChallenge(entity, setId) : null;
    } catch {
      return null;
    }
  }
  function currentChallengeEntity(root, { setId, challengeId }) {
    const page = locate(root);
    if (page?.setId === setId && page.challengeId === challengeId) return page.challenge;
    try {
      const values6 = (value) => {
        const raw = ownData(value, "_collection") ?? value;
        if (!raw || typeof raw !== "object" || Object.getOwnPropertyNames(raw).length > 501) return [];
        return Object.getOwnPropertyNames(raw).filter((key) => key !== "length").map((key) => ownData(raw, key));
      };
      const service = ownData(ownData(root, "services"), "SBC");
      const sets2 = values6(ownData(ownData(service, "repository"), "sets")).filter((set) => ownData(set, "id") === setId);
      if (sets2.length !== 1) return null;
      const matches = values6(ownData(sets2[0], "challenges")).filter((challenge) => ownData(challenge, "id") === challengeId);
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
  }
  async function synchronizeFc27PuzzleSquad(root, target, savedSquad, refs3, assertContext = () => {
  }) {
    if (!Array.isArray(refs3) || refs3.some((ref) => ref?.kind === "concept" || ref?.concept === true)) throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    return synchronize(root, target, savedSquad, refs3, assertContext, false);
  }
  async function synchronizeFc27PuzzleConceptSquad(root, target, savedSquad, refs3, assertContext = () => {
  }) {
    if (!Array.isArray(refs3) || !refs3.some((ref) => ref.kind === "concept") || refs3.some((ref) => !["owned", "concept"].includes(ref.kind) || ref.kind === "concept" && (ref.id !== void 0 || ref.catalogRef !== `fc27:${ref.definitionId}`))) {
      throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    }
    return synchronize(root, target, savedSquad, refs3, assertContext, true);
  }
  function synchronizeFc27PurchasedPuzzleSquad(root, target, savedSquad, refs3, previousRefs, assertContext) {
    if (!Array.isArray(previousRefs) || previousRefs.length !== refs3.length || refs3.some((ref) => !previousRefs.some((old) => old.slot === ref.slot && old.definitionId === ref.definitionId && (old.kind === "concept" || ref.kind === "owned" && old.id === ref.id)))) {
      throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    }
    return synchronize(root, target, savedSquad, refs3, assertContext, refs3.some((ref) => ref.kind === "concept"), previousRefs);
  }
  async function synchronize(root, target, savedSquad, refs3, assertContext, concepts, previousRefs = null) {
    const fail15 = () => {
      throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    };
    const runtime = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS);
    assertContext();
    const challenge = currentChallengeEntity(root, target);
    if (!challenge || ownData(challenge, "status") !== "IN_PROGRESS") return fail15();
    const local = ownData(challenge, "squad");
    const layout = projectFc27PuzzleLayout(root, local, target);
    const savedLayout = projectFc27PuzzleLayout(root, savedSquad, target);
    if (JSON.stringify({ ...layout, squadEmpty: false }) !== JSON.stringify({ ...savedLayout, squadEmpty: false }) || layout.customBrickIndices.length || !Array.isArray(refs3) || (previousRefs === null ? refs3.length !== layout.requiredPlayerCount : refs3.length > layout.requiredPlayerCount) || new Set(refs3.map((ref) => ref.slot)).size !== refs3.length || new Set(refs3.map((ref) => ref.kind === "concept" ? `concept:${ref.definitionId}` : `owned:${ref.id}`)).size !== refs3.length || new Set(refs3.map((ref) => ref.definitionId)).size !== refs3.length) return fail15();
    const matches = (squad) => refs3.every((ref) => {
      const item = ownData(ownData(squad, "_players")?.[ref.slot], "_item");
      return ownData(item, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id) && ownData(item, "definitionId") === ref.definitionId && ownData(item, "concept") === (concepts && ref.kind === "concept");
    });
    const previousMatches = () => previousRefs !== null && previousRefs.every((ref) => {
      const item = ownData(ownData(local, "_players")?.[ref.slot], "_item");
      return ownData(item, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id) && ownData(item, "definitionId") === ref.definitionId && ownData(item, "concept") === (ref.kind === "concept");
    });
    if (!matches(savedSquad) || !layout.squadEmpty && !matches(local) && !previousMatches()) return fail15();
    if (local.update !== root.UTSquadEntity.prototype.update || challenge.onDataChange?.notify !== root.EAObservable.prototype.notify) return fail15();
    runtime();
    if (currentChallengeEntity(root, target) !== challenge) return fail15();
    local.update(savedSquad);
    if (!matches(local) && (layout.squadEmpty || previousMatches())) {
      const retained = ownData(ownData(ownData(root, "call"), "squad"), "setPlayers");
      const path = retained === void 0 ? "UTSquadEntity.prototype.setPlayers" : "call.squad.setPlayers";
      const checkPlayers = await verifyFc27Methods(root, [[path, "36369f3b5fec8c43f00f5078b5d5223b2d3fce1eaf9c47e9bd8355e6a3b53669"]]);
      assertContext();
      runtime();
      checkPlayers();
      if (currentChallengeEntity(root, target) !== challenge || ownData(challenge, "squad") !== local || !projectFc27PuzzleLayout(root, local, target).squadEmpty && !previousMatches() || !matches(savedSquad)) return fail15();
      const players = ownData(savedSquad, "_players").map((slot, index) => refs3.some((ref) => ref.slot === index) ? ownData(slot, "_item") : null);
      const setPlayers = retained ?? ownData(ownData(ownData(root, "UTSquadEntity"), "prototype"), "setPlayers");
      setPlayers.call(local, players);
    }
    if (ownData(challenge, "squad") !== local || !matches(local)) return fail15();
    challenge.onDataChange.notify({ squad: local });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertContext();
    if (!matches(local)) return fail15();
    return { status: "synchronized", selectedCount: refs3.length };
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
    let savedRead = null;
    const replacementBaselines = /* @__PURE__ */ new WeakMap();
    const assertReplacementBaseline = (plan, loaded, baseline) => {
      const binding = replacementBaselines.get(baseline);
      const target = { setId: plan.challenge.setId, challengeId: plan.challenge.id };
      if (!binding || !same(binding.target, target) || Date.now() - binding.observedAt < 0 || Date.now() - binding.observedAt > 15e3) return fail4("FC27_PUZZLE_SERVER_BASELINE_UNVERIFIED");
      assertFc27PuzzleLayout(plan, binding.layout);
      if (!same(projectFc27PuzzleSquadBaseline(root, loaded, target), binding.slots)) return fail4("FC27_PUZZLE_SERVER_SQUAD_CHANGED");
    };
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
    const reconcileCache = (refs3) => {
      assert();
      const repo = at4(root, "repositories.Item.club");
      const items = ownData(repo, "items");
      const collection = ownData(items, "_collection");
      if (!collection || items.remove !== at4(root, "UTItemRepository.prototype.remove") || repo.resetStatsCacheTimestamp !== at4(root, "UTClubRepository.prototype.resetStatsCacheTimestamp")) {
        return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
      }
      const cached = refs3.map((ref) => ({ ref, item: ownData(collection, String(ref.id)) }));
      if (cached.some(({ ref, item }) => item && (ownData(item, "id") !== ref.id || ownData(item, "definitionId") !== ref.definitionId))) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
      dirtyCache();
      for (const { ref, item } of cached) if (item) items.remove(ref.id);
      repo.resetStatsCacheTimestamp();
      if (refs3.some((ref) => ownData(collection, String(ref.id)) !== void 0)) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
    };
    const readDao = async (key, args) => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 800 - (Date.now() - lastRead))));
      assert();
      lastRead = Date.now();
      return new Promise((resolve, reject) => {
        let observable;
        let done = false;
        const owner = {};
        const finish = (error2, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            observable?.unobserve(owner);
          } catch {
          }
          if (error2) reject(error2);
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
            } catch (error2) {
              finish(error2);
            }
          });
        } catch {
          finish(new Error("FC27_PROVIDER_READ_UNCONFIRMED"));
        }
      });
    };
    const freshRefs = async (refs3) => {
      assert();
      if (!Array.isArray(refs3) || refs3.length < 1 || refs3.length > 11 || refs3.some((ref) => !identity4(ref.id) || !identity4(ref.definitionId) || ref.pile !== "club") || new Set(refs3.map((ref) => ref.id)).size !== refs3.length || new Set(refs3.map((ref) => ref.definitionId)).size !== refs3.length) return fail4("FC27_EXACT_ITEMS_CHANGED");
      const items = await club.readPage({ start: 0, count: 250, definitionIds: refs3.map((ref) => ref.definitionId) });
      assert();
      if (items.length >= 250 || new Set(items.map((item) => item.id)).size !== items.length || items.some((item) => !refs3.some((ref) => ref.definitionId === item.definitionId))) return fail4("FC27_EXACT_ITEMS_CHANGED");
      return items.filter((item) => refs3.some((ref) => ref.id === item.id && ref.definitionId === item.definitionId)).map(protectedItem);
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
      const awards = [["set", sets2[0]], ["challenge", challenges[0]]].flatMap(([scope2, entity]) => values4(ownData(entity, "awards"), 6).map((reward) => ({
        scope: scope2,
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
        present: present.map(({ id: id4, definitionId, pile }) => ({ id: id4, definitionId, pile })),
        setTimesCompleted: sets2[0].timesCompleted,
        packId: record.reward.value,
        packCount,
        unassignedClear
      };
    };
    return Object.freeze({
      capabilities: Object.freeze({ verified: true, submitWithoutSave: true, liveAcceptanceVerified: false }),
      async saveConceptDraft(plan, beforeWrite, beforeDispatch, { previousSlots = null, replaceBaseline = null } = {}) {
        assert();
        if (canWrite() !== true || plan?.kind !== "puzzle-concept-draft" || plan.status !== "prepared" || typeof beforeWrite !== "function" || typeof beforeDispatch !== "function" || !Array.isArray(plan.slots) || plan.slots.length !== 11) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const loaded = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const layout = projectFc27PuzzleLayout(root, loaded, { setId: plan.challenge.setId, challengeId: plan.challenge.id });
        assertFc27PuzzleLayout(plan, layout);
        if (replaceBaseline !== null) {
          if (previousSlots !== null) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
          assertReplacementBaseline(plan, loaded, replaceBaseline);
        } else if (previousSlots !== null) {
          if (!Array.isArray(previousSlots) || previousSlots.length !== 11 || previousSlots.some((ref, index) => {
            const item = ownData(ownData(loaded, "_players")?.[index], "_item");
            return ref ? ownData(item, "id") !== (ref.kind === "concept" ? ref.definitionId : ref.id) || ownData(item, "definitionId") !== ref.definitionId || ownData(item, "concept") !== (ref.kind === "concept") : ![0, -1].includes(ownData(item, "id"));
          })) return fail4("FC27_BUY_SQUAD_CHANGED");
        } else if (!layout.squadEmpty) return fail4("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
        const refs3 = plan.slots.filter(Boolean);
        if (refs3.length !== layout.requiredPlayerCount || new Set(refs3.map((ref) => ref.definitionId)).size !== refs3.length || refs3.some((ref) => !identity4(ref.definitionId) || !["owned", "concept"].includes(ref.kind) || plan.slots[ref.slot] !== ref || plan.challenge.brickIndices.includes(ref.slot) || ref.kind === "owned" && (!identity4(ref.id) || ref.pile !== "club") || ref.kind === "concept" && (ref.id !== void 0 || ref.catalogRef !== `fc27:${ref.definitionId}`))) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const players = ownData(loaded, "_players").map((slot, index) => {
          const ref = plan.slots[index];
          return { index, itemData: {
            id: ref ? ref.kind === "concept" ? ref.definitionId : ref.id : ownData(ownData(slot, "_item"), "id"),
            dream: ref?.kind === "concept"
          } };
        });
        if (beforeWrite() !== true) return fail4("FC27_CONCEPT_INPUTS_CHANGED");
        const reply = await transport.request(refs3.some((ref) => ref.kind === "concept") ? "save-concept" : "save", {
          challengeId: plan.challenge.id,
          players,
          simpleBrickIndices: plan.challenge.brickIndices,
          conceptSlots: refs3.filter((ref) => ref.kind === "concept").map(({ slot, definitionId }) => ({ slot, definitionId }))
        }, beforeDispatch);
        assert();
        return {
          setId: plan.challenge.setId,
          challengeId: plan.challenge.id,
          status: ownData(reply, "success") === true && ownData(reply, "status") === 200 ? "confirmed" : "unknown"
        };
      },
      async readConceptDraft(plan) {
        savedRead = null;
        if (plan?.kind !== "puzzle-concept-draft") return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const squad = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const target = { setId: plan.challenge.setId, challengeId: plan.challenge.id };
        const layout = projectFc27PuzzleLayout(root, squad, target);
        assertFc27PuzzleLayout(plan, layout);
        const slots = ownData(squad, "_players");
        const owned = [];
        const concepts = [];
        const playable = (index) => index < 11 && !plan.challenge.brickIndices.includes(index);
        const occupied = slots.slice(0, 11).filter((slot, index) => playable(index) && Number(ownData(ownData(slot, "_item"), "id")) > 0).length;
        if (occupied === 0) return fail4("FC27_CONCEPT_SQUAD_CLEARED");
        if (occupied !== plan.slots.filter(Boolean).length) return fail4("FC27_CONCEPT_SQUAD_MANUAL_EDITED");
        const identityMatches = plan.slots.filter(Boolean).every((ref) => {
          const item = ownData(slots[ref.slot], "_item");
          return ownData(item, "definitionId") === ref.definitionId && ownData(item, "concept") === (ref.kind === "concept") && ownData(item, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id);
        });
        if (!identityMatches) return fail4("FC27_CONCEPT_SQUAD_MANUAL_EDITED");
        for (const ref of plan.slots.filter(Boolean)) {
          const item = ownData(slots[ref.slot], "_item");
          if (ref.kind === "owned") owned.push({ ...protectedItem(snapshotFc27ClubPlayer(item, root)), slot: ref.slot });
          else {
            const expected = plan.purchases.find((entry) => entry.definitionId === ref.definitionId);
            const snapshot = snapshotFc27ClubPlayer(item, root);
            for (const key of ["rating", "rarity", "nationId", "leagueId", "teamId", "positions", "groups", "special", "evolution", "cosmetic"]) {
              if (!same(snapshot[key], expected?.[key])) return fail4("FC27_CONCEPT_READBACK_UNVERIFIED");
            }
            concepts.push({ slot: ref.slot, definitionId: ref.definitionId });
          }
        }
        savedRead = { target, squad, concepts: true, observedAt: Date.now() };
        return { ...target, context, fresh: true, observedAt: savedRead.observedAt, owned, concepts, layout };
      },
      async syncConceptDraft(plan, previousSlots = null) {
        const read = savedRead;
        savedRead = null;
        assert();
        if (!read?.concepts || read.target.setId !== plan.challenge.setId || read.target.challengeId !== plan.challenge.id || Date.now() - read.observedAt < 0 || Date.now() - read.observedAt > 15e3) return fail4("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
        if (previousSlots !== null) return synchronizeFc27PurchasedPuzzleSquad(
          root,
          read.target,
          read.squad,
          plan.slots.filter(Boolean),
          previousSlots.filter(Boolean),
          assert
        );
        return synchronizeFc27PuzzleConceptSquad(root, read.target, read.squad, plan.slots.filter(Boolean), assert);
      },
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
      async readPuzzleBaseline(plan) {
        if (!["puzzle-fill", "puzzle-concept-draft"].includes(plan?.kind)) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const loaded = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const target = { setId: plan.challenge.setId, challengeId: plan.challenge.id };
        const layout = projectFc27PuzzleLayout(root, loaded, target);
        assertFc27PuzzleLayout(plan, layout);
        const slots = projectFc27PuzzleSquadBaseline(root, loaded, target);
        const baseline = Object.freeze({ target: Object.freeze(target), slots: Object.freeze(slots.map((ref) => ref && Object.freeze(ref))) });
        replacementBaselines.set(baseline, { target, slots, layout, observedAt: Date.now() });
        return baseline;
      },
      async validateItems(plan) {
        const items = await freshRefs(plan.selected);
        return { context, fresh: true, observedAt: Date.now(), items };
      },
      assertCurrent() {
        assert();
        return true;
      },
      async readSquadState(plan) {
        const loaded = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const slots = ownData(loaded, "_players");
        if (plan.kind === "puzzle-fill") assertFc27PuzzleLayout(plan, projectFc27PuzzleLayout(
          root,
          loaded,
          { setId: plan.challenge.setId, challengeId: plan.challenge.id }
        ));
        if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !same(ownData(loaded, "simpleBrickIndices"), ["puzzle-fill", "puzzle-fill-recovery"].includes(plan.kind) ? plan.challenge.brickIndices : []) || !same(ownData(loaded, "customBrickIndices"), [])) {
          return fail4("FC27_SQUAD_STATE_UNVERIFIED");
        }
        const ids = slots.map((slot) => ownData(ownData(slot, "_item"), "id"));
        if (ids.some((id4, index) => !Number.isSafeInteger(id4) || ownData(slots[index], "index") !== index || (index >= 11 || plan.challenge.brickIndices.includes(index)) && ![0, -1].includes(id4))) return fail4("FC27_SQUAD_STATE_UNVERIFIED");
        return {
          context,
          fresh: true,
          observedAt: Date.now(),
          setId: plan.challenge.setId,
          challengeId: plan.challenge.id,
          squadEmpty: ids.every((id4) => id4 === 0 || id4 === -1),
          ...plan.kind === "puzzle-fill" ? { layout: projectFc27PuzzleLayout(
            root,
            loaded,
            { setId: plan.challenge.setId, challengeId: plan.challenge.id }
          ) } : {}
        };
      },
      async readRewardBaseline(plan) {
        return { context, fresh: true, packId: plan.rewards[0].value, count: await rewardCount(plan.rewards[0]) };
      },
      async save(plan, beforeWrite = null, beforeDispatch = null, { replaceBaseline = null } = {}) {
        assert();
        if (canWrite() !== true || plan.kind !== "puzzle-fill" && plan.challenge.brickIndices.length) return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        const loaded = ownData(await readDao("loadChallenge", [plan.challenge.id, true]), "squad");
        const slots = ownData(loaded, "_players");
        if (plan.kind === "puzzle-fill") assertFc27PuzzleLayout(plan, projectFc27PuzzleLayout(
          root,
          loaded,
          { setId: plan.challenge.setId, challengeId: plan.challenge.id }
        ));
        if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !same(ownData(loaded, "simpleBrickIndices"), plan.kind === "puzzle-fill" ? plan.challenge.brickIndices : []) || !same(ownData(loaded, "customBrickIndices"), [])) {
          return fail4("FC27_SAVE_INPUT_UNVERIFIED");
        }
        if (replaceBaseline !== null) {
          if (plan.kind !== "puzzle-fill") return fail4("FC27_SAVE_INPUT_UNVERIFIED");
          assertReplacementBaseline(plan, loaded, replaceBaseline);
        }
        const players = slots.map((slot, index) => {
          const selected = plan.selected.find((item) => item.slot === index);
          const emptyId = ownData(ownData(slot, "_item"), "id");
          const playable = index < 11 && !plan.challenge.brickIndices.includes(index);
          if (ownData(slot, "index") !== index || playable && !selected || !playable && (selected || ![0, -1].includes(emptyId))) {
            return fail4("FC27_SAVE_INPUT_UNVERIFIED");
          }
          if (plan.kind === "puzzle-fill" && replaceBaseline === null && ![0, -1].includes(emptyId)) return fail4("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
          return { index, itemData: { id: selected?.id ?? emptyId, dream: false } };
        });
        if (typeof beforeWrite === "function" && beforeWrite() !== true) return fail4("FC27_PUZZLE_FILL_INPUTS_CHANGED");
        const reply = await transport.request("save", {
          challengeId: plan.challenge.id,
          players,
          simpleBrickIndices: plan.kind === "puzzle-fill" ? plan.challenge.brickIndices : []
        }, beforeDispatch);
        assert();
        return { ...targetOf(plan), status: ownData(reply, "success") === true && ownData(reply, "status") === 200 ? "confirmed" : "unknown" };
      },
      async readSavedSquad(plan) {
        savedRead = null;
        const response = await readDao("loadChallenge", [plan.challenge.id, true]);
        const squad = ownData(response, "squad");
        const slots = ownData(squad, "_players");
        if (plan.kind === "puzzle-fill") assertFc27PuzzleLayout(plan, projectFc27PuzzleLayout(
          root,
          squad,
          { setId: plan.challenge.setId, challengeId: plan.challenge.id }
        ));
        if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !same(ownData(squad, "simpleBrickIndices"), ["puzzle-fill", "puzzle-fill-recovery"].includes(plan.kind) ? plan.challenge.brickIndices : []) || !same(ownData(squad, "customBrickIndices"), []) || !["puzzle-fill", "puzzle-fill-recovery"].includes(plan.kind) && plan.challenge.brickIndices.length) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
        const items = [];
        for (let index = 0; index < slots.length; index++) {
          if (ownData(slots[index], "index") !== index) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
          const item = ownData(slots[index], "_item");
          if (index < 11 && !plan.challenge.brickIndices.includes(index)) {
            if (plan.kind !== "puzzle-fill-recovery" || ![0, -1].includes(ownData(item, "id"))) {
              items.push({ ...protectedItem(snapshotFc27ClubPlayer(item, root)), slot: index });
            }
          } else if (![0, -1].includes(ownData(item, "id"))) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
        }
        savedRead = { target: targetOf(plan), squad, items, observedAt: Date.now() };
        return {
          context,
          fresh: true,
          observedAt: savedRead.observedAt,
          ...targetOf(plan),
          squadEmpty: items.length === 0,
          ready: items.length === 11 - plan.challenge.brickIndices.length,
          items,
          ...plan.kind === "puzzle-fill" ? { layout: projectFc27PuzzleLayout(
            root,
            squad,
            { setId: plan.challenge.setId, challengeId: plan.challenge.id }
          ) } : {}
        };
      },
      async syncSavedSquad(plan) {
        assert();
        const read = savedRead;
        savedRead = null;
        if (!["puzzle-fill", "puzzle-fill-recovery"].includes(plan.kind) || !read || !same(read.target, targetOf(plan)) || Date.now() - read.observedAt < 0 || Date.now() - read.observedAt > 15e3 || read.items.length !== plan.selected.length || !plan.selected.every((ref) => read.items.some((item) => item.id === ref.id && item.definitionId === ref.definitionId && item.slot === ref.slot && item.pile === ref.pile))) {
          return fail4("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
        }
        const result = await synchronizeFc27PuzzleSquad(root, read.target, read.squad, plan.selected, assert);
        assert();
        return result;
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
          consumed: evidence.present.length === 0 ? plan.selected.map(({ id: id4, definitionId, pile }) => ({ id: id4, definitionId, pile })) : [],
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
  function normalizeTraditionalJournal(scope2, input) {
    const schema = Object.getOwnPropertyDescriptor(input ?? {}, "schema")?.value;
    const value = fields(input, schema === 2 ? [...keys, "setTimesCompleted"] : keys);
    if (![1, 2].includes(value.schema) || value.schema === 2 && !nonnegative(value.setTimesCompleted) || typeof scope2 !== "string" || value.scope !== scope2 || typeof value.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.operationId) || !positive(value.setId) || !positive(value.challengeId) || !nonnegative(value.updatedAt) || typeof value.phase !== "string" || !Object.hasOwn(outcomes, value.phase) || outcomes[value.phase] !== value.submitted || !nonnegative(value.rewardBaselineCount) || !Array.isArray(value.itemRefs) || value.itemRefs.length < 1 || value.itemRefs.length > 11 || Reflect.ownKeys(value.itemRefs).length !== value.itemRefs.length + 1) return fail5("FC27_JOURNAL_RECORD_UNVERIFIED");
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
  function assessTraditionalRecovery(scope2, input, evidence, now = Date.now()) {
    const record = normalizeTraditionalJournal(scope2, input);
    if (isTerminalTraditionalJournal(record)) return "terminal";
    if (record.schema !== 2 || evidence?.fresh !== true || traditionalJournalScope(evidence.context) !== scope2 || !nonnegative(evidence.observedAt) || now < evidence.observedAt || now - evidence.observedAt > 15e3 || evidence.setId !== record.setId || evidence.challengeId !== record.challengeId || evidence.packId !== record.reward.value || evidence.unassignedClear !== true || !Array.isArray(evidence.present)) return "unresolved";
    const sorted = (values6) => [...values6].sort((a, b) => a.id - b.id);
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
    const guard = (scope2) => {
      if (scope2 !== expectedScope) return fail5("FC27_JOURNAL_SCOPE_UNVERIFIED");
      if (hasExclusiveAccess(scope2) !== true) return fail5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
    };
    async function read(scope2) {
      guard(scope2);
      let raw;
      try {
        raw = await gmGetValue(expectedScope, null);
      } catch {
        return fail5("FC27_JOURNAL_READ_UNCONFIRMED");
      }
      guard(scope2);
      if (raw === null) return null;
      try {
        return normalizeTraditionalJournal(expectedScope, raw);
      } catch {
        return fail5("FC27_RECOVERY_REQUIRED");
      }
    }
    async function write(scope2, value) {
      guard(scope2);
      const next = normalizeTraditionalJournal(expectedScope, value);
      const previous = await read(scope2);
      if (!canAdvance(previous, next)) return fail5("FC27_JOURNAL_TRANSITION_UNVERIFIED");
      guard(scope2);
      try {
        await gmSetValue(expectedScope, globalThis.structuredClone(next));
        if (!same2(await read(scope2), next)) return fail5("FC27_JOURNAL_UNCONFIRMED");
      } catch {
        return fail5("FC27_JOURNAL_UNCONFIRMED");
      }
    }
    async function resolve(scope2, expected, evidence, approval) {
      guard(scope2);
      const previous = await read(scope2);
      if (!same2(previous, expected) || approval?.approved !== true || approval.operationId !== previous?.operationId) {
        return fail5("FC27_RECOVERY_APPROVAL_INVALID");
      }
      const outcome = assessTraditionalRecovery(scope2, previous, evidence, now());
      if (!["completed", "abandoned"].includes(outcome) || approval.outcome !== outcome) return fail5("FC27_RECOVERY_REQUIRED");
      const next = normalizeTraditionalJournal(scope2, { ...previous, phase: outcome, submitted: outcome === "completed", updatedAt: now() });
      if (next.updatedAt < previous.updatedAt) return fail5("FC27_RECOVERY_REQUIRED");
      guard(scope2);
      try {
        await gmSetValue(expectedScope, globalThis.structuredClone(next));
        if (!same2(await read(scope2), next)) return fail5("FC27_JOURNAL_UNCONFIRMED");
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
    const scope2 = traditionalJournalScope(context);
    let active = false;
    let held = false;
    const supported = () => typeof lockManager?.request === "function";
    async function run(requestedScope, task) {
      if (requestedScope !== scope2) return fail6("FC27_JOURNAL_SCOPE_UNVERIFIED");
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
          } catch (error2) {
            taskError = error2;
            throw error2;
          } finally {
            held = false;
          }
        });
      } catch (error2) {
        if (error2 === taskError) throw error2;
        return fail6("FC27_EXCLUSIVE_ACCESS_LOST");
      } finally {
        accepting = false;
        held = false;
        active = false;
      }
    }
    return Object.freeze({
      run,
      hasExclusiveAccess: (requestedScope) => requestedScope === scope2 && held,
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
    const exclusive = (scope2, task) => lock.run(scope2, async () => {
      try {
        return await task();
      } finally {
        while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
      }
    });
    return Object.freeze({ lock, journal, exclusive, inspect: () => {
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
    } catch (error2) {
      try {
        await options.onResultError?.(error2, { result, context });
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
  function safeReason(error2) {
    return /^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_ATTEMPT_UNCONFIRMED";
  }
  function terminalRecord(record, scope2) {
    try {
      return isTerminalTraditionalJournal(normalizeTraditionalJournal(scope2, record));
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
        } catch (error2) {
          return blocked(safeReason(error2));
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
        const scope2 = contextKey(plan.context, "traditional-sbc-journal");
        let entered = false;
        let held = false;
        let operation;
        let outcome;
        let lockFailed = false;
        try {
          try {
            await exclusive(scope2, async () => {
              if (entered) return blocked("FC27_ATTEMPT_BUSY");
              entered = true;
              held = true;
              operation = executeLocked(plan, scope2, () => held);
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
        } catch (error2) {
          return { ...blocked(safeReason(error2)), ...outcome, status: "blocked", reason: safeReason(error2) };
        } finally {
          busy = false;
        }
      }
    };
    async function executeLocked(plan, scope2, lockHeld) {
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
        record = normalizeTraditionalJournal(scope2, { ...record, phase, updatedAt: now(), submitted: submitted ? true : phase === "submit-pending" || submitInvoked && !rejected ? null : false });
        try {
          await bounded(() => journal.write(scope2, clone(record)));
          if (!same3(await bounded(() => journal.read(scope2)), record)) return fail7("FC27_JOURNAL_UNCONFIRMED");
        } catch {
          return fail7("FC27_JOURNAL_UNCONFIRMED");
        }
      };
      try {
        const previous = await bounded(() => journal.read(scope2));
        journalReadConfirmed = true;
        if (previous !== null && !terminalRecord(previous, scope2)) return fail7("FC27_RECOVERY_REQUIRED");
        const operationId = createOperationId();
        if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) return fail7("FC27_OPERATION_ID_UNVERIFIED");
        record = {
          schema: 2,
          scope: scope2,
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
      } catch (error2) {
        const reason = safeReason(error2);
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

  // src/fc27/sbc-requirements.js
  var FC27_SBC_SCOPE = Object.freeze({ GREATER: 0, LOWER: 1, EXACT: 2 });
  var FC27_SBC_KEY = Object.freeze({
    QUALITY: 3,
    SAME_NATION: 4,
    SAME_LEAGUE: 5,
    SAME_CLUB: 6,
    DISTINCT_NATIONS: 7,
    DISTINCT_LEAGUES: 8,
    DISTINCT_CLUBS: 9,
    NATION_ID: 10,
    LEAGUE_ID: 11,
    CLUB_ID: 12,
    RARE: 18,
    TEAM_RATING: 19,
    RARITY_GROUP: 25,
    MIN_OVR: 26,
    EXACT_OVR: 27,
    MAX_OVR: 28,
    LEVEL: 17,
    CHEMISTRY: 35
  });
  var qualityBounds = Object.freeze({
    1: Object.freeze([1, 64]),
    2: Object.freeze([65, 74]),
    3: Object.freeze([75, 99])
  });
  var integer4 = (value) => Number.isSafeInteger(value);
  var nonnegative3 = (value) => integer4(value) && value >= 0;
  var positive3 = (value) => integer4(value) && value > 0;
  var valuesOf = (pair) => Array.isArray(pair?.values) ? pair.values.filter(integer4) : [];
  var firstPair = (rule) => Array.isArray(rule?.pairs) && rule.pairs.length === 1 ? rule.pairs[0] : null;
  function normalizedScope(scope2) {
    return [0, 1, 2].includes(scope2) ? scope2 : null;
  }
  var countMode = (scope2) => scope2 === 0 ? "min" : scope2 === 1 ? "max" : "exact";
  function relationKind(key) {
    return {
      4: "same-nation",
      5: "same-league",
      6: "same-club",
      7: "distinct-nations",
      8: "distinct-leagues",
      9: "distinct-clubs"
    }[key] ?? null;
  }
  function relationRule(key, value, scope2, required2) {
    const kind = relationKind(key);
    if (!kind || !positive3(value) || normalizedScope(scope2) === null) return null;
    const mode = scope2 === FC27_SBC_SCOPE.GREATER ? "min" : scope2 === FC27_SBC_SCOPE.LOWER ? "max" : "exact";
    return { kind, value, mode, count: required2, source: { key, scope: scope2, values: [value], count: -1 } };
  }
  function requirementSource(rule, pair, required2) {
    return Object.freeze({
      key: pair?.key ?? null,
      scope: rule?.scope ?? null,
      values: Array.isArray(pair?.values) ? [...pair.values] : [],
      pairs: Array.isArray(rule?.pairs) ? rule.pairs.map((value) => ({
        key: value?.key ?? null,
        values: Array.isArray(value?.values) ? [...value.values] : []
      })) : [],
      count: rule?.count ?? null,
      required: required2
    });
  }
  function unsupported(rule, pair, required2, reason = "unknown-key") {
    return {
      kind: "unsupported",
      key: pair?.key ?? null,
      reason,
      source: requirementSource(rule, pair, required2)
    };
  }
  function parseFc27SbcRequirements(rawRequirements, required2) {
    if (!Array.isArray(rawRequirements) || !rawRequirements.length || rawRequirements.length > 16 || !positive3(required2) || required2 > 11) {
      return { status: "blocked", reason: "FC27_REQUIREMENTS_UNVERIFIED", rules: [], unsupported: [] };
    }
    const rules = [];
    const unsupportedRules = [];
    for (const raw of rawRequirements) {
      const pair = firstPair(raw);
      const scope2 = normalizedScope(raw?.scope);
      const values6 = valuesOf(pair);
      const source = requirementSource(raw, pair, required2);
      let parsed = null;
      if (!pair || !integer4(pair.key) || scope2 === null || values6.length !== (pair.values?.length ?? -1) || !values6.length || values6.length > 32 || new Set(values6).size !== values6.length) {
        parsed = unsupported(raw, pair, required2, "shape");
      } else {
        const key = pair.key;
        const count2 = nonnegative3(raw.count) && raw.count <= required2 ? raw.count : null;
        const mode = countMode(scope2);
        const value = values6[0];
        switch (key) {
          case FC27_SBC_KEY.QUALITY: {
            const bounds = qualityBounds[value];
            if (!bounds || values6.length !== 1 || raw.count !== -1) parsed = unsupported(raw, pair, required2, "quality-shape");
            else if (scope2 === FC27_SBC_SCOPE.EXACT) {
              parsed = { kind: "all-quality", quality: value, minRating: bounds[0], maxRating: bounds[1], count: required2, source };
            } else if (scope2 === FC27_SBC_SCOPE.GREATER) {
              parsed = { kind: "min-quality", quality: value, count: required2, minRating: bounds[0], source };
            } else {
              parsed = { kind: "max-quality", quality: value, count: required2, maxRating: bounds[1], source };
            }
            break;
          }
          case FC27_SBC_KEY.LEVEL:
            parsed = count2 !== null && values6.every((v) => qualityBounds[v]) ? { kind: "quality-count", qualities: [...values6], mode: scope2 === FC27_SBC_SCOPE.GREATER ? "min" : scope2 === FC27_SBC_SCOPE.LOWER ? "max" : "exact", count: count2, source } : unsupported(raw, pair, required2, "quality-count-shape");
            break;
          case FC27_SBC_KEY.MIN_OVR:
          case FC27_SBC_KEY.EXACT_OVR:
          case FC27_SBC_KEY.MAX_OVR:
            parsed = count2 !== null && values6.length === 1 && value >= 1 && value <= 99 ? { kind: key === 26 ? "player-min-overall" : key === 27 ? "player-exact-overall" : "player-max-overall", value, count: count2, mode, source } : unsupported(raw, pair, required2, "overall-shape");
            break;
          case FC27_SBC_KEY.NATION_ID:
          case FC27_SBC_KEY.LEAGUE_ID:
          case FC27_SBC_KEY.CLUB_ID:
            parsed = count2 !== null && values6.every(positive3) ? {
              kind: key === 10 ? "from-nations" : key === 11 ? "from-leagues" : "from-clubs",
              ids: [...values6],
              count: count2,
              mode: scope2 === FC27_SBC_SCOPE.GREATER ? "min" : scope2 === FC27_SBC_SCOPE.LOWER ? "max" : "exact",
              source
            } : unsupported(raw, pair, required2, "identity-shape");
            break;
          case FC27_SBC_KEY.RARE:
            parsed = count2 !== null && values6.length === 1 && value === 1 ? { kind: "rare", count: count2, mode, source } : unsupported(raw, pair, required2, "rare-shape");
            break;
          case FC27_SBC_KEY.RARITY_GROUP:
            parsed = count2 !== null && values6.length === 1 && positive3(value) ? { kind: "rarity-group", groupId: value, count: count2, mode, source } : unsupported(raw, pair, required2, "group-shape");
            break;
          case FC27_SBC_KEY.TEAM_RATING:
            parsed = raw.count === -1 && values6.length === 1 && value >= 1 && value <= 99 ? { kind: `${mode}-team-rating`, value, source } : unsupported(raw, pair, required2, "team-rating-shape");
            break;
          case FC27_SBC_KEY.CHEMISTRY:
            parsed = raw.count === -1 && values6.length === 1 && value >= 0 && value <= 33 ? { kind: `${mode}-chemistry`, value, source } : unsupported(raw, pair, required2, "chemistry-shape");
            break;
          default: {
            const relation = raw.count === -1 && values6.length === 1 && value <= required2 ? relationRule(key, value, scope2, required2) : null;
            parsed = relation ? { ...relation, source } : unsupported(raw, pair, required2);
          }
        }
      }
      rules.push(parsed);
      if (parsed.kind === "unsupported") unsupportedRules.push(parsed);
    }
    return { status: unsupportedRules.length ? "unsupported" : "observed", reason: unsupportedRules.length ? "FC27_REQUIREMENT_UNSUPPORTED" : "FC27_REQUIREMENTS_PARSED", rules, unsupported: unsupportedRules };
  }
  function itemValue(item, keys2) {
    for (const key of keys2) {
      const value = item?.[key];
      if (integer4(value)) return value;
    }
    return null;
  }
  function itemQuality(item) {
    if ([1, 2, 3].includes(item?.quality)) return item.quality;
    const rating = itemValue(item, ["rating", "overall", "ovr"]);
    if (!integer4(rating) || rating < 1 || rating > 99) return null;
    return rating <= 64 ? 1 : rating <= 74 ? 2 : 3;
  }
  function relationResult(values6, rule) {
    if (values6.some((value) => value === null)) return null;
    const count2 = /* @__PURE__ */ new Map();
    for (const value of values6) if (value !== null) count2.set(value, (count2.get(value) ?? 0) + 1);
    const observed = rule.kind.startsWith("distinct-") ? count2.size : Math.max(0, ...count2.values());
    if (rule.mode === "min") return observed >= rule.value;
    if (rule.mode === "max") return observed <= rule.value;
    return observed === rule.value;
  }
  function compareCount(actual, expected, mode) {
    return mode === "min" ? actual >= expected : mode === "max" ? actual <= expected : actual === expected;
  }
  function createFc27ClubResolver(clubLinks) {
    if (clubLinks?.schema !== 1 || clubLinks.complete !== true || !Array.isArray(clubLinks.links) || clubLinks.links.length > 2e4 || clubLinks.links.some((pair) => !Array.isArray(pair) || pair.length !== 2 || !pair.every(positive3))) return null;
    const links = new Map(clubLinks.links);
    if (links.size !== clubLinks.links.length) return null;
    return (id4) => positive3(id4) ? links.get(id4) ?? id4 : null;
  }
  function matchFc27SbcItemRule(rule, item, groupMatcher, clubResolver) {
    if (![
      "all-quality",
      "min-quality",
      "max-quality",
      "quality-count",
      "player-min-overall",
      "player-exact-overall",
      "player-max-overall",
      "from-nations",
      "from-leagues",
      "from-clubs",
      "rare",
      "rarity-group"
    ].includes(rule?.kind)) return null;
    return ruleResult({ ...rule, count: 1, mode: "min" }, [item], { groupMatcher, clubResolver });
  }
  function ruleResult(rule, squad, options) {
    const players = squad;
    const ids = (keys2) => players.map((item) => {
      const value = itemValue(item, keys2);
      return positive3(value) ? value : null;
    });
    const countMatches = (values6, predicate) => values6.some((value) => value === null) ? null : compareCount(values6.filter(predicate).length, rule.count, rule.mode ?? "min");
    const clubIds = () => typeof options.clubResolver === "function" ? ids(["teamId", "clubId"]).map(options.clubResolver) : players.map(() => null);
    switch (rule.kind) {
      case "all-quality":
        return countMatches(players.map(itemQuality), (value) => value === rule.quality);
      case "min-quality":
        return countMatches(players.map(itemQuality), (value) => value >= rule.quality);
      case "quality-count": {
        const qualities = players.map(itemQuality);
        if (qualities.some((value) => value === null)) return null;
        const matches = qualities.filter((quality2) => {
          return rule.qualities.includes(quality2);
        }).length;
        return compareCount(matches, rule.count, rule.mode);
      }
      case "max-quality":
        return countMatches(players.map(itemQuality), (value) => value <= rule.quality);
      case "player-min-overall":
      case "player-exact-overall":
      case "player-max-overall":
        return countMatches(players.map((item) => {
          const rating = itemValue(item, ["rating", "overall", "ovr"]);
          return integer4(rating) && rating >= 1 && rating <= 99 ? rating : null;
        }), (value) => rule.kind === "player-min-overall" ? value >= rule.value : rule.kind === "player-max-overall" ? value <= rule.value : value === rule.value);
      case "from-nations":
        return countMatches(ids(["nationId", "nation"]), (value) => rule.ids.includes(value));
      case "from-leagues":
        return countMatches(ids(["leagueId", "league"]), (value) => rule.ids.includes(value));
      case "from-clubs": {
        if (typeof options.clubResolver !== "function") return null;
        const allowed = /* @__PURE__ */ new Set([...rule.ids, ...rule.ids.map(options.clubResolver)]);
        return countMatches(clubIds(), (value) => allowed.has(value));
      }
      case "rare":
        return countMatches(players.map((item) => {
          const rarity = itemValue(item, ["rarity", "rareflag"]);
          return nonnegative3(rarity) ? rarity === 1 : null;
        }), (value) => value === true);
      case "rarity-group":
        return countMatches(players.map((item) => {
          if (typeof options.groupMatcher === "function") {
            try {
              const result = options.groupMatcher(item, rule.groupId);
              return typeof result === "boolean" ? result : null;
            } catch {
              return null;
            }
          }
          return Array.isArray(item?.groups) && item.groups.every(nonnegative3) ? item.groups.includes(rule.groupId) : null;
        }), (value) => value === true);
      case "min-team-rating":
      case "max-team-rating":
      case "exact-team-rating":
        return integer4(options.teamRating) && options.teamRating >= 0 && options.teamRating <= 99 ? compareCount(options.teamRating, rule.value, rule.kind.split("-")[0]) : null;
      case "min-chemistry":
      case "max-chemistry":
      case "exact-chemistry":
        return integer4(options.chemistry) && options.chemistry >= 0 && options.chemistry <= 33 ? compareCount(options.chemistry, rule.value, rule.kind.split("-")[0]) : null;
      case "same-nation":
        return relationResult(ids(["nationId", "nation"]), rule);
      case "same-league":
        return relationResult(ids(["leagueId", "league"]), rule);
      case "same-club":
        return relationResult(clubIds(), rule);
      case "distinct-nations":
        return relationResult(ids(["nationId", "nation"]), rule);
      case "distinct-leagues":
        return relationResult(ids(["leagueId", "league"]), rule);
      case "distinct-clubs":
        return relationResult(clubIds(), rule);
      default:
        return null;
    }
  }
  function matchFc27SbcRequirements({ requirements, squad, chemistry, teamRating, groupMatcher, clubLinks } = {}) {
    if (!Array.isArray(requirements) || !requirements.length || !Array.isArray(squad) || !squad.length || squad.length > 11 || Array.from(squad).some((item) => !item || typeof item !== "object") || requirements.some((rule) => !rule || rule.source?.required !== squad.length)) {
      return { status: "blocked", reason: "FC27_REQUIREMENTS_UNVERIFIED", satisfied: false, failures: [] };
    }
    const unsupportedRules = requirements.filter((rule) => rule?.kind === "unsupported");
    if (unsupportedRules.length) return { status: "unsupported", reason: "FC27_REQUIREMENT_UNSUPPORTED", satisfied: false, failures: unsupportedRules };
    const options = { chemistry, teamRating, groupMatcher, clubResolver: createFc27ClubResolver(clubLinks) };
    const failures = requirements.map((rule, index) => ({ rule, index, result: ruleResult(rule, squad, options) })).filter((entry) => entry.result !== true);
    const unavailable = failures.filter((entry) => entry.result === null);
    return {
      status: unavailable.length ? "blocked" : failures.length ? "unsatisfied" : "satisfied",
      reason: unavailable.length ? "FC27_REQUIREMENT_VALUE_UNAVAILABLE" : failures.length ? "FC27_REQUIREMENTS_NOT_MET" : null,
      satisfied: !failures.length,
      failures: failures.map(({ rule, index }) => ({ index, rule }))
    };
  }

  // src/fc27/puzzle-material-policy.js
  var DEFAULT_PUZZLE_MAX_RATING = 82;
  function puzzleMaterialRules(rules, required2) {
    if (!rules.some((rule) => rule.kind === "min-quality")) return [];
    const qualityRules = rules.filter((rule) => ["all-quality", "min-quality", "max-quality", "quality-count"].includes(rule.kind));
    for (let gold = 0; gold <= required2; gold++) {
      for (let silver = 0; silver <= required2 - gold; silver++) {
        const counts = [required2 - silver - gold, silver, gold];
        const squad = counts.flatMap((count2, index) => Array.from({ length: count2 }, () => ({ quality: index + 1 })));
        if (matchFc27SbcRequirements({ requirements: qualityRules, squad }).status !== "satisfied") continue;
        return counts.map((count2, index) => ({
          kind: "quality-count",
          qualities: [index + 1],
          mode: "exact",
          count: count2,
          source: { policy: "minimum-quality-fillers", quality: index + 1, required: required2 }
        }));
      }
    }
    return [];
  }

  // src/fc27/puzzle-preview.js
  var DEFAULT_MAX_NODES = 5e4;
  var integer5 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  var blocked2 = (reason, extra = {}) => ({ status: "blocked", reason, liveExecutionEnabled: false, selected: [], ...extra });
  function freeze2(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze2);
      Object.freeze(value);
    }
    return value;
  }
  function ruleNeedsTeamFacts(rules) {
    return rules.some((rule) => [
      "min-team-rating",
      "max-team-rating",
      "exact-team-rating",
      "min-chemistry",
      "max-chemistry",
      "exact-chemistry"
    ].includes(rule.kind));
  }
  function evaluatePlacement({ chosen, slots, formation, evaluateSquad, takeNode, validate, searchPositions }) {
    let found = null;
    let unavailable = null;
    let exhausted = false;
    const evaluate = (ordered) => {
      if (!takeNode("evaluations")) {
        exhausted = true;
        return;
      }
      let facts2;
      try {
        const brickIndices = Array.from({ length: formation?.slotCount ?? 0 }, (_, index) => index).filter((index) => !slots.includes(index));
        const detached = Array.from({ length: formation?.slotCount ?? ordered.length }, () => null);
        ordered.forEach((item, index) => {
          detached[slots[index]] = { ...item, slot: slots[index] };
        });
        if (brickIndices.some((index) => detached[index] !== null)) {
          unavailable = "FC27_PUZZLE_SLOT_LAYOUT_UNAVAILABLE";
          return;
        }
        facts2 = evaluateSquad(freeze2(globalThis.structuredClone(detached)));
      } catch {
        unavailable = "FC27_PUZZLE_EVALUATOR_FAILED";
        return;
      }
      if (!facts2 || facts2.status !== void 0 && facts2.status !== "observed") {
        unavailable = /^FC27_[A-Z_]{1,80}$/.test(facts2?.reason) ? facts2.reason : "FC27_PUZZLE_EVALUATOR_FAILED";
        return;
      }
      const validation = validate(facts2);
      if (validation.status === "blocked") unavailable = "FC27_REQUIREMENT_VALUE_UNAVAILABLE";
      if (validation.status === "satisfied") found = {
        items: ordered.slice(),
        validation,
        facts: { chemistry: facts2.chemistry ?? null, teamRating: facts2.teamRating ?? null }
      };
    };
    const fits = (item, index) => Array.isArray(item.positions) && item.positions.includes(formation?.positions?.[slots[index]]);
    const preferred = chosen.slice();
    if (searchPositions) {
      const assigned = Array(slots.length).fill(-1);
      const augment = (itemIndex, visited) => {
        if (!takeNode("placementNodes")) {
          exhausted = true;
          return false;
        }
        for (let slot = 0; slot < slots.length; slot++) {
          if (visited.has(slot) || !fits(chosen[itemIndex], slot)) continue;
          visited.add(slot);
          if (assigned[slot] === -1 || augment(assigned[slot], visited)) {
            assigned[slot] = itemIndex;
            return true;
          }
          if (exhausted) return false;
        }
        return false;
      };
      for (let index = 0; index < chosen.length && !exhausted; index++) augment(index, /* @__PURE__ */ new Set());
      if (exhausted) return { found, unavailable, exhausted };
      const used2 = new Set(assigned.filter((index) => index !== -1));
      const fillers = chosen.filter((_item, index) => !used2.has(index));
      assigned.forEach((itemIndex, slot) => {
        preferred[slot] = itemIndex === -1 ? fillers.shift() : chosen[itemIndex];
      });
    }
    evaluate(preferred);
    if (found || unavailable || exhausted || !searchPositions) return { found, unavailable, exhausted };
    const order = slots.map((_slot, index) => index).sort((a, b) => chosen.filter((item) => fits(item, a)).length - chosen.filter((item) => fits(item, b)).length || a - b);
    const arranged = Array(chosen.length);
    const used = /* @__PURE__ */ new Set();
    const visit = (depth) => {
      if (found || unavailable || exhausted) return;
      if (!takeNode("placementNodes")) {
        exhausted = true;
        return;
      }
      if (depth === order.length) {
        if (!arranged.every((item, index) => item === preferred[index])) evaluate(arranged);
        return;
      }
      const slotIndex = order[depth];
      const choices = chosen.map((_item, index) => index).filter((index) => !used.has(index)).sort((a, b) => Number(fits(chosen[b], slotIndex)) - Number(fits(chosen[a], slotIndex)) || a - b);
      for (const index of choices) {
        if (found || unavailable || exhausted) break;
        used.add(index);
        arranged[slotIndex] = chosen[index];
        visit(depth + 1);
        used.delete(index);
      }
    };
    visit(0);
    return { found, unavailable, exhausted };
  }
  var itemKinds = /* @__PURE__ */ new Set([
    "all-quality",
    "min-quality",
    "max-quality",
    "quality-count",
    "player-min-overall",
    "player-exact-overall",
    "player-max-overall",
    "from-nations",
    "from-leagues",
    "from-clubs",
    "rare",
    "rarity-group"
  ]);
  var relationField = (rule) => rule.kind.endsWith("nation") || rule.kind.endsWith("nations") ? "nationId" : rule.kind.endsWith("league") || rule.kind.endsWith("leagues") ? "leagueId" : "teamId";
  var relationValue = (rule, item, resolveClub) => relationField(rule) === "teamId" ? resolveClub?.(item.teamId ?? item.clubId) ?? null : item[relationField(rule)];
  function groupSuffixIndex(rule, candidates, resolveClub) {
    const groups = /* @__PURE__ */ new Map();
    candidates.forEach((item, index) => {
      const value = relationValue(rule, item, resolveClub);
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(index);
    });
    return groups;
  }
  function suffixSize(indices, start) {
    let low = 0;
    let high = indices.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (indices[middle] < start) low = middle + 1;
      else high = middle;
    }
    return indices.length - low;
  }
  function remainingGroupCapacity(groups, used, start, freeGroups) {
    let existing = 0;
    const additional = [];
    for (const [key, indices] of groups) {
      const count2 = suffixSize(indices, start);
      if (used.has(key)) existing += count2;
      else if (count2) additional.push(count2);
    }
    additional.sort((a, b) => b - a);
    return existing + additional.slice(0, freeGroups).reduce((sum, count2) => sum + count2, 0);
  }
  var hintGroup = (hint, item, resolveClub) => hint.strategy === "club" ? resolveClub?.(item.teamId ?? item.clubId) : item[hint.strategy === "nation" ? "nationId" : "leagueId"];
  function isFc27PuzzleSearchHintValid(hint, candidates, clubLinks) {
    if (hint === null) return true;
    if (!hint || Object.keys(hint).sort().join(",") !== "groupId,strategy" || !["balanced", "low-rating", "nation", "league", "club"].includes(hint.strategy) || !integer5(hint.groupId, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (["balanced", "low-rating"].includes(hint.strategy)) return hint.groupId === 0;
    const resolveClub = createFc27ClubResolver(clubLinks);
    return hint.groupId > 0 && candidates.some((item) => hintGroup(hint, item, resolveClub) === hint.groupId);
  }
  function filterUnaryCandidates(candidates, itemRules, required2, groupMatcher, resolveClub) {
    return candidates.filter((item) => itemRules.every((rule) => {
      if (rule.count === required2 && rule.mode !== "max") return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== false;
      if (rule.count === 0 && ["max", "exact"].includes(rule.mode)) return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== true;
      return true;
    }));
  }
  function previewFc27PuzzleSquad({
    context,
    challenge,
    inventory,
    policy,
    evaluateSquad,
    boundSquad,
    groupMatcher,
    clubLinks,
    maxNodes = DEFAULT_MAX_NODES,
    searchHint = null
  } = {}) {
    if (!integer5(maxNodes, 1, 25e4)) return blocked2("FC27_PUZZLE_BUDGET_INVALID");
    if (challenge?.mechanism !== "traditional-puzzle") return blocked2("CHALLENGE_UNVERIFIED");
    const required2 = challenge.slotCount - (challenge.brickIndices?.length ?? NaN);
    const pool = collectSafeTraditionalCandidates({ context, inventory, policy, challenge: {
      ...challenge,
      mechanism: "traditional",
      requirements: [{ kind: "player-count", count: required2 }]
    } });
    if (pool.status !== "candidates") return pool;
    const options = { challenge, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks, pool };
    const rules = parseFc27SbcRequirements(challenge.rawRequirements, required2);
    if (searchHint !== null || maxNodes < 1e3 || pool.candidates.length <= required2 || rules.status !== "observed" || !rules.rules.some((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind) && rule.value > 0)) {
      return searchFc27PuzzleCandidates({ ...options, maxNodes, searchHint });
    }
    const hints = [null];
    const hintCandidates = filterUnaryCandidates(
      pool.candidates,
      [...rules.rules, ...puzzleMaterialRules(rules.rules, required2)].filter((rule) => itemKinds.has(rule.kind)),
      required2,
      groupMatcher,
      createFc27ClubResolver(clubLinks)
    );
    for (const [strategy, field] of [["league", "leagueId"], ["nation", "nationId"]]) {
      const groups = /* @__PURE__ */ new Map();
      for (const item of hintCandidates) {
        if (!integer5(item[field], 1, Number.MAX_SAFE_INTEGER)) continue;
        if (!groups.has(item[field])) groups.set(item[field], /* @__PURE__ */ new Set());
        groups.get(item[field]).add(item.definitionId);
      }
      hints.push(...[...groups].filter(([, ids]) => ids.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0] - b[0]).slice(0, 2).map(([groupId]) => ({ strategy, groupId })));
    }
    let nodes = 0;
    let result;
    const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
    for (const [index, hint] of hints.entries()) {
      const budget = Math.floor((maxNodes - nodes) / (hints.length - index));
      result = searchFc27PuzzleCandidates({ ...options, maxNodes: budget, searchHint: hint });
      nodes += result.nodes ?? 0;
      for (const key of Object.keys(search)) search[key] += result.search?.[key] ?? 0;
      if (result.reason !== "FC27_PUZZLE_SEARCH_LIMIT") {
        return { ...result, ...result.nodes !== void 0 ? { nodes, maxNodes, search, strategyAttempts: index + 1 } : {} };
      }
    }
    return { ...result, nodes, maxNodes, search, strategyAttempts: hints.length };
  }
  function searchFc27PuzzleCandidates({
    challenge,
    policy,
    evaluateSquad,
    boundSquad,
    groupMatcher,
    clubLinks,
    maxNodes = DEFAULT_MAX_NODES,
    searchHint = null,
    pool,
    procurement = null
  } = {}) {
    if (!integer5(maxNodes, 1, 25e4)) return blocked2("FC27_PUZZLE_BUDGET_INVALID");
    const required2 = pool.required;
    if (procurement && (!integer5(procurement.budget, 0, 1e7) || !integer5(procurement.maxPurchases, 0, 11) || typeof procurement.costOf !== "function")) return blocked2("FC27_MARKET_POLICY_INVALID");
    const parsed = parseFc27SbcRequirements(challenge.rawRequirements, required2);
    if (parsed.status === "unsupported") return blocked2("FC27_REQUIREMENT_UNSUPPORTED", { unsupported: parsed.unsupported });
    if (parsed.status !== "observed") return blocked2(parsed.reason);
    const resolveClub = createFc27ClubResolver(clubLinks);
    if (parsed.rules.some((rule) => ["from-clubs", "same-club", "distinct-clubs"].includes(rule.kind)) && !resolveClub) {
      return blocked2("FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE");
    }
    const materialRules = puzzleMaterialRules(parsed.rules, required2);
    const itemRules = [...parsed.rules, ...materialRules].filter((rule) => itemKinds.has(rule.kind));
    if (!isFc27PuzzleSearchHintValid(searchHint, pool.candidates, clubLinks)) {
      return blocked2("FC27_PUZZLE_STRATEGY_INVALID");
    }
    let candidates = filterUnaryCandidates(pool.candidates, itemRules, required2, groupMatcher, resolveClub);
    if (searchHint?.strategy !== "low-rating" && parsed.rules.some((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind) && rule.value > 0)) {
      const fields3 = [
        (item) => item.nationId,
        (item) => item.leagueId,
        (item) => resolveClub?.(item.teamId ?? item.clubId)
      ];
      const frequencies = fields3.map((read) => {
        const groups = /* @__PURE__ */ new Map();
        for (const item of candidates) {
          const key = read(item);
          if (!integer5(key, 1, Number.MAX_SAFE_INTEGER)) continue;
          if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
          groups.get(key).add(item.definitionId);
        }
        return groups;
      });
      const scores = new Map(candidates.map((item) => [item, fields3.reduce((sum, read, index) => sum + Math.min(required2, frequencies[index].get(read(item))?.size ?? 0), 0)]));
      candidates = candidates.slice().sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || scores.get(b) - scores.get(a) || a.rating - b.rating || (Number.isSafeInteger(a.id) && Number.isSafeInteger(b.id) ? a.id - b.id : a.definitionId - b.definitionId));
    }
    if (["nation", "league", "club"].includes(searchHint?.strategy)) {
      const group = (item) => hintGroup(searchHint, item, resolveClub);
      candidates = candidates.slice().sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || Number(group(b) === searchHint.groupId) - Number(group(a) === searchHint.groupId));
    }
    const scarce = itemRules.filter((rule) => rule.mode !== "max" && rule.count > 0).map((rule) => ({
      minimum: rule.count,
      matching: candidates.filter((item) => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) === true)
    }));
    for (const rule of parsed.rules.filter((rule2) => rule2.kind.startsWith("same-") && rule2.mode !== "max")) {
      const groups = /* @__PURE__ */ new Map();
      for (const item of candidates) {
        const key = relationValue(rule, item, resolveClub);
        if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
        groups.get(key).add(item.definitionId);
      }
      scarce.push({ minimum: rule.value, matching: candidates.filter((item) => (groups.get(relationValue(rule, item, resolveClub))?.size ?? 0) >= rule.value) });
    }
    const forced = new Set(scarce.filter((entry) => new Set(entry.matching.map((item) => item.definitionId)).size === entry.minimum).flatMap((entry) => entry.matching));
    const definitionCounts = /* @__PURE__ */ new Map();
    for (const item of candidates) definitionCounts.set(item.definitionId, (definitionCounts.get(item.definitionId) ?? 0) + 1);
    const certain = [...forced].filter((item) => definitionCounts.get(item.definitionId) === 1);
    for (const rule of itemRules.filter((rule2) => ["max", "exact"].includes(rule2.mode))) {
      const used = certain.filter((item) => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) === true).length;
      if (used === rule.count) candidates = candidates.filter((item) => forced.has(item) || matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== true);
    }
    if (forced.size && parsed.rules.some((rule) => rule.kind.endsWith("-chemistry"))) {
      candidates = candidates.slice().sort((a, b) => Number(forced.has(b)) - Number(forced.has(a)));
    }
    const metrics = { safeCandidates: candidates.length, excluded: pool.excluded, excludedByReason: pool.excludedByReason };
    const costs = procurement ? candidates.map(procurement.costOf) : candidates.map(() => 0);
    if (costs.some((cost) => !integer5(cost, 0, 1e7))) return blocked2("FC27_MARKET_QUOTE_INVALID");
    const uniqueDefinitions = new Set(candidates.map((item) => item.definitionId)).size;
    if (uniqueDefinitions < required2) return blocked2("SAFE_MATERIAL_SHORTAGE", { ...metrics, uniqueDefinitions, required: required2 });
    const counted = itemRules.map((rule) => ({
      rule,
      matches: candidates.map((item) => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub))
    }));
    const relations = parsed.rules.filter((rule) => /^(same|distinct)-/.test(rule.kind));
    if (counted.some(({ matches }) => matches.includes(null)) || relations.some((rule) => candidates.some((item) => !integer5(relationValue(rule, item, resolveClub), 1, Number.MAX_SAFE_INTEGER)))) {
      return blocked2("FC27_REQUIREMENT_VALUE_UNAVAILABLE", metrics);
    }
    const groupCaps = new Map(relations.filter((rule) => rule.kind.startsWith("distinct-") && rule.mode !== "min").map((rule) => [rule, groupSuffixIndex(rule, candidates, resolveClub)]));
    for (const rule of relations.filter((rule2) => rule2.kind.startsWith("same-") && rule2.mode !== "max")) {
      const groups = /* @__PURE__ */ new Map();
      for (const item of candidates) {
        const key = relationValue(rule, item, resolveClub);
        if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
        groups.get(key).add(item.definitionId);
      }
      const viable = new Set([...groups].filter(([, ids]) => ids.size >= rule.value).map(([key]) => key));
      counted.push({
        rule: { ...rule, count: rule.value, mode: "min" },
        matches: candidates.map((item) => viable.has(relationValue(rule, item, resolveClub)))
      });
    }
    const deficits = counted.flatMap(({ rule, matches }) => {
      if (rule.mode === "max") return [];
      const available = new Set(candidates.filter((_item, index) => matches[index]).map((item) => item.definitionId)).size;
      return available < rule.count ? [{ kind: rule.kind, minimumMissing: rule.count - available, source: rule.source }] : [];
    });
    if (deficits.length) return blocked2("FC27_PUZZLE_CONSTRAINT_SHORTAGE", { ...metrics, deficits });
    if (ruleNeedsTeamFacts(parsed.rules) && typeof evaluateSquad !== "function") return blocked2("FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE", metrics);
    for (const entry of counted) {
      entry.suffix = Array(candidates.length + 1).fill(0);
      entry.used = 0;
      for (let i = candidates.length - 1; i >= 0; i--) entry.suffix[i] = entry.suffix[i + 1] + Number(entry.matches[i]);
    }
    const slots = Array.from({ length: challenge.slotCount }, (_, index) => index).filter((index) => !challenge.brickIndices.includes(index));
    const chosen = [];
    const definitions = /* @__PURE__ */ new Set();
    let nodes = 0;
    let found = null;
    let unavailable = null;
    let exhausted = false;
    let deferredPlacements = false;
    let spent = 0;
    let purchases = 0;
    let best = null;
    const cheapest = procurement ? Array(candidates.length + 1) : null;
    if (procurement) cheapest[candidates.length] = [];
    if (procurement) for (let i = candidates.length - 1; i >= 0; i--) {
      cheapest[i] = [...cheapest[i + 1], costs[i]].sort((a, b) => a - b).slice(0, required2);
    }
    const finished = () => found && !procurement || best?.cost === 0;
    const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
    const takeNode = (kind) => {
      if (nodes >= maxNodes) {
        exhausted = true;
        return false;
      }
      nodes++;
      search[kind]++;
      return true;
    };
    const needsFacts = ruleNeedsTeamFacts(parsed.rules);
    const searchPositions = parsed.rules.some((rule) => rule.kind.endsWith("-chemistry"));
    const minimumChemistry = Math.max(0, ...parsed.rules.filter((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind)).map((rule) => rule.value));
    const visit = (start) => {
      if (finished() || unavailable || exhausted || !takeNode("combinationNodes")) return;
      const remaining = required2 - chosen.length;
      if (procurement) {
        if (purchases > procurement.maxPurchases || spent > procurement.budget) return;
        const floor = spent + cheapest[start].slice(0, remaining).reduce((sum, cost) => sum + cost, 0);
        if (floor > procurement.budget || best && floor >= best.cost) return;
      }
      for (const { rule, used, suffix } of counted) {
        const mode = rule.mode ?? "min";
        if (mode !== "min" && used > rule.count || mode !== "max" && used + Math.min(remaining, suffix[start]) < rule.count) return;
      }
      for (const rule of relations) {
        const counts = /* @__PURE__ */ new Map();
        for (const item of chosen) {
          const value = relationValue(rule, item, resolveClub);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        const actual = rule.kind.startsWith("distinct-") ? counts.size : Math.max(0, ...counts.values());
        if (rule.mode !== "min" && actual > rule.value || rule.mode !== "max" && actual + remaining < rule.value) return;
        if (groupCaps.has(rule) && remainingGroupCapacity(groupCaps.get(rule), counts, start, rule.value - counts.size) < remaining) return;
      }
      if (chosen.length === required2) {
        const validate = (facts2) => matchFc27SbcRequirements({
          requirements: parsed.rules,
          squad: chosen,
          chemistry: facts2?.chemistry,
          teamRating: facts2?.teamRating,
          groupMatcher,
          clubLinks
        });
        if (needsFacts) {
          if (typeof boundSquad === "function" && minimumChemistry > 0) {
            if (!takeNode("bounds")) return;
            let bound;
            try {
              const squad = Array(challenge.slotCount).fill(null);
              chosen.forEach((item, index) => {
                squad[slots[index]] = { ...item, slot: slots[index] };
              });
              bound = boundSquad(freeze2(globalThis.structuredClone(squad)));
            } catch {
              unavailable = "FC27_PUZZLE_BOUND_UNAVAILABLE";
              return;
            }
            if (bound?.status !== "observed" || !integer5(bound.maxChemistry, 0, 33)) {
              unavailable = "FC27_PUZZLE_BOUND_UNAVAILABLE";
              return;
            }
            if (bound.maxChemistry < minimumChemistry) return;
          }
          let placementNodes = 0;
          const placementNode = (kind) => {
            if (placementNodes >= 256) {
              deferredPlacements = true;
              return false;
            }
            placementNodes++;
            return takeNode(kind);
          };
          const result = evaluatePlacement({
            chosen,
            slots,
            formation: { ...challenge.formation, slotCount: challenge.slotCount },
            evaluateSquad,
            takeNode: placementNode,
            validate,
            searchPositions
          });
          found = result.found;
          unavailable = result.unavailable;
        } else {
          const validation = validate({});
          if (validation.status === "blocked") unavailable = validation.reason;
          if (validation.status === "satisfied") found = { items: chosen.slice(), facts: { chemistry: null, teamRating: null }, validation };
        }
        if (procurement && found) {
          if (!best || spent < best.cost) best = { ...found, cost: spent, purchases };
          found = null;
        }
        return;
      }
      for (let index = start; index <= candidates.length - remaining && !finished() && !unavailable && !exhausted; index++) {
        const item = candidates[index];
        if (definitions.has(item.definitionId)) continue;
        for (const entry of counted) entry.used += Number(entry.matches[index]);
        spent += costs[index];
        purchases += Number(costs[index] > 0);
        chosen.push(item);
        definitions.add(item.definitionId);
        visit(index + 1);
        definitions.delete(item.definitionId);
        chosen.pop();
        spent -= costs[index];
        purchases -= Number(costs[index] > 0);
        for (const entry of counted) entry.used -= Number(entry.matches[index]);
      }
    };
    visit(0);
    if (procurement) found = best;
    if (unavailable) return blocked2("FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE", { ...metrics, nodes, search, evaluatorReason: unavailable });
    if ((exhausted || deferredPlacements) && !found) return blocked2("FC27_PUZZLE_SEARCH_LIMIT", { ...metrics, nodes, maxNodes, search });
    if (!found) return blocked2("FC27_PUZZLE_NO_PLAN_FOUND", { ...metrics, nodes, maxNodes, search, deficits: [] });
    return {
      status: "preview",
      reason: "READ_ONLY_PLAN",
      liveExecutionEnabled: false,
      setId: challenge.setId,
      challengeId: challenge.id,
      required: required2,
      selected: found.items.map((item, index) => ({
        id: item.id,
        definitionId: item.definitionId,
        pile: item.pile,
        rating: item.rating,
        slot: slots[index],
        ...item.catalogRef ? { catalogRef: item.catalogRef } : {}
      })),
      validation: found.validation,
      teamFacts: found.facts,
      nodes,
      maxNodes,
      search,
      ...metrics,
      ...procurement ? {
        estimatedCost: found.cost,
        searchComplete: !exhausted && !deferredPlacements,
        optimalWithinPool: !exhausted && !deferredPlacements
      } : {},
      pending: ["EXACT_ITEM_REVALIDATION", "MARKET_RECEIPT_IF_NEEDED", "EXPLICIT_TRANSACTION_APPROVAL"]
    };
  }

  // src/fc27/puzzle-evaluator.js
  var integer6 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  var positive4 = (value) => integer6(value, 1, Number.MAX_SAFE_INTEGER);
  var fail8 = (reason) => ({ status: "blocked", reason, chemistry: null, teamRating: null });
  function evaluateFc27PuzzleRating({ squad, rating } = {}) {
    if (!Array.isArray(squad) || !squad.length || squad.length > 11 || Array.from(squad).some((item) => !integer6(item?.rating, 1, 99))) return fail8("FC27_PUZZLE_RATING_ITEMS_UNAVAILABLE");
    if (typeof rating?.floatCalculationEnabled !== "boolean") return fail8("FC27_PUZZLE_RATING_CONFIG_UNAVAILABLE");
    let total = squad.reduce((sum, item) => sum + item.rating, 0);
    const average = Math.min(rating.floatCalculationEnabled ? total / 11 : Math.floor(total / 11), 99);
    for (const item of squad) if (item.rating > average) total += item.rating - average;
    if (rating.floatCalculationEnabled) total = Math.round(total);
    return {
      status: "observed",
      teamRating: Math.min(Math.max(Math.floor(total / 11), 0), 99),
      ratingMode: rating.floatCalculationEnabled ? "float" : "integer"
    };
  }
  function parametersOf(parameters) {
    if (!Array.isArray(parameters) || parameters.length !== 3) return null;
    const map = /* @__PURE__ */ new Map();
    for (const parameter of parameters) {
      if (!integer6(parameter?.id, 1, 3) || map.has(parameter.id) || !Array.isArray(parameter.thresholds) || !parameter.thresholds.length || parameter.thresholds.length > 8) return null;
      const thresholds = Array.from(parameter.thresholds);
      if (thresholds.some((value) => !integer6(value?.requirement, 1, 99) || !integer6(value?.points, 0, 3)) || thresholds.some((value, index) => index && value.requirement <= thresholds[index - 1].requirement)) return null;
      map.set(parameter.id, thresholds);
    }
    return map;
  }
  function profilesOf(chemistry) {
    if (chemistry.profilesEnabled === false) return [];
    const snapshot = chemistry.profiles;
    if (snapshot?.complete !== true || !Array.isArray(snapshot.entries) || !snapshot.entries.length || snapshot.entries.length > 128) return null;
    const ids = /* @__PURE__ */ new Set();
    const rarities = /* @__PURE__ */ new Set();
    for (const profile of snapshot.entries) {
      if (!positive4(profile?.id) || ids.has(profile.id) || !Array.isArray(profile.applicableRarityIds) || profile.applicableRarityIds.length > 10001) return null;
      ids.add(profile.id);
      for (const rarity of profile.applicableRarityIds) {
        if (!integer6(rarity, 0, 1e4) || rarities.has(rarity)) return null;
        rarities.add(rarity);
      }
    }
    return ids.has(1) ? snapshot.entries : null;
  }
  function ordinaryProfile(profile) {
    return profile?.maxChem === false && Array.isArray(profile.rules) && profile.rules.length === 3 && new Set(profile.rules.map((rule) => rule?.parameterId)).size === 3 && profile.rules.every((rule) => integer6(rule?.parameterId, 1, 3) && rule.calculationType === 1 && rule.contribution === 1);
  }
  function boundFc27PuzzleChemistry({ squad, formation, chemistry, rating } = {}) {
    if (!Array.isArray(squad) || !Array.isArray(formation?.positions) || squad.length !== 11 || formation.positions.length !== 11) return fail8("FC27_PUZZLE_FORMATION_UNAVAILABLE");
    const actual = evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating });
    if (actual.status !== "observed") return actual;
    const optimistic = { ...formation, positions: squad.map((item, index) => item === null ? formation.positions[index] : item.positions[0]) };
    const result = evaluateFc27PuzzleSquad({ squad, formation: optimistic, chemistry, rating });
    if (result.status !== "observed") return result;
    const playable = squad.flatMap((item, index) => item === null ? [] : [index]);
    let scores = /* @__PURE__ */ new Map([[0, 0]]);
    squad.forEach((item, index) => {
      if (item === null || result.slotChemistry[index] === 0) return;
      const compatible = playable.filter((slot) => item.positions.includes(formation.positions[slot]));
      const next = new Map(scores);
      for (const [mask, score] of scores) for (const slot of compatible) {
        const bit = 1 << slot;
        if (mask & bit) continue;
        const value = score + result.slotChemistry[index];
        if (value > (next.get(mask | bit) ?? -1)) next.set(mask | bit, value);
      }
      scores = next;
    });
    return { status: "observed", maxChemistry: Math.max(...scores.values()) };
  }
  function evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating } = {}) {
    if (!Array.isArray(squad) || squad.length !== 11 || Array.from(squad).some((item) => item === void 0)) return fail8("FC27_PUZZLE_SQUAD_SIZE_UNAVAILABLE");
    if (!Array.isArray(formation?.positions) || formation.positions.length !== 11 || Array.from(formation.positions).some((position) => !integer6(position, 0, 27))) return fail8("FC27_PUZZLE_FORMATION_UNAVAILABLE");
    if (typeof chemistry?.profilesEnabled !== "boolean") return fail8("FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED");
    const resolveClub = createFc27ClubResolver(chemistry.links);
    const parameters = parametersOf(chemistry.parameters);
    const profiles = profilesOf(chemistry);
    const identities = chemistry.identities;
    const identityKeys = ["legendClubId", "legendLeagueId", "heroClubId", "hallOfFutClubId"];
    if (!resolveClub || !parameters || chemistry.maxChemistryPerPlayer !== 3 || !identityKeys.every((key) => positive4(identities?.[key])) || !Array.isArray(chemistry.superChemRarityIds) || chemistry.superChemRarityIds.length > 10001 || Array.from(chemistry.superChemRarityIds).some((value) => !integer6(value, 0, 1e4))) return fail8("FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE");
    if (!profiles) return fail8("FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED");
    const players = squad.filter((item) => item !== null);
    for (const item of players) {
      if (!item || item.type !== "player" || !integer6(item.rating, 1, 99) || !positive4(item.nationId) || !positive4(item.teamId) || !positive4(item.leagueId) || !Array.isArray(item.positions) || !item.positions.length || item.positions.length > 28 || Array.from(item.positions).some((value) => !integer6(value, 0, 27)) || ![0, 1].includes(item.rarity) || item.special !== false || item.evolution !== false || item.cosmetic !== false || item.concept !== false || item.academyEnrolled !== false) return fail8("FC27_PUZZLE_POSITION_OR_ITEM_FACTS_UNAVAILABLE");
      if ([identities.legendClubId, identities.heroClubId, identities.hallOfFutClubId].includes(item.teamId) || item.leagueId === identities.legendLeagueId || chemistry.superChemRarityIds.includes(item.rarity)) return fail8("FC27_PUZZLE_SPECIAL_CHEMISTRY_UNSUPPORTED");
      if (chemistry.profilesEnabled) {
        const profile = profiles.find((value) => value.applicableRarityIds.includes(item.rarity)) ?? profiles.find((value) => value.id === 1);
        if (!ordinaryProfile(profile)) return fail8("FC27_PUZZLE_CHEMISTRY_PROFILE_UNSUPPORTED");
      }
    }
    const fields3 = [
      { id: 1, value: (item) => item.nationId },
      { id: 2, value: (item) => item.leagueId },
      { id: 3, value: (item) => resolveClub(item.teamId) }
    ];
    const counts = fields3.map(() => /* @__PURE__ */ new Map());
    const eligible = squad.map((item, slot) => item !== null && item.positions.includes(formation.positions[slot]));
    squad.forEach((item, slot) => {
      if (eligible[slot]) fields3.forEach((field, index) => {
        const id4 = field.value(item);
        counts[index].set(id4, (counts[index].get(id4) ?? 0) + 1);
      });
    });
    const slotChemistry = squad.map((item, slot) => eligible[slot] ? Math.min(3, fields3.reduce((total, field, index) => {
      const count2 = counts[index].get(field.value(item)) ?? 0;
      return total + parameters.get(field.id).reduce((points, threshold) => points + (count2 >= threshold.requirement ? threshold.points : 0), 0);
    }, 0)) : 0);
    const ratingResult = evaluateFc27PuzzleRating({ squad: players, rating });
    return {
      status: "observed",
      reason: "FC27_PUZZLE_FACTS_EVALUATED",
      chemistry: slotChemistry.reduce((sum, value) => sum + value, 0),
      slotChemistry,
      teamRating: ratingResult.teamRating,
      ratingMode: ratingResult.ratingMode ?? null
    };
  }

  // src/adapters/ea/fc27-puzzle-read.js
  var blocked3 = (reason, extra = {}) => ({ status: "blocked", reason, liveExecutionEnabled: false, ...extra });
  var enumNames = {
    3: "PLAYER_QUALITY",
    4: "SAME_NATION_COUNT",
    5: "SAME_LEAGUE_COUNT",
    6: "SAME_CLUB_COUNT",
    7: "NATION_COUNT",
    8: "LEAGUE_COUNT",
    9: "CLUB_COUNT",
    10: "NATION_ID",
    11: "LEAGUE_ID",
    12: "CLUB_ID",
    17: "PLAYER_LEVEL",
    18: "PLAYER_RARITY",
    19: "TEAM_RATING",
    25: "PLAYER_RARITY_GROUP",
    26: "PLAYER_MIN_OVR",
    27: "PLAYER_EXACT_OVR",
    28: "PLAYER_MAX_OVR",
    35: "CHEMISTRY_POINTS"
  };
  function validateFc27PuzzleSelection(selected, freshItems, plannedItems) {
    const failed = () => ({ status: "blocked", reason: "FC27_EXACT_ITEMS_CHANGED" });
    const validId3 = (value) => Number.isSafeInteger(value) && value > 0;
    if (!Array.isArray(selected) || !Array.isArray(freshItems) || selected.length < 1 || selected.length > 11 || freshItems.length >= 250 || !Array.isArray(plannedItems) || plannedItems.length !== selected.length) return failed();
    const fields3 = [
      "id",
      "definitionId",
      "type",
      "pile",
      "rating",
      "rarity",
      "nationId",
      "leagueId",
      "teamId",
      "positions",
      "groups",
      "special",
      "evolution",
      "cosmetic",
      "concept",
      "academyEnrolled",
      "activeTrade",
      "limitedUse",
      "loans",
      "tradeable",
      "state",
      "locked",
      "activeSquad"
    ];
    const expected = new Map(plannedItems.map((item) => [item?.id, item]));
    const byId = new Map(freshItems.map((item) => [item?.id, item]));
    if (byId.size !== freshItems.length || expected.size !== selected.length || freshItems.some((item) => !validId3(item?.id) || !validId3(item?.definitionId) || !selected.some((ref) => ref.definitionId === item.definitionId))) return failed();
    const seenIds = /* @__PURE__ */ new Set();
    const seenDefinitions = /* @__PURE__ */ new Set();
    for (const plan of selected) {
      const current2 = byId.get(plan?.id);
      const before = expected.get(plan?.id);
      if (!validId3(plan?.id) || !validId3(plan?.definitionId) || plan.pile !== "club" || seenIds.has(plan.id) || seenDefinitions.has(plan.definitionId) || !current2 || !before || current2.id !== plan.id || current2.definitionId !== plan.definitionId || fields3.some((key) => !Object.hasOwn(current2, key) || !Object.hasOwn(before, key) || JSON.stringify(current2[key]) !== JSON.stringify(before[key])) || current2.type !== "player" || current2.pile !== "club" || current2.rating !== plan.rating || current2.special !== false || current2.evolution !== false || current2.cosmetic !== false || current2.concept !== false || current2.academyEnrolled !== false || current2.activeTrade !== false || current2.limitedUse !== false || current2.loans !== -1 || current2.tradeable !== false) {
        return failed();
      }
      seenIds.add(plan.id);
      seenDefinitions.add(plan.definitionId);
    }
    return {
      status: "verified",
      selectedCount: selected.length,
      presentCount: selected.length,
      uniqueDefinitions: seenDefinitions.size === selected.length
    };
  }
  function readFc27PuzzleClubLinks(root) {
    try {
      const map = ownData(ownData(ownData(root, "repositories"), "TeamConfig"), "teamLinks");
      const size = Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(map);
      if (size > 2e4) return null;
      const links = Array.from(Map.prototype.entries.call(map));
      if (links.length !== size || links.some((pair) => !pair.every((id4) => Number.isSafeInteger(id4) && id4 > 0))) return null;
      return Object.freeze({ schema: 1, complete: true, links: Object.freeze(links.map((pair) => Object.freeze(pair))) });
    } catch {
      return null;
    }
  }
  function values5(value, limit) {
    const collection = ownData(value, "_collection") ?? value;
    if (!collection || typeof collection !== "object") return null;
    const keys2 = Array.isArray(collection) ? Array.from({ length: collection.length }, (_, index) => String(index)) : Object.getOwnPropertyNames(collection);
    if (keys2.length > limit) return null;
    return keys2.map((key) => ownData(collection, key));
  }
  function method3(object, key) {
    for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return descriptor.value;
    }
    return void 0;
  }
  function readFc27PuzzleChemistry(root, clubLinks) {
    try {
      const configuration = ownData(ownData(root, "services"), "Configuration");
      const serverSettings = ownData(ownData(root, "repositories"), "ServerSettings");
      const settingsKeys = ownData(root, "UTServerSettingsRepository");
      const keys2 = ownData(settingsKeys, "KEY");
      const feature = method3(configuration, "checkFeatureEnabled");
      const stringSetting = method3(serverSettings, "getStringSettingByKey");
      const chemistryFeatureKey = ownData(keys2, "CHEMISTRY_PROFILES_ENABLED");
      const ratingFeatureKey = ownData(keys2, "SQUAD_RATING_FLOAT_CALCULATION_ENABLED");
      const superChemistryKey = ownData(keys2, "SUPER_CHEM_RARITY_IDS");
      if (typeof feature !== "function" || chemistryFeatureKey === void 0 || ratingFeatureKey === void 0 || typeof stringSetting !== "function" || superChemistryKey === void 0) return null;
      const profilesEnabled = feature.call(configuration, chemistryFeatureKey);
      const floatCalculationEnabled = feature.call(configuration, ratingFeatureKey);
      if (typeof profilesEnabled !== "boolean" || typeof floatCalculationEnabled !== "boolean") return null;
      const superChemRarityText = stringSetting.call(serverSettings, superChemistryKey);
      if (typeof superChemRarityText !== "string" || superChemRarityText.length > 60006 || superChemRarityText !== "" && !/^\d{1,5}(,\d{1,5})*$/.test(superChemRarityText)) return null;
      const superChemRarityIds = superChemRarityText === "" ? [] : superChemRarityText.split(",").map((value) => Number(value));
      if (superChemRarityIds.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 1e4) || new Set(superChemRarityIds).size !== superChemRarityIds.length) return null;
      const itemEntity = ownData(root, "UTItemEntity");
      const identities = {
        legendClubId: ownData(itemEntity, "LEGENDS_CLUB_ID"),
        legendLeagueId: ownData(itemEntity, "LEGENDS_LEAGUE_ID"),
        heroClubId: ownData(itemEntity, "LEAGUE_HERO_CLUB_ID"),
        hallOfFutClubId: ownData(itemEntity, "HALL_OF_FUT_CLUB_ID")
      };
      if (Object.values(identities).some((value) => !Number.isSafeInteger(value) || value <= 0)) return null;
      const chemistry = ownData(ownData(root, "repositories"), "Chemistry");
      const rawParameters = values5(ownData(chemistry, "parameters"), 8);
      const parameters = rawParameters?.map((parameter) => ({
        id: ownData(parameter, "id"),
        thresholds: values5(ownData(parameter, "thresholds"), 8)?.map((threshold) => ({
          requirement: ownData(threshold, "requirement"),
          points: ownData(threshold, "points")
        }))
      }));
      const rawProfiles = values5(ownData(chemistry, "profiles"), 128);
      const base = rawProfiles?.find((profile) => ownData(profile, "id") === 1);
      const rules = values5(ownData(base, "rules"), 8)?.map((rule) => ({
        parameterId: ownData(rule, "parameterId"),
        calculationType: ownData(rule, "calculationType"),
        contribution: ownData(rule, "contribution")
      }));
      if (!Array.isArray(parameters) || parameters.length !== 3 || parameters.some((parameter) => !Array.isArray(parameter.thresholds)) || !base || ownData(base, "maxChem") !== false || ownData(base, "baseOverride") !== false || !Array.isArray(rules) || rules.length !== 3 || rules.some((rule) => rule.calculationType !== 1 || rule.contribution !== 1 || ![1, 2, 3].includes(rule.parameterId)) || new Set(rules.map((rule) => rule.parameterId)).size !== 3) return null;
      const profiles = rawProfiles?.map((profile) => ({
        id: ownData(profile, "id"),
        maxChem: ownData(profile, "maxChem"),
        applicableRarityIds: values5(ownData(profile, "applicableRarityIds"), 10001),
        rules: values5(ownData(profile, "rules"), 8)?.map((rule) => ({
          parameterId: ownData(rule, "parameterId"),
          calculationType: ownData(rule, "calculationType"),
          contribution: ownData(rule, "contribution")
        }))
      }));
      if (profilesEnabled && (!Array.isArray(profiles) || profiles.some((profile) => !Array.isArray(profile.applicableRarityIds) || !Array.isArray(profile.rules)))) return null;
      return Object.freeze({
        parameters: Object.freeze(parameters.map((parameter) => Object.freeze({
          ...parameter,
          thresholds: Object.freeze(parameter.thresholds.map((value) => Object.freeze(value)))
        }))),
        links: clubLinks,
        maxChemistryPerPlayer: 3,
        profilesEnabled,
        profiles: profilesEnabled ? Object.freeze({ complete: true, entries: Object.freeze(profiles.map((profile) => Object.freeze(profile))) }) : null,
        identities: Object.freeze(identities),
        superChemRarityIds: Object.freeze(superChemRarityIds),
        rating: Object.freeze({ floatCalculationEnabled })
      });
    } catch {
      return null;
    }
  }
  async function inspectFc27PuzzlePlan(root, {
    setId,
    challengeId,
    maxRating = DEFAULT_PUZZLE_MAX_RATING,
    catalog: suppliedCatalog = null,
    layout: suppliedLayout = null
  } = {}, onInputs = null) {
    try {
      const context = readFc27Context(root);
      const policy = readFc27PuzzlePolicy(root, maxRating);
      const signature2 = JSON.stringify({ context, policy });
      const unchanged = () => signature2 === JSON.stringify({ context: readFc27Context(root), policy: readFc27PuzzlePolicy(root, maxRating) });
      if (!Number.isSafeInteger(challengeId) || challengeId <= 0 || challengeId >= 1e9) return blocked3("FC27_CHALLENGE_UNVERIFIED");
      const started = Date.now();
      const catalog = suppliedCatalog ?? await inspectFc27ChallengeCatalog(root, { setId });
      if (catalog.status !== "observed") return catalog;
      const matches = catalog.challenges.filter((challenge2) => challenge2.id === challengeId && challenge2.status === "IN_PROGRESS");
      if (matches.length !== 1 || matches[0].eligibilityOperation !== "AND") return blocked3("FC27_IN_PROGRESS_PUZZLE_REQUIRED");
      const observed = matches[0];
      const keys2 = ownData(root, "SBCEligibilityKey");
      const scopes = ownData(root, "SBCEligibilityScope");
      const quality2 = ownData(root, "SBCEligibilityQualityType");
      if (Object.entries({ GREATER: 0, LOWER: 1, EXACT: 2 }).some(([key, value]) => ownData(scopes, key) !== value) || Object.entries({ BRONZE: 1, SILVER: 2, GOLD: 3 }).some(([key, value]) => ownData(quality2, key) !== value) || observed.requirements.some((rule) => rule.pairs.some((pair) => enumNames[pair.key] && ownData(keys2, enumNames[pair.key]) !== pair.key))) {
        return blocked3("FC27_PUZZLE_ENUM_CHANGED");
      }
      if (!suppliedLayout) await new Promise((resolve) => setTimeout(resolve, Math.max(0, 800 - (Date.now() - started))));
      if (!unchanged()) return blocked3("FC27_RUNNER_INPUTS_CHANGED");
      const layout = suppliedLayout ?? await inspectInProgressSquad({ setId, challengeId, includeFormation: true }, root, observed);
      if (layout.status !== "observed") return layout;
      if (layout.setId !== setId || layout.challengeId !== challengeId) return blocked3("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      if (!unchanged()) return blocked3("FC27_RUNNER_INPUTS_CHANGED");
      if (layout.customBrickIndices.length) return blocked3("FC27_PUZZLE_CUSTOM_BRICKS_UNVERIFIED");
      const cached = readFc27CachedClub(root);
      const inventory = {
        schema: 1,
        context,
        kind: "normalized-inventory",
        status: "provisional",
        scope: "club-only",
        complete: false,
        items: cached.items.map((item) => ({ ...item, protected: item.special !== false || item.evolution !== false || item.cosmetic !== false }))
      };
      const challenge = {
        schema: 1,
        context,
        mechanism: "traditional-puzzle",
        requirementsOperation: "AND",
        completed: false,
        setId,
        id: challengeId,
        slotCount: layout.slotCount,
        formation: layout.formation,
        brickIndices: layout.simpleBrickIndices,
        rawRequirements: observed.requirements
      };
      const parsed = parseFc27SbcRequirements(observed.requirements, layout.requiredPlayerCount);
      if (parsed.status === "unsupported") return blocked3("FC27_REQUIREMENT_UNSUPPORTED", { unsupported: parsed.unsupported });
      if (parsed.status !== "observed") return blocked3(parsed.reason);
      const clubLinks = readFc27PuzzleClubLinks(root);
      const needsTeamFacts = parsed.rules.some((rule) => [
        "min-team-rating",
        "max-team-rating",
        "exact-team-rating",
        "min-chemistry",
        "max-chemistry",
        "exact-chemistry"
      ].includes(rule.kind));
      const chemistry = needsTeamFacts ? readFc27PuzzleChemistry(root, clubLinks) : null;
      if (needsTeamFacts && !chemistry) return blocked3("FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE");
      const evaluateSquad = needsTeamFacts ? (squad) => evaluateFc27PuzzleSquad({
        squad,
        formation: layout.formation,
        chemistry,
        rating: chemistry.rating
      }) : void 0;
      const boundSquad = needsTeamFacts ? (squad) => boundFc27PuzzleChemistry({
        squad,
        formation: layout.formation,
        chemistry,
        rating: chemistry.rating
      }) : void 0;
      const inputs = {
        context,
        challenge,
        inventory,
        policy,
        clubLinks,
        chemistry,
        squadEmpty: layout.squadEmpty === true,
        evaluateSquad,
        boundSquad
      };
      const plan = typeof onInputs === "function" ? await onInputs(inputs) : previewFc27PuzzleSquad(inputs);
      if (!unchanged()) return blocked3("FC27_RUNNER_INPUTS_CHANGED");
      return {
        status: plan.status,
        reason: plan.reason,
        liveExecutionEnabled: false,
        setId,
        challengeId,
        layout,
        rules: parsed.rules,
        unsupported: parsed.unsupported,
        inventory: {
          cachedPlayers: cached.items.length,
          status: "provisional",
          complete: false,
          scope: "club-only"
        },
        policy: {
          maxRating: policy.maxRating,
          materialComposition: puzzleMaterialRules(parsed.rules, layout.requiredPlayerCount).map((rule) => ({ quality: rule.qualities[0], count: rule.count }))
        },
        linkedClubCount: clubLinks?.links.length ?? null,
        configuration: chemistry ? {
          profilesEnabled: chemistry.profilesEnabled,
          floatCalculationEnabled: chemistry.rating.floatCalculationEnabled,
          profileCount: chemistry.profiles?.entries.length ?? 0,
          superChemRarityCount: chemistry.superChemRarityIds.length
        } : null,
        plan: {
          required: layout.requiredPlayerCount,
          safeCandidates: plan.safeCandidates ?? null,
          excluded: plan.excluded ?? null,
          excludedByReason: plan.excludedByReason ?? null,
          selectedCount: plan.selected?.length ?? 0,
          deficits: plan.deficits ?? [],
          nodes: plan.nodes ?? 0,
          search: plan.search ?? null,
          teamFacts: plan.teamFacts ?? null,
          evaluatorReason: plan.evaluatorReason ?? null,
          ratings: (plan.selected ?? []).map((item) => item.rating),
          slots: (plan.selected ?? []).map((item) => item.slot),
          exactValidation: plan.exactValidation ?? null,
          fillPreflight: plan.fillPreflight ?? null
        },
        pending: ["EA_TEAM_FACTS_DIFFERENTIAL", "EXACT_ITEM_VALIDATION", "PUZZLE_FILL_TRANSACTION"],
        ...plan.marketRoute ? { marketRoute: plan.marketRoute } : {},
        ...plan.purchaseSuggestion ? { purchaseSuggestion: plan.purchaseSuggestion } : {}
      };
    } catch (error2) {
      return blocked3(/^FC27_[A-Z0-9_]+$/.test(error2?.message) ? error2.message : "FC27_PUZZLE_INSPECTION_UNAVAILABLE");
    }
  }

  // src/fc27/puzzle-fill-plan.js
  var itemFields = [
    "id",
    "definitionId",
    "type",
    "pile",
    "rating",
    "rarity",
    "nationId",
    "leagueId",
    "teamId",
    "positions",
    "groups",
    "special",
    "evolution",
    "cosmetic",
    "concept",
    "academyEnrolled",
    "activeTrade",
    "limitedUse",
    "loans",
    "tradeable",
    "state",
    "locked",
    "activeSquad",
    "protected"
  ];
  var fail9 = (reason) => ({ status: "blocked", reason, executable: false });
  var same4 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var positive5 = (value) => Number.isSafeInteger(value) && value > 0;
  var freeze3 = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze3);
      Object.freeze(value);
    }
    return value;
  };
  var scopeOf = (input) => ({
    context: input.context,
    challenge: input.challenge,
    policy: input.policy,
    clubLinks: input.clubLinks,
    chemistry: input.chemistry
  });
  var project = (item) => Object.fromEntries(itemFields.map((key) => [key, item?.[key]]));
  function assess(scope2, selected, items) {
    const { context, challenge, policy, clubLinks, chemistry } = scope2;
    if (challenge?.mechanism !== "traditional-puzzle" || challenge.slotCount !== 11 || !Array.isArray(challenge.brickIndices) || challenge.brickIndices.length >= 11 || new Set(challenge.brickIndices).size !== challenge.brickIndices.length || challenge.brickIndices.some((index) => !Number.isInteger(index) || index < 0 || index > 10) || !positive5(challenge.formation?.id) || challenge.formation.positions?.length !== 11 || Array.from(challenge.formation.positions).some((value) => !Number.isInteger(value) || value < 0 || value > 27)) {
      return fail9("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
    }
    const required2 = 11 - challenge.brickIndices.length;
    if (!policy || policy.onlyUntradeable !== true || !positive5(policy.maxRating) || policy.maxRating > 99) {
      return fail9("FC27_PUZZLE_FILL_POLICY_UNVERIFIED");
    }
    if (!Array.isArray(selected) || selected.length !== required2 || !Array.isArray(items) || items.length !== required2 || new Set(selected.map((ref) => ref?.slot)).size !== required2 || selected.some((ref) => !ref || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || challenge.brickIndices.includes(ref.slot) || !positive5(ref.id) || !positive5(ref.definitionId) || ref.pile !== "club" || ref.catalogRef !== void 0) || new Set(selected.map((ref) => ref.id)).size !== required2 || new Set(selected.map((ref) => ref.definitionId)).size !== required2 || new Set(items.map((item) => item?.id)).size !== required2) return fail9("FC27_PUZZLE_FILL_SELECTION_CHANGED");
    const byId = new Map(items.map((item) => [item?.id, item]));
    const squad = Array(11).fill(null);
    for (const ref of selected) {
      const item = byId.get(ref.id);
      if (!item || itemFields.some((key) => item[key] === void 0) || item.definitionId !== ref.definitionId || item.pile !== ref.pile || item.rating !== ref.rating || item.state !== "free") {
        return fail9("FC27_PUZZLE_FILL_SELECTION_CHANGED");
      }
      squad[ref.slot] = { ...project(item), slot: ref.slot };
    }
    const pool = collectSafeTraditionalCandidates({
      context,
      policy,
      challenge: { ...challenge, mechanism: "traditional", requirements: [{ kind: "player-count", count: required2 }] },
      inventory: { schema: 1, context, kind: "normalized-inventory", status: "provisional", items: squad.filter(Boolean) }
    });
    if (pool.status !== "candidates" || pool.candidates.length !== required2) return fail9("FC27_PUZZLE_FILL_MATERIAL_PROTECTED");
    const parsed = parseFc27SbcRequirements(challenge.rawRequirements, required2);
    if (parsed.status !== "observed") return fail9(parsed.reason);
    const materialRules = puzzleMaterialRules(parsed.rules, required2);
    if (materialRules.length && matchFc27SbcRequirements({ requirements: materialRules, squad: squad.filter(Boolean) }).status !== "satisfied") {
      return fail9("FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED");
    }
    const needsFacts = parsed.rules.some((rule) => [
      "min-team-rating",
      "max-team-rating",
      "exact-team-rating",
      "min-chemistry",
      "max-chemistry",
      "exact-chemistry"
    ].includes(rule.kind));
    const facts2 = needsFacts ? evaluateFc27PuzzleSquad({ squad, formation: challenge.formation, chemistry, rating: chemistry?.rating }) : { status: "observed", teamRating: null, chemistry: null };
    if (needsFacts && (facts2.status !== "observed" || !Number.isInteger(facts2.teamRating) || facts2.teamRating < 0 || !Number.isInteger(facts2.chemistry) || facts2.chemistry < 0 || facts2.chemistry > 33)) {
      return fail9("FC27_PUZZLE_FILL_FACTS_UNAVAILABLE");
    }
    const validation = matchFc27SbcRequirements({
      requirements: parsed.rules,
      squad: squad.filter(Boolean),
      clubLinks,
      chemistry: facts2.chemistry,
      teamRating: facts2.teamRating
    });
    if (validation.status !== "satisfied" || validation.satisfied !== true) return fail9(validation.reason);
    return {
      status: "verified",
      reason: "FC27_PUZZLE_FILL_PREFLIGHT_VERIFIED",
      executable: false,
      selectedCount: required2,
      teamFacts: { teamRating: facts2.teamRating, chemistry: facts2.chemistry },
      requirementCount: parsed.rules.length
    };
  }
  function prepareFc27PuzzleFillPlan(input, preview) {
    try {
      if (preview?.status !== "preview" || preview.setId !== input?.challenge?.setId || preview.challengeId !== input?.challenge?.id || preview.required !== input?.challenge?.slotCount - input?.challenge?.brickIndices?.length || !Array.isArray(input?.inventory?.items) || !same4(input.inventory.context, input.context) || input.inventory.schema !== 1 || input.inventory.kind !== "normalized-inventory" || !["provisional", "ready"].includes(input.inventory.status)) return fail9("FC27_PUZZLE_FILL_PLAN_UNVERIFIED");
      const selected = structuredClone(preview.selected);
      const scope2 = structuredClone(scopeOf(input));
      const items = selected.map((ref) => {
        const matches = input.inventory.items.filter((item) => item.id === ref.id);
        return matches.length === 1 ? project(matches[0]) : null;
      });
      const validation = assess(scope2, selected, items);
      if (validation.status !== "verified") return validation;
      return freeze3({
        status: "prepared",
        kind: "puzzle-fill",
        schema: 1,
        executable: false,
        ...scope2,
        selected,
        items: structuredClone(items),
        validation
      });
    } catch {
      return fail9("FC27_PUZZLE_FILL_PLAN_UNVERIFIED");
    }
  }
  function validateFc27PuzzleFillPlan(plan, current2, freshItems, { saved = false } = {}) {
    try {
      if (plan?.status !== "prepared" || plan.kind !== "puzzle-fill" || plan.schema !== 1 || !same4(scopeOf(plan), scopeOf(current2))) return fail9("FC27_PUZZLE_FILL_INPUTS_CHANGED");
      if (!Array.isArray(freshItems) || freshItems.length < plan.selected.length || freshItems.length >= 250 || new Set(freshItems.map((item) => item?.id)).size !== freshItems.length || freshItems.some((item) => !positive5(item?.id) || !positive5(item?.definitionId) || !plan.selected.some((ref) => ref.definitionId === item.definitionId)) || saved && freshItems.length !== plan.selected.length) return fail9("FC27_EXACT_ITEMS_CHANGED");
      const currentById = new Map(freshItems.map((item) => [item.id, item]));
      const expected = new Map(plan.items.map((item) => [item.id, item]));
      const items = [];
      for (const ref of plan.selected) {
        const item = currentById.get(ref.id);
        const normalized = item && { ...item, protected: item.protected ?? expected.get(ref.id)?.protected };
        if (!normalized || !same4(project(normalized), expected.get(ref.id)) || saved && item.slot !== ref.slot) return fail9("FC27_EXACT_ITEMS_CHANGED");
        items.push(normalized);
      }
      return assess(scopeOf(current2), plan.selected, items);
    } catch {
      return fail9("FC27_PUZZLE_FILL_PLAN_UNVERIFIED");
    }
  }

  // src/adapters/ea/fc27-puzzle-verify.js
  async function inspectFc27VerifiedPuzzlePlan(root, options = {}, onVerifiedInputs = null) {
    const report = await inspectFc27PuzzlePlan(root, options, async (inputs) => {
      const plan = previewFc27PuzzleSquad(inputs);
      if (plan.status !== "preview") return plan;
      const stop6 = (reason) => ({
        ...plan,
        status: "blocked",
        reason,
        selected: [],
        exactValidation: { status: "blocked", reason }
      });
      try {
        const selected = plan.selected;
        const plannedItems = structuredClone(selected.map((ref) => inputs.inventory.items.find((item) => item.id === ref.id && item.definitionId === ref.definitionId)));
        if (selected.some((item) => item.pile !== "club") || plannedItems.some((item) => !item)) {
          return stop6("FC27_EXACT_ITEMS_CHANGED");
        }
        const inputScope = JSON.stringify({ context: inputs.context, policy: inputs.policy });
        const signature2 = () => {
          const context = readFc27Context(root);
          const policy = readFc27PuzzlePolicy(root, options.maxRating ?? 74);
          if (inputScope !== JSON.stringify({ context, policy })) throw new Error("FC27_RUNNER_INPUTS_CHANGED");
          const cached = readFc27CachedClub(root);
          const links = readFc27PuzzleClubLinks(root);
          return JSON.stringify({
            context,
            policy,
            links,
            chemistry: readFc27PuzzleChemistry(root, links),
            selected: selected.map((ref) => cached.items.find((item) => item.id === ref.id && item.definitionId === ref.definitionId))
          });
        };
        const before = signature2();
        const transport = await createFc27ClubReadTransport(root);
        if (signature2() !== before) return stop6("FC27_RUNNER_INPUTS_CHANGED");
        const fresh = await transport.readPage({
          start: 0,
          count: 250,
          definitionIds: selected.map((item) => item.definitionId)
        });
        if (signature2() !== before) return stop6("FC27_RUNNER_INPUTS_CHANGED");
        const exactValidation = validateFc27PuzzleSelection(selected, fresh, plannedItems);
        if (exactValidation.status !== "verified") return stop6(exactValidation.reason);
        const fillPlan = prepareFc27PuzzleFillPlan(inputs, plan);
        const fillPreflight = fillPlan.status === "prepared" ? validateFc27PuzzleFillPlan(fillPlan, inputs, fresh) : fillPlan;
        if (typeof onVerifiedInputs === "function") {
          const fields3 = [
            "type",
            "rating",
            "rarity",
            "nationId",
            "leagueId",
            "teamId",
            "positions",
            "groups",
            "special",
            "evolution",
            "cosmetic",
            "concept",
            "academyEnrolled"
          ];
          const squad = Array(11).fill(null);
          selected.forEach((ref, index) => {
            if (!Number.isSafeInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || squad[ref.slot]) {
              throw new Error("FC27_PUZZLE_SLOT_UNVERIFIED");
            }
            squad[ref.slot] = Object.fromEntries(fields3.map((key) => [key, plannedItems[index][key]]));
          });
          await onVerifiedInputs(structuredClone({
            squad,
            formation: inputs.challenge.formation,
            chemistry: readFc27PuzzleChemistry(root, readFc27PuzzleClubLinks(root)),
            clubLinks: readFc27PuzzleClubLinks(root),
            requirements: inputs.challenge.rawRequirements
          }), {
            inputs,
            preview: plan,
            fillPlan,
            fresh: structuredClone(fresh)
          });
          if (signature2() !== before) return stop6("FC27_RUNNER_INPUTS_CHANGED");
        }
        return { ...plan, fillPreflight, exactValidation: {
          ...exactValidation,
          observedAt: Date.now(),
          scope: "selected-club-items-only",
          reusableForExecution: false
        } };
      } catch (error2) {
        return stop6(/^FC27_[A-Z0-9_]+$/.test(error2?.message ?? "") ? error2.message : "FC27_PUZZLE_EXACT_CHECK_UNAVAILABLE");
      }
    });
    return {
      ...report,
      executable: false,
      liveExecutionEnabled: false,
      pending: (report.pending ?? []).filter((reason) => reason !== "EXACT_ITEM_VALIDATION" || report.plan?.exactValidation?.status !== "verified")
    };
  }

  // src/fc27/puzzle-fill-journal.js
  var keyOf = (context) => `fcat-fc27-puzzle-fill:${contextKey(createSeasonContext(context), "puzzle-fill")}`;
  var targetKeyOf = (base, setId, challengeId) => `${base}:${setId}:${challengeId}`;
  var indexKeyOf = (base) => `${base}:index`;
  var positive6 = (value) => Number.isSafeInteger(value) && value > 0;
  var same5 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var fail10 = (reason) => {
    throw new Error(reason);
  };
  function normalize(scope2, input) {
    const bricks = input?.schema === 2 ? input.brickIndices : [];
    const required2 = Array.isArray(bricks) ? 11 - bricks.length : 0;
    if (!input || ![1, 2].includes(input.schema) || input.kind !== "puzzle-fill" || required2 < 1 || required2 > 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index > 10) || input.scope !== scope2 || typeof input.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId) || !positive6(input.setId) || !positive6(input.challengeId) || !["save-pending", "saved"].includes(input.phase) || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0 || input.submitted !== false || !Array.isArray(input.itemRefs) || input.itemRefs.length !== required2 || input.itemRefs.some((ref) => !ref || !positive6(ref.id) || !positive6(ref.definitionId) || ref.pile !== "club" || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || bricks.includes(ref.slot)) || new Set(input.itemRefs.map((ref) => ref.id)).size !== required2 || new Set(input.itemRefs.map((ref) => ref.definitionId)).size !== required2 || new Set(input.itemRefs.map((ref) => ref.slot)).size !== required2) {
      return fail10("FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED");
    }
    if (input.account !== void 0 && (!input.account || typeof input.account !== "object" || typeof input.account.accountScope !== "string" || typeof input.account.platform !== "string" || input.account.accountScope.length > 200 || input.account.platform.length > 80)) {
      return fail10("FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED");
    }
    return structuredClone(input);
  }
  function createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue, lock, lockScope = null } = {}) {
    if (typeof gmGetValue !== "function" || typeof gmSetValue !== "function" || typeof lock?.run !== "function" || typeof lock?.hasExclusiveAccess !== "function" || lockScope !== traditionalJournalScope(context)) {
      return fail10("FC27_PUZZLE_FILL_STORAGE_UNAVAILABLE");
    }
    const storageKey = keyOf(context);
    const indexKey = indexKeyOf(storageKey);
    const accountContext = createSeasonContext(context);
    const sameAccount = (record) => !record.account || record.account.accountScope === accountContext.accountScope && record.account.platform === accountContext.platform;
    const scope2 = lockScope;
    const nativeScope = scope2;
    const exclusive = (requestedScope, task) => {
      if (requestedScope !== scope2 || typeof task !== "function") return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      return lock.run(nativeScope, task);
    };
    const held = (requested) => requested === scope2 && lock.hasExclusiveAccess(nativeScope) === true;
    const journal = Object.freeze({
      async read(requestedScope, target = null) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        const key = target && positive6(target.setId) && positive6(target.challengeId) ? targetKeyOf(storageKey, target.setId, target.challengeId) : storageKey;
        let raw;
        try {
          raw = await gmGetValue(key, null);
          if (raw === null && target) raw = await gmGetValue(storageKey, null);
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED");
        }
        if (raw === null && !target) {
          let targets = [];
          try {
            targets = await gmGetValue(indexKey, []);
          } catch {
            return fail10("FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED");
          }
          if (Array.isArray(targets) && targets.length) {
            const records = [];
            for (const entry of targets) {
              if (!positive6(entry?.setId) || !positive6(entry?.challengeId)) continue;
              const candidate = await gmGetValue(targetKeyOf(storageKey, entry.setId, entry.challengeId), null);
              if (candidate !== null) {
                const record2 = normalize(scope2, candidate);
                if (!sameAccount(record2)) return fail10("FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT");
                records.push(record2);
              }
            }
            records.sort((a, b) => b.updatedAt - a.updatedAt);
            return records[0] ?? null;
          }
        }
        if (raw === null) return null;
        const record = normalize(scope2, raw);
        if (record.account && (record.account.accountScope !== accountContext.accountScope || record.account.platform !== accountContext.platform)) return fail10("FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT");
        if (target && (record.setId !== target.setId || record.challengeId !== target.challengeId)) return null;
        return record;
      },
      async list(requestedScope) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        let targets;
        try {
          targets = await gmGetValue(indexKey, []);
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED");
        }
        if (!Array.isArray(targets)) return fail10("FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED");
        const result = [];
        for (const target of targets) {
          if (!positive6(target?.setId) || !positive6(target?.challengeId)) continue;
          const record = await journal.read(scope2, target);
          if (record) result.push(record);
        }
        const legacy = await journal.read(scope2);
        if (legacy && !result.some((record) => record.setId === legacy.setId && record.challengeId === legacy.challengeId)) result.push(legacy);
        return result;
      },
      async write(requestedScope, value) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        const next = normalize(scope2, value);
        const key = targetKeyOf(storageKey, next.setId, next.challengeId);
        const previous = await journal.read(scope2, { setId: next.setId, challengeId: next.challengeId });
        if (previous && next.updatedAt < previous.updatedAt) return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        if (!previous && next.phase !== "save-pending") return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        if (!sameAccount(next)) return fail10("FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT");
        const newOperation = previous?.phase === "saved" && next.phase === "save-pending" && previous.operationId !== next.operationId;
        if (previous && !newOperation && (previous.operationId !== next.operationId || previous.schema !== next.schema || !same5(previous.brickIndices, next.brickIndices) || next.updatedAt < previous.updatedAt || previous.setId !== next.setId || previous.challengeId !== next.challengeId || !same5(previous.itemRefs, next.itemRefs) || previous.phase === "saved" && next.phase !== "saved" || previous.phase === "save-pending" && !["save-pending", "saved"].includes(next.phase))) {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        }
        try {
          await gmSetValue(key, next);
          const targets = await gmGetValue(indexKey, []);
          const nextTargets = Array.isArray(targets) ? targets.filter((target) => target?.setId !== next.setId || target?.challengeId !== next.challengeId) : [];
          nextTargets.push({ setId: next.setId, challengeId: next.challengeId });
          await gmSetValue(indexKey, nextTargets);
          if (!same5(await journal.read(scope2, { setId: next.setId, challengeId: next.challengeId }), next)) return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
          const legacy = await gmGetValue(storageKey, null);
          if (legacy && legacy.setId === next.setId && legacy.challengeId === next.challengeId) await gmSetValue(storageKey, null);
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        }
      },
      async clear(requestedScope, expected) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        normalize(scope2, expected);
        const target = { setId: expected.setId, challengeId: expected.challengeId };
        const key = targetKeyOf(storageKey, target.setId, target.challengeId);
        const current2 = await journal.read(scope2, target);
        if (!same5(current2, expected)) return fail10("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
        try {
          await gmSetValue(key, null);
          const legacy = await gmGetValue(storageKey, null);
          if (same5(legacy, expected)) await gmSetValue(storageKey, null);
          const targets = await gmGetValue(indexKey, []);
          await gmSetValue(indexKey, Array.isArray(targets) ? targets.filter((item) => item?.setId !== target.setId || item?.challengeId !== target.challengeId) : []);
          if (await journal.read(scope2, target) !== null) return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        }
      }
    });
    return Object.freeze({ scope: scope2, nativeScope, exclusive, journal, inspect: () => ({ active: held(scope2) }) });
  }

  // src/fc27/puzzle-fill-transaction.js
  var blocked4 = (reason) => ({ status: "blocked", reason, saved: false, submitted: false });
  var same6 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var sameApproval = (actual, expected) => actual && typeof actual === "object" && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
  var safeReason2 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message ?? "") ? error2.message : "FC27_PUZZLE_FILL_UNCONFIRMED";
  var fail11 = (reason) => {
    throw new Error(reason);
  };
  function createFc27PuzzleFillTransaction({
    enabled = false,
    adapter,
    journal,
    exclusive,
    checkOtherTransactions,
    now = Date.now,
    createOperationId,
    shouldStop = () => false
  } = {}) {
    const plans = /* @__PURE__ */ new WeakMap();
    const permits = /* @__PURE__ */ new WeakMap();
    let busy = false;
    const time = () => {
      const value = now();
      if (!Number.isSafeInteger(value) || value < 0) fail11("FC27_PUZZLE_CLOCK_UNVERIFIED");
      return value;
    };
    const alive = (created) => {
      const age = time() - created;
      if (age < 0 || age > 6e4) fail11("FC27_PUZZLE_FILL_EXPIRED");
      if (shouldStop() !== false) fail11("FC27_PUZZLE_FILL_STOPPED");
    };
    const evidence = (reply, plan) => {
      const age = time() - reply?.observedAt;
      if (!reply || reply.fresh !== true || !Number.isSafeInteger(reply.observedAt) || age < 0 || age > 15e3 || !same6(reply.context, plan.context) || reply.setId !== plan.challenge.setId || reply.challengeId !== plan.challenge.id) fail11("FC27_PUZZLE_FILL_EVIDENCE_UNVERIFIED");
    };
    const validate = (result) => {
      if (result.status !== "verified") fail11(result.reason);
      return result;
    };
    return Object.freeze({
      prepare(input, preview) {
        const plan = prepareFc27PuzzleFillPlan(input, preview);
        if (plan.status === "prepared") plans.set(plan, { created: time(), used: false });
        return plan;
      },
      approve(plan, approval) {
        if (enabled !== true) return blocked4("FC27_PUZZLE_FILL_DISABLED");
        const metadata = plans.get(plan);
        if (!metadata || metadata.used || !sameApproval(approval, {
          approved: true,
          action: "fill-only",
          setId: plan.challenge.setId,
          challengeId: plan.challenge.id,
          count: 1,
          maxPlayers: plan.selected.length,
          maxRating: plan.policy.maxRating
        })) return blocked4("FC27_PUZZLE_FILL_APPROVAL_INVALID");
        try {
          alive(metadata.created);
        } catch (error2) {
          return blocked4(safeReason2(error2));
        }
        metadata.used = true;
        const permit = Object.freeze({});
        permits.set(permit, { plan, created: metadata.created });
        return { status: "approved", permit };
      },
      async execute(permit) {
        if (enabled !== true) return blocked4("FC27_PUZZLE_FILL_DISABLED");
        const approved = permits.get(permit);
        permits.delete(permit);
        if (!approved) return blocked4("FC27_PUZZLE_FILL_APPROVAL_INVALID");
        if (busy) return blocked4("FC27_PUZZLE_FILL_BUSY");
        busy = true;
        let dispatched = false;
        let boundary = false;
        try {
          const { plan, created } = approved;
          alive(created);
          if (typeof exclusive !== "function" || typeof journal?.read !== "function" || typeof journal?.write !== "function" || typeof checkOtherTransactions !== "function" || typeof createOperationId !== "function" || ["readInputs", "validateItems", "save", "readSavedSquad", "syncSavedSquad", "assertCurrent"].some((key) => typeof adapter?.[key] !== "function")) {
            return blocked4("FC27_PUZZLE_FILL_ADAPTER_UNAVAILABLE");
          }
          const scope2 = traditionalJournalScope(plan.context);
          let entered = false;
          return await exclusive(scope2, async () => {
            if (entered) fail11("FC27_EXCLUSIVE_ACCESS_LOST");
            entered = true;
            alive(created);
            if (await checkOtherTransactions(scope2) !== true) fail11("FC27_RECOVERY_REQUIRED");
            const target = { setId: plan.challenge.setId, challengeId: plan.challenge.id };
            const previous = await journal.read(scope2, target);
            if (previous && previous.phase !== "saved") fail11("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            const operationId = createOperationId();
            if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) fail11("FC27_PUZZLE_OPERATION_UNVERIFIED");
            const record = {
              schema: 2,
              kind: "puzzle-fill",
              scope: scope2,
              operationId,
              account: { accountScope: plan.context.accountScope, platform: plan.context.platform },
              brickIndices: [...plan.challenge.brickIndices],
              setId: plan.challenge.setId,
              challengeId: plan.challenge.id,
              itemRefs: plan.selected.map(({ id: id4, definitionId, pile, slot }) => ({ id: id4, definitionId, pile, slot })),
              phase: "save-pending",
              submitted: false,
              updatedAt: time()
            };
            let current2;
            let exact;
            await submitSbcAttempt({
              prepareOnly: true,
              challengeProvider: async () => ({ set: { id: plan.challenge.setId }, challenge: { id: plan.challenge.id } }),
              squadProvider: async () => ({ ok: true, players: plan.items, itemRefs: [] }),
              preSaveValidators: [async () => {
                current2 = await adapter.readInputs(plan);
                evidence(current2, plan);
                if (current2.squadEmpty !== true) fail11("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
                exact = await adapter.validateItems(plan);
                evidence(exact, plan);
                validate(validateFc27PuzzleFillPlan(plan, current2.input, exact.items));
                const latest = await adapter.readInputs(plan);
                evidence(latest, plan);
                if (latest.squadEmpty !== true) fail11("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
                validate(validateFc27PuzzleFillPlan(plan, latest.input, exact.items));
                current2 = latest;
                evidence(exact, plan);
                alive(created);
              }],
              saveSquad: async () => {
                alive(created);
                const receipt = await adapter.save(plan, async () => {
                  if (boundary) fail11("FC27_PUZZLE_SAVE_UNCONFIRMED");
                  alive(created);
                  evidence(exact, plan);
                  evidence(current2, plan);
                  if (adapter.assertCurrent(plan) !== true) fail11("FC27_PUZZLE_FILL_INPUTS_CHANGED");
                  boundary = true;
                  await journal.write(scope2, structuredClone(record));
                  if (!same6(await journal.read(scope2, target), record)) fail11("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
                  alive(created);
                  evidence(exact, plan);
                  evidence(current2, plan);
                  if (adapter.assertCurrent(plan) !== true) fail11("FC27_PUZZLE_FILL_INPUTS_CHANGED");
                  dispatched = true;
                });
                if (!dispatched || receipt?.status !== "confirmed" || receipt.setId !== record.setId || receipt.challengeId !== record.challengeId) {
                  fail11("FC27_PUZZLE_SAVE_UNCONFIRMED");
                }
              },
              readSavedPlayers: async () => {
                const saved = await adapter.readSavedSquad(plan);
                evidence(saved, plan);
                current2 = await adapter.readInputs(plan);
                evidence(current2, plan);
                validate(validateFc27PuzzleFillPlan(plan, current2.input, saved.items, { saved: true }));
                if ((await adapter.syncSavedSquad(plan))?.status !== "synchronized") fail11("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
                return [];
              },
              postSaveValidators: [async () => {
                await journal.write(scope2, { ...record, phase: "saved", updatedAt: time() });
                const completed = await journal.read(scope2, target);
                if (!completed || !same6({ ...completed, phase: record.phase, updatedAt: record.updatedAt }, record) || completed.phase !== "saved") fail11("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
              }]
            });
            return {
              status: "filled",
              reason: "FC27_PUZZLE_SAVED_VERIFIED",
              saved: true,
              submitted: false,
              setId: record.setId,
              challengeId: record.challengeId,
              selectedCount: plan.selected.length
            };
          }) ?? blocked4("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        } catch (error2) {
          return {
            ...blocked4(safeReason2(error2)),
            status: boundary ? "recovery-required" : "blocked",
            saved: dispatched ? null : false
          };
        } finally {
          busy = false;
        }
      }
    });
  }

  // src/fc27/market-query-route.js
  var validId2 = (value) => Number.isSafeInteger(value) && value > 0;
  var levels = Object.freeze([
    { level: "bronze", min: 1, max: 64 },
    { level: "silver", min: 65, max: 74 },
    { level: "gold", min: 75, max: 99 }
  ]);
  var stop3 = (reason) => ({ status: "blocked", reason, queries: [], complete: false, executable: false });
  function planFc27MarketQueryRoute({ challenge, policy } = {}) {
    const required2 = challenge?.slotCount - (challenge?.brickIndices?.length ?? NaN);
    const parsed = parseFc27SbcRequirements(challenge?.rawRequirements, required2);
    if (parsed.status !== "observed") return stop3(parsed.reason);
    if (!Number.isSafeInteger(policy?.maxRating) || policy.maxRating < 1 || policy.maxRating > 99 || !Array.isArray(policy.excludedLeagueIds)) return stop3("FC27_MARKET_POLICY_UNVERIFIED");
    const allowed = levels.filter(({ min, max }) => min <= policy.maxRating && !parsed.rules.some((rule) => rule.kind === "all-quality" && (max < rule.minRating || min > rule.maxRating) || rule.kind === "min-quality" && max < rule.minRating || rule.kind === "max-quality" && min > rule.maxRating));
    if (!allowed.length) return stop3("FC27_MARKET_QUALITY_UNAVAILABLE");
    const priority = (level) => {
      const quality2 = level === "bronze" ? 1 : level === "silver" ? 2 : 3;
      return Math.max(0, ...parsed.rules.filter((rule) => rule.kind === "quality-count" && rule.mode === "min" && rule.qualities.includes(quality2)).map((rule) => rule.count));
    };
    allowed.sort((a, b) => priority(b.level) - priority(a.level) || a.min - b.min);
    const identities = parsed.rules.filter((rule) => rule.mode === "min" && rule.count > 0 && ["from-nations", "from-leagues", "from-clubs"].includes(rule.kind));
    const fields3 = { "from-nations": "nation", "from-leagues": "league", "from-clubs": "team" };
    const anchors = identities.flatMap((rule) => rule.ids.filter(validId2).slice(0, 2).map((id4) => ({ [fields3[rule.kind]]: id4 })));
    const queries = [];
    const add = (query) => {
      if (queries.length < 3 && !queries.some((old) => JSON.stringify(old) === JSON.stringify(query))) queries.push(query);
    };
    for (const anchor of anchors.slice(0, 2)) add({ start: 0, count: 20, level: allowed[0].level, ...anchor });
    for (const { level } of allowed) add({ start: 0, count: 20, level });
    return {
      status: "ready",
      queries,
      complete: false,
      executable: false,
      reasons: ["BOUNDED_CATALOG_SAMPLE", "MARKET_QUOTES_NOT_YET_READ"]
    };
  }

  // src/fc27/puzzle-procurement.js
  var seeds = /* @__PURE__ */ new WeakMap();
  var stop4 = (reason) => ({ status: "blocked", reason, executable: false, plans: [] });
  var positive7 = (value) => Number.isSafeInteger(value) && value > 0;
  var signature = (input) => JSON.stringify([input.context, input.challenge, input.policy, input.inventory, input.chemistry, input.clubLinks]);
  var required = (input) => input.challenge.slotCount - input.challenge.brickIndices.length;
  var poolOf = (input) => collectSafeTraditionalCandidates({ ...input, challenge: {
    ...input.challenge,
    mechanism: "traditional",
    requirements: [{ kind: "player-count", count: required(input) }]
  } });
  var factsOf = (input, squad) => evaluateFc27PuzzleSquad({
    squad,
    formation: input.challenge.formation,
    chemistry: input.chemistry,
    rating: input.chemistry?.rating
  });
  var quality = (rating) => rating < 65 ? 1 : rating < 75 ? 2 : 3;
  var validSeed = (input, seed) => seeds.get(seed) === signature(input);
  function findFc27PuzzleRepairSeed(input) {
    const parsed = parseFc27SbcRequirements(input?.challenge?.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const chemistry = parsed.rules.filter((rule) => rule.kind.endsWith("-chemistry"));
    if (chemistry.length !== 1 || chemistry[0].kind !== "min-chemistry") return stop4("FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE");
    const original = chemistry[0].value;
    for (let difference = 1; difference <= Math.min(4, original); difference++) {
      const challenge = structuredClone(input.challenge);
      const index = parsed.rules.indexOf(chemistry[0]);
      challenge.rawRequirements[index].pairs[0].values = [original - difference];
      const preview = previewFc27PuzzleSquad({ ...input, challenge, maxNodes: 5e4 });
      if (preview.status !== "preview") continue;
      const squad = Array(input.challenge.slotCount).fill(null);
      for (const ref of preview.selected) squad[ref.slot] = { ...structuredClone(input.inventory.items.find((item) => item.id === ref.id)), slot: ref.slot };
      const facts2 = factsOf(input, squad);
      if (facts2.status !== "observed") return stop4(facts2.reason);
      const seed = { status: "ready", executable: false, squad, teamFacts: facts2, requiredChemistry: original };
      seeds.set(seed, signature(input));
      return seed;
    }
    return stop4("FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE");
  }
  function planFc27PuzzleRepairQueries(input, seed) {
    if (!validSeed(input, seed)) return stop4("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    const players = seed.squad.filter(Boolean);
    const resolveClub = createFc27ClubResolver(input.clubLinks);
    const count2 = (read) => {
      const counts = /* @__PURE__ */ new Map();
      for (const item of players) {
        const key = read(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    };
    const tier = count2((item) => quality(item.rating))[0]?.[0];
    const level = { 1: "bronze", 2: "silver", 3: "gold" }[tier];
    const clubs = count2((item) => resolveClub?.(item.teamId));
    const leagues = count2((item) => item.leagueId);
    const queries = [];
    if (positive7(clubs[0]?.[0]) && clubs[0][1] >= 2) queries.push({ start: 0, count: 20, level, team: clubs[0][0] });
    for (const [league] of leagues) {
      if (queries.length >= 3) break;
      if (positive7(league) && !input.policy.excludedLeagueIds.includes(league)) queries.push({ start: 0, count: 20, level, league });
    }
    return { status: "ready", executable: false, queries, complete: false };
  }
  function suggestFc27PuzzlePurchases(input, seed, entries2, { maxChecks = 2e4 } = {}) {
    if (!validSeed(input, seed)) return stop4("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    if (!Array.isArray(entries2) || entries2.length > 60 || !Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 5e4) return stop4("FC27_PURCHASE_REPAIR_BUDGET_INVALID");
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop4(pool.reason);
    if (seed.squad.some((item) => item && !pool.candidates.some((candidate) => candidate.id === item.id && JSON.stringify({ ...candidate, slot: item.slot }) === JSON.stringify(item)))) return stop4("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const material = puzzleMaterialRules(parsed.rules, required(input));
    const candidates = marketCandidates(input, entries2);
    const slots = seed.squad.flatMap((item, index) => item ? [index] : []);
    const plans = [];
    const combinations = /* @__PURE__ */ new Set();
    let checks = 0;
    const assess3 = (squad) => {
      if (checks >= maxChecks) return;
      checks++;
      const players = squad.filter(Boolean);
      if (new Set(players.map((item) => item.definitionId)).size !== players.length) return;
      if (material.length && matchFc27SbcRequirements({ requirements: material, squad: players }).status !== "satisfied") return;
      const facts2 = factsOf(input, squad);
      if (facts2.status !== "observed") return;
      const validation = matchFc27SbcRequirements({
        requirements: parsed.rules,
        squad: players,
        clubLinks: input.clubLinks,
        chemistry: facts2.chemistry,
        teamRating: facts2.teamRating
      });
      if (validation.status !== "satisfied") return;
      const plan = projectSuggestion(squad, facts2, parsed.rules.length);
      const key = plan.purchases.map((item) => item.definitionId).sort((a, b) => a - b).join(",");
      if (combinations.has(key)) return;
      combinations.add(key);
      plans.push(plan);
    };
    for (const card of candidates) for (const removed of slots) for (const target of slots) {
      if (checks >= maxChecks) break;
      const squad = seed.squad.slice();
      squad[removed] = squad[target];
      squad[target] = card;
      assess3(squad);
    }
    if (!plans.length) for (let a = 0; a < Math.min(12, candidates.length); a++) for (let b = a + 1; b < Math.min(12, candidates.length); b++) {
      for (const first of slots) for (const second of slots) {
        if (first === second || checks >= maxChecks) continue;
        const squad = seed.squad.slice();
        squad[first] = candidates[a];
        squad[second] = candidates[b];
        assess3(squad);
      }
    }
    plans.sort((a, b) => a.purchaseCount - b.purchaseCount || b.teamFacts.chemistry - a.teamFacts.chemistry || a.purchases.reduce((n, card) => n + card.rating, 0) - b.purchases.reduce((n, card) => n + card.rating, 0));
    return {
      status: plans.length ? "suggested" : "blocked",
      reason: plans.length ? "FC27_PURCHASE_SUGGESTIONS_READY" : "FC27_PURCHASE_REPAIR_NO_PLAN",
      executable: false,
      plans: plans.slice(0, 8),
      marketCandidates: candidates.length,
      checks,
      truncated: checks >= maxChecks || plans.length > 8,
      marketWideInfeasibilityProven: false
    };
  }
  function marketCandidates(input, entries2) {
    const owned = new Set(input.inventory.items.map((item) => item.definitionId));
    const seen = /* @__PURE__ */ new Set();
    return entries2.filter((item) => {
      if (!positive7(item?.definitionId) || owned.has(item.definitionId) || seen.has(item.definitionId)) return false;
      seen.add(item.definitionId);
      return item.special === false && item.evolution === false && item.cosmetic === false && [0, 1].includes(item.rarity) && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= input.policy.maxRating && (item.rating < 75 || item.rating >= input.policy.goldRange[0] && item.rating <= input.policy.goldRange[1]) && [item.nationId, item.leagueId, item.teamId].every(positive7) && !input.policy.excludedLeagueIds.includes(item.leagueId) && Array.isArray(item.positions) && item.positions.length > 0 && item.positions.every((position) => Number.isInteger(position) && position >= 0 && position <= 27) && Array.isArray(item.groups) && item.groups.every((group) => Number.isInteger(group) && group >= 0);
    }).map((item) => ({
      definitionId: item.definitionId,
      rating: item.rating,
      rarity: item.rarity,
      nationId: item.nationId,
      ...typeof item.displayName === "string" && item.displayName.length <= 201 && !/[\u0000-\u001f]/.test(item.displayName) ? { displayName: item.displayName } : {},
      leagueId: item.leagueId,
      teamId: item.teamId,
      positions: [...item.positions],
      groups: [...item.groups],
      special: false,
      evolution: false,
      cosmetic: false,
      type: "player",
      concept: false,
      academyEnrolled: false,
      catalogRef: `fc27:${item.definitionId}`
    }));
  }
  function projectSuggestion(squad, facts2, requirementCount) {
    const purchases = squad.flatMap((item, slot) => item?.catalogRef ? [{ ...item, slot, quantity: 1 }] : []);
    return {
      executable: false,
      liveExecutionEnabled: false,
      purchaseCount: purchases.length,
      purchases,
      selectedOwned: squad.flatMap((item, slot) => item && !item.catalogRef ? [{
        id: item.id,
        definitionId: item.definitionId,
        pile: item.pile,
        rating: item.rating,
        slot
      }] : []),
      teamFacts: { chemistry: facts2.chemistry, teamRating: facts2.teamRating },
      requirementCount,
      requiresPurchasedMaterialApproval: true,
      marketAvailabilityVerified: false
    };
  }
  function planFc27PuzzleShortageQueries(input, entries2 = []) {
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop4(pool.reason);
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const material = puzzleMaterialRules(parsed.rules, required(input));
    const missing = material.filter((rule) => rule.count > new Set(pool.candidates.filter((item) => quality(item.rating) === rule.qualities[0]).map((item) => item.definitionId)).size);
    const generic = planFc27MarketQueryRoute(input);
    if (generic.status !== "ready") return generic;
    const levelOf = (tier) => ({ 1: "bronze", 2: "silver", 3: "gold" })[tier];
    const tiers = material.length ? material.filter((rule) => rule.count > 0).sort((a, b) => Number(missing.includes(b)) - Number(missing.includes(a)) || b.count - a.count).map((rule) => levelOf(rule.qualities[0])) : [...new Set(generic.queries.map((query) => query.level))];
    const queries = [];
    const add = (query) => {
      if (queries.length < 3 && !queries.some((existing) => JSON.stringify(existing) === JSON.stringify(query))) queries.push(query);
    };
    const cappedClubs = parsed.rules.some((rule) => rule.kind === "distinct-clubs" && rule.mode !== "min" && rule.value < required(input));
    if (cappedClubs) {
      const resolveClub = createFc27ClubResolver(input.clubLinks);
      if (!resolveClub) return stop4("FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE");
      const candidates = [...pool.candidates, ...marketCandidates(input, entries2)];
      const lanes = tiers.map((level) => {
        const groups = /* @__PURE__ */ new Map();
        for (const item of candidates.filter((item2) => levelOf(quality(item2.rating)) === level)) {
          const team = item.teamId;
          const group = resolveClub(team);
          if (!positive7(team) || !positive7(group)) continue;
          if (!groups.has(group)) groups.set(group, { team, ids: /* @__PURE__ */ new Set() });
          groups.get(group).ids.add(item.definitionId);
        }
        return [...groups.values()].sort((a, b) => b.ids.size - a.ids.size || a.team - b.team).map(({ team }) => ({ start: 0, count: 20, level, team }));
      });
      for (const query of generic.queries.filter((query2) => query2.team || query2.nation || query2.league)) {
        if (tiers.includes(query.level)) add(query);
      }
      lanes.forEach((lane, index) => add(lane[0] ?? { start: 0, count: 20, level: tiers[index] }));
      for (let index = 1; index < 3; index++) for (const lane of lanes) if (lane[index]) add(lane[index]);
    }
    if (!missing.length) {
      for (const query of generic.queries) if (tiers.includes(query.level)) add(query);
    } else {
      for (const rule of missing) add({ start: 0, count: 20, level: levelOf(rule.qualities[0]) });
    }
    if (!queries.length) for (const level of tiers) add({ start: 0, count: 20, level });
    const baseQueries = queries.slice();
    const leagues = /* @__PURE__ */ new Map();
    for (const item of pool.candidates) leagues.set(item.leagueId, (leagues.get(item.leagueId) ?? 0) + 1);
    for (const [league] of [...leagues].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      for (const query of baseQueries.filter((query2) => !query2.team && !query2.league && !query2.nation)) add({ ...query, league });
      if (queries.length === 3) break;
    }
    return { status: "ready", executable: false, queries, complete: false };
  }
  function suggestFc27PuzzleJointPurchases(input, entries2, { maxNodes = 5e4 } = {}) {
    if (!Array.isArray(entries2) || entries2.length > 60) return stop4("FC27_PURCHASE_REPAIR_BUDGET_INVALID");
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop4(pool.reason);
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const market = marketCandidates(input, entries2);
    const result = searchFc27PuzzleCandidates({
      ...input,
      maxNodes,
      pool: { ...pool, candidates: [...pool.candidates, ...market] },
      procurement: { budget: required(input), maxPurchases: required(input), costOf: (item) => item.catalogRef ? 1 : 0 }
    });
    if (result.status !== "preview") return {
      ...stop4(result.reason),
      marketCandidates: market.length,
      nodes: result.nodes ?? 0,
      truncated: result.reason === "FC27_PUZZLE_SEARCH_LIMIT"
    };
    const squad = Array(input.challenge.slotCount).fill(null);
    for (const ref of result.selected) squad[ref.slot] = ref.catalogRef ? market.find((item) => item.catalogRef === ref.catalogRef) : pool.candidates.find((item) => item.id === ref.id);
    return {
      status: "suggested",
      reason: "FC27_PURCHASE_SUGGESTIONS_READY",
      executable: false,
      plans: [projectSuggestion(squad, result.teamFacts, parsed.rules.length)],
      marketCandidates: market.length,
      nodes: result.nodes,
      truncated: result.searchComplete === false,
      marketWideInfeasibilityProven: false
    };
  }

  // src/fc27/puzzle-concept-plan.js
  var positive8 = (value) => Number.isSafeInteger(value) && value > 0;
  var integer7 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  var blocked5 = (reason) => ({ status: "blocked", reason, executable: false, liveExecutionEnabled: false });
  function prepareFc27PuzzleConceptPlan({ challenge, plan } = {}) {
    if (!challenge || !plan || plan.status !== "preview" || !positive8(challenge.setId) || !positive8(challenge.id) || plan.setId !== challenge.setId || plan.challengeId !== challenge.id || !integer7(challenge.slotCount, 1, 11) || !Array.isArray(challenge.brickIndices) || challenge.brickIndices.length >= challenge.slotCount || new Set(challenge.brickIndices).size !== challenge.brickIndices.length || challenge.brickIndices.some((index) => !integer7(index, 0, challenge.slotCount - 1))) {
      return blocked5("FC27_PUZZLE_CONCEPT_INPUT_UNVERIFIED");
    }
    const required2 = challenge.slotCount - challenge.brickIndices.length;
    if (!Array.isArray(plan.selectedOwned) || !Array.isArray(plan.purchases) || [...plan.selectedOwned, ...plan.purchases].some((item) => !item || typeof item !== "object")) {
      return blocked5("FC27_PUZZLE_CONCEPT_PLAN_INVALID");
    }
    const owned = plan.selectedOwned;
    const purchases = plan.purchases;
    const entries2 = [
      ...owned.map((item) => ({ ...item, kind: "owned" })),
      ...purchases.map((item) => ({ ...item, kind: "concept" }))
    ];
    if (entries2.length !== required2 || new Set(entries2.map((item) => item.slot)).size !== required2 || entries2.some((item) => !integer7(item.slot, 0, challenge.slotCount - 1) || challenge.brickIndices.includes(item.slot) || !positive8(item.definitionId) || !integer7(item.rating, 1, 99)) || new Set(entries2.map((item) => item.definitionId)).size !== required2 || owned.some((item) => !positive8(item.id) || item.pile !== "club" || item.catalogRef !== void 0) || new Set(owned.map((item) => item.id)).size !== owned.length || purchases.some((item) => item.id !== void 0 || item.pile !== void 0 || item.catalogRef !== `fc27:${item.definitionId}` || item.quantity !== 1 || !integer7(item.observedBuyNow ?? item.estimatedUnitPrice, 150, 15e6)) || (plan.purchaseCount ?? purchases.length) !== purchases.length) {
      return blocked5("FC27_PUZZLE_CONCEPT_PLAN_INVALID");
    }
    const slots = Array.from({ length: challenge.slotCount }, (_, slot) => {
      const item = entries2.find((entry) => entry.slot === slot);
      return item ? {
        slot,
        kind: item.kind,
        definitionId: item.definitionId,
        rating: item.rating,
        ...item.kind === "owned" ? { id: item.id, pile: item.pile } : {
          catalogRef: item.catalogRef,
          quantity: item.quantity ?? 1,
          estimatedUnitPrice: item.estimatedUnitPrice ?? null,
          observedBuyNow: item.observedBuyNow ?? null
        }
      } : null;
    });
    if (slots.some((item, slot) => !challenge.brickIndices.includes(slot) && !item)) {
      return blocked5("FC27_PUZZLE_CONCEPT_PLAN_INVALID");
    }
    return Object.freeze({
      status: "prepared",
      kind: "puzzle-concept",
      schema: 1,
      executable: false,
      liveExecutionEnabled: false,
      setId: challenge.setId,
      challengeId: challenge.id,
      required: required2,
      purchaseCount: purchases.length,
      estimatedCost: purchases.reduce((sum, item) => sum + (item.observedBuyNow ?? item.estimatedUnitPrice ?? 0), 0),
      slots: Object.freeze(slots.map((item) => item && Object.freeze(item))),
      pending: Object.freeze(purchases.length ? [
        "CONCEPT_SQUAD_DISPLAY",
        "EXPLICIT_PURCHASE_APPROVAL",
        "LIVE_AUCTION_RECHECK",
        "EXACT_PURCHASE_RECEIPTS",
        "FRESH_INVENTORY_REPLAN"
      ] : ["CONCEPT_SQUAD_DISPLAY"])
    });
  }

  // src/fc27/puzzle-procurement-policy.js
  var DEFAULT_PUZZLE_QUOTE_CEILING = null;
  var MAX_PUZZLE_QUOTE_PRICE = 15e6;
  var PUZZLE_MARKET_READ_LIMIT = 25;
  var isPuzzleQuoteCeiling = (value) => value === null || Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;

  // src/fc27/puzzle-procurement-session.js
  var safeReason3 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message ?? "") ? error2.message : "FC27_PURCHASE_READ_FAILED";
  var stop5 = (reason) => ({ status: "blocked", reason, executable: false, liveExecutionEnabled: false, plans: [] });
  var same7 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var id2 = (value) => Number.isSafeInteger(value) && value > 0;
  var AUTH_RETRY_DELAY = 3e4;
  var failureDetails = (reason, value) => {
    const match = /^FC27_MARKET_HTTP_([1-5]\d{2})$/.exec(reason);
    const eaCode = Object.getOwnPropertyDescriptor(value ?? {}, "eaCode")?.value;
    return {
      httpStatus: match ? Number(match[1]) : null,
      eaCode: Number.isSafeInteger(eaCode) && eaCode >= 0 && eaCode <= 2147483647 ? eaCode : null
    };
  };
  function createFc27PuzzleProcurementSession({ createTransport, get, set, now = Date.now } = {}) {
    let busy = false;
    return Object.freeze({ async plan(input, { assertCurrent = () => {
    }, quoteCeiling = DEFAULT_PUZZLE_QUOTE_CEILING } = {}) {
      if (busy) return stop5("FC27_PURCHASE_BUSY");
      busy = true;
      let requests = 0;
      let cacheHits = 0;
      let transport;
      const diagnostics = {
        stage: "repair-seed",
        route: null,
        catalogPages: 0,
        catalogCandidates: 0,
        usableCandidates: null,
        unpricedPlans: 0,
        localReason: null,
        checks: null,
        nodes: null,
        truncated: null,
        catalogAttempts: 0,
        quoteAttempts: 0,
        authRecoveries: 0,
        failureSource: null,
        httpStatus: null,
        eaCode: null,
        retryAfterSeconds: null,
        excludedUnavailable: 0,
        replans: 0
      };
      const finish = (result) => ({ ...result, quoteCeiling, requests, cacheHits, diagnostics: { ...diagnostics, cacheHits } });
      try {
        if (!isPuzzleQuoteCeiling(quoteCeiling)) return finish(stop5("FC27_PURCHASE_PRICE_LIMIT_INVALID"));
        const scope2 = traditionalJournalScope(input.context);
        assertCurrent();
        const seed = findFc27PuzzleRepairSeed(input);
        if (seed.status !== "ready" && seed.reason !== "FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE") return finish(seed);
        diagnostics.route = seed.status === "ready" ? "repair" : "joint";
        diagnostics.stage = "query-planning";
        const route = seed.status === "ready" ? planFc27PuzzleRepairQueries(input, seed) : planFc27PuzzleShortageQueries(input);
        if (route.status !== "ready") return finish(route);
        const cachedRead = async (kind, query) => {
          diagnostics.stage = kind === "catalog" ? "catalog-read" : "quote-read";
          assertCurrent();
          const key = `fcat-fc27-puzzle-market:${scope2}:${kind}:${JSON.stringify(query)}`;
          const stored = await get(key, null);
          assertCurrent();
          if (stored !== null) {
            if (stored?.schema !== 1 || stored.kind !== kind || !same7(stored.query, query) || !id2(stored.at) || stored.at > now()) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
            if (stored.state !== "observed") {
              const reason = safeReason3({ message: stored.reason ?? "FC27_PURCHASE_READ_UNCONFIRMED" });
              const authFailure = stored.state === "blocked" && reason === "FC27_MARKET_HTTP_401";
              const remaining = Math.max(0, stored.at + AUTH_RETRY_DELAY - now());
              if (!authFailure || remaining > 0) {
                Object.assign(diagnostics, failureDetails(reason, stored.details), {
                  failureSource: "cache",
                  retryAfterSeconds: authFailure ? Math.ceil(remaining / 1e3) : null
                });
                throw new Error(reason);
              }
              diagnostics.authRecoveries++;
            } else {
              const ttl = kind === "catalog" ? 864e5 : 6e5;
              if (!id2(stored.result?.observedAt) || stored.result.observedAt > now()) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
              if (now() - Math.min(stored.at, stored.result.observedAt) <= ttl) {
                cacheHits++;
                return structuredClone(stored.result);
              }
            }
          }
          if (requests >= PUZZLE_MARKET_READ_LIMIT) throw new Error("FC27_PURCHASE_READ_BUDGET");
          const record = { schema: 1, kind, query, at: now(), state: "pending" };
          await set(key, record);
          if (!same7(await get(key, null), record)) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
          assertCurrent();
          let attempted = false;
          try {
            transport ??= await createTransport({ maxRequests: PUZZLE_MARKET_READ_LIMIT });
            assertCurrent();
            requests++;
            diagnostics[kind === "catalog" ? "catalogAttempts" : "quoteAttempts"]++;
            attempted = true;
            const result = await (kind === "catalog" ? transport.readCatalogPage(query) : transport.readQuotePage(query));
            await set(key, { ...record, state: "observed", result });
            assertCurrent();
            return result;
          } catch (error2) {
            const reason = safeReason3(error2);
            const details = failureDetails(reason, Object.getOwnPropertyDescriptor(error2 ?? {}, "marketFailure")?.value);
            Object.assign(diagnostics, details, {
              failureSource: attempted ? "request" : "transport",
              retryAfterSeconds: reason === "FC27_MARKET_HTTP_401" ? AUTH_RETRY_DELAY / 1e3 : null
            });
            await set(key, { ...record, at: now(), state: "blocked", reason, details });
            throw error2;
          }
        };
        const entries2 = /* @__PURE__ */ new Map();
        const quotes = /* @__PURE__ */ new Map();
        const usedQueries = [];
        const unavailable = /* @__PURE__ */ new Set();
        let hadPlans = false;
        let pendingQueries = route.queries.slice();
        while (pendingQueries.length && usedQueries.length < 3) {
          const query = pendingQueries.shift();
          const page = await cachedRead("catalog", query);
          usedQueries.push(query);
          if (page?.status !== "observed" || page.season !== "27" || page.source !== "ea-defid" || !same7(page.query, query) || !id2(page.observedAt) || page.observedAt > now() || now() - page.observedAt > 864e5 || !Array.isArray(page.entries) || page.entries.length > query.count || new Set(page.entries.map((item) => item?.definitionId)).size !== page.entries.length) throw new Error("FC27_PURCHASE_CATALOG_UNVERIFIED");
          for (const entry of page.entries) {
            if (entries2.has(entry.definitionId) && !same7(entries2.get(entry.definitionId), entry)) throw new Error("FC27_PURCHASE_CATALOG_CHANGED");
            entries2.set(entry.definitionId, entry);
          }
          diagnostics.catalogPages++;
          diagnostics.catalogCandidates = entries2.size;
          for (; ; ) {
            assertCurrent();
            diagnostics.stage = "local-market-search";
            const available = [...entries2.values()].filter((item) => !unavailable.has(item.definitionId));
            const suggestion = seed.status === "ready" ? suggestFc27PuzzlePurchases(input, seed, available) : suggestFc27PuzzleJointPurchases(input, available);
            diagnostics.usableCandidates = suggestion.marketCandidates ?? null;
            diagnostics.localReason = suggestion.reason ?? null;
            diagnostics.checks = suggestion.checks ?? null;
            diagnostics.nodes = suggestion.nodes ?? null;
            diagnostics.truncated = suggestion.truncated ?? null;
            const plans = suggestion.plans ?? [];
            diagnostics.unpricedPlans = plans.length;
            hadPlans ||= plans.length > 0;
            let removed = false;
            for (const plan of plans) {
              for (const item of plan.purchases) {
                if (!quotes.has(item.definitionId)) {
                  const quote = await cachedRead("quote", { definitionId: item.definitionId, start: 0, count: 20, maxBuy: quoteCeiling });
                  if (quote?.status !== "observed" || quote.season !== "27" || quote.platform !== input.context.platform || quote.source !== "ea-visible-buy-now" || quote.definitionId !== item.definitionId || !id2(quote.observedAt) || quote.observedAt > now() || now() - quote.observedAt > 6e5 || !Number.isInteger(quote.eligible) || quote.eligible < 0 || quote.eligible > 20 || (quote.eligible === 0 ? quote.price !== null : !Number.isInteger(quote.price) || quote.price < 150 || quote.price > (quoteCeiling ?? MAX_PUZZLE_QUOTE_PRICE))) throw new Error("FC27_PURCHASE_QUOTE_UNVERIFIED");
                  quotes.set(item.definitionId, quote);
                }
                if (quotes.get(item.definitionId).price === null) {
                  unavailable.add(item.definitionId);
                  removed = true;
                  break;
                }
              }
              if (plan.purchases.every((item) => quotes.get(item.definitionId)?.price > 0)) break;
            }
            diagnostics.excludedUnavailable = unavailable.size;
            const priced = plans.filter((plan) => plan.purchases.every((item) => quotes.get(item.definitionId)?.price > 0)).map((plan) => ({
              ...plan,
              purchases: plan.purchases.map((item) => ({
                ...item,
                observedBuyNow: quotes.get(item.definitionId).price,
                quotedAt: quotes.get(item.definitionId).observedAt
              })),
              estimatedCost: plan.purchases.reduce((sum, item) => sum + quotes.get(item.definitionId).price, 0)
            })).sort((a, b) => a.purchaseCount - b.purchaseCount || a.estimatedCost - b.estimatedCost);
            if (priced.length) return finish({
              status: "suggested",
              reason: "FC27_PURCHASE_PLAN_PRICED",
              executable: false,
              liveExecutionEnabled: false,
              plans: priced.slice(0, 3).map((plan) => ({
                ...plan,
                conceptPlan: prepareFc27PuzzleConceptPlan({ challenge: input.challenge, plan: {
                  ...plan,
                  status: "preview",
                  setId: input.challenge.setId,
                  challengeId: input.challenge.id
                } })
              })),
              requests,
              cacheHits,
              queries: usedQueries,
              seedChemistry: seed.teamFacts?.chemistry ?? null,
              requiredChemistry: seed.requiredChemistry ?? null,
              quoteCeiling,
              affordabilityVerified: false,
              globalMinimumProven: false,
              pending: ["EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL", "LIVE_AUCTION_RECHECK", "EXACT_PURCHASE_RECEIPTS", "FRESH_INVENTORY_REPLAN"]
            });
            if (!removed) break;
            diagnostics.replans++;
          }
          if (seed.status !== "ready" && usedQueries.length < 3) {
            const nextRoute = planFc27PuzzleShortageQueries(input, [...entries2.values()]);
            if (nextRoute.status !== "ready") return finish(nextRoute);
            pendingQueries = [...nextRoute.queries, ...pendingQueries].filter((candidate, index, all) => !usedQueries.some((used) => same7(used, candidate)) && all.findIndex((other) => same7(other, candidate)) === index);
          }
        }
        const searchLimited = diagnostics.localReason === "FC27_PUZZLE_SEARCH_LIMIT" || diagnostics.truncated === true && diagnostics.unpricedPlans === 0;
        return finish({ ...stop5(searchLimited ? "FC27_PUZZLE_SEARCH_LIMIT" : hadPlans ? "FC27_PURCHASE_QUOTES_UNAVAILABLE" : "FC27_PURCHASE_REPAIR_NO_PLAN"), queries: usedQueries });
      } catch (error2) {
        return finish(stop5(safeReason3(error2)));
      } finally {
        busy = false;
      }
    } });
  }

  // src/adapters/ea/fc27-market-read.js
  var FC27_MARKET_READ_METHODS = Object.freeze([
    ...FC27_CLUB_READ_METHODS,
    ["UTItemDAO.prototype.searchConceptItems", "6d5080a272138db4e8ba514633e7678d43d065fde141d1cad0fa1246818aa788"],
    ["UTItemDAO.prototype.searchTransferMarket", "3894f730c0e1bbcf0ff8dc1f5290f35c21e8906fdcf6a6344714e66d0739d90e"],
    ["FCAuthenticationService.prototype.getIdentifier", "30d1c91b414f508725e07f81c0577e40308be93ea92925051b21740c2781dbc3"],
    ["Identification.prototype.handleRequest", "74627d97570009ea15aea10dd2ff26d4ac85c8eeaea55f53253b6d3f9bb0eb09"],
    ["Identification.prototype.handleResponse", "cc4de06cc8696a4723f9539159c912c6d7cd4b7263ccaf7db9d7198b2f31ff01"]
  ]);
  var at5 = (root, path) => path.split(".").reduce((v, key) => ownData(v, key), root);
  var valid = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  var num = (v, min = 1, max = 1e9) => valid(v, min, max) ? v : null;
  var error = (code2) => new Error(`FC27_MARKET_${code2}`);
  function readFc27MarketPlayerName(root, definitionId) {
    const mask = at5(root, "ItemIdMask.DATABASE");
    if (!valid(definitionId, 1, 2147483647) || !valid(mask, 1, 2147483647)) return null;
    const assetId = definitionId & mask;
    const entry = ownData(at5(root, "repositories.Item.staticData._collection"), String(assetId));
    if (ownData(entry, "id") !== assetId) return null;
    const part = (key) => {
      const value = ownData(entry, key);
      return typeof value === "string" && value.length <= 100 && !/[\u0000-\u001f]/.test(value) && /[\p{L}\p{N}]/u.test(value) ? value.trim() : "";
    };
    return part("commonName") || [part("firstName"), part("lastName")].filter(Boolean).join(" ") || null;
  }
  function marketReadReason(caught) {
    return /^FC27_(?:MARKET_[A-Z0-9_]+|CONTEXT_UNAVAILABLE)$/.test(caught?.message ?? "") ? caught.message : "FC27_MARKET_READ_FAILED";
  }
  function numbers2(value, limit, max) {
    if (!Array.isArray(value) || value.length > limit) return null;
    const result = Array.from({ length: value.length }, (_, i) => num(ownData(value, String(i)), 0, max));
    return result.includes(null) || new Set(result).size !== result.length ? null : result;
  }
  function publicPlayer(entity, resourceId) {
    if (ownData(entity, "definitionId") !== resourceId || ownData(entity, "type") !== "player") throw error("ENTITY_UNVERIFIED");
    const get = (key) => ownData(entity, key);
    const rarity = num(get("_rareflag"), 0, 1e4);
    const upgrades = get("upgrades");
    const cosmetics = get("cosmetics");
    const hyper = get("_hyperCosmeticDTOs");
    const staticData = get("_staticData");
    const part = (key) => {
      const value = ownData(staticData, key);
      return typeof value === "string" && value.length <= 100 && !/[\u0000-\u001f]/.test(value) ? value.trim() : "";
    };
    const displayName = part("knownAs") || [part("firstName"), part("lastName")].filter(Boolean).join(" ");
    return {
      definitionId: resourceId,
      rating: upgrades === null ? num(get("_rating"), 1, 99) : null,
      ...displayName ? { displayName } : {},
      rarity,
      nationId: num(get("nationId")),
      leagueId: num(get("leagueId")),
      teamId: num(get("teamId")),
      positions: upgrades === null ? numbers2(get("basePossiblePositions"), 28, 27) : null,
      groups: numbers2(get("groups"), 128, 1e4),
      special: rarity === null ? null : ![0, 1].includes(rarity),
      evolution: upgrades === void 0 ? null : upgrades !== null,
      cosmetic: Array.isArray(cosmetics) && hyper && typeof hyper === "object" && !Array.isArray(hyper) ? cosmetics.length > 0 || Object.getOwnPropertyNames(hyper).length > 0 : null
    };
  }
  function method4(object, key) {
    for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
      const d = Object.getOwnPropertyDescriptor(object, key);
      if (d) return Object.hasOwn(d, "value") ? d.value : void 0;
    }
  }
  async function createFc27MarketReadTransport(root, { maxRequests = 8 } = {}) {
    if (!valid(maxRequests, 1, PUZZLE_MARKET_READ_LIMIT)) throw error("QUERY_INVALID");
    const context = readFc27Context(root);
    const reviewed = /* @__PURE__ */ new Map();
    for (const [index, [path, expected]] of FC27_MARKET_READ_METHODS.entries()) {
      const fn = at5(root, path);
      if (typeof fn !== "function") throw error(`METHOD_${index}_MISSING`);
      const digest = await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn)));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (hash !== expected) throw error(`METHOD_${index}_CHANGED`);
      reviewed.set(path, fn);
    }
    const Request = at5(root, "UTHttpRequest");
    const auth = at5(root, "services.Item.itemDao.authDelegate");
    const factory = at5(root, "factories.Item");
    const createItem = reviewed.get("UTItemEntityFactory.prototype.createItem");
    const identifier = ownData(auth, "identification");
    const assertRuntime = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw error("SCOPE_CHANGED");
      for (const [path, fn] of reviewed) if (at5(root, path) !== fn) throw error("RUNTIME_CHANGED");
      if (at5(root, "GAME_NAME") !== "fc27" || at5(root, "HttpRequestMethod.GET") !== "GET" || at5(root, "services.Item.itemDao.authDelegate") !== auth || !auth || !identifier || ownData(auth, "identification") !== identifier || method4(auth, "getIdentifier") !== reviewed.get("FCAuthenticationService.prototype.getIdentifier") || method4(identifier, "handleRequest") !== reviewed.get("Identification.prototype.handleRequest") || method4(identifier, "handleResponse") !== reviewed.get("Identification.prototype.handleResponse") || at5(root, "factories.Item") !== factory || method4(factory, "createItem") !== createItem) throw error("DEPENDENCIES_UNVERIFIED");
    };
    assertRuntime();
    let busy = false;
    let stopped = false;
    let requests = 0;
    let lastRequestAt = null;
    async function request(kind, query, project3) {
      if (busy || stopped || requests >= maxRequests) throw error("READ_BLOCKED");
      busy = true;
      let failureDetails2 = null;
      try {
        const delay = lastRequestAt === null ? 0 : Math.max(0, 800 - (Date.now() - lastRequestAt));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        assertRuntime();
        const req = new Request(auth);
        for (const [key, path] of [
          ["send", "UTHttpRequest.prototype.send"],
          ["setPath", "UTHttpRequest.prototype.setPath"],
          ["abort", "EAHttpRequest.prototype.abort"]
        ]) if (method4(req, key) !== reviewed.get(path)) throw error("RUNTIME_CHANGED");
        req.doRetry = false;
        req.doReauth = false;
        req.timeout = 15e3;
        req.cache = false;
        req.requestType = "GET";
        const endpoint = `/ut/game/fc27/${kind === "catalog" ? "defid" : "transfermarket"}`;
        req.setPath(endpoint);
        const url = new URL(ownData(req, "url"));
        if (url.protocol !== "https:" || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) throw error("ENDPOINT_UNVERIFIED");
        req.urlVariables = `?${new URLSearchParams(query).toString()}`;
        if (kind === "quotes") reviewed.get("Identification.prototype.handleRequest").call(identifier, req);
        lastRequestAt = Date.now();
        requests++;
        const dto = await new Promise((resolve, reject) => {
          const observer = {};
          let done = false;
          const finish = (err, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              req.unobserve(observer);
            } catch {
            }
            if (err) reject(err);
            else resolve(value);
          };
          const timer = setTimeout(() => {
            finish(error("READ_TIMEOUT"));
            try {
              req.abort();
            } catch {
            }
          }, 16e3);
          try {
            req.observe(observer, (sender, value) => {
              if (done) return;
              if (sender !== req) {
                finish(error("RESPONSE_OWNER_MISMATCH"));
                return;
              }
              try {
                if (kind === "quotes") reviewed.get("Identification.prototype.handleResponse").call(identifier, req);
                finish(null, value);
              } catch {
                finish(error("RESPONSE_UNVERIFIED"));
              }
            });
            req.send();
          } catch {
            finish(error("REQUEST_FAILED"));
          }
        });
        assertRuntime();
        const status = ownData(dto, "status");
        if (ownData(dto, "success") !== true || status !== 200) {
          const rawCode = ownData(ownData(dto, "response"), "code");
          const code2 = typeof rawCode === "string" && /^\d{1,10}$/.test(rawCode) ? Number(rawCode) : rawCode;
          failureDetails2 = {
            httpStatus: valid(status, 100, 599) ? status : null,
            eaCode: valid(code2, 0, 2147483647) ? code2 : null
          };
          throw error(valid(status, 100, 599) ? `HTTP_${status}` : "RESPONSE_UNVERIFIED");
        }
        const body = ownData(dto, "response");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw error("RESPONSE_UNVERIFIED");
        const result = project3(body);
        assertRuntime();
        return result;
      } catch (caught) {
        stopped = true;
        const failure = new Error(marketReadReason(caught));
        if (failureDetails2) failure.marketFailure = failureDetails2;
        throw failure;
      } finally {
        busy = false;
      }
    }
    function materialize(raw) {
      const definitionId = num(ownData(raw, "resourceId"), 1, Number.MAX_SAFE_INTEGER);
      if (definitionId === null || ![void 0, "player"].includes(ownData(raw, "itemType")) || ownData(raw, "count") !== void 0 || ownData(raw, "cardassetid") !== void 0) throw error("PAYLOAD_UNVERIFIED");
      return publicPlayer(createItem.call(factory, structuredClone(raw)), definitionId);
    }
    return Object.freeze({
      getRequestCount: () => requests,
      readCatalogPage: async (query = {}) => {
        if (!query || Object.keys(query).some((k) => !["start", "count", "level", "nation", "league", "team"].includes(k)) || !valid(query.start, 0, 1e3) || !valid(query.count, 1, 50) || !["bronze", "silver", "gold"].includes(query.level) || ["nation", "league", "team"].some((k) => query[k] !== void 0 && !valid(query[k], 1, 1e9))) throw error("QUERY_INVALID");
        return request("catalog", { type: "player", sort: "asc", ...query }, (body) => {
          const raw = ownData(body, "itemData");
          if (!Array.isArray(raw) || raw.length > query.count) throw error("PAYLOAD_UNVERIFIED");
          const entries2 = raw.map(materialize);
          if (new Set(entries2.map((p) => p.definitionId)).size !== entries2.length) throw error("DUPLICATE_DEFINITION");
          return {
            status: "observed",
            season: "27",
            source: "ea-defid",
            observedAt: Date.now(),
            entries: entries2,
            query: { ...query },
            complete: false,
            pageEndObserved: raw.length < query.count
          };
        });
      },
      readQuotePage: async (query = {}) => {
        if (!query || Object.keys(query).some((k) => !["definitionId", "start", "count", "maxBuy"].includes(k)) || !valid(query.definitionId, 1, Number.MAX_SAFE_INTEGER) || !valid(query.start, 0, 1e3) || !valid(query.count, 1, 50) || !isPuzzleQuoteCeiling(query.maxBuy)) throw error("QUERY_INVALID");
        return request("quotes", {
          type: "player",
          definitionId: query.definitionId,
          start: query.start,
          num: query.count,
          ...query.maxBuy === null ? {} : { maxb: query.maxBuy }
        }, (body) => {
          const rows = ownData(body, "auctionInfo");
          if (!Array.isArray(rows) || rows.length > query.count) throw error("PAYLOAD_UNVERIFIED");
          const ids = /* @__PURE__ */ new Set();
          const prices = [];
          for (const row of rows) {
            const item = ownData(row, "itemData");
            if (ownData(item, "resourceId") !== query.definitionId) throw error("DEFINITION_MISMATCH");
            const tradeId = ownData(row, "tradeId");
            if (!(valid(tradeId, 1, Number.MAX_SAFE_INTEGER) || typeof tradeId === "string" && /^[1-9]\d{0,19}$/.test(tradeId)) || ids.has(String(tradeId))) throw error("AUCTION_IDENTITY_UNVERIFIED");
            ids.add(String(tradeId));
            const price = ownData(row, "buyNowPrice");
            if (ownData(row, "tradeState") === "active" && valid(ownData(row, "expires"), 1, 604800) && valid(price, 150, query.maxBuy ?? MAX_PUZZLE_QUOTE_PRICE) && ownData(row, "tradeOwner") === false && ownData(item, "untradeable") === false) prices.push(price);
          }
          return {
            status: "observed",
            season: "27",
            platform: context.platform,
            definitionId: query.definitionId,
            source: "ea-visible-buy-now",
            observedAt: Date.now(),
            returned: rows.length,
            eligible: prices.length,
            price: prices.length ? Math.min(...prices) : null,
            complete: false,
            executable: false,
            marketAvailabilityVerified: false
          };
        });
      }
    });
  }

  // src/fc27/puzzle-concept-draft.js
  var same8 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var blocked6 = (reason) => ({ status: "blocked", reason, executable: false });
  var scope = (input) => ({
    context: input.context,
    challenge: input.challenge,
    policy: input.policy,
    clubLinks: input.clubLinks,
    chemistry: input.chemistry
  });
  var fields2 = [
    "id",
    "definitionId",
    "pile",
    "rating",
    "rarity",
    "nationId",
    "leagueId",
    "teamId",
    "positions",
    "groups",
    "type",
    "special",
    "evolution",
    "cosmetic",
    "concept",
    "academyEnrolled",
    "activeTrade",
    "limitedUse",
    "loans",
    "tradeable",
    "state",
    "locked",
    "activeSquad",
    "protected"
  ];
  var project2 = (item) => Object.fromEntries(fields2.map((key) => [key, item?.[key]]));
  var freeze4 = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze4);
      Object.freeze(value);
    }
    return value;
  };
  function assess2(input, slots, owned, purchases) {
    const { challenge, context, policy } = input;
    if (challenge?.mechanism !== "traditional-puzzle" || challenge.slotCount !== 11 || policy?.onlyUntradeable !== true || !same8(challenge.context, context)) return blocked6("FC27_CONCEPT_SCOPE_UNVERIFIED");
    const pool = collectSafeTraditionalCandidates({
      context,
      policy,
      challenge: { ...challenge, mechanism: "traditional", requirements: [{ kind: "player-count", count: slots.filter(Boolean).length }] },
      inventory: { schema: 1, context, kind: "normalized-inventory", status: "provisional", items: owned }
    });
    if (pool.status !== "candidates" || pool.candidates.length !== owned.length || owned.some((item) => item.pile !== "club" || item.state !== "free" || fields2.some((key) => item[key] === void 0))) {
      return blocked6("FC27_CONCEPT_MATERIAL_PROTECTED");
    }
    const squad = slots.map((slot) => {
      if (!slot) return null;
      const item = slot.kind === "owned" ? owned.find((item2) => item2.id === slot.id) : purchases.find((item2) => item2.definitionId === slot.definitionId);
      return item && { ...item, slot: slot.slot };
    });
    if (squad.some((item, slot) => slots[slot] && (!item || item.definitionId !== slots[slot].definitionId || item.rating !== slots[slot].rating))) return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
    for (const item of purchases) {
      if (item.id !== void 0 || item.pile !== void 0 || item.catalogRef !== `fc27:${item.definitionId}` || item.type !== "player" || item.special !== false || item.evolution !== false || item.cosmetic !== false || item.concept !== false || item.academyEnrolled !== false || ![0, 1].includes(item.rarity) || item.rating > policy.maxRating || item.rating >= 75 && (item.rating < policy.goldRange[0] || item.rating > policy.goldRange[1]) || policy.excludedLeagueIds.includes(item.leagueId) || ![item.nationId, item.leagueId, item.teamId].every((id4) => Number.isSafeInteger(id4) && id4 > 0) || !Array.isArray(item.positions) || !item.positions.length || item.positions.some((p) => !Number.isInteger(p) || p < 0 || p > 27) || !Array.isArray(item.groups) || item.groups.some((id4) => !Number.isSafeInteger(id4) || id4 < 0)) return blocked6("FC27_CONCEPT_CATALOG_UNVERIFIED");
    }
    const parsed = parseFc27SbcRequirements(challenge.rawRequirements, squad.filter(Boolean).length);
    if (parsed.status !== "observed") return blocked6(parsed.reason);
    const needsFacts = parsed.rules.some((rule) => /-(chemistry|team-rating)$/.test(rule.kind));
    const facts2 = needsFacts ? evaluateFc27PuzzleSquad({
      squad,
      formation: challenge.formation,
      chemistry: input.chemistry,
      rating: input.chemistry?.rating
    }) : { status: "observed", teamRating: null, chemistry: null };
    if (facts2.status !== "observed") return blocked6(facts2.reason);
    const validation = matchFc27SbcRequirements({
      requirements: [...parsed.rules, ...puzzleMaterialRules(parsed.rules, squad.filter(Boolean).length)],
      squad: squad.filter(Boolean),
      clubLinks: input.clubLinks,
      chemistry: facts2.chemistry,
      teamRating: facts2.teamRating
    });
    return validation.status === "satisfied" ? { status: "verified", teamFacts: { chemistry: facts2.chemistry, teamRating: facts2.teamRating } } : blocked6(validation.reason);
  }
  function prepareFc27PuzzleConceptDraft(input, suggestion) {
    try {
      const plan = prepareFc27PuzzleConceptPlan({
        challenge: input.challenge,
        plan: { ...suggestion, status: "preview", setId: input.challenge.setId, challengeId: input.challenge.id }
      });
      if (plan.status !== "prepared" || plan.purchaseCount < 1) return blocked6("FC27_CONCEPT_PLAN_UNVERIFIED");
      if (input.inventory?.kind !== "normalized-inventory" || !same8(input.context, input.inventory.context)) return blocked6("FC27_CONCEPT_SCOPE_UNVERIFIED");
      const owned = suggestion.selectedOwned.map((ref) => {
        const found = input.inventory.items.filter((item) => item.id === ref.id);
        return found.length === 1 ? project2(found[0]) : null;
      });
      if (owned.some((item) => !item) || suggestion.purchases.some((item) => input.inventory.items.some((owned2) => owned2.definitionId === item.definitionId))) {
        return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
      }
      const detached = structuredClone(scope(input));
      const purchases = structuredClone(suggestion.purchases);
      const validation = assess2(detached, plan.slots, owned, purchases);
      if (validation.status !== "verified") return validation;
      return freeze4({ ...plan, kind: "puzzle-concept-draft", ...detached, owned, purchases, validation });
    } catch {
      return blocked6("FC27_CONCEPT_PLAN_UNVERIFIED");
    }
  }
  function validateFc27PuzzleConceptDraft(plan, current2, freshOwned) {
    try {
      if (plan?.kind !== "puzzle-concept-draft" || plan.status !== "prepared" || !same8(scope(plan), scope(current2))) return blocked6("FC27_CONCEPT_INPUTS_CHANGED");
      const rebuilt = prepareFc27PuzzleConceptDraft({ ...scope(plan), inventory: {
        schema: 1,
        context: plan.context,
        kind: "normalized-inventory",
        status: "provisional",
        items: plan.owned
      } }, {
        selectedOwned: plan.slots.filter((ref) => ref?.kind === "owned").map(({ id: id4, definitionId, rating, pile, slot }) => ({ id: id4, definitionId, rating, pile, slot })),
        purchases: plan.purchases,
        purchaseCount: plan.purchaseCount
      });
      if (rebuilt.status !== "prepared" || !same8(rebuilt.slots, plan.slots) || rebuilt.estimatedCost !== plan.estimatedCost) return blocked6("FC27_CONCEPT_PLAN_UNVERIFIED");
      if (!Array.isArray(freshOwned) || freshOwned.length >= 250 || new Set(freshOwned.map((item) => item.id)).size !== freshOwned.length || freshOwned.some((item) => !plan.owned.some((ref) => ref.definitionId === item.definitionId))) return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
      const owned = plan.owned.map((expected) => {
        const fresh = freshOwned.find((item) => item.id === expected.id);
        const actual = fresh && project2({ ...fresh, protected: fresh.protected ?? expected.protected });
        return same8(actual, expected) ? actual : null;
      });
      if (owned.some((item) => !item)) return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
      return assess2(current2, plan.slots, owned, plan.purchases);
    } catch {
      return blocked6("FC27_CONCEPT_PLAN_UNVERIFIED");
    }
  }

  // src/fc27/puzzle-concept-session.js
  var fail12 = (reason) => {
    throw new Error(reason);
  };
  var same9 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var reasonOf = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message ?? "") ? error2.message : "FC27_CONCEPT_UNCONFIRMED";
  var blocked7 = (reason) => ({ status: "blocked", reason, saved: false, submitted: false });
  var fc27ConceptPendingKey = (scope2, target = null) => `fcat-fc27-concept-pending:${scope2}${target ? `:${target.setId}:${target.challengeId}` : ""}`;
  var keyOf2 = (scope2, target) => `fcat-fc27-concept-draft:${scope2}:${target.setId}:${target.challengeId}`;
  var indexKeyOf2 = (scope2) => `${fc27ConceptPendingKey(scope2)}:index`;
  var sameTarget = (a, b) => a?.setId === b?.setId && a?.challengeId === b?.challengeId;
  var validTarget = (target) => [target?.setId, target?.challengeId].every((id4) => Number.isSafeInteger(id4) && id4 > 0);
  var accountOf = (context) => ({ accountScope: context?.accountScope, platform: context?.platform });
  var accountMatches = (record, context) => !record?.account || record.account.accountScope === context?.accountScope && record.account.platform === context?.platform;
  async function readFc27ConceptPending(get, scope2, target = null) {
    if (target && !validTarget(target)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
    if (target) {
      const current2 = await get(fc27ConceptPendingKey(scope2, target), null);
      if (current2 !== null) {
        if (!sameTarget(current2, target)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
        return current2;
      }
    }
    const legacy = await get(fc27ConceptPendingKey(scope2), null);
    if (legacy !== null && !validTarget(legacy)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
    if (target) return sameTarget(legacy, target) ? legacy : null;
    if (legacy !== null) return legacy;
    const targets = await get(indexKeyOf2(scope2), []);
    if (!Array.isArray(targets) || targets.some((entry) => !validTarget(entry))) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
    for (const entry of targets) {
      const pending = await readFc27ConceptPending(get, scope2, entry);
      if (pending !== null) return pending;
    }
    return null;
  }
  function createFc27PuzzleConceptSession({
    scope: scope2,
    context,
    get,
    set,
    exclusive,
    checkOtherTransactions,
    createProvider,
    readCurrent,
    assertCurrent,
    now = Date.now,
    operationId
  } = {}) {
    const store = async (key, value) => {
      await set(key, structuredClone(value));
      if (!same9(await get(key, null), value)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
    };
    const evidence = (reply, plan) => {
      if (!reply?.fresh || !Number.isSafeInteger(reply.observedAt) || now() - reply.observedAt < 0 || now() - reply.observedAt > 15e3 || !same9(reply.context, plan.context)) fail12("FC27_CONCEPT_EVIDENCE_UNVERIFIED");
    };
    const validate = (plan, current2, owned) => {
      const result = validateFc27PuzzleConceptDraft(plan, current2, owned);
      if (result.status !== "verified") fail12(result.reason);
    };
    const targetOf = (plan) => ({ setId: plan.challenge.setId, challengeId: plan.challenge.id });
    const pendingOf = (target, context2, identifier) => ({ ...target, operationId: identifier, account: accountOf(context2) });
    const clearPending = async (target) => {
      await store(fc27ConceptPendingKey(scope2, target), null);
      const legacy = await get(fc27ConceptPendingKey(scope2), null);
      if (sameTarget(legacy, target)) await store(fc27ConceptPendingKey(scope2), null);
      const targets = await get(indexKeyOf2(scope2), []);
      if (!Array.isArray(targets)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
      await store(indexKeyOf2(scope2), targets.filter((entry) => !sameTarget(entry, target)));
    };
    const abandon = async (target) => {
      await store(keyOf2(scope2, target), null);
      await clearPending(target);
      return { status: "reset", reason: "FC27_CONCEPT_SQUAD_CLEARED", ...target, saved: false, submitted: false };
    };
    const readback = async (provider, record) => {
      const { plan } = record;
      const saved = await provider.readConceptDraft(plan);
      evidence(saved, plan);
      if (saved.setId !== plan.challenge.setId || saved.challengeId !== plan.challenge.id) fail12("FC27_CONCEPT_READBACK_UNVERIFIED");
      validate(plan, await readCurrent(plan, { afterSave: true }), saved.owned);
      if ((await provider.syncConceptDraft(plan))?.status !== "synchronized") fail12("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
      await store(keyOf2(scope2, targetOf(plan)), { ...record, phase: "saved", updatedAt: now() });
      await clearPending(targetOf(plan));
      return {
        status: "concept-filled",
        reason: "FC27_CONCEPT_SAVED_VERIFIED",
        saved: true,
        submitted: false,
        ...targetOf(plan),
        purchaseCount: plan.purchaseCount,
        estimatedCost: plan.estimatedCost
      };
    };
    return Object.freeze({
      async save(input, suggestion) {
        const plan = prepareFc27PuzzleConceptDraft(input, suggestion);
        if (plan.status !== "prepared") return plan;
        let boundary = false;
        let provider;
        try {
          return await exclusive(scope2, async () => {
            assertCurrent();
            if (!same9(plan.context, context)) fail12("FC27_CONCEPT_INPUTS_CHANGED");
            const target = targetOf(plan);
            if (await checkOtherTransactions() !== true || await readFc27ConceptPending(get, scope2, target) !== null) fail12("FC27_CONCEPT_RECOVERY_REQUIRED");
            const previous = await get(keyOf2(scope2, target), null);
            if (previous?.phase === "save-pending") fail12("FC27_CONCEPT_RECOVERY_REQUIRED");
            provider = await createProvider();
            const current2 = await readCurrent(plan);
            if (current2.squadEmpty !== true) fail12("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
            const replaceBaseline = typeof provider.readPuzzleBaseline === "function" ? await provider.readPuzzleBaseline(plan) : null;
            const selected = plan.slots.filter((ref) => ref?.kind === "owned");
            const fresh = selected.length ? await provider.validateItems({ selected }) : { context: plan.context, fresh: true, observedAt: now(), items: [] };
            evidence(fresh, plan);
            validate(plan, await readCurrent(plan), fresh.items);
            const identifier = operationId();
            if (typeof identifier !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(identifier)) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
            const record = {
              schema: 1,
              scope: scope2,
              operationId: identifier,
              account: { accountScope: plan.context.accountScope, platform: plan.context.platform },
              phase: "save-pending",
              plan,
              updatedAt: now(),
              submitted: false
            };
            const receipt = await provider.saveConceptDraft(plan, () => {
              assertCurrent();
              return true;
            }, async () => {
              assertCurrent();
              evidence(fresh, plan);
              const latest = await readCurrent(plan);
              if (latest.squadEmpty !== true) fail12("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
              validate(plan, latest, fresh.items);
              boundary = true;
              const pending = pendingOf(target, plan.context, record.operationId);
              const targets = await get(indexKeyOf2(scope2), []);
              if (!Array.isArray(targets) || targets.some((entry) => !validTarget(entry))) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
              await store(indexKeyOf2(scope2), [...targets.filter((entry) => !sameTarget(entry, target)), target]);
              await store(fc27ConceptPendingKey(scope2, target), pending);
              await store(keyOf2(scope2, target), record);
              assertCurrent();
              evidence(fresh, plan);
            }, { replaceBaseline });
            if (receipt?.status !== "confirmed" || !same9({ setId: receipt.setId, challengeId: receipt.challengeId }, targetOf(plan))) fail12("FC27_CONCEPT_SAVE_UNCONFIRMED");
            return readback(provider, record);
          }) ?? blocked7("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        } catch (error2) {
          return { ...blocked7(reasonOf(error2)), status: boundary ? "recovery-required" : "blocked", saved: boundary ? null : false };
        } finally {
          provider?.cancel();
        }
      },
      async recover(target, { restartIfEmpty = false } = {}) {
        let provider;
        try {
          const result = await exclusive(scope2, async () => {
            if (await checkOtherTransactions() !== true) fail12("FC27_RECOVERY_REQUIRED");
            assertCurrent();
            const pending = await readFc27ConceptPending(get, scope2, target);
            const record = await get(keyOf2(scope2, target), null);
            if (!pending && !record) return { status: "absent" };
            if (pending && (pending.setId !== target.setId || pending.challengeId !== target.challengeId)) {
              return { ...blocked7("FC27_CONCEPT_RECOVERY_REQUIRED"), recoverySetId: pending.setId, recoveryChallengeId: pending.challengeId };
            }
            if (!record || record.schema !== 1 || record.scope !== scope2 || record.submitted !== false || !same9(targetOf(record.plan), target) || !["saved", "save-pending"].includes(record.phase) || typeof record.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(record.operationId) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 || record.updatedAt > now() || !same9(record.plan?.context, context) || !accountMatches(record, record.plan?.context) || pending?.account && !accountMatches(pending, record.plan?.context) || pending && pending.operationId !== record.operationId) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
            validate(record.plan, record.plan, record.plan.owned);
            if (restartIfEmpty && !pending && record.phase === "saved" && (await readCurrent(record.plan)).squadEmpty === true) {
              assertCurrent();
              return { status: "reset", reason: "FC27_PUZZLE_LOCAL_SQUAD_CLEARED", ...target, saved: false, submitted: false };
            }
            assertCurrent();
            provider = await createProvider();
            try {
              return { ...await readback(provider, record), restored: true };
            } catch (error2) {
              if (error2?.message === "FC27_CONCEPT_SQUAD_CLEARED") {
                if (pending || record.phase === "save-pending") fail12("FC27_CONCEPT_RECOVERY_REQUIRED");
                return abandon(target);
              }
              throw error2;
            }
          });
          return result?.status === "absent" ? null : result ?? blocked7("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        } catch (error2) {
          return blocked7(reasonOf(error2));
        } finally {
          provider?.cancel();
        }
      }
    });
  }

  // src/fc27/puzzle-buy-session.js
  var same10 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var fail13 = (reason) => {
    throw new Error(reason);
  };
  var integer8 = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
  var safeReason4 = (e) => /^FC27_[A-Z0-9_]+$/.test(e?.message ?? "") ? e.message : "FC27_BUY_UNCONFIRMED";
  var puzzleBuyKey = (scope2, target) => `fcat-fc27-puzzle-buy:${scope2}:${target.setId}:${target.challengeId}`;
  var puzzleBuyPendingKey = (scope2) => `fcat-fc27-puzzle-buy-pending:${scope2}`;
  var settled = (record) => Array.isArray(record?.entries) && record.entries.every((e) => !["buy-pending", "bought", "move-pending"].includes(e.state)) && record.phase !== "save-pending";
  function createFc27PuzzleBuySession({
    scope: scope2,
    context,
    get,
    set,
    exclusive,
    loadDraft,
    createAdapter,
    assertCurrent,
    shouldStop = () => false,
    onProgress = () => {
    }
  } = {}) {
    const store = async (key, value) => {
      await set(key, structuredClone(value));
      if (!same10(await get(key, null), value)) fail13("FC27_BUY_JOURNAL_UNCONFIRMED");
    };
    const check = (record) => {
      if (!record || record.schema !== 1 || record.scope !== scope2 || !same10(record.context, context) || !Array.isArray(record.entries) || record.entries.length > 32 || record.entries.some((e) => !integer8(e.slot) || e.slot > 31 || !integer8(e.definitionId, 1) || !["waiting", "buy-pending", "bought", "move-pending", "move-rejected", "club"].includes(e.state) || e.state !== "waiting" && (!integer8(e.itemId, 1) || (e.source === "owned" ? e.state !== "club" || e.tradeId !== "0" || e.price !== 0 : typeof e.tradeId !== "string" || !/^[1-9]\d{0,19}$/.test(e.tradeId) || !integer8(e.price, 150)))) || new Set(record.entries.map((e) => e.slot)).size !== record.entries.length || !["ready", "save-pending", "saved"].includes(record.phase)) fail13("FC27_BUY_JOURNAL_UNCONFIRMED");
    };
    const summary = (record) => {
      const entries2 = Array.isArray(record?.entries) ? record.entries : [];
      const acquired = entries2.filter((e) => ["bought", "move-pending", "move-rejected", "club"].includes(e.state));
      return {
        purchased: acquired.filter((e) => e.source !== "owned").length,
        reused: acquired.filter((e) => e.source === "owned").length,
        fulfilled: acquired.length,
        total: entries2.length,
        spent: acquired.reduce((sum, e) => sum + (integer8(e.price) ? e.price : 0), 0)
      };
    };
    return Object.freeze({
      async execute(target, { budget, quoteCeiling = null, expectedOperationId, approved = false, recoverOnly = false } = {}) {
        let adapter;
        let record;
        try {
          target = { setId: target?.setId, challengeId: target?.challengeId };
          if (!integer8(target.setId, 1) || !integer8(target.challengeId, 1)) fail13("FC27_BUY_PLAN_CHANGED");
          if (approved !== true || !integer8(budget) || budget > 165e6 || quoteCeiling !== null && (!integer8(quoteCeiling, 150) || quoteCeiling > 15e6)) fail13("FC27_BUY_APPROVAL_REQUIRED");
          return await exclusive(scope2, async () => {
            assertCurrent();
            const draft = await loadDraft(target);
            if (!draft || draft.phase !== "saved" || draft.operationId !== expectedOperationId || !same10(draft.plan.context, context)) fail13("FC27_BUY_PLAN_CHANGED");
            const key = puzzleBuyKey(scope2, target);
            const pending = await get(puzzleBuyPendingKey(scope2), null);
            if (pending !== null && (pending.key !== key || pending.operationId !== draft.operationId)) fail13("FC27_BUY_RECOVERY_REQUIRED");
            record = await get(key, null);
            if (record) {
              check(record);
              if (record.operationId !== draft.operationId) {
                if (!settled(record) || pending) fail13("FC27_BUY_RECOVERY_REQUIRED");
                record = null;
              } else if (!same10(record.base, draft.plan)) fail13("FC27_BUY_PLAN_CHANGED");
            }
            record ??= {
              schema: 1,
              scope: scope2,
              context,
              operationId: draft.operationId,
              target,
              base: draft.plan,
              phase: "ready",
              applied: [],
              entries: draft.plan.slots.filter((s) => s?.kind === "concept").map((s) => ({ slot: s.slot, definitionId: s.definitionId, state: "waiting" }))
            };
            check(record);
            if (!same10(record.target, target) || !same10(record.base.context, context) || record.entries.length !== record.base.slots.filter((s) => s?.kind === "concept").length || record.entries.some((e) => record.base.slots[e.slot]?.kind !== "concept" || record.base.slots[e.slot].definitionId !== e.definitionId) || !Array.isArray(record.applied) || record.applied.some((e) => e.state !== "club" || !record.entries.some((entry) => same10(entry, e)))) fail13("FC27_BUY_JOURNAL_UNCONFIRMED");
            adapter = await createAdapter();
            if (record.phase === "save-pending") {
              await adapter.recoverSave(record);
              record.applied = record.entries.filter((e) => e.state === "club").map((e) => ({ ...e }));
              record.phase = "saved";
              await store(key, record);
              await store(puzzleBuyPendingKey(scope2), null);
            }
            for (const entry of record.entries.filter((e) => ["buy-pending", "bought", "move-pending", "move-rejected"].includes(e.state))) {
              const location = await adapter.locate(entry);
              if (location === "club") entry.state = "club";
              else if (location === "purchased") entry.state = "bought";
              else fail13("FC27_BUY_RECEIPT_UNCONFIRMED");
            }
            await store(key, record);
            await adapter.verifySquad(record);
            await store(key, record);
            const persist = () => store(key, record);
            const mark = async () => {
              await store(puzzleBuyPendingKey(scope2), { key, operationId: record.operationId });
              await persist();
            };
            const report = (phase = "progress", entry = null, extra = {}) => {
              try {
                const index = entry ? record.entries.indexOf(entry) : -1;
                onProgress({
                  ...summary(record),
                  failures: failures.map((item) => ({ ...item })),
                  phase,
                  index: index >= 0 ? index + 1 : null,
                  total: record.entries.length,
                  ...entry ? { slot: entry.slot, definitionId: entry.definitionId } : {},
                  ...extra
                });
              } catch {
              }
            };
            let stopReason = null;
            const failures = [];
            try {
              for (const entry of record.entries) {
                if (entry.state === "club") continue;
                try {
                  if (["buy-pending", "bought", "move-pending"].includes(entry.state)) {
                    const location = await adapter.locate(entry);
                    if (location === "club") {
                      entry.state = "club";
                      await persist();
                    } else if (location === "purchased") {
                      entry.state = "bought";
                      await persist();
                    } else fail13("FC27_BUY_RECEIPT_UNCONFIRMED");
                  }
                  if (entry.state === "waiting") {
                    assertCurrent();
                    if (recoverOnly || shouldStop()) {
                      stopReason = "FC27_BUY_STOPPED";
                      break;
                    }
                    const remaining = budget - summary(record).spent;
                    await adapter.verifyCurrent(record);
                    report("search", entry);
                    const quote = await adapter.find(entry.definitionId, quoteCeiling ?? Infinity);
                    if (!quote) {
                      failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: "FC27_BUY_NO_LISTING" });
                      report("failed", entry, { reason: "FC27_BUY_NO_LISTING" });
                      continue;
                    }
                    if (quote.unavailable) {
                      failures.push({
                        slot: entry.slot,
                        definitionId: entry.definitionId,
                        reason: quote.reason,
                        httpStatus: quote.httpStatus,
                        errorCode: quote.errorCode
                      });
                      report("failed", entry, quote);
                      continue;
                    }
                    if (quote.definitionId !== entry.definitionId || !integer8(quote.itemId, 1) || !integer8(quote.price, 150) || quoteCeiling !== null && quote.price > quoteCeiling || typeof quote.tradeId !== "string" || !/^[1-9]\d{0,19}$/.test(quote.tradeId)) fail13("FC27_BUY_QUOTE_UNVERIFIED");
                    report("price-ready", entry, { price: quote.price });
                    if (quote.price > remaining) {
                      failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: "FC27_BUY_BUDGET_EXCEEDED" });
                      report("failed", entry, { reason: "FC27_BUY_BUDGET_EXCEEDED", price: quote.price });
                      continue;
                    }
                    assertCurrent();
                    if (shouldStop()) {
                      stopReason = "FC27_BUY_STOPPED";
                      break;
                    }
                    Object.assign(entry, quote, { state: "buy-pending" });
                    await mark();
                    report("buying", entry, { price: entry.price });
                    const receipt = await adapter.buy(entry);
                    if (receipt.status === "rejected") {
                      entry.state = "waiting";
                      await persist();
                      failures.push({
                        slot: entry.slot,
                        definitionId: entry.definitionId,
                        reason: receipt.reason,
                        httpStatus: receipt.httpStatus,
                        errorCode: receipt.errorCode
                      });
                      report("failed", entry, receipt);
                      continue;
                    }
                    if (receipt.status !== "bought" || receipt.itemId !== entry.itemId || receipt.definitionId !== entry.definitionId || receipt.tradeId !== entry.tradeId || receipt.price !== entry.price) fail13("FC27_BUY_RECEIPT_UNCONFIRMED");
                    entry.state = "bought";
                    await persist();
                    report("bought", entry, { price: entry.price });
                  }
                  if (entry.state === "bought") {
                    entry.state = "move-pending";
                    await mark();
                    report("moving", entry, { price: entry.price });
                    const moved = await adapter.move(entry);
                    if (moved?.status === "rejected") {
                      entry.state = "move-rejected";
                      await persist();
                      failures.push({
                        slot: entry.slot,
                        definitionId: entry.definitionId,
                        reason: moved.reason,
                        httpStatus: moved.httpStatus,
                        errorCode: moved.errorCode
                      });
                      report("failed", entry, moved);
                      continue;
                    }
                    if (await adapter.locate(entry) !== "club") fail13("FC27_BUY_MOVE_UNCONFIRMED");
                    entry.state = "club";
                    await persist();
                    report("completed", entry, { price: entry.price });
                  }
                } finally {
                  report("progress", entry);
                  await adapter.afterPlayer?.();
                }
              }
            } catch (e) {
              stopReason = safeReason4(e);
            }
            record.lastResult = { reason: stopReason ?? failures[0]?.reason ?? "FC27_BUY_COMPLETED", failures };
            await persist();
            if (!settled(record)) return { status: "recovery-required", ...record.lastResult, ...summary(record) };
            const acquired = record.entries.filter((e) => e.state === "club");
            if (!same10(acquired, record.applied)) {
              const result = await adapter.save(record, async () => {
                record.phase = "save-pending";
                await mark();
              });
              record.applied = (result?.applied ?? acquired).map((e) => ({ ...e }));
              record.phase = "saved";
              await persist();
            }
            await store(puzzleBuyPendingKey(scope2), null);
            return {
              status: acquired.length === record.entries.length ? "purchased" : "partial",
              ...record.lastResult,
              ...summary(record),
              saved: acquired.length > 0 && record.applied.length === acquired.length,
              replacementPending: record.applied.length !== acquired.length,
              submitted: false
            };
          });
        } catch (e) {
          if (record) {
            record.lastResult = { reason: safeReason4(e), failures: record.lastResult?.failures ?? [] };
            try {
              await set(`fcat-fc27-puzzle-buy-last:${scope2}`, { target: record.target, ...record.lastResult, ...summary(record) });
            } catch {
            }
          }
          return {
            status: record && !settled(record) ? "recovery-required" : "blocked",
            reason: safeReason4(e),
            ...record ? summary(record) : {},
            submitted: false
          };
        } finally {
          adapter?.cancel?.();
        }
      }
    });
  }

  // src/fc27/puzzle-buy-slots.js
  function puzzleBuySlotRefs(base, entries2 = []) {
    return base.slots.map((slot) => {
      if (!slot) return null;
      const entry = entries2.find((entry2) => entry2.slot === slot.slot && entry2.state === "club");
      return {
        slot: slot.slot,
        id: entry?.itemId ?? (slot.kind === "concept" ? slot.definitionId : slot.id),
        definitionId: slot.definitionId,
        concept: !entry && slot.kind === "concept"
      };
    });
  }
  function puzzleBuyMatchesSlots(record, slots) {
    if (!Array.isArray(slots) || slots.length !== record.base.slots.length) return false;
    const old = puzzleBuySlotRefs(record.base, record.applied);
    const next = puzzleBuySlotRefs(record.base, record.entries);
    const same13 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return slots.every((slot, i) => same13(slot, old[i]) || same13(slot, next[i]));
  }

  // src/adapters/ea/fc27-purchase-squad.js
  var same11 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var refs2 = (squad) => squad?._players?.slice(0, 11).map((slot, index) => [0, -1].includes(slot._item.id) ? null : { slot: index, id: slot._item.id, definitionId: slot._item.definitionId, concept: slot._item.concept });
  var planRefs = (slots) => slots.filter(Boolean).map((slot) => slot.concept ? { slot: slot.slot, kind: "concept", definitionId: slot.definitionId, catalogRef: `fc27:${slot.definitionId}` } : { slot: slot.slot, kind: "owned", definitionId: slot.definitionId, id: slot.id, pile: "club" });
  async function createFc27PurchaseSquad(root, { canWrite, assertTarget }) {
    const context = readFc27Context(root), dao = root.services.SBC.sbcDAO;
    const runtime = await verifyFc27Methods(root, [[
      "UTSquadBuildingChallengeDAO.prototype.loadChallenge",
      "04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e"
    ]]);
    const transport = await createFc27TransactionTransport(root, { canWrite });
    const assert = () => {
      runtime();
      assertTarget();
      if (!same11(context, readFc27Context(root)) || dao !== root.services.SBC.sbcDAO || dao.loadChallenge !== root.UTSquadBuildingChallengeDAO.prototype.loadChallenge) throw Error("FC27_BUY_CONTEXT_CHANGED");
    };
    const load = async (record) => {
      assert();
      const squad = await new Promise((resolve, reject) => {
        const owner = {};
        let observable;
        let done = false;
        const finish = (error2, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            observable?.unobserve(owner);
          } catch {
          }
          if (error2) reject(error2);
          else resolve(value);
        };
        const timer = setTimeout(() => finish(Error("FC27_BUY_SAVE_UNCONFIRMED")), 16e3);
        try {
          observable = dao.loadChallenge(record.target.challengeId, true);
          observable.observe(owner, (_sender, reply) => {
            if (reply?.success && reply.status === 200 && reply.response?.squad) finish(null, reply.response.squad);
            else finish(Error("FC27_BUY_SAVE_UNCONFIRMED"));
          });
        } catch {
          finish(Error("FC27_BUY_SAVE_UNCONFIRMED"));
        }
      });
      assert();
      const layout = projectFc27PuzzleLayout(root, squad, record.target);
      if (!same11(layout.formation, record.base.challenge.formation) || !same11(layout.simpleBrickIndices, record.base.challenge.brickIndices) || layout.customBrickIndices.length) throw Error("FC27_BUY_SQUAD_CHANGED");
      return squad;
    };
    const sync = async (record, squad) => {
      const local = readFc27PuzzlePageSlots(root, record.target);
      if (!puzzleBuyMatchesSlots(record, local)) throw Error("FC27_BUY_SQUAD_CHANGED");
      await synchronizeFc27PurchasedPuzzleSquad(
        root,
        record.target,
        squad,
        planRefs(puzzleBuySlotRefs(record.base, record.entries)),
        planRefs(local),
        () => {
          assert();
          if (!puzzleBuyMatchesSlots(record, readFc27PuzzlePageSlots(root, record.target))) throw Error("FC27_BUY_SQUAD_CHANGED");
        }
      );
    };
    return {
      async verifySquad(record) {
        if (!puzzleBuyMatchesSlots(record, refs2(await load(record)))) throw Error("FC27_BUY_SQUAD_CHANGED");
      },
      async save(record, beforeDispatch) {
        let squad = await load(record);
        const expected = puzzleBuySlotRefs(record.base, record.entries);
        if (!same11(refs2(squad), expected)) {
          if (!puzzleBuyMatchesSlots(record, refs2(squad))) throw Error("FC27_BUY_SQUAD_CHANGED");
          const players = squad._players.map((slot, index) => ({ index, itemData: {
            id: expected[index]?.id ?? slot._item.id,
            dream: expected[index]?.concept ?? false
          } }));
          const result = await transport.request("save-purchase", {
            challengeId: record.target.challengeId,
            players,
            simpleBrickIndices: record.base.challenge.brickIndices,
            emptySlotIndices: expected.flatMap((slot, index) => slot === null ? [index] : []),
            conceptSlots: expected.filter((slot) => slot?.concept).map(({ slot, definitionId }) => ({ slot, definitionId }))
          }, async () => {
            assert();
            if (!puzzleBuyMatchesSlots(record, readFc27PuzzlePageSlots(root, record.target))) throw Error("FC27_BUY_SQUAD_CHANGED");
            await beforeDispatch();
          });
          if (result?.success !== true || result.status !== 200) throw Error("FC27_BUY_SAVE_UNCONFIRMED");
          squad = await load(record);
        }
        if (!same11(refs2(squad), expected)) throw Error("FC27_BUY_SAVE_UNCONFIRMED");
        await sync(record, squad);
      },
      async recoverSave(record) {
        const squad = await load(record);
        if (!same11(refs2(squad), puzzleBuySlotRefs(record.base, record.entries))) throw Error("FC27_BUY_SAVE_UNCONFIRMED");
        await sync(record, squad);
      },
      cancel: () => transport.cancel()
    };
  }

  // src/fc27/fsu-auction-search.js
  /*!
   * Adapted from FSU 26.09 events.readAuctionPrices / buyConceptPlayer.
   * Copyright (c) Futcd_kcka
   * Copyright (c) 2026 ShatteredLancer (local modifications)
   * MIT License
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  async function readFsuStyleAuctionPrices({
    search,
    above,
    below,
    initial,
    ceiling = Infinity,
    attempts = 5,
    wait = async () => {
    },
    onResults = () => {
    },
    onSearchFailure = () => {
    }
  }) {
    let price = Math.min(initial, ceiling);
    const queried = /* @__PURE__ */ new Set();
    let items = [];
    while (attempts-- > 0) {
      if (price > ceiling || queried.has(price)) break;
      const response = await search(price);
      const reply = Array.isArray(response) ? { success: true, data: { items: response } } : response;
      if (!reply.success) {
        onSearchFailure(reply);
        break;
      }
      onResults();
      const page = reply.data.items;
      items = items.concat(page);
      queried.add(price);
      if (!page.length) price = above(price);
      else if (page.length === 21) price = below(price);
      else break;
      if (attempts > 0) await wait(0.2, 0.5);
    }
    return items;
  }

  // src/adapters/ea/fc27-puzzle-buy.js
  var FC27_BUY_SERVICE_METHODS = Object.freeze([
    ["bid", "998a2fe52b55da1fd5a4e96263dcefb153769ced27d093117af1e9bfac1e820a"],
    ["move", "021d1826feb561a8e66721559bc223b69346f51287f2993b4eadbb0c3bf353f4"]
  ]);
  var same12 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var id3 = (n) => Number.isSafeInteger(n) && n > 0;
  var fail14 = (reason) => {
    throw new Error(reason);
  };
  function readFc27PuzzleBuyPlan(root, target) {
    const page = readFc27PurchasePage(root, target);
    if (!page) fail14("FC27_BUY_TARGET_CHANGED");
    const { items, slots: refs3 } = page;
    if (refs3.filter(Boolean).some((ref) => !id3(ref.id) || !id3(ref.definitionId) || typeof ref.concept !== "boolean")) fail14("FC27_BUY_PLAN_CHANGED");
    const purchases = refs3.filter((ref) => ref?.concept).map((ref) => {
      const item = items[ref.slot];
      return {
        definitionId: ref.definitionId,
        rating: item._rating,
        nationId: item.nationId,
        teamId: item.teamId,
        leagueId: item.leagueId,
        preferredPosition: item.preferredPosition
      };
    });
    return {
      context: readFc27Context(root),
      kind: "native-concept-purchase",
      challenge: { id: target.challengeId, setId: target.setId },
      slots: refs3.map((ref) => !ref ? null : ref.concept ? { slot: ref.slot, kind: "concept", definitionId: ref.definitionId } : { slot: ref.slot, kind: "owned", id: ref.id, definitionId: ref.definitionId, pile: "club" }),
      purchases,
      purchaseCount: purchases.length
    };
  }
  async function createFc27PuzzleBuyAdapter(root, {
    canWrite,
    assertTarget,
    referencePrice,
    attempts = 5,
    onEvent = () => {
    },
    wait = (min, max) => new Promise((resolve) => setTimeout(
      resolve,
      Math.floor(Math.random() * (max * 1e3 - min * 1e3 + 1)) + min * 1e3
    ))
  } = {}) {
    const context = readFc27Context(root);
    const service = root.services.Item;
    const proto = Object.getPrototypeOf(service);
    const runtime = await verifyFc27Methods(
      { service: proto, crypto: root.crypto },
      FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash])
    );
    const functions = Object.fromEntries(["bid", "move", "searchTransferMarket", "clearTransferMarketCache", "requestUnassignedItems"].map((name) => [name, service[name]]));
    if (Object.values(functions).some((fn) => typeof fn !== "function") || root.ItemPile.CLUB !== 7 || root.ItemPile.PURCHASED !== 6 || root.GameCurrency.COINS !== "COINS") fail14("FC27_BUY_RUNTIME_UNVERIFIED");
    let provider;
    const legacyProvider = async () => provider ??= await createFc27PurchaseSquad(root, { canWrite, assertTarget });
    let club;
    const auctions = /* @__PURE__ */ new Map();
    const confirmedMoves = /* @__PURE__ */ new Set();
    let closed = false;
    let currentRecord = null;
    const diagnostic = (stage, values6 = {}) => {
      onEvent({ stage, ...values6 });
    };
    const pin = (pgid) => root.services.PIN.sendData(root.PINEventType.PAGE_VIEW, { type: root.PIN_PAGEVIEW_EVT_TYPE, pgid });
    const assertAccount = () => {
      runtime();
      if (closed || !same12(context, readFc27Context(root)) || root.services.Item !== service || Object.getPrototypeOf(service) !== proto || Object.keys(functions).some((name) => service[name] !== functions[name])) fail14("FC27_BUY_CONTEXT_CHANGED");
    };
    const writable = () => {
      assertAccount();
      if (canWrite() !== true) fail14("FC27_BUY_DISABLED");
    };
    const observe = async (operation, mutation = false) => {
      assertAccount();
      if (mutation) writable();
      return new Promise((resolve, reject) => {
        const owner = {};
        let observable;
        let done = false;
        const finish = (error2, result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            observable?.unobserve(owner);
          } catch {
          }
          if (error2) reject(error2);
          else resolve(result);
        };
        const timer = setTimeout(() => finish(new Error("FC27_BUY_RESPONSE_UNCONFIRMED")), 16e3);
        try {
          observable = operation();
          observable.observe(owner, (_sender, reply) => {
            try {
              assertAccount();
              finish(null, reply);
            } catch (error2) {
              finish(error2);
            }
          });
        } catch {
          finish(new Error("FC27_BUY_RESPONSE_UNCONFIRMED"));
        }
      });
    };
    const coins = () => {
      const amount = root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount;
      if (!Number.isSafeInteger(amount) || amount < 0) fail14("FC27_BUY_BALANCE_UNVERIFIED");
      return amount;
    };
    const verifyCurrent = (record) => {
      assertAccount();
      assertTarget();
      const page = readFc27PurchasePageSlots(root, record.target, record);
      if (!puzzleBuyMatchesSlots(record, page)) fail14("FC27_BUY_SQUAD_CHANGED");
    };
    return Object.freeze({
      async verifySquad(record) {
        currentRecord = record;
        verifyCurrent(record);
        const used = root.repositories.Item.numItemsInCache(root.ItemPile.PURCHASED);
        if (used >= root.MAX_NEW_ITEMS) fail14("FC27_BUY_UNASSIGNED_FULL");
      },
      verifyCurrent,
      async find(definitionId, maxBuy) {
        await verifyCurrent(currentRecord);
        const criteria = new root.UTSearchCriteriaDTO();
        Object.assign(criteria, { defId: [definitionId], type: root.SearchType.PLAYER, category: root.SearchCategory.ANY });
        const model = new root.UTBucketedItemSearchViewModel();
        model.searchFeature = root.ItemSearchFeature.MARKET;
        model.defaultSearchCriteria.type = criteria.type;
        model.defaultSearchCriteria.category = criteria.category;
        model.updateSearchCriteria(criteria);
        const item = readFc27PurchasePage(root, currentRecord.target)?.items.find((card) => card?.definitionId === definitionId);
        if (!item || typeof referencePrice !== "function") fail14("FC27_BUY_REFERENCE_PRICE_UNAVAILABLE");
        const initial = Number(await referencePrice({
          definitionId,
          rating: item._rating,
          nationId: item.nationId,
          teamId: item.teamId,
          leagueId: item.leagueId,
          preferredPosition: item.preferredPosition
        }));
        if (!Number.isFinite(initial) || initial < 0) fail14("FC27_BUY_REFERENCE_PRICE_INVALID");
        diagnostic("reference", { definitionId, price: initial });
        let searchFailure = null;
        const items = await readFsuStyleAuctionPrices({
          ceiling: maxBuy,
          initial,
          attempts,
          wait,
          onResults: () => pin("Transfer Market Results - List View"),
          onSearchFailure: (reply) => {
            searchFailure = { reason: "FC27_BUY_SEARCH_FAILED", ...responseCodes(reply) };
          },
          above: (price) => root.UTCurrencyInputControl.getIncrementAboveVal(price),
          below: (price) => root.UTCurrencyInputControl.getIncrementBelowVal(price),
          search: async (price) => {
            verifyCurrent(currentRecord);
            criteria.maxBuy = price;
            model.updateSearchCriteria(criteria);
            service.clearTransferMarketCache();
            const reply = await observe(() => service.searchTransferMarket(model.searchCriteria, 1));
            diagnostic("search", { definitionId, maxBuy: model.searchCriteria.maxBuy, ...responseCodes(reply), count: reply.data?.items?.length ?? 0 });
            if (reply.success && (!Array.isArray(reply.data?.items) || reply.data.items.some((card) => card.definitionId !== definitionId))) fail14("FC27_BUY_QUOTE_UNVERIFIED");
            return reply;
          }
        });
        items.sort((a, b) => b.getAuctionData().buyNowPrice - a.getAuctionData().buyNowPrice);
        if (!items.length) return searchFailure ? { unavailable: true, ...searchFailure } : null;
        const selected = items[items.length - 1];
        const auction = selected.getAuctionData();
        const tradeId = String(auction.tradeId);
        if (!/^[1-9]\d{0,19}$/.test(tradeId)) fail14("FC27_BUY_QUOTE_UNVERIFIED");
        auctions.set(tradeId, selected);
        return { definitionId, itemId: selected.id, tradeId, price: auction.buyNowPrice };
      },
      async buy(entry) {
        await verifyCurrent(currentRecord);
        writable();
        const item = auctions.get(entry.tradeId);
        const auction = item?.getAuctionData();
        if (!item || item.id !== entry.itemId || item.definitionId !== entry.definitionId || String(auction.tradeId) !== entry.tradeId || auction.buyNowPrice !== entry.price) {
          return { status: "rejected", reason: "FC27_BUY_LISTING_CHANGED" };
        }
        if (!auction.canBuy(coins())) return { status: "rejected", reason: "FC27_BUY_INSUFFICIENT_COINS" };
        if (!(auction.getSecondsRemaining() > 0)) return { status: "rejected", reason: "FC27_BUY_LISTING_CHANGED" };
        pin("Item - Detail View");
        const reply = await observe(() => {
          verifyCurrent(currentRecord);
          return service.bid(item, entry.price);
        }, true);
        diagnostic("bid", { definitionId: entry.definitionId, price: entry.price, ...responseCodes(reply) });
        if (reply?.success === true && Array.isArray(reply.data?.itemIds) && reply.data.itemIds.length === 1 && reply.data.itemIds[0] === entry.itemId) {
          return { status: "bought", itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId, price: entry.price };
        }
        if (reply?.success === false) return {
          status: "rejected",
          ...responseCodes(reply),
          reason: reply.error?.code !== void 0 && reply.error.code === root.UtasErrorCode.PERMISSION_DENIED ? "FC27_BUY_LISTING_UNAVAILABLE" : "FC27_BUY_REJECTED"
        };
        return { status: "unknown" };
      },
      async locate(entry) {
        assertAccount();
        if (confirmedMoves.has(entry.itemId)) return "club";
        club ??= await createFc27ClubReadTransport(root);
        const matches = await club.readPage({ start: 0, count: 250, definitionIds: [entry.definitionId] });
        const found = matches.find((item) => item.id === entry.itemId && item.definitionId === entry.definitionId);
        if (found) return "club";
        root.repositories.Item.setDirty(root.ItemPile.PURCHASED);
        const reply = await observe(() => service.requestUnassignedItems());
        if (reply?.success !== true || reply.status !== 200 || !Array.isArray(reply.response?.items)) fail14("FC27_BUY_RECEIPT_UNCONFIRMED");
        const items = reply.response.items.filter((item) => item.id === entry.itemId && item.definitionId === entry.definitionId);
        if (items.length !== 1) return "unknown";
        auctions.set(entry.tradeId, items[0]);
        return "purchased";
      },
      async move(entry) {
        writable();
        const item = auctions.get(entry.tradeId);
        if (!item || item.id !== entry.itemId || item.definitionId !== entry.definitionId) fail14("FC27_BUY_MOVE_UNCONFIRMED");
        const reply = await observe(() => service.move(item, root.ItemPile.CLUB), true);
        diagnostic("move", { definitionId: entry.definitionId, ...responseCodes(reply) });
        if (reply?.success === false) return { status: "rejected", reason: "FC27_BUY_MOVE_REJECTED", ...responseCodes(reply) };
        if (reply?.success !== true || !Array.isArray(reply.data?.itemIds) || !reply.data.itemIds.includes(entry.itemId) || item.pile !== root.ItemPile.CLUB) fail14("FC27_BUY_MOVE_UNCONFIRMED");
        confirmedMoves.add(entry.itemId);
      },
      async save(record, beforeDispatch) {
        await verifyCurrent(record);
        if (record.base.kind !== "native-concept-purchase") await (await legacyProvider()).save(record, beforeDispatch);
        else {
          const slots = readFc27PurchasePageSlots(root, record.target, record);
          return { applied: record.entries.filter((entry) => entry.state === "club" && slots[entry.slot]?.id === entry.itemId && slots[entry.slot]?.concept === false) };
        }
      },
      async recoverSave(record) {
        await (await legacyProvider()).recoverSave(record);
      },
      afterPlayer: () => wait(0.5, 1),
      cancel() {
        closed = true;
        provider?.cancel();
      }
    });
  }
  function responseCodes(reply) {
    return {
      httpStatus: Number.isSafeInteger(reply?.status) ? reply.status : null,
      errorCode: Number.isSafeInteger(reply?.error?.code) ? reply.error.code : null
    };
  }

  // src/fc27/fsu-reference-price.js
  var positions = ["GK", "SW", "RWB", "RB", "RCB", "CB", "LCB", "LB", "LWB", "RDM", "CDM", "LDM", "RM", "RCM", "CM", "LCM", "LM", "RAM", "CAM", "LAM", "RF", "CF", "LF", "RW", "RS", "ST", "LS", "LW"];
  function createFsuReferencePrice({ season, platform, request, get, set }) {
    platform = platform.split(":")[0].toLowerCase();
    const apiPlatform = platform === "pc" ? "PC" : "PS";
    const prefix = platform === "pc" ? "pc_" : "ps_";
    const key = `fcat-futbin-ids:${season}`;
    const prices = /* @__PURE__ */ new Map();
    return async (player) => {
      const ids = await get(key, {});
      const recordPrice = (data2, definitionId) => {
        prices.set(Number(definitionId), data2.LCPrice ?? data2[`${prefix}LCPrice`] ?? data2.price ?? 0);
      };
      const base = `https://www.futbin.org/futbin/api/${season}/`;
      let url;
      if (Object.hasOwn(ids, player.definitionId)) {
        url = `${base}fetchPlayerInformationMinimal?ID=${ids[player.definitionId]}&platform=${apiPlatform}`;
      } else {
        const position = positions[player.preferredPosition];
        url = `${base}getFilteredPlayers?platform=${apiPlatform}&nation=${player.nationId}&league=${player.leagueId}&rating=${player.rating}-${player.rating}&club=${player.teamId}&sort=rating&position=${position}&order=desc&page=1`;
      }
      const response = await request(url);
      const data = JSON.parse(response);
      for (const row of Object.values(data.data ?? {})) {
        if (url.includes("getFilteredPlayers?")) {
          recordPrice(row, row.resource_id);
          ids[row.resource_id] = row.ID;
        } else recordPrice(row, row.Player_Resource);
      }
      if (url.includes("getFilteredPlayers?")) await set(key, ids);
      return prices.get(player.definitionId) ?? 0;
    };
  }

  // src/adapters/browser/fc27-futbin-http.js
  function createFc27FutbinHttp(gmRequest) {
    return (url) => new Promise((resolve, reject) => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://www.futbin.org" || !/^\/futbin\/api\/27\/(getFilteredPlayers|fetchPlayerInformationMinimal)$/.test(parsed.pathname) || parsed.username || parsed.password || typeof gmRequest !== "function") {
        reject(Error("FC27_BUY_REFERENCE_PRICE_UNAVAILABLE"));
        return;
      }
      gmRequest({
        method: "GET",
        url,
        anonymous: true,
        headers: { "Content-Type": "application/json" },
        onload: (response) => {
          if (![200, 201].includes(response.status)) reject(Error(`FC27_BUY_REFERENCE_HTTP_${Number(response.status) || 0}`));
          else resolve(response.responseText);
        },
        onerror: () => reject(Error("FC27_BUY_REFERENCE_PRICE_UNAVAILABLE"))
      });
    });
  }

  // src/adapters/browser/fc27-acceptance-session.js
  var blocked8 = (reason) => ({ status: "blocked", reason });
  var safeReason5 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message) ? error2.message : "FC27_ACCEPTANCE_UNCONFIRMED";
  var puzzleInput = (input) => ({
    context: input.context,
    challenge: input.challenge,
    inventory: input.inventory,
    policy: input.policy,
    clubLinks: input.clubLinks,
    chemistry: input.chemistry,
    squadEmpty: input.squadEmpty
  });
  var puzzleCatalogCacheKey = (scope2, setId, challengeId = "all") => `fcat-fc27-puzzle-catalog:${scope2}:${setId}:${challengeId}`;
  var cacheCatalogProjection = (catalog, scope2, setId, reasonOverride = void 0) => ({
    schema: 1,
    scope: scope2,
    setId,
    challengeId: null,
    attemptedAt: Date.now(),
    result: structuredClone({
      status: catalog?.status,
      reason: reasonOverride ?? catalog?.reason,
      httpStatus: catalog?.httpStatus,
      liveExecutionEnabled: false,
      setId: catalog?.setId ?? setId,
      setName: catalog?.setName,
      setRewards: catalog?.setRewards,
      challengeRewardsSource: catalog?.challengeRewardsSource,
      rewardIdentityVerified: catalog?.rewardIdentityVerified,
      challenges: Array.isArray(catalog?.challenges) ? catalog.challenges.map((challenge) => ({
        id: challenge.id,
        setId: challenge.setId,
        name: challenge.name,
        status: challenge.status,
        type: challenge.type,
        eligibilityOperation: challenge.eligibilityOperation,
        requirements: challenge.requirements,
        rewards: challenge.rewards
      })) : []
    })
  });
  var readCachedCatalog = async (gmGetValue, scope2, setId, challengeId = void 0) => {
    try {
      const cached = await gmGetValue(puzzleCatalogCacheKey(scope2, setId), null);
      if (!cached) return null;
      if (cached.schema !== 1 || cached.scope !== scope2 || cached.setId !== setId || cached.challengeId !== null || !cached.result || cached.result.setId !== setId || !Number.isSafeInteger(cached.attemptedAt) || !["observed", "blocked"].includes(cached.result.status) || !Array.isArray(cached.result.challenges)) {
        return { status: "blocked", reason: "FC27_CATALOG_CACHE_UNVERIFIED", liveExecutionEnabled: false, setId };
      }
      return structuredClone(cached.result);
    } catch {
      return { status: "blocked", reason: "FC27_CATALOG_CACHE_UNVERIFIED", liveExecutionEnabled: false, setId };
    }
  };
  function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, gmRequest, lockManager, liveEnabled = false }) {
    const context = readFc27Context(root);
    const scope2 = traditionalJournalScope(context);
    const referencePrice = createFsuReferencePrice({
      season: context.season,
      platform: context.platform,
      get: gmGetValue,
      set: gmSetValue,
      request: createFc27FutbinHttp(gmRequest)
    });
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
    const puzzlePersistence = createFc27PuzzleFillPersistence({
      context,
      gmGetValue,
      gmSetValue,
      lock: persistence.lock,
      lockScope: scope2
    });
    let prepared = null;
    let preparedPuzzle = null;
    let recovery = null;
    let armed = false;
    let busy = false;
    const catalogMemo = /* @__PURE__ */ new Map();
    const puzzlePolicyKey = `fcat-fc27-puzzle-policy:${scope2}`;
    const procurement = createFc27PuzzleProcurementSession({
      createTransport: (options) => createFc27MarketReadTransport(root, options),
      get: gmGetValue,
      set: gmSetValue
    });
    const readPuzzleSettings = async () => {
      const value = await gmGetValue(puzzlePolicyKey, null);
      if (value === null) return { maxRating: DEFAULT_PUZZLE_MAX_RATING, quoteCeiling: DEFAULT_PUZZLE_QUOTE_CEILING, queriesNumber: 5 };
      if (value?.schema !== 1 || !Number.isSafeInteger(value.maxRating) || value.maxRating < 1 || value.maxRating > 99) {
        throw new Error("FC27_PUZZLE_POLICY_INVALID");
      }
      const quoteCeiling = Object.hasOwn(value, "quoteCeiling") ? value.quoteCeiling : DEFAULT_PUZZLE_QUOTE_CEILING;
      if (!isPuzzleQuoteCeiling(quoteCeiling)) throw new Error("FC27_PUZZLE_POLICY_INVALID");
      const queriesNumber = value.queriesNumber ?? 5;
      if (!Number.isSafeInteger(queriesNumber) || queriesNumber < 1) throw new Error("FC27_PUZZLE_POLICY_INVALID");
      return { maxRating: value.maxRating, quoteCeiling, queriesNumber };
    };
    const readPuzzleMaxRating = async () => (await readPuzzleSettings()).maxRating;
    const invalidate = () => {
      prepared?.adapter.cancel();
      prepared = null;
      preparedPuzzle?.adapter.cancel();
      preparedPuzzle = null;
    };
    const traditionalExclusive = (requestedScope, task) => persistence.exclusive(requestedScope, async () => {
      return task();
    });
    const unchanged = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_TRANSACTION_CONTEXT_CHANGED");
    };
    const assertNoPuzzlePending = async (target) => {
      if (await gmGetValue(puzzleBuyPendingKey(scope2), null) !== null) throw new Error("FC27_BUY_RECOVERY_REQUIRED");
      if ((await puzzlePersistence.journal.read(scope2, target))?.phase === "save-pending") throw new Error("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
      if (await readFc27ConceptPending(gmGetValue, scope2, target) !== null) throw new Error("FC27_CONCEPT_RECOVERY_REQUIRED");
    };
    const conceptSession = (assertTarget, expectedSettings = null) => createFc27PuzzleConceptSession({
      scope: scope2,
      context,
      get: gmGetValue,
      set: gmSetValue,
      exclusive: persistence.exclusive,
      operationId: () => root.crypto.randomUUID(),
      assertCurrent: () => {
        unchanged();
        assertTarget();
      },
      checkOtherTransactions: async () => {
        const other = await persistence.journal.read(scope2);
        return !other || isTerminalTraditionalJournal(other);
      },
      createProvider: () => createFc27TraditionalProvider(root, { canWrite: () => {
        unchanged();
        assertTarget();
        return liveEnabled === true && armed && persistence.inspect().active;
      } }),
      readCurrent: async (plan) => {
        unchanged();
        assertTarget();
        if (expectedSettings && JSON.stringify(await readPuzzleSettings()) !== JSON.stringify(expectedSettings)) {
          throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
        }
        const target = { setId: plan.challenge.setId, challengeId: plan.challenge.id };
        const snapshot = readFc27PuzzlePageSnapshot(root, target);
        if (!snapshot || snapshot.challenge.status !== "IN_PROGRESS" || snapshot.challenge.eligibilityOperation !== "AND") {
          throw new Error("FC27_CONCEPT_INPUTS_CHANGED");
        }
        const links = readFc27PuzzleClubLinks(root);
        return {
          context,
          challenge: {
            ...plan.challenge,
            rawRequirements: snapshot.challenge.requirements,
            formation: snapshot.layout.formation,
            brickIndices: snapshot.layout.simpleBrickIndices
          },
          policy: readFc27PuzzlePolicy(root, await readPuzzleMaxRating()),
          clubLinks: links,
          chemistry: plan.chemistry ? readFc27PuzzleChemistry(root, links) : plan.chemistry,
          squadEmpty: snapshot.layout.squadEmpty
        };
      }
    });
    const readPuzzleCatalog = async (setId, challengeId = void 0) => {
      if (!Number.isSafeInteger(setId) || setId <= 0) return { result: blocked8("FC27_CATALOG_SET_UNVERIFIED"), source: "none" };
      const memoKey = `${setId}:${challengeId ?? "all"}`;
      if (catalogMemo.has(memoKey)) return { ...catalogMemo.get(memoKey), source: "memoized" };
      let cached = await readCachedCatalog(gmGetValue, scope2, setId);
      if (cached) {
        const value2 = { result: cached, source: "cached" };
        catalogMemo.set(memoKey, value2);
        return value2;
      }
      const value = await persistence.exclusive(scope2, async () => {
        const again = await readCachedCatalog(gmGetValue, scope2, setId);
        if (again) return { result: again, source: "cached" };
        try {
          await gmSetValue(puzzleCatalogCacheKey(scope2, setId), cacheCatalogProjection(
            { status: "blocked", reason: "FC27_CATALOG_READ_IN_PROGRESS", setId },
            scope2,
            setId
          ));
        } catch {
          throw new Error("FC27_CATALOG_CACHE_UNAVAILABLE");
        }
        const observed = await inspectFc27ChallengeCatalog(root, { setId });
        try {
          await gmSetValue(puzzleCatalogCacheKey(scope2, setId), cacheCatalogProjection(observed, scope2, setId));
        } catch {
          throw new Error("FC27_CATALOG_CACHE_UNAVAILABLE");
        }
        return { result: observed, source: "single-read" };
      });
      catalogMemo.set(memoKey, value);
      return value;
    };
    const provider = () => createFc27TraditionalProvider(root, { canWrite: () => {
      unchanged();
      return liveEnabled === true && armed && persistence.inspect().active;
    } });
    const run = async (task) => {
      if (busy) return blocked8("FC27_ATTEMPT_BUSY");
      busy = true;
      try {
        unchanged();
        return await task();
      } catch (error2) {
        return blocked8(safeReason5(error2));
      } finally {
        busy = false;
        armed = false;
      }
    };
    const inspect = async () => persistence.exclusive(scope2, async () => {
      recovery = null;
      const activePuzzle = readFc27PuzzlePage(root);
      const conceptPending = await readFc27ConceptPending(gmGetValue, scope2, activePuzzle);
      if (conceptPending !== null) {
        const valid2 = [conceptPending?.setId, conceptPending?.challengeId].every((id4) => Number.isSafeInteger(id4) && id4 > 0);
        return {
          status: "blocked",
          kind: "puzzle-concept",
          reason: "FC27_CONCEPT_RECOVERY_REQUIRED",
          ...valid2 ? { recoverySetId: conceptPending.setId, recoveryChallengeId: conceptPending.challengeId } : {},
          submitted: false
        };
      }
      const puzzleRecords = activePuzzle ? [await puzzlePersistence.journal.read(scope2, activePuzzle)].filter(Boolean) : await puzzlePersistence.journal.list(scope2);
      const puzzleRecord = puzzleRecords.find((record2) => record2.phase === "save-pending") ?? null;
      if (puzzleRecord?.phase === "save-pending") {
        const evidence = await observePuzzleRecovery(puzzleRecord);
        if (evidence) recovery = { kind: "puzzle-fill", record: puzzleRecord, outcome: evidence };
        return {
          kind: "puzzle-fill",
          status: recovery ? "recoverable" : "blocked",
          reason: recovery ? "FC27_PUZZLE_RECOVERY_CONFIRMATION_REQUIRED" : "FC27_PUZZLE_FILL_RECOVERY_REQUIRED",
          phase: puzzleRecord.phase,
          outcome: evidence,
          setId: puzzleRecord.setId,
          challengeId: puzzleRecord.challengeId,
          selectedCount: puzzleRecord.itemRefs.length,
          submitted: false
        };
      }
      const record = await persistence.journal.read(scope2);
      recovery = null;
      if (!record || isTerminalTraditionalJournal(record)) return { status: "idle", phase: record?.phase ?? null };
      const adapter = await provider();
      try {
        const evidence = await adapter.observeRecovery(record);
        const outcome = assessTraditionalRecovery(scope2, record, evidence);
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
    const observePuzzleRecovery = async (record, { synchronize: synchronize2 = false } = {}) => {
      const current2 = readFc27CurrentPuzzleChallenge(root, record);
      if (!current2 || current2.status !== "IN_PROGRESS") return null;
      const adapter = await provider();
      const plan = {
        kind: "puzzle-fill-recovery",
        set: { id: record.setId },
        challenge: {
          id: record.challengeId,
          setId: record.setId,
          brickIndices: record.schema === 2 ? record.brickIndices : []
        },
        selected: record.itemRefs
      };
      try {
        const saved = await adapter.readSavedSquad(plan);
        if (saved.squadEmpty === true) {
          const current3 = await adapter.validateItems({ selected: record.itemRefs });
          return current3.items.length === record.itemRefs.length && record.itemRefs.every((ref) => current3.items.some((item) => item.id === ref.id && item.definitionId === ref.definitionId && item.pile === ref.pile)) ? "empty" : null;
        }
        if (saved.items.length === record.itemRefs.length && record.itemRefs.every((ref) => saved.items.some((item) => item.id === ref.id && item.definitionId === ref.definitionId && item.pile === ref.pile && item.slot === ref.slot))) {
          if (synchronize2 && (await adapter.syncSavedSquad(plan))?.status !== "synchronized") return null;
          return "saved";
        }
        return null;
      } finally {
        adapter.cancel();
      }
    };
    const preparePuzzle = async ({ setId, challengeId } = {}, assertTarget = () => true, progress = () => {
    }, nativeOnly = false) => {
      invalidate();
      assertTarget();
      const available = await persistence.exclusive(scope2, async () => {
        const record = await persistence.journal.read(scope2);
        if (record && !isTerminalTraditionalJournal(record)) throw new Error("FC27_RECOVERY_REQUIRED");
        if ((await puzzlePersistence.journal.read(scope2, { setId, challengeId }))?.phase === "save-pending") throw new Error("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
        if (Number.isSafeInteger(challengeId) && await readFc27ConceptPending(gmGetValue, scope2, { setId, challengeId }) !== null) throw new Error("FC27_CONCEPT_RECOVERY_REQUIRED");
        return true;
      });
      if (available !== true) return blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      const pageSnapshot = nativeOnly ? readFc27PuzzlePageSnapshot(root, { setId, challengeId }) : null;
      if (nativeOnly && !pageSnapshot) return blocked8("FC27_PUZZLE_FILL_TARGET_CHANGED");
      const catalogRead = pageSnapshot ? { source: "native-page", result: {
        status: "observed",
        reason: "FC27_NATIVE_PUZZLE_READ",
        liveExecutionEnabled: false,
        setId,
        challenges: [pageSnapshot.challenge]
      } } : await readPuzzleCatalog(setId, challengeId);
      const catalog = catalogRead.result;
      if (catalog.status !== "observed") return { ...catalog, catalogSource: catalogRead.source };
      if (nativeOnly && pageSnapshot.challenge.status !== "IN_PROGRESS") {
        return blocked8(pageSnapshot.challenge.status === "COMPLETED" ? "FC27_PUZZLE_CHALLENGE_COMPLETED" : "FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS");
      }
      const candidates = catalog.challenges.filter((challenge) => challenge.status === "IN_PROGRESS" && challenge.eligibilityOperation === "AND" && (challengeId === void 0 || challenge.id === challengeId));
      if (candidates.length !== 1) return blocked8("FC27_PUZZLE_CHALLENGE_AMBIGUOUS");
      let privateData = null;
      const purchaseSettings = await readPuzzleSettings();
      const requestedMaxRating = purchaseSettings.maxRating;
      const puzzleOptions = {
        setId,
        challengeId: candidates[0].id,
        maxRating: requestedMaxRating,
        catalog,
        layout: pageSnapshot?.layout
      };
      const report = nativeOnly ? await inspectFc27PuzzlePlan(root, puzzleOptions, async (inputs) => {
        const preview = previewFc27PuzzleSquad(inputs);
        privateData = { inputs, preview };
        if (inputs.squadEmpty === true && [
          "SAFE_MATERIAL_SHORTAGE",
          "FC27_PUZZLE_CONSTRAINT_SHORTAGE",
          "FC27_PUZZLE_SEARCH_LIMIT",
          "FC27_PUZZLE_NO_PLAN_FOUND"
        ].includes(preview.reason)) {
          progress("procurement");
          const purchaseSuggestion = await persistence.exclusive(scope2, () => procurement.plan(inputs, { quoteCeiling: purchaseSettings.quoteCeiling, assertCurrent: () => {
            assertTarget();
            unchanged();
            const latest = readFc27PuzzlePageSnapshot(root, { setId, challengeId: candidates[0].id });
            if (!latest?.layout?.squadEmpty || JSON.stringify(latest.challenge.requirements) !== JSON.stringify(inputs.challenge.rawRequirements) || JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(inputs.policy)) {
              throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
            }
          } })) ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
          for (const plan of purchaseSuggestion.plans ?? []) for (const item of plan.purchases) {
            const name = readFc27MarketPlayerName(root, item.definitionId);
            if (name) item.displayName = name;
          }
          if (purchaseSuggestion.status === "suggested" && purchaseSuggestion.plans?.length) {
            assertTarget();
            progress("validating");
            armed = true;
            try {
              const result = await conceptSession(assertTarget, purchaseSettings).save(inputs, purchaseSuggestion.plans[0]);
              privateData.conceptResult = result;
              return { ...preview, purchaseSuggestion, status: result.status, reason: result.reason };
            } finally {
              armed = false;
            }
          }
          return { ...preview, purchaseSuggestion };
        }
        return preview;
      }) : await inspectFc27VerifiedPuzzlePlan(
        root,
        puzzleOptions,
        async (_projection, data) => {
          privateData = data;
        }
      );
      if (privateData?.conceptResult) return { ...privateData.conceptResult, policy: report.policy, catalogSource: catalogRead.source };
      if (report.status === "preview" && privateData && (nativeOnly || privateData.fillPlan?.status === "prepared")) {
        const baseInput = structuredClone(puzzleInput(privateData.inputs));
        const basePreview = structuredClone(privateData.preview);
        const planTarget = { setId, challengeId: candidates[0].id };
        const assertChallenge = (challenge) => {
          if (!challenge || challenge.id !== planTarget.challengeId || challenge.setId !== planTarget.setId || challenge.status !== "IN_PROGRESS" || challenge.eligibilityOperation !== "AND" || JSON.stringify(challenge.requirements) !== JSON.stringify(baseInput.challenge.rawRequirements)) {
            throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
          }
        };
        let assertPuzzleCurrent = () => false;
        const native = await createFc27TraditionalProvider(root, { canWrite: () => {
          unchanged();
          return liveEnabled === true && armed && persistence.inspect().active && assertPuzzleCurrent();
        } });
        const assertPuzzleEnvironment = () => {
          unchanged();
          native.assertCurrent();
          assertChallenge(readFc27CurrentPuzzleChallenge(root, planTarget));
          const links = readFc27PuzzleClubLinks(root);
          if (JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(baseInput.policy) || JSON.stringify(links) !== JSON.stringify(baseInput.clubLinks) || baseInput.chemistry && JSON.stringify(readFc27PuzzleChemistry(root, links)) !== JSON.stringify(baseInput.chemistry)) {
            throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
          }
          return true;
        };
        assertPuzzleCurrent = () => {
          assertTarget();
          assertPuzzleEnvironment();
          if (nativeOnly) {
            const snapshot = readFc27PuzzlePageSnapshot(root, planTarget);
            if (!snapshot) throw new Error("FC27_PUZZLE_FILL_TARGET_CHANGED");
            assertChallenge(snapshot.challenge);
            if (!snapshot.layout.squadEmpty) throw new Error("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
            if (JSON.stringify(currentInput(snapshot.challenge, snapshot.layout).challenge) !== JSON.stringify(baseInput.challenge)) throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
          }
          return true;
        };
        let savedLayout = null;
        let serverBaseline = null;
        const currentInput = (challenge, layout) => {
          assertChallenge(challenge);
          if (!layout || layout.setId !== planTarget.setId || layout.challengeId !== planTarget.challengeId || layout.slotCount !== baseInput.challenge.slotCount || layout.customBrickIndices.length || JSON.stringify(layout.simpleBrickIndices) !== JSON.stringify(baseInput.challenge.brickIndices)) {
            throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
          }
          return { ...structuredClone(baseInput), challenge: {
            ...structuredClone(baseInput.challenge),
            rawRequirements: challenge.requirements,
            formation: layout.formation
          } };
        };
        const adapter = {
          async readInputs(plan2) {
            if (await readPuzzleMaxRating() !== requestedMaxRating) throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
            assertPuzzleEnvironment();
            if (savedLayout) {
              const challenge = readFc27CurrentPuzzleChallenge(root, planTarget);
              return {
                context: baseInput.context,
                fresh: true,
                observedAt: Date.now(),
                ...planTarget,
                squadEmpty: savedLayout.squadEmpty,
                input: currentInput(challenge, savedLayout)
              };
            }
            if (!nativeOnly) {
              const state = await native.readSquadState(plan2);
              return { ...state, input: currentInput(readFc27CurrentPuzzleChallenge(root, planTarget), state.layout) };
            }
            assertTarget();
            assertPuzzleCurrent();
            if (serverBaseline === null && typeof native.readPuzzleBaseline === "function") {
              serverBaseline = await native.readPuzzleBaseline(plan2);
            }
            assertPuzzleCurrent();
            const snapshot = readFc27PuzzlePageSnapshot(root, planTarget);
            if (!snapshot) throw new Error("FC27_PUZZLE_FILL_TARGET_CHANGED");
            return {
              context: baseInput.context,
              fresh: true,
              observedAt: Date.now(),
              ...planTarget,
              squadEmpty: snapshot.layout.squadEmpty,
              input: currentInput(snapshot.challenge, snapshot.layout)
            };
          },
          async validateItems(plan2) {
            const result = await native.validateItems({ selected: plan2.selected });
            return { ...result, setId: plan2.challenge.setId, challengeId: plan2.challenge.id };
          },
          assertCurrent: assertPuzzleCurrent,
          save: (plan2, beforeDispatch) => {
            progress("saving");
            return native.save({ ...plan2, set: { id: plan2.challenge.setId } }, assertPuzzleCurrent, beforeDispatch, { replaceBaseline: serverBaseline });
          },
          syncSavedSquad: (plan2) => native.syncSavedSquad({ ...plan2, set: { id: plan2.challenge.setId } }),
          readSavedSquad: async (plan2) => {
            progress("verifying");
            const saved = await native.readSavedSquad({ ...plan2, set: { id: plan2.challenge.setId } });
            savedLayout = saved.layout;
            if (!savedLayout) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
            return saved;
          },
          cancel: () => native.cancel()
        };
        const engine = createFc27PuzzleFillTransaction({
          enabled: liveEnabled === true,
          adapter,
          journal: puzzlePersistence.journal,
          exclusive: puzzlePersistence.exclusive,
          checkOtherTransactions: async (activeScope) => {
            const record = await persistence.journal.read(activeScope);
            return !record || isTerminalTraditionalJournal(record);
          },
          createOperationId: () => root.crypto.randomUUID()
        });
        const plan = engine.prepare(baseInput, basePreview);
        if (plan.status === "prepared") preparedPuzzle = { engine, plan, adapter };
        else native.cancel();
      }
      return {
        ...report,
        catalogSource: catalogRead.source,
        policy: { ...report.policy, maxRating: privateData?.inputs?.policy?.maxRating ?? report.policy?.maxRating },
        fillReady: liveEnabled === true && preparedPuzzle?.plan?.status === "prepared",
        fillLiveEnabled: liveEnabled === true
      };
    };
    const executePuzzle = async (approval) => {
      if (!preparedPuzzle || liveEnabled !== true) return blocked8("FC27_PUZZLE_FILL_DISABLED");
      const current2 = preparedPuzzle;
      preparedPuzzle = null;
      const result = current2.engine.approve(current2.plan, approval);
      if (result.status !== "approved") {
        current2.adapter.cancel();
        return result;
      }
      armed = true;
      try {
        return await current2.engine.execute(result.permit);
      } finally {
        current2.adapter.cancel();
      }
    };
    const setPuzzlePolicy = (changes) => run(async () => {
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).some((key) => !["maxRating", "quoteCeiling", "queriesNumber"].includes(key))) return blocked8("FC27_PUZZLE_POLICY_INVALID");
      return persistence.exclusive(scope2, async () => {
        const settings = { ...await readPuzzleSettings(), ...changes };
        if (!Number.isSafeInteger(settings.maxRating) || settings.maxRating < 1 || settings.maxRating > 99 || !isPuzzleQuoteCeiling(settings.quoteCeiling) || !Number.isSafeInteger(settings.queriesNumber) || settings.queriesNumber < 1) return blocked8("FC27_PUZZLE_POLICY_INVALID");
        invalidate();
        await gmSetValue(puzzlePolicyKey, { schema: 1, ...settings });
        if (JSON.stringify(await readPuzzleSettings()) !== JSON.stringify(settings)) return blocked8("FC27_PUZZLE_POLICY_UNCONFIRMED");
        return { status: "observed", reason: "FC27_PUZZLE_POLICY_SAVED", ...settings };
      });
    });
    let buyStopped = false;
    const readBuyDraft = async (target) => {
      unchanged();
      const buy = await gmGetValue(puzzleBuyKey(scope2, target), null);
      if (buy && buy.scope === scope2 && JSON.stringify(buy.context) === JSON.stringify(context) && (await gmGetValue(puzzleBuyPendingKey(scope2), null) !== null || buy.phase === "save-pending" || buy.entries.some((e) => ["buy-pending", "bought", "move-pending", "move-rejected"].includes(e.state)) || buy.entries.filter((e) => e.state === "club").length !== buy.applied.length || puzzleBuyMatchesSlots(buy, readFc27PurchasePageSlots(root, target, buy)))) {
        return { phase: "saved", operationId: buy.operationId, plan: buy.base };
      }
      const plan = readFc27PuzzleBuyPlan(root, target);
      return { phase: "saved", operationId: JSON.stringify(plan.slots), plan };
    };
    const inspectPurchases = async (target) => {
      const draft = await readBuyDraft(target);
      if (!draft) return { status: "absent" };
      const raw = await gmGetValue(puzzleBuyKey(scope2, target), null);
      const record = raw?.operationId === draft.operationId ? raw : null;
      const entries2 = record?.entries ?? [];
      const acquired = entries2.filter((e) => ["club", "bought", "move-pending", "move-rejected"].includes(e.state));
      const spent = acquired.reduce((sum, e) => sum + e.price, 0);
      const remaining = draft.plan.slots.filter((item) => item?.kind === "concept" && !acquired.some((e) => e.slot === item.slot));
      const page = readFc27PurchasePageSlots(root, target, record);
      const pending = record?.phase === "save-pending" || entries2.some((e) => ["buy-pending", "bought", "move-pending", "move-rejected"].includes(e.state)) || entries2.filter((e) => e.state === "club").length !== (record?.applied?.length ?? 0);
      if (!pending && !puzzleBuyMatchesSlots(record ?? { base: draft.plan, entries: [], applied: [] }, page)) return { status: "blocked", reason: "FC27_BUY_SQUAD_CHANGED" };
      return {
        status: "ready",
        operationId: draft.operationId,
        total: draft.plan.purchaseCount,
        remaining: remaining.length,
        spent,
        budget: spent + remaining.reduce((sum, item) => sum + (item.observedBuyNow ?? 0), 0),
        recovery: pending,
        completed: remaining.length === 0 && !pending
      };
    };
    return Object.freeze({
      inspectPuzzlePurchases: (target) => run(() => inspectPurchases(target)),
      stopPuzzlePurchases: () => {
        buyStopped = true;
      },
      buyPuzzlePlayers: (target, approval, { isCurrent, onProgress } = {}) => run(async () => {
        if (liveEnabled !== true || approval?.approved !== true || typeof isCurrent !== "function") return blocked8("FC27_BUY_APPROVAL_REQUIRED");
        buyStopped = false;
        armed = true;
        const events = [];
        const assertTarget = () => {
          unchanged();
          if (!isCurrent()) throw new Error("FC27_BUY_TARGET_CHANGED");
        };
        try {
          const settings = await readPuzzleSettings();
          const buyer = createFc27PuzzleBuySession({
            scope: scope2,
            context,
            get: gmGetValue,
            set: gmSetValue,
            exclusive: persistence.exclusive,
            assertCurrent: assertTarget,
            shouldStop: () => buyStopped,
            onProgress,
            loadDraft: async (currentTarget) => {
              const other = await persistence.journal.read(scope2);
              if (other && !isTerminalTraditionalJournal(other)) throw new Error("FC27_RECOVERY_REQUIRED");
              if ((await puzzlePersistence.journal.read(scope2, currentTarget))?.phase === "save-pending" || await readFc27ConceptPending(gmGetValue, scope2, currentTarget) !== null) throw new Error("FC27_CONCEPT_RECOVERY_REQUIRED");
              return readBuyDraft(currentTarget);
            },
            createAdapter: () => createFc27PuzzleBuyAdapter(root, {
              assertTarget,
              referencePrice,
              attempts: settings.queriesNumber,
              onEvent: (event) => {
                if (events.length < 300) events.push(event);
              },
              canWrite: () => liveEnabled === true && armed && persistence.inspect().active
            })
          });
          const summary = await inspectPurchases(target);
          const coins = root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount;
          return await buyer.execute(target, {
            ...approval,
            budget: approval.budget ?? (Number.isSafeInteger(coins) && coins >= 0 ? Math.min(165e6, coins + summary.spent) : null),
            quoteCeiling: settings.quoteCeiling
          });
        } finally {
          armed = false;
          invalidate();
          try {
            await gmSetValue(`fcat-fc27-buy-trace:${scope2}`, { target: { setId: target.setId, challengeId: target.challengeId }, at: Date.now(), events });
          } catch {
          }
        }
      }),
      inspectPuzzlePolicy: () => run(async () => ({ status: "observed", ...await readPuzzleSettings() })),
      setPuzzlePolicy,
      setPuzzleMaxRating: (maxRating) => setPuzzlePolicy({ maxRating }),
      inspectCatalog: ({ setId } = {}) => run(async () => {
        invalidate();
        const catalogRead = await readPuzzleCatalog(setId);
        return { ...catalogRead.result, catalogSource: catalogRead.source };
      }),
      inspectPuzzle: (options) => run(() => preparePuzzle(options)),
      solveAndFillPuzzle: (target, { isCurrent, onProgress } = {}) => run(async () => {
        if (liveEnabled !== true) return blocked8("FC27_PUZZLE_FILL_DISABLED");
        if (!Number.isSafeInteger(target?.setId) || target.setId <= 0 || !Number.isSafeInteger(target?.challengeId) || target.challengeId <= 0 || typeof isCurrent !== "function") return blocked8("FC27_PUZZLE_FILL_TARGET_CHANGED");
        if (await gmGetValue(puzzleBuyPendingKey(scope2), null) !== null) return blocked8("FC27_BUY_RECOVERY_REQUIRED");
        const purchased = await gmGetValue(puzzleBuyKey(scope2, target), null) ? await inspectPurchases(target) : { status: "absent" };
        if (purchased.status === "ready" && purchased.spent > 0) return { status: "blocked", reason: "FC27_BUY_DRAFT_ACTIVE" };
        const assertTarget = () => {
          if (isCurrent() !== true) throw new Error("FC27_PUZZLE_FILL_TARGET_CHANGED");
          return true;
        };
        const log = {
          schema: 1,
          setId: target.setId,
          challengeId: target.challengeId,
          startedAt: Date.now(),
          action: "fill-only",
          stages: [],
          submitted: false
        };
        const progress = (stage) => {
          log.stages.push({ stage, at: Date.now() });
          log.stages = log.stages.slice(-20);
          try {
            onProgress?.(stage);
          } catch {
          }
        };
        const persistLog = async () => {
          try {
            await gmSetValue(`fcat-fc27-puzzle-last:${scope2}`, structuredClone(log));
          } catch {
          }
        };
        let result;
        try {
          progress("planning");
          await persistLog();
          result = await persistence.exclusive(scope2, async () => {
            const other = await persistence.journal.read(scope2);
            if (other && !isTerminalTraditionalJournal(other)) return blocked8("FC27_RECOVERY_REQUIRED");
            const record = await puzzlePersistence.journal.read(scope2, target);
            if (record?.phase !== "save-pending") return null;
            if (record.setId !== target.setId || record.challengeId !== target.challengeId) {
              return { ...blocked8("FC27_PUZZLE_FILL_RECOVERY_REQUIRED"), recoverySetId: record.setId, recoveryChallengeId: record.challengeId };
            }
            progress("recovering");
            assertTarget();
            if (await observePuzzleRecovery(record, { synchronize: true }) !== "saved") return blocked8("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            unchanged();
            await puzzlePersistence.journal.write(scope2, { ...record, phase: "saved", updatedAt: Date.now() });
            return {
              status: "filled",
              reason: "FC27_PUZZLE_SAVED_RESTORED",
              saved: true,
              submitted: false,
              setId: record.setId,
              challengeId: record.challengeId,
              selectedCount: record.itemRefs.length,
              restored: true
            };
          });
          if (!result) {
            result = await conceptSession(assertTarget).recover(target, { restartIfEmpty: true });
          }
          if (result?.status === "reset") result = null;
          if (!result) {
            const preview = await preparePuzzle(target, assertTarget, progress, true);
            log.preview = preview;
            log.catalogSource = preview.catalogSource ?? "unknown";
            if (preview.fillReady !== true) result = preview.status === "preview" ? blocked8("FC27_PUZZLE_FILL_PLAN_UNVERIFIED") : preview;
            else {
              assertTarget();
              log.plan = {
                selected: structuredClone(preparedPuzzle.plan.selected),
                rules: structuredClone(preparedPuzzle.plan.challenge.rawRequirements),
                validation: structuredClone(preparedPuzzle.plan.validation)
              };
              progress("validating");
              await persistLog();
              assertTarget();
              result = await executePuzzle({
                approved: true,
                action: "fill-only",
                count: 1,
                setId: target.setId,
                challengeId: target.challengeId,
                maxPlayers: preparedPuzzle.plan.selected.length,
                maxRating: preparedPuzzle.plan.policy.maxRating
              });
            }
          }
        } catch (error2) {
          result = blocked8(safeReason5(error2));
        } finally {
          invalidate();
        }
        log.result = result;
        log.finishedAt = Date.now();
        await persistLog();
        if (result?.status === "recovery-required") {
          try {
            await gmSetValue(`fcat-fc27-puzzle-write-failure:${scope2}`, structuredClone(log));
          } catch {
          }
        }
        return result;
      }),
      prepare: (options) => run(async () => {
        invalidate();
        return await traditionalExclusive(scope2, async () => {
          const record = await persistence.journal.read(scope2);
          if (record && !isTerminalTraditionalJournal(record)) return blocked8("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const input = await adapter.prepareInputs(options);
            const target = { setId: input.contract.set.id, challengeId: input.contract.challenge.id };
            await assertNoPuzzlePending(target);
            if (input.contract.challenge.brickIndices.length) return blocked8("FC27_ACCEPTANCE_BRICKS_UNSUPPORTED");
            const engine = createTraditionalTransaction({
              enabled: liveEnabled,
              adapter,
              ...persistence,
              exclusive: (requestedScope, task) => persistence.exclusive(requestedScope, async () => {
                await assertNoPuzzlePending(target);
                return task();
              }),
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
              return blocked8("FC27_EXACT_ITEMS_CHANGED");
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
              selected: plan.selected.map((item) => ({ slot: item.slot, rating: item.rating, pile: item.pile })),
              requirements: plan.challenge.requirements.map((rule) => ({ ...rule })),
              packId: baseline.packId,
              packCount: baseline.count
            };
          } catch (error2) {
            adapter.cancel();
            throw error2;
          }
        }) ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      }),
      execute: (approval) => run(async () => {
        if (!prepared || liveEnabled !== true) return blocked8("FC27_LIVE_DISABLED");
        const current2 = prepared;
        prepared = null;
        const result = current2.engine.approve(current2.plan, approval);
        if (result.status !== "approved") {
          current2.adapter.cancel();
          return result;
        }
        armed = true;
        try {
          return await current2.engine.execute(result.permit);
        } finally {
          current2.adapter.cancel();
        }
      }),
      fillPuzzle: (approval) => run(() => executePuzzle(approval)),
      inspectRecovery: () => run(async () => {
        invalidate();
        return await inspect() ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      }),
      resolveRecovery: (approved) => run(async () => {
        if (approved !== true || !recovery) return blocked8("FC27_RECOVERY_APPROVAL_INVALID");
        const expected = recovery;
        recovery = null;
        return await persistence.exclusive(scope2, async () => {
          if (expected.kind === "puzzle-fill") {
            const record2 = await puzzlePersistence.journal.read(scope2, { setId: expected.record.setId, challengeId: expected.record.challengeId });
            if (JSON.stringify(record2) !== JSON.stringify(expected.record) || await observePuzzleRecovery(record2, { synchronize: expected.outcome === "saved" }) !== expected.outcome) return blocked8("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            unchanged();
            await puzzlePersistence.journal.clear(scope2, record2);
            return {
              status: "resolved",
              reason: "FC27_PUZZLE_RECOVERY_RESOLVED",
              outcome: expected.outcome,
              saved: expected.outcome === "saved",
              submitted: false
            };
          }
          const record = await persistence.journal.read(scope2);
          if (JSON.stringify(record) !== JSON.stringify(expected.record)) return blocked8("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const evidence = await adapter.observeRecovery(record);
            unchanged();
            if (expected.outcome === "completed") {
              if (assessTraditionalRecovery(scope2, record, evidence) !== "completed") return blocked8("FC27_RECOVERY_REQUIRED");
              await adapter.reconcileRecoveredCache(record, evidence);
            }
            return await persistence.journal.resolve(
              scope2,
              record,
              evidence,
              { approved: true, operationId: record.operationId, outcome: expected.outcome }
            );
          } finally {
            adapter.cancel();
          }
        }) ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      })
    });
  }
  async function checkFc27GmInstallation({ gmGetValue, gmSetValue, lockManager, hold = false }) {
    const context = { season: "27", accountScope: "acceptance-self-test", platform: "local" };
    const scope2 = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
    const result = await persistence.exclusive(scope2, async () => {
      const previous = await persistence.journal.read(scope2);
      if (!previous) await persistence.journal.write(scope2, {
        schema: 2,
        scope: scope2,
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
      const record = await persistence.journal.read(scope2);
      return { status: "verified", persistedPreviously: !!previous, phase: record.phase, synthetic: true, eaRequests: 0 };
    });
    return result ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
  }

  // src/fc27/sbc-presentation.js
  function describeCatalogRule(rule) {
    const raw = `count=${rule.count ?? "?"}, scope=${rule.scope ?? "?"}, pairs=${JSON.stringify(rule.pairs)}`;
    const pair = rule.pairs?.length === 1 ? rule.pairs[0] : null;
    const value = pair?.values?.length === 1 ? pair.values[0] : null;
    let label = null;
    if (pair?.key === 3 && rule.count === -1 && [1, 2, 3].includes(value) && (rule.scope === 2 || rule.scope === 0 && value === 3)) {
      label = `All players: ${["Bronze", "Silver", "Gold"][value - 1]} quality`;
    } else if ([26, 28].includes(pair?.key) && Number.isInteger(value) && value >= 1 && value <= 99 && Number.isInteger(rule.count) && rule.count > 0 && rule.count <= 11 && [0, 2].includes(rule.scope)) {
      label = `${rule.scope === 0 ? "At least" : "Exactly"} ${rule.count} players: ${pair.key === 26 ? "minimum" : "maximum"} OVR ${value}`;
    }
    return { label: label ?? "Unsupported requirement \u2014 retained for inspection", raw, recognized: label !== null };
  }
  function describeCatalogRewards(rewards2) {
    if (!Array.isArray(rewards2)) return "Unknown rewards";
    if (!rewards2.length) return "No rewards at this level";
    return rewards2.map((reward) => `${reward.count ?? "?"} \xD7 ${reward.type ?? "unknown"} ${reward.value ?? "?"} (${reward.tradable === true ? "tradeable" : reward.tradable === false ? "untradeable" : "tradeability unknown"})`).join("; ");
  }
  function describePreparedRequirement(rule) {
    if (rule.kind === "player-count") return `${rule.count} players`;
    return `${rule.count} players: ${rule.kind === "player-min-overall" ? "minimum" : "maximum"} OVR ${rule.value}`;
  }

  // src/adapters/browser/fc27-workbench-view.js
  var FC27_WORKBENCH_TABS = Object.freeze([
    ["sbc", "SBC \u89E3\u9898"],
    ["gallery", "Gallery"],
    ["market", "\u5E02\u573A"],
    ["trading", "\u81EA\u52A8\u4EA4\u6613"],
    ["inventory", "\u5E93\u5B58"],
    ["routine", "Routine"],
    ["rolling", "\u6EDA\u5361"],
    ["activity", "\u6D3B\u52A8\u8BB0\u5F55"],
    ["settings", "\u8BBE\u7F6E"]
  ]);
  var planned = (id4, title, description, features, status = "\u89C4\u5212\u4E2D \xB7 \u5C1A\u672A\u63A5\u5165") => `
  <section id="page-${id4}" role="tabpanel" aria-labelledby="tab-${id4}" tabindex="0" hidden>
    <div class="section-heading"><div><p class="eyebrow">${title}</p><h2>${description}</h2></div><span class="badge planned">${status}</span></div>
    <div class="feature-grid">${features.map(([name, text2]) => `<article class="card"><h3>${name}</h3><p>${text2}</p></article>`).join("")}</div>
    <p class="module-note">\u672C\u9875\u5F53\u524D\u4EC5\u5C55\u793A\u529F\u80FD\u89C4\u5212\uFF0C\u5C1A\u4E0D\u6267\u884C\u64CD\u4F5C\u3002</p>
  </section>`;
  function fc27WorkbenchMarkup() {
    return `<style>
    :host{all:initial;position:fixed;inset:0;z-index:100002;display:none;padding:24px 12px;background:#0008;font:14px/1.5 Arial,sans-serif;color:#edf1f4;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}[hidden]{display:none!important}
    .workbench{width:min(1100px,100%);height:100%;margin:auto;background:#17212c;border:1px solid #3c4852;border-radius:8px;overflow:auto}
    :host([data-navigation-page]){position:relative;inset:auto;z-index:auto;min-height:100%;padding:0;background:#17212c}
    :host([data-navigation-page]) .workbench{width:100%;height:auto;min-height:100%;margin:0;border:0;border-radius:0;overflow:visible}
    summary{padding:10px 24px;font-size:12px;color:#9dabb7;cursor:pointer}
    :host([data-navigation-page]) .workbench>details>summary{display:none}
    .module-tabs{display:flex;gap:8px;overflow-x:auto;padding:12px 24px;background:#17212c;border-bottom:1px solid #36444e;scrollbar-width:thin;position:sticky;top:0;z-index:2}
    button,select,input{font:inherit;color:inherit;background:#202d36;border:1px solid #46545d;border-radius:5px;padding:9px 12px;min-height:40px;max-width:100%}
    button{cursor:pointer}button:disabled{opacity:.45;cursor:default}
    button[role=tab]{flex:0 0 auto;min-width:88px;min-height:44px;white-space:nowrap;border-radius:10px;background:#1d2931;font-weight:500}
    button[role=tab][aria-selected=true]{border-color:#9df3d5;background:#273740;color:#b3ffe3}
    button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #9df3d5;outline-offset:2px}
    .body{padding:24px;max-width:1280px;margin:0 auto}h2,h3,p{margin:0}h2{font-size:23px;line-height:1.3;margin-top:4px}h3{font-size:16px;margin-bottom:10px}
    .section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.eyebrow{font-size:12px;color:#9cabb7}
    .badge{display:inline-block;flex-shrink:0;font-size:12px;border:1px solid #517368;color:#a7efd2;background:#203c35;border-radius:20px;padding:4px 10px}.badge.planned{border-color:#53616b;color:#bac7d0;background:#25313a}
    .feature-grid,.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{padding:20px;background:#22323d;border:1px solid #3a4b57;border-radius:12px;min-width:0}.card p,.module-note{color:#bdcbd3}.card p+p{margin-top:10px}.module-note{font-size:13px;margin-top:18px}
    .card+.card-block,.card-block{margin-top:18px}.accent{color:#8bf0c8}label{display:grid;gap:7px;margin:12px 0;font-size:13px}select{width:100%}.row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .primary{background:#b1f5d7;color:#152c22;border-color:#b1f5d7;font-weight:600}small{display:block;color:#a5b7c4;font-size:12px;margin-top:8px}.advanced{border:1px solid #3a4b57;border-radius:12px;margin-top:18px;background:#1c2a34}.advanced>summary{padding:16px 20px;font-size:14px;color:#d9e5ec}.advanced-content{padding:0 20px 20px}
    .operation-status{margin:24px 24px 0;border-top:1px solid #36444e;padding:12px 0 20px;color:#b2c1cc;font-size:12px;overflow-wrap:anywhere}.operation-status output{display:block;color:#e7dbad;margin-top:4px}
    #detail,#requirements,#squad{overflow-wrap:anywhere}#detail{margin-top:12px}#requirements:empty,#squad:empty{display:none}#requirements,#squad{margin-top:18px;padding:16px;background:#22323d;border-radius:8px}.requirement{margin-top:10px;border-top:1px solid #45535c;padding-top:10px}ul{padding-left:20px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{padding:8px;background:#304451;border-radius:4px}
    dialog{max-width:min(440px,calc(100vw - 24px));color:#edf1f4;background:#22323d;border:1px solid #617781;border-radius:10px}dialog::backdrop{background:#0009}
    @media(max-width:650px){.body{padding:16px}.module-tabs{padding:10px 16px;gap:6px}.feature-grid,.settings-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column;gap:10px}h2{font-size:20px}.card{padding:16px}.operation-status{margin:16px 16px 0}#squad ol{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style><div class="workbench"><details open><summary></summary>
    <nav class="module-tabs" role="tablist" aria-label="FCAT \u529F\u80FD\u6A21\u5757">${FC27_WORKBENCH_TABS.map(([id4, label], index) => `<button type="button" role="tab" id="tab-${id4}" aria-controls="page-${id4}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join("")}</nav>
    <div class="body">
      <section id="page-sbc" role="tabpanel" aria-labelledby="tab-sbc" tabindex="0">
        <div class="section-heading"><div><p class="eyebrow">SBC PUZZLE</p><h2>\u89E3\u9898\u4E0E\u8865\u5361</h2></div><span class="badge">\u5DF2\u63A5\u5165\u539F\u751F SBC</span></div>
        <div class="card"><h3>\u5728\u539F\u751F\u9635\u5BB9\u4E2D\u5B8C\u6210\u64CD\u4F5C</h3><p>\u8FDB\u5165\u76EE\u6807 SBC\uFF0C\u70B9\u51FB\u53F3\u680F\u7684 <span class="accent">FCAT \u89E3\u9898\u586B\u5145</span>\uFF0C\u5C06\u5E93\u5B58\u7403\u5458\u548C\u7F3A\u5931\u7684\u6982\u5FF5\u7403\u5458\u4E00\u8D77\u586B\u5165\u9635\u5BB9\u3002</p><p>\u9700\u8981\u8865\u5361\u65F6\uFF0C\u518D\u70B9\u51FB\u540C\u4E00\u4FA7\u680F\u7684 <span class="accent">FCAT \u6279\u91CF\u8D2D\u4E70</span>\u3002\u63D0\u4EA4 SBC \u4ECD\u4E3A\u72EC\u7ACB\u64CD\u4F5C\u3002</p></div>
        <div id="puzzle-settings" class="card card-block"><h3>\u89E3\u9898\u4E0E\u91C7\u8D2D\u8BBE\u7F6E</h3><div class="settings-grid">
          <label>\u91D1\u5361\u6700\u9AD8\u8BC4\u5206<input id="puzzle-rating" type="number" min="1" max="99" step="1" value="82"><small>\u9ED8\u8BA4 82\uFF1B\u5DF2\u4FDD\u5B58\u7684\u66F4\u4F4E\u4E0A\u9650\u7EE7\u7EED\u6709\u6548\u3002</small></label>
          <label id="puzzle-quote-setting">\u8865\u5361\u5355\u5361\u62A5\u4EF7\u4E0A\u9650\uFF08\u91D1\u5E01\uFF09<input id="puzzle-quote-ceiling" type="number" min="150" max="15000000" step="1" placeholder="\u4E0D\u9650"><small>\u7559\u7A7A\u4E3A\u4E0D\u9650\uFF1B\u6B64\u9879\u7528\u4E8E\u8865\u5361\u89C4\u5212\u3002</small></label>
          <label id="puzzle-queries-setting">\u8D2D\u4E70\u67E5\u4EF7\u6B21\u6570<input id="puzzle-queries" type="number" min="1" step="1" value="5"><small>\u9ED8\u8BA4 5 \u6B21\u3002</small></label>
        </div><small>\u94DC\u94F6\u5361\u6309\u539F\u751F\u54C1\u8D28\u8981\u6C42\u9009\u6750\uFF1B\u6700\u4F4E\u94F6\u5361\uFF0B\u81F3\u5C11 2 \u91D1\u6309 2 \u91D1\uFF0B\u5176\u4F59\u94F6\u5361\u89E3\u9898\u3002\u91D1\u5361\u4ECD\u53D7 FSU \u8303\u56F4\u9650\u5236\uFF0C\u7F3A\u6599\u4E0D\u81EA\u52A8\u589E\u52A0\u91D1\u5361\u6216\u63D0\u9AD8\u8BC4\u5206\u3002</small><div class="row"><button id="puzzle-policy-save" class="primary">\u4FDD\u5B58\u89E3\u9898\u8BBE\u7F6E</button></div></div>
        <details class="advanced" data-sbc-advanced><summary>\u9700\u6C42\u68C0\u67E5\u4E0E\u5355\u6B21\u64CD\u4F5C</summary><div class="advanced-content">
          <p class="module-note">\u539F\u751F\u53F3\u680F\u662F\u65E5\u5E38\u89E3\u9898\u5165\u53E3\u3002\u8FD9\u91CC\u4FDD\u7559\u9700\u6C42\u68C0\u67E5\u3001\u65B9\u6848\u9884\u89C8\u53CA\u5DF2\u6709\u7684\u5355\u6B21\u786E\u8BA4\u64CD\u4F5C\u3002</p>
          <div class="settings-grid"><label>SBC<select id="target"></select></label><label>\u4F20\u7EDF\u5355\u6B21 SBC \u8BC4\u5206\u4E0A\u9650<select id="rating"><option>74</option><option>83</option></select></label></div>
          <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">\u5237\u65B0\u5217\u8868</button><button id="catalog">\u8BFB\u53D6\u9700\u6C42</button><button id="puzzle">\u89E3\u9898\u9884\u89C8</button><button id="prepare">\u6821\u9A8C\u9635\u5BB9</button><button id="execute" disabled>\u5355\u6B21\u63D0\u4EA4</button><button id="fill" disabled>\u586B\u9635\u5E76\u4FDD\u5B58</button></div>
          <div id="requirements" aria-live="polite"></div><div id="squad"></div>
        </div></details>
      </section>
      ${planned("gallery", "GALLERY", "\u6536\u96C6\u76EE\u6807\u4E0E\u7F3A\u5361\u91C7\u8D2D", [["\u6536\u96C6\u8FDB\u5EA6", "\u67E5\u770B\u6536\u96C6\u76EE\u6807\u3001\u5DF2\u62E5\u6709\u7248\u672C\u4E0E\u7F3A\u5931\u7403\u5458\u3002"], ["\u7F3A\u5361\u91C7\u8D2D", "\u6839\u636E\u7F3A\u53E3\u6BD4\u8F83\u4EF7\u683C\uFF0C\u751F\u6210\u91C7\u8D2D\u8BA1\u5212\u5E76\u6838\u5BF9\u6536\u96C6\u8FDB\u5EA6\u3002"]])}
      ${planned("market", "MARKET", "\u4EF7\u683C\u6BD4\u8F83\u4E0E\u8BA2\u5355\u6267\u884C", [["\u641C\u7D22\u4E0E\u6BD4\u4EF7", "\u7B5B\u9009\u7CBE\u786E\u7403\u5458\u7248\u672C\uFF0C\u5BF9\u6BD4\u53C2\u8003\u4EF7\u683C\u4E0E\u5B9E\u65F6\u6302\u724C\u3002"], ["\u4E70\u5165\u4E0E\u6302\u724C", "\u7BA1\u7406\u624B\u52A8\u8BA2\u5355\u3001\u6279\u91CF\u4E70\u5165\u4E0E\u6302\u724C\u7ED3\u679C\u3002SBC \u6982\u5FF5\u7403\u5458\u8D2D\u4E70\u76EE\u524D\u5DF2\u5728\u539F\u751F SBC \u4FA7\u680F\u63D0\u4F9B\u3002"]])}
      ${planned("trading", "TRADING", "\u5B9A\u65F6\u4E70\u5165\u4E0E\u552E\u51FA", [["\u5B9A\u65F6\u4EFB\u52A1", "\u6309\u6307\u5B9A\u65F6\u95F4\u6216\u5468\u671F\u6267\u884C\u8D2D\u4E70\u3001\u6302\u724C\u548C\u91CD\u65B0\u6302\u724C\u3002"], ["\u6267\u884C\u6761\u4EF6", "\u4E3A\u4EFB\u52A1\u8BBE\u7F6E\u4EF7\u683C\u8303\u56F4\u3001\u9884\u7B97\u3001\u6709\u6548\u671F\u53CA\u505C\u6B62\u6761\u4EF6\u3002"]])}
      ${planned("inventory", "INVENTORY", "\u5E93\u5B58\u4E0E\u6750\u6599\u7BA1\u7406", [["\u5E93\u5B58\u89C6\u56FE", "\u7EDF\u4E00\u67E5\u770B Club\u3001Storage\u3001\u91CD\u590D\u5361\u4E0E\u53EF\u7528\u6750\u6599\u3002"], ["\u6574\u7406\u4E0E\u4FDD\u62A4", "\u89C4\u5212\u5E93\u5B58\u6574\u7406\uFF0C\u67E5\u770B\u9009\u6750\u9650\u5236\u3001\u9501\u5361\u53CA\u4FDD\u62A4\u51B2\u7A81\u3002"]])}
      ${planned("routine", "ROUTINE", "\u65E5\u5E38\u4EFB\u52A1\u7F16\u6392", [["\u4EFB\u52A1\u7EC4\u5408", "\u5C06\u6BCF\u65E5\u64CD\u4F5C\u7EC4\u7EC7\u4E3A\u53EF\u590D\u7528\u7684\u6709\u9650\u6B65\u9AA4\u3002"], ["\u8FDB\u5EA6\u4E0E\u7EED\u8DD1", "\u67E5\u770B\u5B8C\u6210\u60C5\u51B5\uFF0C\u4ECE\u5DF2\u786E\u8BA4\u7684\u4E2D\u65AD\u4F4D\u7F6E\u7EE7\u7EED\u3002"]])}
      ${planned("rolling", "ROLLING", "\u8FDE\u7EED SBC \u5FAA\u73AF", [["FC27 \u5FAA\u73AF", "\u5728\u9002\u5408\u91CD\u590D\u5236\u4F5C\u7684 SBC \u548C FC27 \u5408\u540C\u5C31\u7EEA\u540E\u63A5\u5165\u3002"], ["\u5F53\u524D\u4F18\u5148\u7EA7", "\u4F18\u5148\u5B8C\u5584\u89E3\u9898\u3001Gallery \u4E0E\u4EA4\u6613\u3002\u65E7 FC26 \u7684 Rolling\u3001Swap \u548C\u9884\u6D4B\u903B\u8F91\u4E0D\u4F1A\u76F4\u63A5\u542F\u7528\u3002"]], "\u6682\u7F13\u5F00\u53D1")}
      <section id="page-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0" hidden>
        <div class="section-heading"><div><p class="eyebrow">ACTIVITY</p><h2>\u64CD\u4F5C\u8BB0\u5F55\u4E0E\u6062\u590D</h2></div><span class="badge">\u57FA\u7840\u6062\u590D\u68C0\u67E5</span></div>
        <div class="card"><h3>\u5F53\u524D\u4F1A\u8BDD</h3><p>\u6700\u8FD1\u4E00\u6B21\u5DE5\u4F5C\u53F0\u64CD\u4F5C\u7ED3\u679C\u663E\u793A\u5728\u9875\u5E95\uFF1B\u8BE6\u7EC6\u4FE1\u606F\u663E\u793A\u5728\u6B64\u3002\u8DE8\u6A21\u5757\u5386\u53F2\u5217\u8868\u5C1A\u672A\u63A5\u5165\u3002</p><div id="detail"></div></div>
        <div class="card card-block"><h3>\u5355\u6B21 SBC \u6062\u590D\u68C0\u67E5</h3><p>\u6838\u5BF9\u5DF2\u6709\u5355\u6B21 SBC \u4E8B\u52A1\u8BB0\u5F55\uFF0C\u518D\u786E\u8BA4\u53EF\u6062\u590D\u7ED3\u679C\u3002</p><div class="row"><button id="recovery">\u68C0\u67E5\u6062\u590D\u8BB0\u5F55</button><button id="resolve" disabled>\u786E\u8BA4\u6062\u590D\u7ED3\u679C</button></div></div>
      </section>
      <section id="page-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="0" hidden>
        <div class="section-heading"><div><p class="eyebrow">SETTINGS</p><h2>\u8BBE\u7F6E\u4E0E\u8BCA\u65AD</h2></div></div>
        <div class="feature-grid"><div class="card"><h3>\u5F53\u524D\u7248\u672C</h3><p id="workbench-version"></p><small id="workbench-mode"></small><p class="module-note">\u89E3\u9898\u4E0E\u91C7\u8D2D\u53C2\u6570\u5728\u300CSBC \u89E3\u9898\u300D\u9875\u8BBE\u7F6E\u3002</p></div>
        <div class="card"><h3>\u5B89\u88C5\u4E0E\u591A\u6807\u7B7E\u68C0\u67E5</h3><p>\u4EC5\u5728\u9700\u8981\u6392\u67E5\u5B58\u50A8\u6216\u591A\u6807\u7B7E\u5360\u7528\u95EE\u9898\u65F6\u8FD0\u884C\u3002</p><div class="row"><button id="gm">\u68C0\u67E5\u811A\u672C\u5B58\u50A8</button><button id="hold">\u68C0\u67E5\u6807\u7B7E\u9501</button></div></div></div>
      </section>
    </div><div class="operation-status" aria-live="polite">\u6700\u8FD1\u4E00\u6B21\u5DE5\u4F5C\u53F0\u64CD\u4F5C<output id="status">\u5C1A\u65E0\u64CD\u4F5C</output></div>
  </details></div><dialog><p id="approval"></p><div class="row"><button id="cancel">\u53D6\u6D88</button><button id="confirm">\u786E\u8BA4</button></div></dialog>`;
  }
  function bindFc27WorkbenchTabs(shadow, host) {
    const tabs = FC27_WORKBENCH_TABS.map(([id4]) => shadow.getElementById(`tab-${id4}`));
    const select = (id4) => {
      if (!FC27_WORKBENCH_TABS.some(([key]) => key === id4)) return;
      for (const [key] of FC27_WORKBENCH_TABS) {
        const active = key === id4;
        const tab = shadow.getElementById(`tab-${key}`);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        shadow.getElementById(`page-${key}`).hidden = !active;
      }
      host.dataset.activeTab = id4;
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", (event) => {
        if (event.isTrusted) select(FC27_WORKBENCH_TABS[index][0]);
      });
      tab.addEventListener("keydown", (event) => {
        if (!event.isTrusted) return;
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(FC27_WORKBENCH_TABS[next][0]);
        tabs[next].focus();
        tabs[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
      });
    });
    select("sbc");
    return select;
  }

  // src/adapters/browser/fc27-acceptance-panel.js
  function mountFc27AcceptancePanel({
    document,
    targets,
    inspectCatalog = null,
    inspectPuzzle = null,
    prepare: prepare2,
    execute,
    fillPuzzle = null,
    inspectRecovery,
    resolveRecovery,
    checkInstallation,
    inspectPuzzlePolicy = null,
    setPuzzleMaxRating = null,
    setPuzzlePolicy = null,
    hostId = "fcat-fc27-acceptance",
    title = "FC Automation Tool - FC27 Acceptance",
    version = null,
    liveEnabled = false
  }) {
    if (!document?.body || document.getElementById(hostId)) return;
    const host = document.createElement("aside");
    host.id = hostId;
    if (version) host.dataset.version = version;
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = fc27WorkbenchMarkup();
    const selectTab = bindFc27WorkbenchTabs(shadow, host);
    const node = (id4) => shadow.getElementById(id4);
    node("workbench-version").textContent = version ?? title;
    node("workbench-mode").textContent = liveEnabled === true ? "\u5DF2\u5F00\u653E\u73B0\u6709\u5355\u6B21\u64CD\u4F5C\uFF1B\u63D0\u4EA4\u9700\u5355\u72EC\u786E\u8BA4\u3002" : "\u5F53\u524D\u4E3A\u53EA\u8BFB\u6A21\u5F0F\u3002";
    node("puzzle-settings").hidden = typeof setPuzzleMaxRating !== "function" && typeof setPuzzlePolicy !== "function";
    node("puzzle-quote-setting").hidden = typeof setPuzzlePolicy !== "function";
    node("puzzle-queries-setting").hidden = typeof setPuzzlePolicy !== "function";
    shadow.querySelector("summary").textContent = `${title}\u3000\xD7`;
    node("status").textContent = liveEnabled === true ? "Live: single SBC" : "Live execution disabled";
    let busy = false;
    let plan = null;
    let puzzlePlan = null;
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
      for (const button of shadow.querySelectorAll('button:not([role="tab"]),select,input')) button.disabled = busy;
      node("execute").disabled = busy || liveEnabled !== true || plan?.liveEnabled !== true;
      node("fill").disabled = busy || liveEnabled !== true || puzzlePlan?.fillReady !== true || typeof fillPuzzle !== "function";
      node("resolve").disabled = busy || recovery?.status !== "recoverable";
      node("catalog").disabled = busy || !node("target").value || typeof inspectCatalog !== "function";
      node("puzzle").disabled = busy || !node("target").value || typeof inspectPuzzle !== "function";
      node("prepare").disabled = busy || !node("target").value;
    };
    const appendText = (parent, tag, text2) => {
      const element = document.createElement(tag);
      element.textContent = text2;
      parent.append(element);
      return element;
    };
    const clear = () => {
      plan = null;
      puzzlePlan = null;
      recovery = null;
      action = null;
      node("requirements").replaceChildren();
      node("squad").replaceChildren();
      node("detail").textContent = "";
      node("status").textContent = node("target").value ? "Choose Read requirements or Verify squad" : "No cached SBCs. Open EA SBC once, then refresh.";
      delete host.dataset.result;
    };
    const renderPlan = (result) => {
      node("requirements").replaceChildren();
      appendText(node("requirements"), "div", "Verified plan requirements");
      const rules = appendText(node("requirements"), "ul", "");
      for (const rule of result.requirements ?? []) appendText(rules, "li", describePreparedRequirement(rule));
      const squad = node("squad");
      squad.replaceChildren();
      appendText(squad, "div", "Selected slots \xB7 exact material checked");
      const list = appendText(squad, "ol", "");
      for (const item of result.selected ?? []) appendText(list, "li", `Slot ${item.slot + 1} \xB7 ${item.rating} OVR \xB7 ${item.pile}`);
      appendText(squad, "small", "Untradeable ordinary cards only. Confirm once saves and submits this plan; materials are checked again before saving.");
    };
    const renderCatalog = (result) => {
      const target = node("requirements");
      target.replaceChildren();
      if (result?.status !== "observed") return;
      const heading = document.createElement("div");
      heading.textContent = `${result.setName ?? "SBC"} \xB7 ${result.challenges.length} challenge${result.challenges.length === 1 ? "" : "s"}`;
      target.append(heading);
      appendText(target, "small", "Requirements from this EA read. Layout and submission eligibility are checked by Verify squad.");
      appendText(target, "small", `Set rewards (cached, unverified): ${describeCatalogRewards(result.setRewards?.rewards)}`);
      if (result.challenges.length !== 1) appendText(target, "div", "Multi-challenge planning is not supported yet.");
      for (const challenge of result.challenges) {
        const block = document.createElement("div");
        block.className = "requirement";
        const title2 = document.createElement("div");
        title2.textContent = `${challenge.name ?? `Challenge ${challenge.id}`} \xB7 ${challenge.status ?? "unknown"} \xB7 ${challenge.eligibilityOperation ?? "unknown"} rules`;
        block.append(title2);
        if (challenge.status !== "IN_PROGRESS") appendText(block, "small", "Not ready for planning. Unstarted challenges need EA initialization; this read does not start them.");
        if (challenge.eligibilityOperation !== "AND") appendText(block, "small", "Unsupported requirement combination.");
        const list = document.createElement("ul");
        for (const rule of challenge.requirements ?? []) {
          const item = document.createElement("li");
          const description = describeCatalogRule(rule);
          item.textContent = description.label;
          appendText(item, "small", description.raw);
          list.append(item);
        }
        if (!challenge.requirements?.length) {
          const item = document.createElement("li");
          item.textContent = "No requirement rows observed";
          list.append(item);
        }
        block.append(list);
        appendText(block, "small", `Challenge rewards (this read): ${describeCatalogRewards(challenge.rewards)}`);
        target.append(block);
      }
    };
    const renderPuzzle = (result) => {
      plan = null;
      puzzlePlan = result;
      node("requirements").replaceChildren();
      node("squad").replaceChildren();
      appendText(node("requirements"), "div", `Puzzle \xB7 Set ${result.setId} / Challenge ${result.challengeId}`);
      appendText(node("requirements"), "small", result.fillReady === true ? `Ready for confirmed save \xB7 untradeable ordinary Club cards, max OVR ${result.policy?.maxRating ?? "?"}. No SBC submission.` : `Preview only \xB7 untradeable ordinary Club cards, max OVR ${result.policy?.maxRating ?? "?"}. No saving or submission.`);
      const rules = appendText(node("requirements"), "ul", "");
      for (const rule of result.rules ?? []) appendText(rules, "li", JSON.stringify(rule.source));
      const facts2 = result.plan?.teamFacts;
      appendText(node("squad"), "div", `Local rating ${facts2?.teamRating ?? "?"} \xB7 chemistry ${facts2?.chemistry ?? "?"} \xB7 selected ${result.plan?.selectedCount ?? 0}/${result.plan?.required ?? "?"}`);
      appendText(node("squad"), "small", `Exact Club check: ${result.plan?.exactValidation?.status ?? "unavailable"} \xB7 fill preflight: ${result.plan?.fillPreflight?.status ?? "unavailable"}`);
      appendText(node("squad"), "small", result.fillReady === true ? "Exact Club check passed. Confirm once to fill and save this squad only; it will not submit the SBC or open rewards." : "Local rule checks are not server acceptance. Puzzle fill is unavailable until the save contract is verified.");
      const list = appendText(node("squad"), "ol", "");
      for (const [index, slot] of (result.plan?.slots ?? []).entries()) {
        appendText(list, "li", `Slot ${slot + 1} \xB7 ${result.plan.ratings[index]} OVR \xB7 club`);
      }
    };
    const run = async (task) => {
      if (busy) return;
      busy = true;
      update();
      node("status").textContent = "Checking...";
      host.dataset.busy = "true";
      try {
        const result = await task();
        if (result.status === "prepared") {
          plan = result;
          renderPlan(result);
        }
        if (result.status === "recoverable") recovery = result;
        if (result.status === "observed" && result.challenges) renderCatalog(result);
        if (result.status === "preview" && result.plan) renderPuzzle(result);
        node("status").textContent = result.reason ?? result.status;
        node("detail").textContent = result.status === "prepared" ? `${result.setName}: ${result.selectedCount} players; OVR ${result.ratings.join(", ")}; pack ${result.packId}` : result.synthetic ? `GM ${result.persistedPreviously ? "restored" : "written"}; ${result.phase}` : "";
        host.dataset.result = JSON.stringify(result);
      } catch (error2) {
        const reason = /^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_ACCEPTANCE_UNCONFIRMED";
        node("status").textContent = reason;
        host.dataset.result = JSON.stringify({ status: "blocked", reason });
      } finally {
        busy = false;
        host.dataset.busy = "false";
        update();
      }
    };
    const on = (id4, callback) => node(id4).addEventListener("click", (event) => {
      if (event.isTrusted && !busy) callback();
    });
    on("refresh", () => {
      renderTargets();
      clear();
      update();
    });
    on("puzzle-policy-save", () => {
      if (typeof setPuzzleMaxRating !== "function" && typeof setPuzzlePolicy !== "function") return;
      const value = Number(node("puzzle-rating").value);
      clear();
      const priceText = node("puzzle-quote-ceiling").value.trim();
      void run(async () => {
        const result = typeof setPuzzlePolicy === "function" ? await setPuzzlePolicy({
          maxRating: value,
          quoteCeiling: priceText === "" ? null : Number(priceText),
          queriesNumber: Number(node("puzzle-queries").value)
        }) : await setPuzzleMaxRating(value);
        return { ...result, reason: result.status === "observed" ? `\u89E3\u9898\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF1A\u6700\u9AD8\u8BC4\u5206 ${result.maxRating}\uFF1B\u8865\u5361\u5355\u5361\u62A5\u4EF7${result.quoteCeiling == null ? "\u4E0D\u9650" : `\u4E0A\u9650 ${result.quoteCeiling} \u91D1\u5E01`}` : result.reason };
      });
    });
    shadow.querySelector("details").addEventListener("toggle", () => {
      if (!shadow.querySelector("details").open || busy || liveEnabled !== true || typeof inspectPuzzlePolicy !== "function") return;
      void run(async () => {
        const result = await inspectPuzzlePolicy();
        if (result.status === "observed") {
          node("puzzle-rating").value = String(result.maxRating);
          node("puzzle-quote-ceiling").value = result.quoteCeiling == null ? "" : String(result.quoteCeiling);
          node("puzzle-queries").value = String(result.queriesNumber ?? 5);
        }
        return result;
      });
    });
    on("gm", () => {
      clear();
      void run(() => checkInstallation(false));
    });
    on("hold", () => {
      clear();
      void run(() => checkInstallation(true));
    });
    on("catalog", () => {
      clear();
      void run(() => inspectCatalog({ setId: Number(node("target").value) }));
    });
    on("puzzle", () => {
      clear();
      void run(() => inspectPuzzle({ setId: Number(node("target").value) }));
    });
    on("prepare", () => {
      clear();
      void run(() => prepare2({ setId: Number(node("target").value), maxRating: Number(node("rating").value) }));
    });
    on("recovery", () => {
      clear();
      void run(inspectRecovery);
    });
    const dialog = shadow.querySelector("dialog");
    on("execute", () => {
      if (liveEnabled !== true || plan?.liveEnabled !== true) return;
      action = "execute";
      node("approval").textContent = `${plan.setName}: submit ${plan.selectedCount} players, max OVR ${plan.maxRating}, once.`;
      dialog.showModal();
    });
    on("fill", () => {
      if (liveEnabled !== true || puzzlePlan?.fillReady !== true) return;
      action = "fill";
      node("approval").textContent = `Set ${puzzlePlan.setId} / Challenge ${puzzlePlan.challengeId}: fill ${puzzlePlan.plan?.selectedCount ?? "?"} untradeable ordinary Club players, max OVR ${puzzlePlan.policy?.maxRating ?? "?"}, and save once. No SBC submission or reward opening.`;
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
    dialog.addEventListener("cancel", () => {
      action = null;
    });
    on("confirm", () => {
      dialog.close();
      if (action === "execute" && plan) {
        const current2 = plan;
        clear();
        void run(() => execute({
          approved: true,
          count: 1,
          setId: current2.setId,
          challengeId: current2.challengeId,
          maxRating: current2.maxRating,
          maxPlayers: current2.selectedCount
        }));
      } else if (action === "fill" && puzzlePlan) {
        const current2 = puzzlePlan;
        clear();
        void run(() => fillPuzzle({
          approved: true,
          action: "fill-only",
          count: 1,
          setId: current2.setId,
          challengeId: current2.challengeId,
          maxPlayers: current2.plan?.selectedCount,
          maxRating: current2.policy?.maxRating
        }));
      } else if (action === "resolve" && recovery) {
        clear();
        void run(() => resolveRecovery(true));
      }
      action = null;
    });
    for (const id4 of ["target", "rating"]) node(id4).addEventListener("change", () => {
      clear();
      update();
    });
    document.body.append(host);
    host.style.display = "none";
    renderTargets();
    update();
    const open = (container) => {
      if (container?.append) {
        container.append(host);
        host.dataset.navigationPage = "true";
        shadow.querySelector("summary").textContent = title;
      }
      host.style.display = "block";
      shadow.querySelector("details").open = true;
      renderTargets();
      update();
      if (!busy && liveEnabled === true && typeof inspectPuzzlePolicy === "function") {
        void run(async () => {
          const result = await inspectPuzzlePolicy();
          if (result.status === "observed") {
            node("puzzle-rating").value = String(result.maxRating);
            node("puzzle-quote-ceiling").value = result.quoteCeiling == null ? "" : String(result.quoteCeiling);
            node("puzzle-queries").value = String(result.queriesNumber ?? 5);
          }
          return result;
        });
      }
    };
    const close = () => {
      if (!busy) {
        host.style.display = "none";
        shadow.querySelector("details").open = false;
      }
    };
    shadow.querySelector("summary").addEventListener("click", (event) => {
      if (host.dataset.navigationPage) {
        event.preventDefault();
        return;
      }
      if (event.isTrusted && !busy) {
        event.preventDefault();
        close();
      }
    });
    return Object.freeze({
      open,
      close,
      triggerPuzzle: ({ setId, challengeId }) => {
        if (busy || !Number.isSafeInteger(setId) || typeof inspectPuzzle !== "function") return;
        shadow.querySelector("details").open = true;
        selectTab("sbc");
        shadow.querySelector("[data-sbc-advanced]").open = true;
        renderTargets();
        node("target").value = String(setId);
        clear();
        void run(() => inspectPuzzle({ setId, challengeId }));
      },
      element: host
    });
  }

  // src/adapters/browser/fc27-puzzle-native-button.js
  var stageText = { planning: "\u6B63\u5728\u89E3\u9898\u2026", procurement: "\u6B63\u5728\u8BA1\u7B97\u8865\u5361\u65B9\u6848\u5E76\u67E5\u8BE2\u5019\u9009\u62A5\u4EF7\u2026", validating: "\u6B63\u5728\u590D\u6838\u6750\u6599\u2026", saving: "\u6B63\u5728\u586B\u9635\u4FDD\u5B58\u2026", verifying: "\u6B63\u5728\u6838\u9A8C\u4FDD\u5B58\u7ED3\u679C\u2026", recovering: "\u6B63\u5728\u6838\u5BF9\u5DF2\u4FDD\u5B58\u9635\u5BB9\u5E76\u6062\u590D\u663E\u793A\u2026" };
  var sameTarget2 = (a, b) => !!(a && b && a.setId === b.setId && a.challengeId === b.challengeId && a.anchor === b.anchor);
  var resultText = (result) => {
    if (result?.reason === "FC27_BUY_RECOVERY_REQUIRED") return "\u8D2D\u4E70\u7ED3\u679C\u5C1A\u5F85\u6838\u5BF9\uFF0C\u8BF7\u4F7F\u7528\u672C\u9875\u6279\u91CF\u8D2D\u4E70\u6309\u94AE\u6062\u590D\uFF0C\u4E0D\u4F1A\u91CD\u65B0\u8D2D\u4E70\u5DF2\u6210\u4EA4\u7684\u5361\u3002";
    if (result?.reason === "FC27_BUY_DRAFT_ACTIVE") return "\u6B64\u9635\u5BB9\u5DF2\u6709\u786E\u8BA4\u8D2D\u4E70\u7684\u5361\uFF1B\u53EF\u7EE7\u7EED\u6279\u91CF\u8D2D\u4E70\u5269\u4F59\u6982\u5FF5\u5361\uFF0C\u6216\u5728\u539F\u751F\u9875\u9762\u63D0\u4EA4\u5DF2\u5B8C\u6210\u7684\u9635\u5BB9\u3002";
    if (result?.status === "concept-filled") return `\u5DF2${result.restored ? "\u6062\u590D" : "\u4FDD\u5B58"}\u9635\u5BB9\uFF0C\u542B ${result.purchaseCount} \u5F20\u5F85\u8D2D\u6982\u5FF5\u5361\uFF0C\u89C2\u5BDF\u603B\u4EF7 ${result.estimatedCost} \u91D1\u5E01\u3002\u5C1A\u672A\u8D2D\u4E70\u6216\u63D0\u4EA4 SBC\uFF1BFCAT \u6279\u91CF\u8D2D\u4E70\u63A5\u7EBF\u5C1A\u672A\u5B8C\u6210\u3002`;
    const purchase = result?.purchaseSuggestion;
    if (purchase?.reason === "FC27_PURCHASE_CACHE_EXPIRED") return "\u8865\u5361\u8D44\u6599\u6216\u62A5\u4EF7\u5DF2\u8FC7\u671F\uFF0C\u672C\u6B21\u672A\u91C7\u7528\u65E7\u4EF7\u683C\u3001\u672A\u518D\u6B21\u8BF7\u6C42\u6216\u8D2D\u4E70\uFF1B\u9700\u8981\u66F4\u65B0\u8865\u5361\u8D44\u6599\u3002";
    if (purchase?.reason === "FC27_MARKET_HTTP_429") return "EA \u5E02\u573A\u8BF7\u6C42\u9650\u6D41\uFF0C\u672C\u6B21\u5DF2\u505C\u6B62\u5E76\u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u6216\u8D2D\u4E70\u3002";
    if (purchase?.status === "suggested" && purchase.plans?.length) {
      const plan = purchase.plans[0];
      const cards = plan.purchases.map((item) => `${item.displayName && /[\p{L}\p{N}]/u.test(item.displayName) ? item.displayName : "\u7403\u5458"}\uFF08${item.rating} \u5206\uFF0C\u7248\u672C ${item.definitionId}\uFF09\uFF0C\u89C2\u5BDF\u4EF7 ${item.observedBuyNow}`).join("\uFF1B");
      return `\u8865\u5361\u5EFA\u8BAE\uFF1A${cards}\u3002\u5171 ${plan.purchaseCount} \u5F20\uFF0C\u7EA6 ${plan.estimatedCost} \u91D1\u5E01\uFF1B\u8865\u5361\u65B9\u6848\u5316\u5B66 ${plan.teamFacts.chemistry}\uFF0C\u672C\u5730\u590D\u6838\u6EE1\u8DB3\u5168\u90E8\u6761\u4EF6\u3002\u5C1A\u672A\u8D2D\u4E70\uFF0C\u9700\u6279\u51C6\u8D2D\u4E70\u53CA\u4F7F\u7528\u8FD9\u4E9B\u5361\u540E\u91CD\u65B0\u9A8C\u9635\u3002`;
    }
    if (result?.status === "filled" && result.restored === true) return "\u5DF2\u6062\u590D\u4E4B\u524D\u4FDD\u5B58\u7684\u9635\u5BB9\uFF0C\u672A\u91CD\u590D\u4FDD\u5B58\u6216\u63D0\u4EA4 SBC\u3002";
    if (result?.status === "filled" && result.saved === true) return "\u9635\u5BB9\u5DF2\u4FDD\u5B58\uFF0C\u672A\u63D0\u4EA4 SBC\u3002";
    if (result?.httpStatus === 429 || result?.reason === "FC27_CLUB_HTTP_429") return "EA \u8BF7\u6C42\u9650\u6D41\uFF0C\u672C\u6B21\u5DF2\u505C\u6B62\uFF0C\u6CA1\u6709\u81EA\u52A8\u91CD\u8BD5\u3002";
    if (result?.reason === "FC27_CATALOG_READ_UNCONFIRMED" || result?.reason === "FC27_CATALOG_CACHE_UNVERIFIED") {
      return "SBC \u9700\u6C42\u8BB0\u5F55\u4E0D\u53EF\u7528\uFF0C\u8BF7\u8FDB\u5165\u76EE\u6807\u5B50\u9635\u540E\u4F7F\u7528\u89E3\u9898\u586B\u5145\u3002";
    }
    if (result?.reason === "FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED") return "\u4FDD\u5B58\u540E\u9875\u9762\u540C\u6B65\u672A\u5B8C\u6210\uFF0C\u5DF2\u4FDD\u7559\u6062\u590D\u8BB0\u5F55\uFF1B\u8BF7\u52FF\u91CD\u590D\u4FDD\u5B58\u3002";
    if (result?.reason === "FC27_CONCEPT_SQUAD_MANUAL_EDITED") return "\u68C0\u6D4B\u5230\u9635\u5BB9\u88AB\u90E8\u5206\u6E05\u7A7A\u6216\u624B\u52A8\u4FEE\u6539\uFF1B\u4E3A\u4FDD\u62A4\u73B0\u6709\u5361\u7247\uFF0C\u8BF7\u5148\u6E05\u7A7A\u6574\u4E2A\u9635\u5BB9\u540E\u518D\u70B9\u51FB FCAT \u89E3\u9898\u586B\u5145\u3002";
    if (Number.isSafeInteger(result?.recoveryChallengeId)) return `\u5B50\u9635 ${result.recoveryChallengeId} \u7684\u4FDD\u5B58\u5F85\u6838\u5BF9\uFF0C\u8BF7\u8FD4\u56DE\u8BE5\u5B50\u9635\u70B9\u51FB\u89E3\u9898\u586B\u5145\u6062\u590D\u3002`;
    if (result?.status === "recovery-required" || /RECOVERY_REQUIRED/.test(result?.reason ?? "")) return "\u4FDD\u5B58\u72B6\u6001\u5F85\u6838\u5BF9\uFF0C\u8BF7\u4F7F\u7528 FCAT \u6062\u590D\u68C0\u67E5\u3002";
    if (result?.reason === "FC27_PUZZLE_EXISTING_SQUAD_BLOCKED") return "\u5F53\u524D\u9635\u5BB9\u5DF2\u6709\u7403\u5458\uFF0C\u672A\u8986\u76D6\u539F\u9635\u5BB9\u3002";
    if (result?.reason === "FC27_PUZZLE_SERVER_SQUAD_CHANGED") return "\u89E3\u9898\u671F\u95F4\u670D\u52A1\u5668\u9635\u5BB9\u53D1\u751F\u53D8\u5316\uFF0C\u672C\u6B21\u672A\u8986\u76D6\uFF1B\u8BF7\u6838\u5BF9\u5F53\u524D\u9635\u5BB9\u540E\u518D\u8BD5\u3002";
    if (result?.reason === "FC27_PUZZLE_SERVER_BASELINE_UNVERIFIED") return "\u672C\u6B21\u670D\u52A1\u5668\u9635\u5BB9\u6838\u5BF9\u5DF2\u5931\u6548\uFF0C\u672A\u4FDD\u5B58\uFF1B\u8BF7\u91CD\u65B0\u70B9\u51FB\u89E3\u9898\u586B\u5145\u3002";
    if (result?.reason === "FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED") return "\u9635\u5BB9\u4E0D\u7B26\u5408\u9009\u6750\u7B56\u7565\uFF0C\u672A\u589E\u52A0\u9AD8\u54C1\u8D28\u5361\u8865\u4F4D\u3002";
    if (["FC27_PUZZLE_SEARCH_LIMIT", "FC27_PUZZLE_CONSTRAINT_SHORTAGE", "SAFE_MATERIAL_SHORTAGE", "FC27_PUZZLE_NO_PLAN_FOUND"].includes(result?.reason)) {
      const composition = result.policy?.materialComposition?.filter((rule) => rule.count > 0).map((rule) => `${rule.count} ${{ 1: "\u94DC", 2: "\u94F6", 3: "\u91D1" }[rule.quality] ?? ""}`).join("\uFF0B");
      const scope2 = [composition, Number.isInteger(result.policy?.maxRating) ? `\u6700\u9AD8 ${result.policy.maxRating}` : ""].filter(Boolean).join("\uFF0C");
      const message = result.reason === "FC27_PUZZLE_SEARCH_LIMIT" ? "\u672C\u6B21\u641C\u7D22\u8FBE\u5230\u4E0A\u9650\uFF0C\u5C1A\u672A\u627E\u5230\u6EE1\u8DB3\u5168\u90E8\u6761\u4EF6\u7684\u9635\u5BB9\uFF1B\u4E0D\u80FD\u5224\u5B9A\u65E0\u89E3\uFF0C\u672A\u4FEE\u6539\u9635\u5BB9\u3002" : "\u672C\u6B21\u5E93\u5B58\u89E3\u9898\u672A\u627E\u5230\u7B26\u5408\u9009\u6750\u9650\u5236\u7684\u9635\u5BB9\uFF0C\u672A\u81EA\u52A8\u589E\u52A0\u9AD8\u54C1\u8D28\u5361\u3002";
      return scope2 ? `${scope2}\uFF1A${message}` : message;
    }
    if (result?.reason === "FC27_PUZZLE_CHALLENGE_COMPLETED") return "\u5F53\u524D SBC \u5B50\u9635\u5DF2\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u6539\u7528\u5176\u4ED6\u5B50\u9635\u3002";
    if (result?.reason === "FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS") return "\u5F53\u524D SBC \u5B50\u9635\u4E0D\u53EF\u7EE7\u7EED\uFF0C\u4E0D\u4F1A\u6539\u7528\u5176\u4ED6\u5B50\u9635\u3002";
    if (result?.reason === "FC27_PUZZLE_FILL_TARGET_CHANGED") return "\u9875\u9762\u5DF2\u5207\u6362\uFF0C\u672C\u6B21\u586B\u9635\u505C\u6B62\u3002";
    return `\u672A\u5B8C\u6210\u586B\u9635\uFF1A${/^[A-Z0-9_]{1,100}$/.test(result?.reason ?? "") ? result.reason : "\u8BF7\u7A0D\u540E\u91CD\u8BD5"}`;
  };
  var code = (value) => typeof value === "string" && /^FC27_[A-Z0-9_]{1,100}$/.test(value) ? value : null;
  var countText = (value) => Number.isSafeInteger(value) && value >= 0 ? String(value) : "\u672A\u77E5";
  var purchaseReasons = {
    FC27_PUZZLE_SEARCH_LIMIT: "\u8865\u5361\u7EC4\u5408\u641C\u7D22\u8FBE\u5230\u4E0A\u9650\uFF0C\u4E0D\u80FD\u5224\u5B9A\u65E0\u89E3",
    FC27_PURCHASE_REPAIR_NO_PLAN: "\u672C\u6B21\u5019\u9009\u4E2D\u672A\u627E\u5230\u8865\u5361\u7EC4\u5408\uFF0C\u4E0D\u4EE3\u8868\u6574\u4E2A\u5E02\u573A\u65E0\u89E3",
    FC27_PURCHASE_QUOTES_UNAVAILABLE: "\u5DF2\u5C1D\u8BD5\u66FF\u6362\u65E0\u53EF\u7528\u6302\u724C\u7684\u5019\u9009\uFF0C\u4ECD\u672A\u53D6\u5F97\u6574\u9635\u6240\u9700\u62A5\u4EF7",
    FC27_PURCHASE_READ_BUDGET: "\u672C\u6B21\u67E5\u8BE2\u5DF2\u8FBE\u9884\u7B97\uFF0C\u5DF2\u4FDD\u5B58\u8FDB\u5EA6\uFF1B\u518D\u6B21\u70B9\u51FB\u4F1A\u590D\u7528\u4ECD\u6709\u6548\u7684\u6570\u636E\u7EE7\u7EED\u89C4\u5212",
    FC27_PURCHASE_PRICE_LIMIT_INVALID: "\u8865\u5361\u5355\u5361\u62A5\u4EF7\u4E0A\u9650\u65E0\u6548\uFF0C\u8BF7\u5728\u89E3\u9898\u8BBE\u7F6E\u4E2D\u586B\u5199\u91D1\u989D\u6216\u7559\u7A7A\u4E3A\u4E0D\u9650",
    FC27_MARKET_HTTP_429: "EA \u9650\u6D41\uFF0C\u5DF2\u505C\u6B62\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5",
    FC27_MARKET_HTTP_401: "EA \u62D2\u7EDD\u4E86\u5E02\u573A\u67E5\u8BE2\u8BA4\u8BC1\uFF0C\u672A\u4FEE\u6539\u9635\u5BB9",
    FC27_MARKET_READ_BLOCKED: "\u8D44\u6599\u6216\u62A5\u4EF7\u8BFB\u53D6\u88AB\u505C\u6B62\uFF0C\u672A\u5B8C\u6210\u67E5\u8BE2",
    FC27_PURCHASE_CACHE_UNVERIFIED: "\u8865\u5361\u7F13\u5B58\u6821\u9A8C\u5931\u8D25\uFF0C\u672A\u91CD\u65B0\u67E5\u8BE2",
    FC27_PURCHASE_READ_UNCONFIRMED: "\u4E4B\u524D\u7684\u67E5\u8BE2\u5C1A\u672A\u786E\u8BA4\uFF0C\u672A\u91CD\u590D\u8BF7\u6C42",
    FC27_PURCHASE_CACHE_EXPIRED: "\u8D44\u6599\u6216\u62A5\u4EF7\u5DF2\u8FC7\u671F\uFF0C\u672A\u91C7\u7528\u65E7\u4EF7\u683C"
  };
  function formatFc27PuzzleNativeResult(result) {
    const message = resultText(result);
    const purchase = result?.purchaseSuggestion;
    if (purchase?.status !== "blocked") return message;
    const reason = code(purchase.reason);
    const lines = [message, `\u8865\u5361\uFF1A${purchaseReasons[reason] ?? "\u89C4\u5212\u672A\u5B8C\u6210"}${reason ? `\uFF08${reason}\uFF09` : ""}\u3002`];
    if (Object.hasOwn(purchase, "quoteCeiling")) lines.push(purchase.quoteCeiling === null ? "\u5355\u5361\u62A5\u4EF7\uFF1A\u4E0D\u9650\u3002" : `\u5355\u5361\u62A5\u4EF7\u4E0A\u9650\uFF1A${countText(purchase.quoteCeiling)} \u91D1\u5E01\u3002`);
    const inventory = result.plan;
    if (inventory) lines.push(`\u5E93\u5B58\u521D\u7B5B ${countText(inventory.safeCandidates)} \u4EBA\uFF1B\u641C\u7D22\u8282\u70B9 ${countText(inventory.nodes)}\u3002`);
    const d = purchase.diagnostics;
    if (d) {
      if (d.failureSource === "cache") lines.push("\u672C\u6B21\u8BFB\u53D6\u7684\u662F\u5386\u53F2\u5931\u8D25\u8BB0\u5F55\uFF0C\u672A\u91CD\u65B0\u53D1\u9001\u8BE5\u67E5\u8BE2\u3002");
      else if (d.failureSource === "request") lines.push("\u672C\u6B21\u67E5\u8BE2\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\u540E\u7EED\u8BF7\u6C42\u3002");
      if (reason === "FC27_MARKET_HTTP_401" && Number.isSafeInteger(d.retryAfterSeconds) && d.retryAfterSeconds >= 0) {
        lines.push(`\u786E\u8BA4 Web App \u5DF2\u6B63\u5E38\u767B\u5F55\u540E\uFF0C\u8BF7\u7B49\u5F85 ${d.retryAfterSeconds} \u79D2\uFF0C\u518D\u6B21\u70B9\u51FB\u201CFCAT \u89E3\u9898\u586B\u5145\u201D\uFF1B\u53EA\u91CD\u67E5\u5931\u8D25\u9879\uFF0C\u6210\u529F\u8D44\u6599\u7EE7\u7EED\u590D\u7528\uFF08\u8FC7\u671F\u5219\u66F4\u65B0\uFF09\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5FAA\u73AF\u91CD\u8BD5\u3002`);
      }
      if (Number.isSafeInteger(d.eaCode) && d.eaCode >= 0 && d.eaCode <= 2147483647) lines.push(`EA \u9519\u8BEF\u7801\uFF1A${d.eaCode}\u3002`);
      const stage = {
        "repair-seed": "\u5BFB\u627E\u5E93\u5B58\u57FA\u7840\u9635\u5BB9",
        "query-planning": "\u89C4\u5212\u8D44\u6599\u67E5\u8BE2",
        "catalog-read": "\u8BFB\u53D6\u7403\u5458\u8D44\u6599",
        "local-market-search": "\u672C\u5730\u7EC4\u5408\u6C42\u89E3",
        "quote-read": "\u8BFB\u53D6\u5E02\u573A\u62A5\u4EF7"
      }[d.stage] ?? "\u672A\u77E5";
      const route = { repair: "\u5C40\u90E8\u66FF\u6362 1\u20132 \u5F20", joint: "\u5E93\u5B58\u4E0E\u5019\u9009\u8054\u5408\u6C42\u89E3" }[d.route] ?? "\u5C1A\u672A\u786E\u5B9A";
      lines.push(`\u505C\u5728${stage}\uFF1B${route}\u3002\u8D44\u6599 ${countText(d.catalogPages)} \u9875\uFF0C\u53BB\u91CD\u5019\u9009 ${countText(d.catalogCandidates)}\uFF0C\u8D44\u6599\u9884\u7B5B\u5408\u683C ${countText(d.usableCandidates)}\u3002`);
      if (code(d.localReason)) lines.push(`\u672C\u5730\u7ED3\u679C\uFF1A${d.localReason}\uFF1B\u68C0\u67E5 ${countText(d.checks)} \u6B21 / \u8282\u70B9 ${countText(d.nodes)}${d.truncated === true ? "\uFF08\u641C\u7D22\u6216\u7ED3\u679C\u622A\u65AD\uFF09" : ""}\u3002`);
      lines.push(`\u67E5\u8BE2\u5C1D\u8BD5\uFF1A\u8D44\u6599 ${countText(d.catalogAttempts)}\u3001\u62A5\u4EF7 ${countText(d.quoteAttempts)}\uFF1B\u7F13\u5B58 ${countText(d.cacheHits)}\u3002`);
      if (d.excludedUnavailable > 0) lines.push(`\u5DF2\u6392\u9664 ${countText(d.excludedUnavailable)} \u4E2A\u65E0\u53EF\u7528\u6302\u724C\u7684\u5019\u9009\uFF1B\u672C\u5730\u91CD\u65B0\u89C4\u5212 ${countText(d.replans)} \u6B21\u3002`);
    }
    return lines.join("\n");
  }
  function mountFc27PuzzleNativeButton({
    document,
    onFill,
    readTarget,
    schedule = setInterval,
    unschedule = clearInterval
  } = {}) {
    if (!document?.body || document.getElementById("fcat-fc27-puzzle-native")) return () => {
    };
    const button = document.createElement("button");
    button.id = "fcat-fc27-puzzle-native";
    button.type = "button";
    button.textContent = "FCAT \u89E3\u9898\u586B\u5145";
    button.title = "\u4E00\u952E\u89E3\u9898\u3001\u590D\u6838\u5E76\u4FDD\u5B58\u9635\u5BB9\uFF0C\u4E0D\u63D0\u4EA4 SBC";
    button.className = "btn-standard call-to-action";
    button.style.cssText = "display:block;width:calc(100% - 1rem);margin:.5rem auto;min-height:38px";
    const status = document.createElement("div");
    status.id = "fcat-fc27-puzzle-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText = "margin:.5rem;text-align:center;white-space:pre-line;overflow-wrap:anywhere;font-size:13px;max-height:180px;overflow-y:auto";
    let target = null;
    let busy = false;
    let disposed = false;
    const read = () => {
      try {
        return readTarget?.();
      } catch {
        return null;
      }
    };
    const update = () => {
      const next = read();
      if (!next?.anchor?.isConnected) {
        target = null;
        button.remove();
        status.remove();
        return;
      }
      if (!sameTarget2(next, target)) {
        status.textContent = "";
        status.hidden = true;
      }
      target = next;
      if (button.nextSibling !== next.anchor) next.anchor.before(button);
      if (status.nextSibling !== button) button.before(status);
      button.disabled = busy;
    };
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted || !target || busy || disposed || typeof onFill !== "function") return;
      const next = read();
      if (!sameTarget2(next, target)) {
        update();
        return;
      }
      const origin = { ...next };
      const isCurrent = () => !disposed && origin.anchor.isConnected && sameTarget2(read(), origin);
      const onProgress = (stage) => {
        if (!isCurrent()) return;
        status.hidden = false;
        status.textContent = stageText[stage] ?? "\u6B63\u5728\u5904\u7406\u2026";
      };
      busy = true;
      button.disabled = true;
      button.textContent = "FCAT \u6B63\u5728\u586B\u5145\u2026";
      onProgress("planning");
      try {
        const result = await onFill({ setId: origin.setId, challengeId: origin.challengeId }, { isCurrent, onProgress });
        if (isCurrent()) {
          status.hidden = false;
          status.textContent = formatFc27PuzzleNativeResult(result);
        }
      } catch {
        if (isCurrent()) {
          status.hidden = false;
          status.textContent = "\u586B\u9635\u672A\u5B8C\u6210\uFF0C\u8BF7\u67E5\u770B\u540E\u53F0\u8BB0\u5F55\u3002";
        }
      } finally {
        busy = false;
        button.textContent = "FCAT \u89E3\u9898\u586B\u5145";
        if (!disposed) update();
      }
    });
    update();
    const timer = schedule(update, 1e3);
    return () => {
      disposed = true;
      unschedule(timer);
      button.remove();
      status.remove();
    };
  }

  // src/adapters/browser/fc27-puzzle-buy-button.js
  var reasons = {
    FC27_BUY_BUDGET_EXCEEDED: "\u5DF2\u5230\u672C\u6B21\u9884\u7B97\uFF1B\u53EF\u4FEE\u6539\u9884\u7B97\u540E\u7EE7\u7EED\u5269\u4F59\u8D2D\u4E70\u3002",
    FC27_BUY_NO_LISTING: "\u90E8\u5206\u7248\u672C\u5728\u4EF7\u683C\u8303\u56F4\u5185\u6682\u65E0\u6302\u724C\uFF0C\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_RATE_LIMITED: "EA \u9650\u6D41\uFF0C\u5DF2\u505C\u6B62\uFF0C\u6CA1\u6709\u81EA\u52A8\u91CD\u8BD5\u3002",
    FC27_BUY_STOPPED: "\u5DF2\u505C\u6B62\uFF0C\u5DF2\u8D2D\u4E70\u7ED3\u679C\u4FDD\u7559\u3002",
    FC27_BUY_ALREADY_OWNED: "\u7F3A\u5931\u7248\u672C\u5DF2\u5728 Club \u4E2D\uFF0C\u8BF7\u5148\u66FF\u6362\u5BF9\u5E94\u6982\u5FF5\u5361\uFF0C\u907F\u514D\u91CD\u590D\u8D2D\u4E70\u3002",
    FC27_BUY_SQUAD_CHANGED: "\u9635\u5BB9\u5DF2\u88AB\u4FEE\u6539\uFF0C\u672C\u6B21\u672A\u7EE7\u7EED\u8D2D\u4E70\u6216\u8986\u76D6\u9635\u5BB9\u3002",
    FC27_BUY_INSUFFICIENT_COINS: "\u90E8\u5206\u7403\u5458\u91D1\u5E01\u4E0D\u8DB3\uFF0C\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_REJECTED: "\u90E8\u5206\u4E70\u65AD\u88AB EA \u62D2\u7EDD\uFF0C\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_SEARCH_FAILED: "\u90E8\u5206\u7403\u5458\u67E5\u4EF7\u5931\u8D25\uFF0C\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_MOVE_REJECTED: "\u90E8\u5206\u7403\u5458\u5DF2\u8D2D\u5165\u4F46\u672A\u80FD\u5165\u5E93\uFF0C\u5DF2\u4FDD\u7559\u56DE\u6267\u5E76\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_UNASSIGNED_FULL: "\u5F85\u5206\u914D\u533A\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u5904\u7406\u540E\u7EE7\u7EED\u3002",
    FC27_BUY_AUTH_REQUIRED: "EA \u767B\u5F55\u6216\u4EA4\u6613\u6743\u9650\u5931\u6548\uFF0C\u5DF2\u505C\u6B62\uFF0C\u8BF7\u6062\u590D\u4F1A\u8BDD\u540E\u7EE7\u7EED\u3002",
    FC27_BUY_LISTING_UNAVAILABLE: "\u90E8\u5206\u6302\u724C\u5DF2\u88AB\u4E70\u8D70\uFF1B\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002",
    FC27_BUY_LISTING_CHANGED: "\u90E8\u5206\u6302\u724C\u5DF2\u8FC7\u671F\uFF1B\u5DF2\u7EE7\u7EED\u5904\u7406\u5176\u4F59\u7403\u5458\u3002"
  };
  function mountFc27PuzzleBuyButton({
    document,
    readTarget,
    inspect,
    buy,
    stop: stop6,
    foregroundProgress = null,
    schedule = setInterval,
    unschedule = clearInterval,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    if (!document?.body || document.getElementById("fcat-fc27-puzzle-buy")) return () => {
    };
    const box = document.createElement("div");
    box.id = "fcat-fc27-puzzle-buy";
    box.style.cssText = "margin:.5rem 1rem;padding:.5rem 0;text-align:center";
    const style = document.createElement("style");
    style.textContent = "#fcat-fc27-puzzle-buy [hidden]{display:none!important}";
    box.append(style);
    const button = document.createElement("button");
    button.className = "btn-standard mini call-to-action";
    button.style.width = "100%";
    const cancel = document.createElement("button");
    cancel.className = "btn-standard";
    cancel.textContent = "\u505C\u6B62\u8D2D\u4E70";
    cancel.hidden = true;
    const output = document.createElement("div");
    output.setAttribute("role", "status");
    output.style.cssText = "font-size:13px;margin:.4rem 0";
    box.append(button, cancel, output);
    let foregroundActive = false;
    const loading = (active) => {
      if (active) {
        if (foregroundActive) return;
        foregroundActive = true;
        try {
          foregroundProgress?.start?.({ stop: stop6 });
        } catch {
        }
      } else {
        if (!foregroundActive) return;
        foregroundActive = false;
        try {
          foregroundProgress?.end?.();
        } catch {
        }
      }
    };
    const message = (text2) => {
      output.textContent = text2;
    };
    const markFailures = (selected, failures = []) => {
      const now = readTarget();
      if (now?.setId !== selected.setId || now?.challengeId !== selected.challengeId) return;
      for (const failure of failures) {
        const ref = now.slots?.[failure.slot];
        if (!Number.isSafeInteger(failure.slot) || ref?.concept !== true || ref.definitionId !== failure.definitionId) continue;
        const cards = document.querySelectorAll(`.ut-squad-slot-view[index="${failure.slot}"] .concept`);
        if (cards.length !== 1 || cards[0].querySelector(".fcat-cards-buyerror")) continue;
        const marker = document.createElement("div");
        marker.className = "ut-squad-slot-chemistry-points-view item fcat-cards-buyerror";
        marker.title = reasons[failure.reason] ?? "\u672C\u6B21\u8D2D\u4E70\u672A\u5B8C\u6210";
        const icon = document.createElement("div");
        icon.className = "ut-squad-slot-chemistry-points-view--container chemstyle icon_untradeable";
        marker.append(icon);
        cards[0].append(marker);
      }
    };
    let target = null;
    let summary = null;
    let signature2 = null;
    let busy = false;
    let reading = false;
    let disposed = false;
    const key = (value) => value ? `${value.setId}:${value.challengeId}:${value.squadSignature ?? ""}` : null;
    const attach = (next) => {
      if (next.purchaseAnchor?.isConnected) {
        next.purchaseAnchor.prepend(box);
        return;
      }
      const panel = next.anchor.closest(".ut-sbc-challenge-details-view");
      if (panel) panel.prepend(box);
      else next.anchor.before(box);
    };
    const refresh = async (force = false) => {
      if (disposed || busy || reading) return;
      const next = readTarget();
      if (!next?.anchor?.isConnected) {
        box.remove();
        target = null;
        signature2 = null;
        return;
      }
      const changed = key(next) !== signature2;
      if (!force && !changed) return;
      reading = true;
      try {
        const result = await inspect(next);
        if (disposed || key(readTarget()) !== key(next)) return;
        if (result?.reason === "FC27_ACCEPTANCE_BUSY") return;
        const switched = !target || target.setId !== next.setId || target.challengeId !== next.challengeId;
        target = next;
        signature2 = key(next);
        summary = result;
        if (result?.status !== "ready" || result.completed) {
          if (result?.completed && !switched && button.hidden) {
            attach(next);
            return;
          }
          if (!switched && output.textContent) {
            button.disabled = true;
            if (result?.reason) output.textContent += ` ${reasons[result.reason] ?? result.reason}`;
            attach(next);
            return;
          }
          box.remove();
          return;
        }
        if (switched || result.remaining > 0 || result.recovery) button.hidden = false;
        button.textContent = result.recovery ? "FCAT \u6838\u5BF9\u5E76\u7EE7\u7EED\u8D2D\u4E70" : `FCAT \u6279\u91CF\u8D2D\u4E70\u6982\u5FF5\u7403\u5458\uFF08${result.remaining} \u5F20\uFF09`;
        button.disabled = false;
        if (switched) output.textContent = "\u70B9\u51FB\u540E\u9010\u5F20\u67E5\u8BE2\u3001\u4E70\u5165\u5E76\u66FF\u6362\u5F53\u524D\u6982\u5FF5\u5361\uFF1B\u4E0D\u4F1A\u63D0\u4EA4 SBC\u3002";
        attach(next);
      } catch {
        output.textContent = "\u8D2D\u4E70\u6E05\u5355\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
        signature2 = null;
      } finally {
        reading = false;
      }
    };
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted || busy || !target || summary?.status !== "ready") return;
      const selected = target;
      busy = true;
      button.disabled = true;
      cancel.hidden = false;
      cancel.disabled = false;
      try {
        await wait(500);
        loading(true);
        message("\u6B63\u5728\u67E5\u8BE2\u5E76\u8D2D\u4E70\u5F53\u524D\u6982\u5FF5\u7403\u5458\u2026");
        const result = await buy(selected, { approved: true, budget: null, expectedOperationId: summary.operationId }, {
          isCurrent: () => {
            const now = readTarget();
            return !!now && now.setId === selected.setId && now.challengeId === selected.challengeId;
          },
          onProgress: (progress) => {
            try {
              foregroundProgress?.update?.(progress);
            } catch {
            }
            message(`\u5DF2\u8D2D\u4E70 ${progress.purchased}/${progress.total}\uFF0C\u5DF2\u82B1\u8D39 ${progress.spent} \u91D1\u5E01\u3002`);
            markFailures(selected, progress.failures);
          }
        });
        output.textContent = result?.status === "purchased" ? `\u8D2D\u4E70\u5B8C\u6210\uFF1A${result.purchased} \u5F20\uFF0C\u82B1\u8D39 ${result.spent} \u91D1\u5E01\uFF1B${result.replacementPending ? "\u539F\u751F\u9635\u5BB9\u66FF\u6362\u5C1A\u672A\u5B8C\u6210\uFF0C\u56DE\u6267\u5DF2\u4FDD\u7559\uFF0C\u4E0D\u4F1A\u91CD\u590D\u4E70\u5165" : "\u5DF2\u5165\u5E93\u5E76\u66FF\u6362\u5F53\u524D\u6982\u5FF5\u5361"}\uFF0C\u672A\u63D0\u4EA4 SBC\u3002` : `${reasons[result?.reason] ?? `\u8D2D\u4E70\u6682\u505C\uFF1A${/^FC27_[A-Z0-9_]+$/.test(result?.reason ?? "") ? result.reason : "\u7ED3\u679C\u5F85\u6838\u5BF9"}`} \u5DF2\u8D2D\u4E70 ${result?.purchased ?? 0} \u5F20\uFF0C\u82B1\u8D39 ${result?.spent ?? 0} \u91D1\u5E01\u3002`;
        if (result?.failures?.length) output.textContent += ` \u672C\u6B21 ${result.failures.length} \u5F20\u672A\u4E70\u5230\uFF0C\u53EF\u518D\u6B21\u70B9\u51FB\u7EED\u8D2D\u3002`;
        markFailures(selected, result?.failures);
        if (result?.reused) output.textContent += ` \u53E6\u6709 ${result.reused} \u5F20\u5DF2\u5728 Club\uFF0C\u76F4\u63A5\u66FF\u6362\uFF0C\u672A\u91CD\u590D\u8D2D\u4E70\u3002`;
        if (result?.status === "purchased" && !result.replacementPending) button.hidden = true;
      } catch {
        output.textContent = "\u8D2D\u4E70\u7ED3\u679C\u5F85\u6838\u5BF9\uFF0C\u8BF7\u52FF\u91CD\u590D\u4E0B\u5355\u3002";
      } finally {
        loading(false);
        busy = false;
        button.disabled = false;
        cancel.hidden = true;
      }
      if (!button.hidden) await refresh(true);
    });
    cancel.addEventListener("click", (event) => {
      if (event.isTrusted && busy) {
        stop6();
        cancel.disabled = true;
        output.textContent = "\u6B63\u5728\u5B8C\u6210\u5F53\u524D\u6210\u4EA4\u6838\u5BF9\uFF0C\u7136\u540E\u505C\u6B62\u2026";
      }
    });
    const timer = schedule(() => {
      void refresh();
    }, 700);
    void refresh();
    return () => {
      disposed = true;
      unschedule(timer);
      loading(false);
      box.remove();
    };
  }

  // src/adapters/browser/fc27-workbench-navigation.js
  var NAV_SELECTORS = Object.freeze([".ut-tab-bar"]);
  var TAB_PATCH = /* @__PURE__ */ Symbol.for("fcat.fc27.tab-bar-patch");
  var TAB_OWNER = /* @__PURE__ */ Symbol.for("fcat.fc27.workbench-tab");
  function inherits(runtime, child, parent) {
    if (typeof runtime?.JSUtils?.inherits === "function") {
      runtime.JSUtils.inherits(child, parent);
      return;
    }
    child.prototype = Object.create(parent.prototype);
    child.prototype.constructor = child;
  }
  function createNativeTab(runtime, onOpen) {
    const TabItem = runtime?.UTTabBarItemView;
    const Flow = runtime?.UTGameFlowNavigationController;
    const ViewController = runtime?.EAViewController;
    const View = runtime?.EAView;
    if (!TabItem || !Flow || !ViewController || !View || !runtime?.UTGameTabBarController?.prototype?.initWithViewControllers) return null;
    try {
      let WorkbenchView = function() {
        View.call(this);
      }, WorkbenchController = function() {
        ViewController.call(this);
      };
      inherits(runtime, WorkbenchView, View);
      WorkbenchView.prototype._generate = function _generate() {
        if (this.__root) return this.__root;
        const element = runtime.document.createElement("div");
        element.className = "ut-market-search-filters-view floating fcat-navigation-workbench";
        element.style.cssText = "height:100%;overflow:auto";
        this.__root = element;
        this._generated = true;
        return element;
      };
      WorkbenchView.prototype.getRootElement = function getRootElement() {
        return this.__root ?? this._generate();
      };
      inherits(runtime, WorkbenchController, ViewController);
      WorkbenchController.prototype._getViewInstanceFromData = function _getViewInstanceFromData() {
        return new WorkbenchView();
      };
      WorkbenchController.prototype.getNavigationTitle = function getNavigationTitle() {
        return "FC Automation Tool";
      };
      WorkbenchController.prototype.viewDidAppear = function viewDidAppear(...args) {
        this.getNavigationController?.().setNavigationVisibility?.(true, true);
        onOpen?.(this.getView().getRootElement());
        return ViewController.prototype.viewDidAppear?.call(this, ...args);
      };
      const createController = (existing) => {
        const item = new TabItem();
        item.init?.();
        const tags = (existing ?? []).map((value) => value?.tabBarItem?.getTag?.()).filter(Number.isFinite);
        item.setTag?.(Math.max(19, ...tags) + 1);
        item.setText?.("FCAT");
        item.addClass?.("icon-transfer");
        item.addClass?.("fcat-navigation-entry");
        const controller = new Flow();
        controller.initWithRootController?.(new WorkbenchController());
        controller.tabBarItem = item;
        controller[TAB_OWNER] = true;
        return controller;
      };
      const prototype = runtime.UTGameTabBarController.prototype;
      if (!prototype[TAB_PATCH]) {
        const original = prototype.initWithViewControllers;
        if (typeof original !== "function") return null;
        const patched = function initWithViewControllers(viewControllers, ...args) {
          const list = Array.isArray(viewControllers) ? viewControllers : [];
          if (prototype[TAB_PATCH]?.active && !list.some((value) => value?.[TAB_OWNER])) list.push(createController(list));
          return original.call(this, list, ...args);
        };
        Object.defineProperty(prototype, TAB_PATCH, { value: { original, patched, active: true }, configurable: true });
        prototype.initWithViewControllers = patched;
      }
      return { createController };
    } catch {
      return null;
    }
  }
  function mountFc27WorkbenchNavigation({ document, runtime, onOpen, observe = true } = {}) {
    if (!document?.body || typeof onOpen !== "function") return () => {
    };
    let disposed = false;
    let button = null;
    let native = createNativeTab(runtime, onOpen);
    const attach = () => {
      if (disposed) return;
      native ??= createNativeTab(runtime, onOpen);
      const root = document.querySelector?.(".ut-tab-bar");
      if (!root) return;
      const nativeEntry = [...root.querySelectorAll?.(".fcat-navigation-entry") ?? [root.querySelector?.(".fcat-navigation-entry")]].find((entry) => entry && entry !== button);
      if (nativeEntry && nativeEntry !== button) {
        button?.remove?.();
        button = null;
        return;
      }
      const existing = document.querySelector?.("#fcat-fc27-navigation-entry") ?? root.querySelector?.("#fcat-fc27-navigation-entry");
      if (existing) {
        button = existing;
        return;
      }
      button = document.createElement("button");
      button.id = "fcat-fc27-navigation-entry";
      button.type = "button";
      button.className = "ut-tab-bar-item fcat-navigation-entry";
      button.setAttribute("aria-label", "FC Automation Tool");
      button.title = "FC Automation Tool";
      button.innerHTML = '<span aria-hidden="true" class="fcat-navigation-glyph">FC</span><span class="fcat-navigation-label">FCAT</span>';
      button.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:64px;min-height:48px;border:0;border-radius:0;background:transparent;color:inherit;font:600 11px/1 Arial,sans-serif;cursor:pointer;z-index:2";
      button.querySelector?.(".fcat-navigation-glyph")?.setAttribute("style", "display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#2b7a61;color:#fff;font-size:10px;font-weight:700");
      button.querySelector?.(".fcat-navigation-label")?.setAttribute("style", "font-size:11px;line-height:14px;white-space:nowrap");
      button.addEventListener("click", (event) => {
        if (event.isTrusted) onOpen();
      });
      root.append(button);
    };
    attach();
    const Observer = document.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    const observer = observe && typeof Observer === "function" ? new Observer(attach) : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer?.disconnect();
      button?.remove?.();
      button = null;
      const patch = runtime?.UTGameTabBarController?.prototype?.[TAB_PATCH];
      if (patch?.patched) {
        patch.active = false;
        if (runtime.UTGameTabBarController.prototype.initWithViewControllers === patch.patched) {
          runtime.UTGameTabBarController.prototype.initWithViewControllers = patch.original;
          delete runtime.UTGameTabBarController.prototype[TAB_PATCH];
        }
      }
    };
  }

  // src/fc27/production-entry.js
  var dependencies = {
    root: unsafeWindow,
    gmGetValue: GM_getValue,
    gmSetValue: GM_setValue,
    gmRequest: GM_xmlhttpRequest,
    lockManager: unsafeWindow.navigator.locks,
    liveEnabled: true
  };
  var session;
  var current = () => session ??= createFc27AcceptanceSession(dependencies);
  var fallbackPurchaseProgress = null;
  var foregroundPurchaseProgress = {
    start: () => {
      try {
        const events = unsafeWindow.events;
        if (typeof events?.showLoader === "function") {
          events.showLoader();
          return;
        }
      } catch {
      }
      const document = unsafeWindow.document;
      if (!document?.body || document.getElementById("fcat-fc27-foreground-progress")) return;
      fallbackPurchaseProgress = document.createElement("div");
      fallbackPurchaseProgress.id = "fcat-fc27-foreground-progress";
      fallbackPurchaseProgress.setAttribute("role", "status");
      fallbackPurchaseProgress.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100003;min-width:280px;max-width:calc(100vw - 32px);padding:16px 20px;border:1px solid #67736c;border-radius:8px;background:#202724;color:#edf1ef;box-shadow:0 14px 60px #000b;text-align:center;font:600 14px/1.45 Arial,sans-serif";
      fallbackPurchaseProgress.textContent = "\u6B63\u5728\u51C6\u5907\u8D2D\u4E70\u2026";
      document.body.append(fallbackPurchaseProgress);
    },
    update: (progress) => {
      try {
        const events = unsafeWindow.events;
        if (fallbackPurchaseProgress) {
          const label = progress.phase === "search" ? "\u6B63\u5728\u67E5\u4EF7" : progress.phase === "price-ready" ? "\u4EF7\u683C\u5DF2\u786E\u8BA4" : progress.phase === "buying" ? "\u6B63\u5728\u4E70\u5165" : progress.phase === "moving" ? "\u6B63\u5728\u79FB\u5165 Club" : progress.phase === "completed" ? "\u5DF2\u5B8C\u6210" : "\u6B63\u5728\u5904\u7406";
          fallbackPurchaseProgress.textContent = `${label} ${progress.index}/${progress.total}`;
        }
        if (typeof events?.changeLoadingText !== "function" || !Number.isSafeInteger(progress?.index)) return;
        const info = ["readauction.progress", progress.index, progress.total];
        if (progress.phase === "search") events.changeLoadingText("readauction.progress", info);
        else if (["price-ready", "buying", "bought", "moving", "completed"].includes(progress.phase)) {
          events.changeLoadingText("buyplayer.loadingclose", info);
        }
      } catch {
      }
    },
    end: () => {
      try {
        unsafeWindow.events?.hideLoader?.();
      } catch {
      }
      fallbackPurchaseProgress?.remove?.();
      fallbackPurchaseProgress = null;
    }
  };
  var acceptancePanel = mountFc27AcceptancePanel({
    document: unsafeWindow.document,
    hostId: "fcat-fc27-production",
    title: `FC Automation Tool ${"27.0.2"}`,
    version: "27.0.2",
    liveEnabled: dependencies.liveEnabled,
    targets: () => readFc27ChallengeTargets(unsafeWindow),
    inspectCatalog: (options) => current().inspectCatalog(options),
    inspectPuzzle: (options) => current().inspectPuzzle(options),
    inspectPuzzlePolicy: () => current().inspectPuzzlePolicy(),
    setPuzzleMaxRating: (value) => current().setPuzzleMaxRating(value),
    setPuzzlePolicy: (value) => current().setPuzzlePolicy(value),
    prepare: (options) => current().prepare(options),
    execute: (approval) => current().execute(approval),
    fillPuzzle: (approval) => current().fillPuzzle(approval),
    inspectRecovery: () => current().inspectRecovery(),
    resolveRecovery: (approved) => current().resolveRecovery(approved),
    checkInstallation: (hold) => checkFc27GmInstallation({ ...dependencies, hold })
  });
  mountFc27WorkbenchNavigation({ document: unsafeWindow.document, runtime: unsafeWindow, onOpen: (container) => acceptancePanel?.open?.(container) });
  mountFc27PuzzleNativeButton({
    document: unsafeWindow.document,
    onFill: (target, callbacks) => current().solveAndFillPuzzle(target, callbacks),
    readTarget: () => readFc27PuzzlePage(unsafeWindow)
  });
  mountFc27PuzzleBuyButton({
    document: unsafeWindow.document,
    readTarget: () => {
      const target = readFc27PuzzlePage(unsafeWindow);
      const slots = target ? readFc27PurchasePageSlots(unsafeWindow, target) : null;
      return target ? { ...target, slots, squadSignature: JSON.stringify(slots) } : null;
    },
    inspect: (target) => current().inspectPuzzlePurchases(target),
    buy: (target, approval, callbacks) => current().buyPuzzlePlayers(target, approval, callbacks),
    stop: () => current().stopPuzzlePurchases(),
    foregroundProgress: foregroundPurchaseProgress
  });
})();
