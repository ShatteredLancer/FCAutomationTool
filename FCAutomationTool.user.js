// ==UserScript==
// @name         FC Automation Tool
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool
// @version      27.0.1
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
    const id3 = get("id");
    const definitionId = get("definitionId");
    if (!identity2(id3) || !identity2(definitionId)) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
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
      id: id3,
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
    const stop5 = (reason) => ({ status: "blocked", reason, liveExecutionEnabled: false });
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
      const id3 = data(formation, "id");
      const raw = data(formation, "positions");
      let positions = null;
      if (Array.isArray(raw) && data(raw, "length") === 11) {
        const copied = Array.from({ length: 11 }, (_, index) => data(data(raw, String(index)), "typeId"));
        if (copied.every((value) => Number.isInteger(value) && value >= 0 && value <= 27)) positions = copied;
      }
      return { id: Number.isSafeInteger(id3) && id3 >= 0 && id3 < 1e9 ? id3 : null, positions };
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
    if (![setId, challengeId].every((id3) => Number.isSafeInteger(id3) && id3 > 0 && id3 < 1e9)) return stop5("INVALID_CHALLENGE_IDENTITY");
    try {
      const initial = find();
      if (!initial) return stop5("IN_PROGRESS_CHALLENGE_UNCONFIRMED");
      const load = data(initial.dao, "loadChallenge");
      if (typeof load !== "function" || !root.crypto?.subtle) return stop5("DAO_IMPLEMENTATION_UNREVIEWED");
      const source = Function.prototype.toString.call(load);
      if (source.length > 4096) return stop5("DAO_IMPLEMENTATION_UNREVIEWED");
      const hash = Array.from(
        new Uint8Array(await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source))),
        (value) => value.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== "04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e") return stop5("DAO_IMPLEMENTATION_UNREVIEWED");
      const unchanged = () => {
        const current2 = find();
        return current2?.service === initial.service && current2?.dao === initial.dao && current2?.challenge === initial.challenge && data(initial.dao, "loadChallenge") === load && current2?.scope === initial.scope && current2?.user === initial.user && current2?.persona === initial.persona && current2?.club === initial.club;
      };
      if (!unchanged()) return stop5("CHALLENGE_CHANGED");
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
        const timer = setTimeout(() => finish(stop5("SQUAD_READ_TIMEOUT")), 15e3);
        try {
          observable = load.call(initial.dao, challengeId, true);
          observable.observe(owner, (_sender, response) => {
            if (finished) return;
            try {
              if (!unchanged()) return finish(stop5("CHALLENGE_CHANGED"));
              if (data(response, "success") !== true || data(response, "status") !== 200) return finish(stop5("SQUAD_READ_UNCONFIRMED"));
              const squad = data(data(response, "response"), "squad");
              const slots = data(data(root, "UTSquadEntity"), "FIELD_PLAYERS");
              const simple = data(squad, "simpleBrickIndices");
              const custom = data(squad, "customBrickIndices");
              if (slots !== 11 || !Array.isArray(simple) || !Array.isArray(custom) || simple.length > 11 || custom.length > 11) return finish(stop5("SLOT_LAYOUT_UNVERIFIED"));
              const bricks = [...simple, ...custom];
              if (bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= slots) || new Set(bricks).size !== bricks.length || bricks.length >= slots) return finish(stop5("SLOT_LAYOUT_UNVERIFIED"));
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
              finish(stop5("SQUAD_READ_UNCONFIRMED"));
            }
          });
        } catch {
          finish(stop5("SQUAD_READ_UNCONFIRMED"));
        }
      });
    } catch {
      return stop5("SQUAD_INSPECTION_UNAVAILABLE");
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
        const id3 = ownData(challenge, "id");
        const setId = ownData(set, "id");
        if (ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "setId") !== setId || !Number.isSafeInteger(id3) || id3 <= 0 || !Number.isSafeInteger(setId) || setId <= 0) continue;
        const name = ownData(challenge, "name");
        targets.push({ id: id3, setId, name: typeof name === "string" && name.length <= 160 ? name : `Challenge ${id3}` });
      }
    }
    return targets;
  }
  function normalizeFc27TraditionalChallenge({ context, setId, challenge, layout, keys: keys2, scopes, qualities }) {
    const id3 = ownData(challenge, "id");
    if (ownData(challenge, "setId") !== setId || ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "eligibilityOperation") !== "AND" || layout.status !== "observed" || layout.setId !== setId || layout.challengeId !== id3 || layout.slotCount !== 11 || ownData(keys2, "PLAYER_MIN_OVR") !== 26 || ownData(keys2, "PLAYER_MAX_OVR") !== 28 || ownData(scopes, "GREATER") !== 0 || ownData(scopes, "EXACT") !== 2) {
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
        const scope = ownData(rule, "scope");
        if (ownData(keys2, "PLAYER_QUALITY") !== 3 || ownData(rule, "count") !== -1 || ownData(qualities, "BRONZE") !== 1 || ownData(qualities, "SILVER") !== 2 || ownData(qualities, "GOLD") !== 3 || !Array.isArray(quality2) || quality2.length !== 1 || ![1, 2, 3].includes(quality2[0]) || !(scope === 2 || scope === 0 && quality2[0] === 3)) {
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
      id: id3,
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
    let scope;
    try {
      scope = createSeasonContext(context);
    } catch {
      return stop2("CONTEXT_UNAVAILABLE");
    }
    if (scope.season !== "27") return stop2("UNSUPPORTED_SEASON");
    for (const input of [challenge, inventory, policy]) {
      let other;
      try {
        other = createSeasonContext(input?.context);
      } catch {
        return stop2("CONTEXT_UNAVAILABLE");
      }
      if (["season", "accountScope", "platform"].some((key) => other[key] !== scope[key])) return stop2("CONTEXT_MISMATCH");
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
    if (policy.schema !== 1 || policy.reviewed !== true || !integer2(policy.maxRating, 1, 99) || ["onlyUntradeable", "protectFsuLockedPlayers", "protectActiveSquad", "storageFirst"].some((key) => typeof policy[key] !== "boolean") || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2 || policy.goldRange.some((value) => !integer2(value, 75, 99)) || policy.goldRange[0] > policy.goldRange[1] || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200 || policy.excludedLeagueIds.some((id3) => !identity3(id3))) return stop2("PROTECTION_POLICY_UNVERIFIED");
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
      if (flags.some((value) => typeof value !== "boolean") || !Number.isInteger(goldenMax) || goldenMax < 75 || goldenMax > 99 || !leagues || leagues.some((id3) => !Number.isSafeInteger(id3) || id3 < 1)) throw new Error("FC27_FSU_POLICY_UNVERIFIED");
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
        if (!Number.isInteger(start) || start < 0 || start > 2e4 || !Number.isInteger(count2) || count2 < 1 || count2 > 250 || !Array.isArray(definitionIds) || definitionIds.length > 50 || definitionIds.some((id3) => !validId(id3)) || new Set(definitionIds).size !== definitionIds.length) throw new Error("FC27_CLUB_QUERY_INVALID");
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
      const id3 = target.challengeId;
      const mutation = action === "save" || action === "submit";
      if (!["unassigned", "packs", "save", "submit"].includes(action) || mutation && (!Number.isSafeInteger(id3) || id3 <= 0 || canWrite() !== true)) return fail3("FC27_LIVE_DISABLED");
      if (action === "save") {
        const bricks = target.simpleBrickIndices === void 0 ? [] : target.simpleBrickIndices;
        if (!Array.isArray(bricks) || bricks.length >= 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11) || !Array.isArray(target.players) || target.players.length < 11 || target.players.length > 32 || new Set(target.players.slice(0, 11).filter((_, index) => !bricks.includes(index)).map((player) => player?.itemData?.id)).size !== 11 - bricks.length || target.players.some((player, index) => player?.index !== index || !Number.isSafeInteger(player?.itemData?.id) || (index < 11 && !bricks.includes(index) ? player.itemData.id < 1 : ![0, -1].includes(player.itemData.id)) || player.itemData.dream !== false)) return fail3("FC27_SAVE_INPUT_UNVERIFIED");
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
        const endpoint = `/ut/game/${game}/${action === "unassigned" ? "purchased/items" : action === "packs" ? "store/purchaseGroup/all" : `sbs/challenge/${id3}${action === "save" ? "/squad" : ""}`}`;
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
        if (beforeDispatch !== null) {
          if (action !== "save" || typeof beforeDispatch !== "function") return fail3("FC27_SAVE_INPUT_UNVERIFIED");
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
    const fail12 = () => {
      throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
    };
    const slots = ownData(squad, "_players");
    const simple = ownData(squad, "simpleBrickIndices");
    const custom = ownData(squad, "customBrickIndices");
    if (ownData(ownData(root, "UTSquadEntity"), "FIELD_PLAYERS") !== 11 || !Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !Array.isArray(simple) || !Array.isArray(custom)) return fail12();
    const bricks = [...simple, ...custom];
    if (bricks.length >= 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11)) return fail12();
    const ids = Array.from({ length: slots.length }, (_, index) => {
      const slot = ownData(slots, String(index));
      const id4 = ownData(ownData(slot, "_item"), "id");
      if (ownData(slot, "index") !== index || !Number.isSafeInteger(id4) || id4 < -1 || (index >= 11 || simple.includes(index)) && id4 > 0) return fail12();
      return id4;
    });
    const formation = ownData(squad, "_formation");
    const id3 = ownData(formation, "id");
    const raw = ownData(formation, "positions");
    if (!Number.isSafeInteger(id3) || id3 <= 0 || !Array.isArray(raw) || raw.length !== 11) return fail12();
    const positions = Array.from({ length: 11 }, (_, index) => ownData(ownData(raw, String(index)), "typeId"));
    if (positions.some((value) => !Number.isInteger(value) || value < 0 || value > 27)) return fail12();
    return {
      status: "observed",
      setId,
      challengeId,
      slotCount: 11,
      simpleBrickIndices: [...simple],
      customBrickIndices: [...custom],
      requiredPlayerCount: 11 - bricks.length,
      formation: { id: id3, positions },
      squadEmpty: ids.every((value) => value === 0 || value === -1)
    };
  }
  function assertFc27PuzzleLayout(plan, layout) {
    if (layout.setId !== plan.challenge.setId || layout.challengeId !== plan.challenge.id || layout.slotCount !== plan.challenge.slotCount || layout.customBrickIndices.length || JSON.stringify(layout.simpleBrickIndices) !== JSON.stringify(plan.challenge.brickIndices) || JSON.stringify(layout.formation) !== JSON.stringify(plan.challenge.formation)) {
      throw new Error("FC27_PUZZLE_FILL_LAYOUT_CHANGED");
    }
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
      return { setId, challengeId, anchor, challenge: ownData(detail, "_challenge") };
    } catch {
      return null;
    }
  }
  function readFc27PuzzlePage(root) {
    const target = locate(root);
    return target ? { setId: target.setId, challengeId: target.challengeId, anchor: target.anchor } : null;
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
  async function synchronizeFc27PuzzleSquad(root, target, savedSquad, refs2, assertContext = () => {
  }) {
    const fail12 = () => {
      throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    };
    const runtime = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS);
    assertContext();
    const challenge = currentChallengeEntity(root, target);
    if (!challenge || ownData(challenge, "status") !== "IN_PROGRESS") return fail12();
    const local = ownData(challenge, "squad");
    const layout = projectFc27PuzzleLayout(root, local, target);
    const savedLayout = projectFc27PuzzleLayout(root, savedSquad, target);
    if (JSON.stringify({ ...layout, squadEmpty: false }) !== JSON.stringify({ ...savedLayout, squadEmpty: false }) || layout.customBrickIndices.length || !Array.isArray(refs2) || refs2.length !== layout.requiredPlayerCount || new Set(refs2.map((ref) => ref.slot)).size !== refs2.length || new Set(refs2.map((ref) => ref.id)).size !== refs2.length || new Set(refs2.map((ref) => ref.definitionId)).size !== refs2.length) return fail12();
    const matches = (squad) => refs2.every((ref) => {
      const item = ownData(ownData(squad, "_players")?.[ref.slot], "_item");
      return ownData(item, "id") === ref.id && ownData(item, "definitionId") === ref.definitionId;
    });
    if (!matches(savedSquad) || !layout.squadEmpty && !matches(local)) return fail12();
    if (local.update !== root.UTSquadEntity.prototype.update || challenge.onDataChange?.notify !== root.EAObservable.prototype.notify) return fail12();
    runtime();
    if (currentChallengeEntity(root, target) !== challenge) return fail12();
    local.update(savedSquad);
    if (ownData(challenge, "squad") !== local || !matches(local)) return fail12();
    challenge.onDataChange.notify({ squad: local });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertContext();
    if (!matches(local)) return fail12();
    return { status: "synchronized", selectedCount: refs2.length };
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
        present: present.map(({ id: id3, definitionId, pile }) => ({ id: id3, definitionId, pile })),
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
        if (ids.some((id3, index) => !Number.isSafeInteger(id3) || ownData(slots[index], "index") !== index || (index >= 11 || plan.challenge.brickIndices.includes(index)) && ![0, -1].includes(id3))) return fail4("FC27_SQUAD_STATE_UNVERIFIED");
        return {
          context,
          fresh: true,
          observedAt: Date.now(),
          setId: plan.challenge.setId,
          challengeId: plan.challenge.id,
          squadEmpty: ids.every((id3) => id3 === 0 || id3 === -1),
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
      async save(plan, beforeWrite = null, beforeDispatch = null) {
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
        const players = slots.map((slot, index) => {
          const selected = plan.selected.find((item) => item.slot === index);
          const emptyId = ownData(ownData(slot, "_item"), "id");
          const playable = index < 11 && !plan.challenge.brickIndices.includes(index);
          if (ownData(slot, "index") !== index || playable && !selected || !playable && (selected || ![0, -1].includes(emptyId))) {
            return fail4("FC27_SAVE_INPUT_UNVERIFIED");
          }
          if (plan.kind === "puzzle-fill" && ![0, -1].includes(emptyId)) return fail4("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
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
          consumed: evidence.present.length === 0 ? plan.selected.map(({ id: id3, definitionId, pile }) => ({ id: id3, definitionId, pile })) : [],
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
        } catch (error2) {
          return { ...blocked(safeReason(error2)), ...outcome, status: "blocked", reason: safeReason(error2) };
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
  function normalizedScope(scope) {
    return [0, 1, 2].includes(scope) ? scope : null;
  }
  var countMode = (scope) => scope === 0 ? "min" : scope === 1 ? "max" : "exact";
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
  function relationRule(key, value, scope, required2) {
    const kind = relationKind(key);
    if (!kind || !positive3(value) || normalizedScope(scope) === null) return null;
    const mode = scope === FC27_SBC_SCOPE.GREATER ? "min" : scope === FC27_SBC_SCOPE.LOWER ? "max" : "exact";
    return { kind, value, mode, count: required2, source: { key, scope, values: [value], count: -1 } };
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
      const scope = normalizedScope(raw?.scope);
      const values6 = valuesOf(pair);
      const source = requirementSource(raw, pair, required2);
      let parsed = null;
      if (!pair || !integer4(pair.key) || scope === null || values6.length !== (pair.values?.length ?? -1) || !values6.length || values6.length > 32 || new Set(values6).size !== values6.length) {
        parsed = unsupported(raw, pair, required2, "shape");
      } else {
        const key = pair.key;
        const count2 = nonnegative3(raw.count) && raw.count <= required2 ? raw.count : null;
        const mode = countMode(scope);
        const value = values6[0];
        switch (key) {
          case FC27_SBC_KEY.QUALITY: {
            const bounds = qualityBounds[value];
            if (!bounds || values6.length !== 1 || raw.count !== -1) parsed = unsupported(raw, pair, required2, "quality-shape");
            else if (scope === FC27_SBC_SCOPE.EXACT) {
              parsed = { kind: "all-quality", quality: value, minRating: bounds[0], maxRating: bounds[1], count: required2, source };
            } else if (scope === FC27_SBC_SCOPE.GREATER) {
              parsed = { kind: "min-quality", quality: value, count: required2, minRating: bounds[0], source };
            } else {
              parsed = { kind: "max-quality", quality: value, count: required2, maxRating: bounds[1], source };
            }
            break;
          }
          case FC27_SBC_KEY.LEVEL:
            parsed = count2 !== null && values6.every((v) => qualityBounds[v]) ? { kind: "quality-count", qualities: [...values6], mode: scope === FC27_SBC_SCOPE.GREATER ? "min" : scope === FC27_SBC_SCOPE.LOWER ? "max" : "exact", count: count2, source } : unsupported(raw, pair, required2, "quality-count-shape");
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
              mode: scope === FC27_SBC_SCOPE.GREATER ? "min" : scope === FC27_SBC_SCOPE.LOWER ? "max" : "exact",
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
            const relation = raw.count === -1 && values6.length === 1 && value <= required2 ? relationRule(key, value, scope, required2) : null;
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
    return (id3) => positive3(id3) ? links.get(id3) ?? id3 : null;
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
    for (const [strategy, field] of [["league", "leagueId"], ["nation", "nationId"]]) {
      const groups = /* @__PURE__ */ new Map();
      for (const item of pool.candidates) {
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
    let candidates = pool.candidates;
    candidates = candidates.filter((item) => itemRules.every((rule) => {
      if (rule.count === required2 && rule.mode !== "max") return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== false;
      if (rule.count === 0 && ["max", "exact"].includes(rule.mode)) return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== true;
      return true;
    }));
    if (searchHint !== null && (!searchHint || Object.keys(searchHint).sort().join(",") !== "groupId,strategy" || !["balanced", "low-rating", "nation", "league", "club"].includes(searchHint.strategy) || !integer5(searchHint.groupId, 0, Number.MAX_SAFE_INTEGER) || (["balanced", "low-rating"].includes(searchHint.strategy) ? searchHint.groupId !== 0 : searchHint.groupId === 0))) {
      return blocked2("FC27_PUZZLE_STRATEGY_INVALID");
    }
    if (searchHint?.strategy !== "low-rating" && parsed.rules.some((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind) && rule.value > 0)) {
      const fields2 = [
        (item) => item.nationId,
        (item) => item.leagueId,
        (item) => resolveClub?.(item.teamId ?? item.clubId)
      ];
      const frequencies = fields2.map((read) => {
        const groups = /* @__PURE__ */ new Map();
        for (const item of candidates) {
          const key = read(item);
          if (!integer5(key, 1, Number.MAX_SAFE_INTEGER)) continue;
          if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
          groups.get(key).add(item.definitionId);
        }
        return groups;
      });
      const scores = new Map(candidates.map((item) => [item, fields2.reduce((sum, read, index) => sum + Math.min(required2, frequencies[index].get(read(item))?.size ?? 0), 0)]));
      candidates = candidates.slice().sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || scores.get(b) - scores.get(a) || a.rating - b.rating || (Number.isSafeInteger(a.id) && Number.isSafeInteger(b.id) ? a.id - b.id : a.definitionId - b.definitionId));
    }
    if (["nation", "league", "club"].includes(searchHint?.strategy)) {
      const group = (item) => searchHint.strategy === "club" ? resolveClub?.(item.teamId ?? item.clubId) : item[searchHint.strategy === "nation" ? "nationId" : "leagueId"];
      if (!candidates.some((item) => group(item) === searchHint.groupId)) return blocked2("FC27_PUZZLE_STRATEGY_INVALID");
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
    if (!found) return blocked2("FC27_PUZZLE_NO_PLAN_FOUND", { ...metrics, nodes, maxNodes, deficits: [] });
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
    const fields2 = [
      { id: 1, value: (item) => item.nationId },
      { id: 2, value: (item) => item.leagueId },
      { id: 3, value: (item) => resolveClub(item.teamId) }
    ];
    const counts = fields2.map(() => /* @__PURE__ */ new Map());
    const eligible = squad.map((item, slot) => item !== null && item.positions.includes(formation.positions[slot]));
    squad.forEach((item, slot) => {
      if (eligible[slot]) fields2.forEach((field, index) => {
        const id3 = field.value(item);
        counts[index].set(id3, (counts[index].get(id3) ?? 0) + 1);
      });
    });
    const slotChemistry = squad.map((item, slot) => eligible[slot] ? Math.min(3, fields2.reduce((total, field, index) => {
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
    const validId2 = (value) => Number.isSafeInteger(value) && value > 0;
    if (!Array.isArray(selected) || !Array.isArray(freshItems) || selected.length < 1 || selected.length > 11 || freshItems.length >= 250 || !Array.isArray(plannedItems) || plannedItems.length !== selected.length) return failed();
    const fields2 = [
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
    if (byId.size !== freshItems.length || expected.size !== selected.length || freshItems.some((item) => !validId2(item?.id) || !validId2(item?.definitionId) || !selected.some((ref) => ref.definitionId === item.definitionId))) return failed();
    const seenIds = /* @__PURE__ */ new Set();
    const seenDefinitions = /* @__PURE__ */ new Set();
    for (const plan of selected) {
      const current2 = byId.get(plan?.id);
      const before = expected.get(plan?.id);
      if (!validId2(plan?.id) || !validId2(plan?.definitionId) || plan.pile !== "club" || seenIds.has(plan.id) || seenDefinitions.has(plan.definitionId) || !current2 || !before || current2.id !== plan.id || current2.definitionId !== plan.definitionId || fields2.some((key) => !Object.hasOwn(current2, key) || !Object.hasOwn(before, key) || JSON.stringify(current2[key]) !== JSON.stringify(before[key])) || current2.type !== "player" || current2.pile !== "club" || current2.rating !== plan.rating || current2.special !== false || current2.evolution !== false || current2.cosmetic !== false || current2.concept !== false || current2.academyEnrolled !== false || current2.activeTrade !== false || current2.limitedUse !== false || current2.loans !== -1 || current2.tradeable !== false) {
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
      if (links.length !== size || links.some((pair) => !pair.every((id3) => Number.isSafeInteger(id3) && id3 > 0))) return null;
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
  function assess(scope, selected, items) {
    const { context, challenge, policy, clubLinks, chemistry } = scope;
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
      const scope = structuredClone(scopeOf(input));
      const items = selected.map((ref) => {
        const matches = input.inventory.items.filter((item) => item.id === ref.id);
        return matches.length === 1 ? project(matches[0]) : null;
      });
      const validation = assess(scope, selected, items);
      if (validation.status !== "verified") return validation;
      return freeze3({
        status: "prepared",
        kind: "puzzle-fill",
        schema: 1,
        executable: false,
        ...scope,
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
      const stop5 = (reason) => ({
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
          return stop5("FC27_EXACT_ITEMS_CHANGED");
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
        if (signature2() !== before) return stop5("FC27_RUNNER_INPUTS_CHANGED");
        const fresh = await transport.readPage({
          start: 0,
          count: 250,
          definitionIds: selected.map((item) => item.definitionId)
        });
        if (signature2() !== before) return stop5("FC27_RUNNER_INPUTS_CHANGED");
        const exactValidation = validateFc27PuzzleSelection(selected, fresh, plannedItems);
        if (exactValidation.status !== "verified") return stop5(exactValidation.reason);
        const fillPlan = prepareFc27PuzzleFillPlan(inputs, plan);
        const fillPreflight = fillPlan.status === "prepared" ? validateFc27PuzzleFillPlan(fillPlan, inputs, fresh) : fillPlan;
        if (typeof onVerifiedInputs === "function") {
          const fields2 = [
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
            squad[ref.slot] = Object.fromEntries(fields2.map((key) => [key, plannedItems[index][key]]));
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
          if (signature2() !== before) return stop5("FC27_RUNNER_INPUTS_CHANGED");
        }
        return { ...plan, fillPreflight, exactValidation: {
          ...exactValidation,
          observedAt: Date.now(),
          scope: "selected-club-items-only",
          reusableForExecution: false
        } };
      } catch (error2) {
        return stop5(/^FC27_[A-Z0-9_]+$/.test(error2?.message ?? "") ? error2.message : "FC27_PUZZLE_EXACT_CHECK_UNAVAILABLE");
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
  var positive6 = (value) => Number.isSafeInteger(value) && value > 0;
  var same5 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var fail10 = (reason) => {
    throw new Error(reason);
  };
  function normalize(scope, input) {
    const bricks = input?.schema === 2 ? input.brickIndices : [];
    const required2 = Array.isArray(bricks) ? 11 - bricks.length : 0;
    if (!input || ![1, 2].includes(input.schema) || input.kind !== "puzzle-fill" || required2 < 1 || required2 > 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index > 10) || input.scope !== scope || typeof input.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId) || !positive6(input.setId) || !positive6(input.challengeId) || !["save-pending", "saved"].includes(input.phase) || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0 || input.submitted !== false || !Array.isArray(input.itemRefs) || input.itemRefs.length !== required2 || input.itemRefs.some((ref) => !ref || !positive6(ref.id) || !positive6(ref.definitionId) || ref.pile !== "club" || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || bricks.includes(ref.slot)) || new Set(input.itemRefs.map((ref) => ref.id)).size !== required2 || new Set(input.itemRefs.map((ref) => ref.definitionId)).size !== required2 || new Set(input.itemRefs.map((ref) => ref.slot)).size !== required2) {
      return fail10("FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED");
    }
    return structuredClone(input);
  }
  function createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue, lock, lockScope = null } = {}) {
    if (typeof gmGetValue !== "function" || typeof gmSetValue !== "function" || typeof lock?.run !== "function" || typeof lock?.hasExclusiveAccess !== "function" || lockScope !== traditionalJournalScope(context)) {
      return fail10("FC27_PUZZLE_FILL_STORAGE_UNAVAILABLE");
    }
    const storageKey = keyOf(context);
    const scope = lockScope;
    const nativeScope = scope;
    const exclusive = (requestedScope, task) => {
      if (requestedScope !== scope || typeof task !== "function") return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      return lock.run(nativeScope, task);
    };
    const held = (requested) => requested === scope && lock.hasExclusiveAccess(nativeScope) === true;
    const journal = Object.freeze({
      async read(requestedScope) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        let raw;
        try {
          raw = await gmGetValue(storageKey, null);
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED");
        }
        if (raw === null) return null;
        return normalize(scope, raw);
      },
      async write(requestedScope, value) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        const next = normalize(scope, value);
        const previous = await journal.read(scope);
        if (previous && next.updatedAt < previous.updatedAt) return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        if (!previous && next.phase !== "save-pending") return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        const newOperation = previous?.phase === "saved" && next.phase === "save-pending" && previous.operationId !== next.operationId;
        if (previous && !newOperation && (previous.operationId !== next.operationId || previous.schema !== next.schema || !same5(previous.brickIndices, next.brickIndices) || next.updatedAt < previous.updatedAt || previous.setId !== next.setId || previous.challengeId !== next.challengeId || !same5(previous.itemRefs, next.itemRefs) || previous.phase === "saved" && next.phase !== "saved" || previous.phase === "save-pending" && !["save-pending", "saved"].includes(next.phase))) {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED");
        }
        try {
          await gmSetValue(storageKey, next);
          if (!same5(await journal.read(scope), next)) return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        }
      },
      async clear(requestedScope, expected) {
        if (!held(requestedScope)) return fail10("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        const current2 = await journal.read(scope);
        if (!same5(current2, expected)) return fail10("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
        try {
          await gmSetValue(storageKey, null);
          if (await journal.read(scope) !== null) return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        } catch {
          return fail10("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
        }
      }
    });
    return Object.freeze({ scope, nativeScope, exclusive, journal, inspect: () => ({ active: held(scope) }) });
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
          const scope = traditionalJournalScope(plan.context);
          let entered = false;
          return await exclusive(scope, async () => {
            if (entered) fail11("FC27_EXCLUSIVE_ACCESS_LOST");
            entered = true;
            alive(created);
            if (await checkOtherTransactions(scope) !== true) fail11("FC27_RECOVERY_REQUIRED");
            const previous = await journal.read(scope);
            if (previous && previous.phase !== "saved") fail11("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            const operationId = createOperationId();
            if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) fail11("FC27_PUZZLE_OPERATION_UNVERIFIED");
            const record = {
              schema: 2,
              kind: "puzzle-fill",
              scope,
              operationId,
              brickIndices: [...plan.challenge.brickIndices],
              setId: plan.challenge.setId,
              challengeId: plan.challenge.id,
              itemRefs: plan.selected.map(({ id: id3, definitionId, pile, slot }) => ({ id: id3, definitionId, pile, slot })),
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
                  await journal.write(scope, structuredClone(record));
                  if (!same6(await journal.read(scope), record)) fail11("FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED");
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
                await journal.write(scope, { ...record, phase: "saved", updatedAt: time() });
                const completed = await journal.read(scope);
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

  // src/fc27/puzzle-procurement.js
  var seeds = /* @__PURE__ */ new WeakMap();
  var stop3 = (reason) => ({ status: "blocked", reason, executable: false, plans: [] });
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
    if (parsed.status !== "observed") return stop3(parsed.reason);
    const chemistry = parsed.rules.filter((rule) => rule.kind.endsWith("-chemistry"));
    if (chemistry.length !== 1 || chemistry[0].kind !== "min-chemistry") return stop3("FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE");
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
      if (facts2.status !== "observed") return stop3(facts2.reason);
      const seed = { status: "ready", executable: false, squad, teamFacts: facts2, requiredChemistry: original };
      seeds.set(seed, signature(input));
      return seed;
    }
    return stop3("FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE");
  }
  function planFc27PuzzleRepairQueries(input, seed) {
    if (!validSeed(input, seed)) return stop3("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
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
    if (!validSeed(input, seed)) return stop3("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    if (!Array.isArray(entries2) || entries2.length > 60 || !Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 5e4) return stop3("FC27_PURCHASE_REPAIR_BUDGET_INVALID");
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop3(pool.reason);
    if (seed.squad.some((item) => item && !pool.candidates.some((candidate) => candidate.id === item.id && JSON.stringify({ ...candidate, slot: item.slot }) === JSON.stringify(item)))) return stop3("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop3(parsed.reason);
    const material = puzzleMaterialRules(parsed.rules, required(input));
    const owned = new Set(input.inventory.items.map((item) => item.definitionId));
    const seen = /* @__PURE__ */ new Set();
    const candidates = entries2.filter((item) => {
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
    const slots = seed.squad.flatMap((item, index) => item ? [index] : []);
    const plans = [];
    const combinations = /* @__PURE__ */ new Set();
    let checks = 0;
    const assess2 = (squad) => {
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
      const purchases = squad.flatMap((item, slot) => item?.catalogRef ? [{ ...item, slot, quantity: 1 }] : []);
      const key = purchases.map((item) => item.definitionId).sort((a, b) => a - b).join(",");
      if (combinations.has(key)) return;
      combinations.add(key);
      plans.push({
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
        requirementCount: parsed.rules.length,
        requiresPurchasedMaterialApproval: true,
        marketAvailabilityVerified: false
      });
    };
    for (const card of candidates) for (const removed of slots) for (const target of slots) {
      if (checks >= maxChecks) break;
      const squad = seed.squad.slice();
      squad[removed] = squad[target];
      squad[target] = card;
      assess2(squad);
    }
    if (!plans.length) for (let a = 0; a < Math.min(12, candidates.length); a++) for (let b = a + 1; b < Math.min(12, candidates.length); b++) {
      for (const first of slots) for (const second of slots) {
        if (first === second || checks >= maxChecks) continue;
        const squad = seed.squad.slice();
        squad[first] = candidates[a];
        squad[second] = candidates[b];
        assess2(squad);
      }
    }
    plans.sort((a, b) => a.purchaseCount - b.purchaseCount || b.teamFacts.chemistry - a.teamFacts.chemistry || a.purchases.reduce((n, card) => n + card.rating, 0) - b.purchases.reduce((n, card) => n + card.rating, 0));
    return {
      status: plans.length ? "suggested" : "blocked",
      reason: plans.length ? "FC27_PURCHASE_SUGGESTIONS_READY" : "FC27_PURCHASE_REPAIR_NO_PLAN",
      executable: false,
      plans: plans.slice(0, 8),
      checks,
      truncated: checks >= maxChecks || plans.length > 8,
      marketWideInfeasibilityProven: false
    };
  }

  // src/fc27/puzzle-procurement-session.js
  var safeReason3 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message ?? "") ? error2.message : "FC27_PURCHASE_READ_FAILED";
  var stop4 = (reason) => ({ status: "blocked", reason, executable: false, liveExecutionEnabled: false, plans: [] });
  var same7 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var id2 = (value) => Number.isSafeInteger(value) && value > 0;
  function createFc27PuzzleProcurementSession({ createTransport, get, set, now = Date.now } = {}) {
    let busy = false;
    return Object.freeze({ async plan(input, { assertCurrent = () => {
    } } = {}) {
      if (busy) return stop4("FC27_PURCHASE_BUSY");
      busy = true;
      let requests = 0;
      let cacheHits = 0;
      let transport;
      try {
        const scope = traditionalJournalScope(input.context);
        assertCurrent();
        const seed = findFc27PuzzleRepairSeed(input);
        if (seed.status !== "ready") return seed;
        const route = planFc27PuzzleRepairQueries(input, seed);
        if (route.status !== "ready") return route;
        const cachedRead = async (kind, query) => {
          assertCurrent();
          const key = `fcat-fc27-puzzle-market:${scope}:${kind}:${JSON.stringify(query)}`;
          const stored = await get(key, null);
          assertCurrent();
          if (stored !== null) {
            if (stored?.schema !== 1 || stored.kind !== kind || !same7(stored.query, query) || !id2(stored.at) || stored.at > now()) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
            if (stored.state !== "observed") throw new Error(stored.reason ?? "FC27_PURCHASE_READ_UNCONFIRMED");
            if (now() - stored.at > (kind === "catalog" ? 864e5 : 6e5)) throw new Error("FC27_PURCHASE_CACHE_EXPIRED");
            cacheHits++;
            return structuredClone(stored.result);
          }
          const record = { schema: 1, kind, query, at: now(), state: "pending" };
          await set(key, record);
          if (!same7(await get(key, null), record)) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
          assertCurrent();
          try {
            transport ??= await createTransport();
            assertCurrent();
            requests++;
            const result = await (kind === "catalog" ? transport.readCatalogPage(query) : transport.readQuotePage(query));
            await set(key, { ...record, state: "observed", result });
            assertCurrent();
            return result;
          } catch (error2) {
            await set(key, { ...record, state: "blocked", reason: safeReason3(error2) });
            throw error2;
          }
        };
        const entries2 = /* @__PURE__ */ new Map();
        const quotes = /* @__PURE__ */ new Map();
        const usedQueries = [];
        let lastSuggestion;
        for (const query of route.queries) {
          const page = await cachedRead("catalog", query);
          usedQueries.push(query);
          if (page?.status !== "observed" || page.season !== "27" || page.source !== "ea-defid" || !same7(page.query, query) || !id2(page.observedAt) || page.observedAt > now() || now() - page.observedAt > 864e5 || !Array.isArray(page.entries) || page.entries.length > query.count || new Set(page.entries.map((item) => item?.definitionId)).size !== page.entries.length) throw new Error("FC27_PURCHASE_CATALOG_UNVERIFIED");
          for (const entry of page.entries) {
            if (entries2.has(entry.definitionId) && !same7(entries2.get(entry.definitionId), entry)) throw new Error("FC27_PURCHASE_CATALOG_CHANGED");
            entries2.set(entry.definitionId, entry);
          }
          assertCurrent();
          lastSuggestion = suggestFc27PuzzlePurchases(input, seed, [...entries2.values()]);
          const plans = lastSuggestion.plans ?? [];
          for (const plan of plans) for (const item of plan.purchases) {
            if (quotes.has(item.definitionId) || quotes.size >= 4) continue;
            const quote = await cachedRead("quote", { definitionId: item.definitionId, start: 0, count: 20, maxBuy: 2e3 });
            if (quote?.status !== "observed" || quote.season !== "27" || quote.platform !== input.context.platform || quote.source !== "ea-visible-buy-now" || quote.definitionId !== item.definitionId || !id2(quote.observedAt) || quote.observedAt > now() || now() - quote.observedAt > 6e5 || !Number.isInteger(quote.eligible) || quote.eligible < 0 || quote.eligible > 20 || (quote.eligible === 0 ? quote.price !== null : !Number.isInteger(quote.price) || quote.price < 150 || quote.price > 2e3)) {
              throw new Error("FC27_PURCHASE_QUOTE_UNVERIFIED");
            }
            quotes.set(item.definitionId, quote);
          }
          const priced = plans.filter((plan) => plan.purchases.every((item) => quotes.get(item.definitionId)?.price > 0)).map((plan) => ({
            ...plan,
            purchases: plan.purchases.map((item) => ({
              ...item,
              observedBuyNow: quotes.get(item.definitionId).price,
              quotedAt: quotes.get(item.definitionId).observedAt
            })),
            estimatedCost: plan.purchases.reduce((sum, item) => sum + quotes.get(item.definitionId).price, 0)
          })).sort((a, b) => a.purchaseCount - b.purchaseCount || a.estimatedCost - b.estimatedCost);
          if (priced.length) return {
            status: "suggested",
            reason: "FC27_PURCHASE_PLAN_PRICED",
            executable: false,
            liveExecutionEnabled: false,
            plans: priced.slice(0, 3),
            requests,
            cacheHits,
            queries: usedQueries,
            seedChemistry: seed.teamFacts.chemistry,
            requiredChemistry: seed.requiredChemistry,
            quoteCeiling: 2e3,
            affordabilityVerified: false,
            globalMinimumProven: false,
            pending: ["EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL", "LIVE_AUCTION_RECHECK", "EXACT_PURCHASE_RECEIPTS", "FRESH_INVENTORY_REPLAN"]
          };
        }
        return { ...stop4(lastSuggestion?.plans?.length ? "FC27_PURCHASE_QUOTES_UNAVAILABLE" : "FC27_PURCHASE_REPAIR_NO_PLAN"), requests, cacheHits, queries: usedQueries };
      } catch (error2) {
        return { ...stop4(safeReason3(error2)), requests, cacheHits };
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
  var error = (code) => new Error(`FC27_MARKET_${code}`);
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
  async function createFc27MarketReadTransport(root) {
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
    async function request(kind, query, project2) {
      if (busy || stopped || requests >= 8) throw error("READ_BLOCKED");
      busy = true;
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
        if (ownData(dto, "success") !== true || status !== 200) throw error(valid(status, 100, 599) ? `HTTP_${status}` : "RESPONSE_UNVERIFIED");
        const body = ownData(dto, "response");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw error("RESPONSE_UNVERIFIED");
        const result = project2(body);
        assertRuntime();
        return result;
      } catch (caught) {
        stopped = true;
        throw new Error(marketReadReason(caught));
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
        if (!query || Object.keys(query).some((k) => !["definitionId", "start", "count", "maxBuy"].includes(k)) || !valid(query.definitionId, 1, Number.MAX_SAFE_INTEGER) || !valid(query.start, 0, 1e3) || !valid(query.count, 1, 50) || !valid(query.maxBuy, 150, 1e4)) throw error("QUERY_INVALID");
        return request("quotes", {
          type: "player",
          definitionId: query.definitionId,
          start: query.start,
          num: query.count,
          maxb: query.maxBuy
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
            if (ownData(row, "tradeState") === "active" && valid(ownData(row, "expires"), 1, 604800) && valid(price, 150, query.maxBuy) && ownData(row, "tradeOwner") === false && ownData(item, "untradeable") === false) prices.push(price);
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

  // src/adapters/browser/fc27-acceptance-session.js
  var blocked5 = (reason) => ({ status: "blocked", reason });
  var safeReason4 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message) ? error2.message : "FC27_ACCEPTANCE_UNCONFIRMED";
  var puzzleInput = (input) => ({
    context: input.context,
    challenge: input.challenge,
    inventory: input.inventory,
    policy: input.policy,
    clubLinks: input.clubLinks,
    chemistry: input.chemistry,
    squadEmpty: input.squadEmpty
  });
  var puzzleCatalogCacheKey = (scope, setId, challengeId = "all") => `fcat-fc27-puzzle-catalog:${scope}:${setId}:${challengeId}`;
  var cacheCatalogProjection = (catalog, scope, setId, reasonOverride = void 0) => ({
    schema: 1,
    scope,
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
  var readCachedCatalog = async (gmGetValue, scope, setId, challengeId = void 0) => {
    try {
      const cached = await gmGetValue(puzzleCatalogCacheKey(scope, setId), null);
      if (!cached) return null;
      if (cached.schema !== 1 || cached.scope !== scope || cached.setId !== setId || cached.challengeId !== null || !cached.result || cached.result.setId !== setId || !Number.isSafeInteger(cached.attemptedAt) || !["observed", "blocked"].includes(cached.result.status) || !Array.isArray(cached.result.challenges)) {
        return { status: "blocked", reason: "FC27_CATALOG_CACHE_UNVERIFIED", liveExecutionEnabled: false, setId };
      }
      return structuredClone(cached.result);
    } catch {
      return { status: "blocked", reason: "FC27_CATALOG_CACHE_UNVERIFIED", liveExecutionEnabled: false, setId };
    }
  };
  function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, lockManager, liveEnabled = false }) {
    const context = readFc27Context(root);
    const scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
    const puzzlePersistence = createFc27PuzzleFillPersistence({
      context,
      gmGetValue,
      gmSetValue,
      lock: persistence.lock,
      lockScope: scope
    });
    let prepared = null;
    let preparedPuzzle = null;
    let recovery = null;
    let armed = false;
    let busy = false;
    const catalogMemo = /* @__PURE__ */ new Map();
    const puzzlePolicyKey = `fcat-fc27-puzzle-policy:${scope}`;
    const procurement = createFc27PuzzleProcurementSession({
      createTransport: () => createFc27MarketReadTransport(root),
      get: gmGetValue,
      set: gmSetValue
    });
    const readPuzzleMaxRating = async () => {
      const value = await gmGetValue(puzzlePolicyKey, null);
      if (value === null) return DEFAULT_PUZZLE_MAX_RATING;
      if (value?.schema !== 1 || !Number.isSafeInteger(value.maxRating) || value.maxRating < 1 || value.maxRating > 99) {
        throw new Error("FC27_PUZZLE_POLICY_INVALID");
      }
      return value.maxRating;
    };
    const invalidate = () => {
      prepared?.adapter.cancel();
      prepared = null;
      preparedPuzzle?.adapter.cancel();
      preparedPuzzle = null;
    };
    const traditionalExclusive = (requestedScope, task) => persistence.exclusive(requestedScope, async () => {
      if ((await puzzlePersistence.journal.read(requestedScope))?.phase === "save-pending") throw new Error("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
      return task();
    });
    const unchanged = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_TRANSACTION_CONTEXT_CHANGED");
    };
    const readPuzzleCatalog = async (setId, challengeId = void 0) => {
      if (!Number.isSafeInteger(setId) || setId <= 0) return { result: blocked5("FC27_CATALOG_SET_UNVERIFIED"), source: "none" };
      const memoKey = `${setId}:${challengeId ?? "all"}`;
      if (catalogMemo.has(memoKey)) return { ...catalogMemo.get(memoKey), source: "memoized" };
      let cached = await readCachedCatalog(gmGetValue, scope, setId);
      if (cached) {
        const value2 = { result: cached, source: "cached" };
        catalogMemo.set(memoKey, value2);
        return value2;
      }
      const value = await persistence.exclusive(scope, async () => {
        const again = await readCachedCatalog(gmGetValue, scope, setId);
        if (again) return { result: again, source: "cached" };
        try {
          await gmSetValue(puzzleCatalogCacheKey(scope, setId), cacheCatalogProjection(
            { status: "blocked", reason: "FC27_CATALOG_READ_IN_PROGRESS", setId },
            scope,
            setId
          ));
        } catch {
          throw new Error("FC27_CATALOG_CACHE_UNAVAILABLE");
        }
        const observed = await inspectFc27ChallengeCatalog(root, { setId });
        try {
          await gmSetValue(puzzleCatalogCacheKey(scope, setId), cacheCatalogProjection(observed, scope, setId));
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
      if (busy) return blocked5("FC27_ATTEMPT_BUSY");
      busy = true;
      try {
        unchanged();
        return await task();
      } catch (error2) {
        return blocked5(safeReason4(error2));
      } finally {
        busy = false;
        armed = false;
      }
    };
    const inspect = async () => persistence.exclusive(scope, async () => {
      recovery = null;
      const puzzleRecord = await puzzlePersistence.journal.read(scope);
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
    const observePuzzleRecovery = async (record, { synchronize = false } = {}) => {
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
          if (synchronize && (await adapter.syncSavedSquad(plan))?.status !== "synchronized") return null;
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
      const available = await persistence.exclusive(scope, async () => {
        const record = await persistence.journal.read(scope);
        if (record && !isTerminalTraditionalJournal(record)) throw new Error("FC27_RECOVERY_REQUIRED");
        if ((await puzzlePersistence.journal.read(scope))?.phase === "save-pending") throw new Error("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
        return true;
      });
      if (available !== true) return blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      const pageSnapshot = nativeOnly ? readFc27PuzzlePageSnapshot(root, { setId, challengeId }) : null;
      if (nativeOnly && !pageSnapshot) return blocked5("FC27_PUZZLE_FILL_TARGET_CHANGED");
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
        return blocked5(pageSnapshot.challenge.status === "COMPLETED" ? "FC27_PUZZLE_CHALLENGE_COMPLETED" : "FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS");
      }
      const candidates = catalog.challenges.filter((challenge) => challenge.status === "IN_PROGRESS" && challenge.eligibilityOperation === "AND" && (challengeId === void 0 || challenge.id === challengeId));
      if (candidates.length !== 1) return blocked5("FC27_PUZZLE_CHALLENGE_AMBIGUOUS");
      let privateData = null;
      const requestedMaxRating = await readPuzzleMaxRating();
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
          const purchaseSuggestion = await persistence.exclusive(scope, () => procurement.plan(inputs, { assertCurrent: () => {
            assertTarget();
            unchanged();
            const latest = readFc27PuzzlePageSnapshot(root, { setId, challengeId: candidates[0].id });
            if (!latest?.layout?.squadEmpty || JSON.stringify(latest.challenge.requirements) !== JSON.stringify(inputs.challenge.rawRequirements) || JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(inputs.policy)) {
              throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
            }
          } })) ?? blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
          for (const plan of purchaseSuggestion.plans ?? []) for (const item of plan.purchases) {
            const name = readFc27MarketPlayerName(root, item.definitionId);
            if (name) item.displayName = name;
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
            return native.save({ ...plan2, set: { id: plan2.challenge.setId } }, assertPuzzleCurrent, beforeDispatch);
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
      if (!preparedPuzzle || liveEnabled !== true) return blocked5("FC27_PUZZLE_FILL_DISABLED");
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
    return Object.freeze({
      inspectPuzzlePolicy: () => run(async () => ({ status: "observed", maxRating: await readPuzzleMaxRating() })),
      setPuzzleMaxRating: (maxRating) => run(async () => {
        if (!Number.isSafeInteger(maxRating) || maxRating < 1 || maxRating > 99) return blocked5("FC27_PUZZLE_POLICY_INVALID");
        return persistence.exclusive(scope, async () => {
          invalidate();
          await gmSetValue(puzzlePolicyKey, { schema: 1, maxRating });
          if (await readPuzzleMaxRating() !== maxRating) return blocked5("FC27_PUZZLE_POLICY_UNCONFIRMED");
          return { status: "observed", reason: "FC27_PUZZLE_POLICY_SAVED", maxRating };
        });
      }),
      inspectCatalog: ({ setId } = {}) => run(async () => {
        invalidate();
        const catalogRead = await readPuzzleCatalog(setId);
        return { ...catalogRead.result, catalogSource: catalogRead.source };
      }),
      inspectPuzzle: (options) => run(() => preparePuzzle(options)),
      solveAndFillPuzzle: (target, { isCurrent, onProgress } = {}) => run(async () => {
        if (liveEnabled !== true) return blocked5("FC27_PUZZLE_FILL_DISABLED");
        if (!Number.isSafeInteger(target?.setId) || target.setId <= 0 || !Number.isSafeInteger(target?.challengeId) || target.challengeId <= 0 || typeof isCurrent !== "function") return blocked5("FC27_PUZZLE_FILL_TARGET_CHANGED");
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
            await gmSetValue(`fcat-fc27-puzzle-last:${scope}`, structuredClone(log));
          } catch {
          }
        };
        let result;
        try {
          progress("planning");
          await persistLog();
          result = await persistence.exclusive(scope, async () => {
            const other = await persistence.journal.read(scope);
            if (other && !isTerminalTraditionalJournal(other)) return blocked5("FC27_RECOVERY_REQUIRED");
            const record = await puzzlePersistence.journal.read(scope);
            if (record?.phase !== "save-pending") return null;
            if (record.setId !== target.setId || record.challengeId !== target.challengeId) {
              return { ...blocked5("FC27_PUZZLE_FILL_RECOVERY_REQUIRED"), recoverySetId: record.setId, recoveryChallengeId: record.challengeId };
            }
            progress("recovering");
            assertTarget();
            if (await observePuzzleRecovery(record, { synchronize: true }) !== "saved") return blocked5("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            unchanged();
            await puzzlePersistence.journal.write(scope, { ...record, phase: "saved", updatedAt: Date.now() });
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
            const preview = await preparePuzzle(target, assertTarget, progress, true);
            log.preview = preview;
            log.catalogSource = preview.catalogSource ?? "unknown";
            if (preview.fillReady !== true) result = preview.status === "preview" ? blocked5("FC27_PUZZLE_FILL_PLAN_UNVERIFIED") : preview;
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
          result = blocked5(safeReason4(error2));
        } finally {
          invalidate();
        }
        log.result = result;
        log.finishedAt = Date.now();
        await persistLog();
        if (result?.status === "recovery-required") {
          try {
            await gmSetValue(`fcat-fc27-puzzle-write-failure:${scope}`, structuredClone(log));
          } catch {
          }
        }
        return result;
      }),
      prepare: (options) => run(async () => {
        invalidate();
        return await traditionalExclusive(scope, async () => {
          const record = await persistence.journal.read(scope);
          if (record && !isTerminalTraditionalJournal(record)) return blocked5("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const input = await adapter.prepareInputs(options);
            if (input.contract.challenge.brickIndices.length) return blocked5("FC27_ACCEPTANCE_BRICKS_UNSUPPORTED");
            const engine = createTraditionalTransaction({
              enabled: liveEnabled,
              adapter,
              ...persistence,
              exclusive: traditionalExclusive,
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
              return blocked5("FC27_EXACT_ITEMS_CHANGED");
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
        }) ?? blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      }),
      execute: (approval) => run(async () => {
        if (!prepared || liveEnabled !== true) return blocked5("FC27_LIVE_DISABLED");
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
        return await inspect() ?? blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
      }),
      resolveRecovery: (approved) => run(async () => {
        if (approved !== true || !recovery) return blocked5("FC27_RECOVERY_APPROVAL_INVALID");
        const expected = recovery;
        recovery = null;
        return await persistence.exclusive(scope, async () => {
          if (expected.kind === "puzzle-fill") {
            const record2 = await puzzlePersistence.journal.read(scope);
            if (JSON.stringify(record2) !== JSON.stringify(expected.record) || await observePuzzleRecovery(record2, { synchronize: expected.outcome === "saved" }) !== expected.outcome) return blocked5("FC27_PUZZLE_FILL_RECOVERY_REQUIRED");
            unchanged();
            await puzzlePersistence.journal.clear(scope, record2);
            return {
              status: "resolved",
              reason: "FC27_PUZZLE_RECOVERY_RESOLVED",
              outcome: expected.outcome,
              saved: expected.outcome === "saved",
              submitted: false
            };
          }
          const record = await persistence.journal.read(scope);
          if (JSON.stringify(record) !== JSON.stringify(expected.record)) return blocked5("FC27_RECOVERY_REQUIRED");
          const adapter = await provider();
          try {
            const evidence = await adapter.observeRecovery(record);
            unchanged();
            if (expected.outcome === "completed") {
              if (assessTraditionalRecovery(scope, record, evidence) !== "completed") return blocked5("FC27_RECOVERY_REQUIRED");
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
        }) ?? blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
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
    return result ?? blocked5("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
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
    shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:100002;font:13px/1.45 Arial,sans-serif;color:#edf1ef;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}details{width:min(460px,calc(100vw - 24px));background:#202724;border:1px solid #67736c;border-radius:6px}
    summary{padding:12px;cursor:pointer;font-weight:600}.body{padding:0 12px 12px;max-height:calc(100dvh - 100px);overflow:auto}
    label{display:grid;gap:4px;margin:8px 0}select,button,input{font:inherit;min-height:36px;padding:7px;border:1px solid #67736c;border-radius:4px;color:inherit;background:#303b35;max-width:100%}
    select{width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
    output{display:block;min-height:38px;overflow-wrap:anywhere;border-top:1px solid #526159;padding-top:8px;color:#f3d89a}
    #requirements,#squad{margin-top:8px;color:#c2d9cb;overflow-wrap:anywhere}ul{margin:4px 0 0 18px;padding:0}.requirement{margin-top:8px;padding-top:6px;border-top:1px solid #39483f}
    small{display:block;color:#9caea3;margin-top:4px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{background:#303b35;padding:8px;border-radius:4px}
    #detail{margin-top:6px;overflow-wrap:anywhere;color:#c2d9cb}dialog{max-width:min(360px,calc(100vw - 24px));color:#edf1ef;background:#202724;border:1px solid #67736c;border-radius:6px}dialog::backdrop{background:#0009}
  </style><details><summary></summary><div class="body">
    <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">&#8635;</button><button id="gm">Check GM</button><button id="hold">Check tab lock</button></div>
    <label>SBC<select id="target"></select></label><label>Max OVR<select id="rating"><option>74</option><option>83</option></select></label>
    <div id="puzzle-settings"><label>\u89E3\u9898\u7403\u5458\u6700\u9AD8\u8BC4\u5206\uFF08\u91D1\u5361\u9ED8\u8BA4 82\uFF09<input id="puzzle-rating" type="number" min="1" max="99" step="1" value="82"></label><button id="puzzle-policy-save">\u4FDD\u5B58\u89E3\u9898\u4E0A\u9650</button><small>\u94DC\u94F6\u6309\u672C\u9635\u54C1\u8D28\u6761\u4EF6\u9009\u6750\uFF1B\u6700\u4F4E\u94F6\u5361\uFF0B\u81F3\u5C11 2 \u91D1\u6309 2 \u91D1\uFF0B\u5176\u4F59\u94F6\u5361\u89E3\u9898\u3002\u91D1\u5361\u4ECD\u53D7 FSU \u8303\u56F4\u9650\u5236\uFF0C\u7F3A\u6599\u4E0D\u81EA\u52A8\u589E\u52A0\u91D1\u5361\u6216\u63D0\u9AD8\u8BC4\u5206\uFF1B\u5DF2\u4FDD\u5B58\u7684\u66F4\u4F4E\u4E0A\u9650\u7EE7\u7EED\u6709\u6548\u3002</small></div>
    <div class="row"><button id="catalog">Read requirements</button><button id="puzzle">Plan Puzzle</button><button id="prepare">Verify squad</button><button id="execute" disabled>Submit once</button><button id="fill" disabled>Fill and save once</button></div>
    <div class="row"><button id="recovery">Check recovery</button><button id="resolve" disabled>Confirm recovery</button></div>
    <output id="status">Live execution disabled</output><div id="detail"></div><div id="requirements" aria-live="polite"></div><div id="squad"></div>
  </div></details><dialog><p id="approval"></p><div class="row"><button id="cancel">Cancel</button><button id="confirm">Confirm</button></div></dialog>`;
    const node = (id3) => shadow.getElementById(id3);
    node("puzzle-settings").hidden = typeof setPuzzleMaxRating !== "function";
    shadow.querySelector("summary").textContent = title;
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
      for (const button of shadow.querySelectorAll("button,select,input")) button.disabled = busy;
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
    const on = (id3, callback) => node(id3).addEventListener("click", (event) => {
      if (event.isTrusted && !busy) callback();
    });
    on("refresh", () => {
      renderTargets();
      clear();
      update();
    });
    on("puzzle-policy-save", () => {
      if (typeof setPuzzleMaxRating !== "function") return;
      const value = Number(node("puzzle-rating").value);
      clear();
      void run(async () => {
        const result = await setPuzzleMaxRating(value);
        return { ...result, reason: result.status === "observed" ? `\u89E3\u9898\u8BC4\u5206\u4E0A\u9650\u5DF2\u4FDD\u5B58\uFF1A${result.maxRating}` : result.reason };
      });
    });
    shadow.querySelector("details").addEventListener("toggle", () => {
      if (!shadow.querySelector("details").open || busy || typeof inspectPuzzlePolicy !== "function") return;
      void run(async () => {
        const result = await inspectPuzzlePolicy();
        if (result.status === "observed") node("puzzle-rating").value = String(result.maxRating);
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
    for (const id3 of ["target", "rating"]) node(id3).addEventListener("change", () => {
      clear();
      update();
    });
    document.body.append(host);
    renderTargets();
    update();
    return Object.freeze({
      triggerPuzzle: ({ setId, challengeId }) => {
        if (busy || !Number.isSafeInteger(setId) || typeof inspectPuzzle !== "function") return;
        shadow.querySelector("details").open = true;
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
  var sameTarget = (a, b) => !!(a && b && a.setId === b.setId && a.challengeId === b.challengeId && a.anchor === b.anchor);
  var resultText = (result) => {
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
    if (Number.isSafeInteger(result?.recoveryChallengeId)) return `\u5B50\u9635 ${result.recoveryChallengeId} \u7684\u4FDD\u5B58\u5F85\u6838\u5BF9\uFF0C\u8BF7\u8FD4\u56DE\u8BE5\u5B50\u9635\u70B9\u51FB\u89E3\u9898\u586B\u5145\u6062\u590D\u3002`;
    if (result?.status === "recovery-required" || /RECOVERY_REQUIRED/.test(result?.reason ?? "")) return "\u4FDD\u5B58\u72B6\u6001\u5F85\u6838\u5BF9\uFF0C\u8BF7\u4F7F\u7528 FCAT \u6062\u590D\u68C0\u67E5\u3002";
    if (result?.reason === "FC27_PUZZLE_EXISTING_SQUAD_BLOCKED") return "\u5F53\u524D\u9635\u5BB9\u5DF2\u6709\u7403\u5458\uFF0C\u672A\u8986\u76D6\u539F\u9635\u5BB9\u3002";
    if (result?.reason === "FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED") return "\u9635\u5BB9\u4E0D\u7B26\u5408\u9009\u6750\u7B56\u7565\uFF0C\u672A\u589E\u52A0\u9AD8\u54C1\u8D28\u5361\u8865\u4F4D\u3002";
    if (["FC27_PUZZLE_SEARCH_LIMIT", "FC27_PUZZLE_CONSTRAINT_SHORTAGE", "SAFE_MATERIAL_SHORTAGE", "FC27_PUZZLE_NO_PLAN_FOUND"].includes(result?.reason)) {
      const composition = result.policy?.materialComposition?.filter((rule) => rule.count > 0).map((rule) => `${rule.count} ${{ 1: "\u94DC", 2: "\u94F6", 3: "\u91D1" }[rule.quality] ?? ""}`).join("\uFF0B");
      const scope = [composition, Number.isInteger(result.policy?.maxRating) ? `\u6700\u9AD8 ${result.policy.maxRating}` : ""].filter(Boolean).join("\uFF0C");
      const message = result.reason === "FC27_PUZZLE_SEARCH_LIMIT" ? "\u672C\u6B21\u641C\u7D22\u672A\u627E\u5230\u6EE1\u8DB3\u5168\u90E8\u6761\u4EF6\u7684\u9635\u5BB9\uFF0C\u672A\u653E\u5BBD\u9009\u6750\u6216\u4FEE\u6539\u9635\u5BB9\u3002" : "\u5F53\u524D\u53EF\u7528\u6750\u6599\u65E0\u6CD5\u5728\u9009\u6750\u9650\u5236\u5185\u7EC4\u6210\u9635\u5BB9\uFF0C\u672A\u81EA\u52A8\u589E\u52A0\u9AD8\u54C1\u8D28\u5361\u3002";
      return scope ? `${scope}\uFF1A${message}` : message;
    }
    if (result?.reason === "FC27_PUZZLE_CHALLENGE_COMPLETED") return "\u5F53\u524D SBC \u5B50\u9635\u5DF2\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u6539\u7528\u5176\u4ED6\u5B50\u9635\u3002";
    if (result?.reason === "FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS") return "\u5F53\u524D SBC \u5B50\u9635\u4E0D\u53EF\u7EE7\u7EED\uFF0C\u4E0D\u4F1A\u6539\u7528\u5176\u4ED6\u5B50\u9635\u3002";
    if (result?.reason === "FC27_PUZZLE_FILL_TARGET_CHANGED") return "\u9875\u9762\u5DF2\u5207\u6362\uFF0C\u672C\u6B21\u586B\u9635\u505C\u6B62\u3002";
    return `\u672A\u5B8C\u6210\u586B\u9635\uFF1A${/^[A-Z0-9_]{1,100}$/.test(result?.reason ?? "") ? result.reason : "\u8BF7\u7A0D\u540E\u91CD\u8BD5"}`;
  };
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
    status.style.cssText = "margin:.5rem;text-align:center;white-space:normal;overflow-wrap:anywhere;font-size:13px";
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
      if (!sameTarget(next, target)) {
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
      if (!sameTarget(next, target)) {
        update();
        return;
      }
      const origin = { ...next };
      const isCurrent = () => !disposed && origin.anchor.isConnected && sameTarget(read(), origin);
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
          status.textContent = resultText(result);
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

  // src/fc27/production-entry.js
  var dependencies = {
    root: unsafeWindow,
    gmGetValue: GM_getValue,
    gmSetValue: GM_setValue,
    lockManager: unsafeWindow.navigator.locks,
    liveEnabled: true
  };
  var session;
  var current = () => session ??= createFc27AcceptanceSession(dependencies);
  mountFc27AcceptancePanel({
    document: unsafeWindow.document,
    hostId: "fcat-fc27-production",
    title: `FC Automation Tool ${"27.0.1"}`,
    version: "27.0.1",
    liveEnabled: dependencies.liveEnabled,
    targets: () => readFc27ChallengeTargets(unsafeWindow),
    inspectCatalog: (options) => current().inspectCatalog(options),
    inspectPuzzle: (options) => current().inspectPuzzle(options),
    inspectPuzzlePolicy: () => current().inspectPuzzlePolicy(),
    setPuzzleMaxRating: (value) => current().setPuzzleMaxRating(value),
    prepare: (options) => current().prepare(options),
    execute: (approval) => current().execute(approval),
    fillPuzzle: (approval) => current().fillPuzzle(approval),
    inspectRecovery: () => current().inspectRecovery(),
    resolveRecovery: (approved) => current().resolveRecovery(approved),
    checkInstallation: (hold) => checkFc27GmInstallation({ ...dependencies, hold })
  });
  mountFc27PuzzleNativeButton({
    document: unsafeWindow.document,
    onFill: (target, callbacks) => current().solveAndFillPuzzle(target, callbacks),
    readTarget: () => readFc27PuzzlePage(unsafeWindow)
  });
})();
