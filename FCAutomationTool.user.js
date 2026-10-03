// ==UserScript==
// @name         FC Automation Tool
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool
// @version      27.0.10
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
// @connect      www.fut.gg
// @connect      fodder.gg
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
  function callBoolean(item2, method5) {
    try {
      const value = item2?.[method5]?.();
      return typeof value === "boolean" ? value : null;
    } catch {
      return null;
    }
  }
  function readExplicitPlayerRareFlag(item2 = {}) {
    const explicitValues = [
      item2.rareflag,
      item2.rareFlag,
      item2._rareflag,
      item2._data?.rareflag,
      item2._data?.rareFlag,
      item2._staticData?.rareflag,
      item2._staticData?.rareFlag
    ].map(Number).filter(Number.isFinite);
    return explicitValues.length ? Math.max(0, ...explicitValues) : null;
  }
  function readPlayerRareFlag(item2 = {}) {
    const explicitRareFlag = readExplicitPlayerRareFlag(item2);
    if (explicitRareFlag !== null) return explicitRareFlag;
    if (item2.special === true || callBoolean(item2, "isSpecial") === true) return 2;
    if (item2.rare === true || callBoolean(item2, "isRare") === true) return 1;
    return 0;
  }
  function isSpecialPlayerCard(item2 = {}) {
    return readPlayerRareFlag(item2) > 1;
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
      const item2 = ownData(value, key);
      if (!item2 || typeof item2 !== "object") throw new Error("FC27_COLLECTION_UNAVAILABLE");
      return item2;
    });
  }
  function snapshotFc27ClubPlayer(item2, root) {
    const get = (key) => ownData(item2, key);
    const id7 = get("id");
    const definitionId = get("definitionId");
    if (!identity2(id7) || !identity2(definitionId)) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
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
      id: id7,
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
    const items = cached.filter((item2) => ownData(item2, "type") === playerType).map((item2) => snapshotFc27ClubPlayer(item2, root));
    if (new Set(items.map((item2) => item2.id)).size !== items.length) throw new Error("FC27_CACHED_ITEM_IDENTITY_CONFLICT");
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
      const id7 = data(formation, "id");
      const raw = data(formation, "positions");
      let positions2 = null;
      if (Array.isArray(raw) && data(raw, "length") === 11) {
        const copied = Array.from({ length: 11 }, (_, index) => data(data(raw, String(index)), "typeId"));
        if (copied.every((value) => Number.isInteger(value) && value >= 0 && value <= 27)) positions2 = copied;
      }
      return { id: Number.isSafeInteger(id7) && id7 >= 0 && id7 < 1e9 ? id7 : null, positions: positions2 };
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
    if (![setId, challengeId].every((id7) => Number.isSafeInteger(id7) && id7 > 0 && id7 < 1e9)) return stop6("INVALID_CHALLENGE_IDENTITY");
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
        const id7 = ownData(challenge, "id");
        const setId = ownData(set, "id");
        if (ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "setId") !== setId || !Number.isSafeInteger(id7) || id7 <= 0 || !Number.isSafeInteger(setId) || setId <= 0) continue;
        const name = ownData(challenge, "name");
        targets.push({ id: id7, setId, name: typeof name === "string" && name.length <= 160 ? name : `Challenge ${id7}` });
      }
    }
    return targets;
  }
  function normalizeFc27TraditionalChallenge({ context, setId, challenge, layout, keys: keys2, scopes, qualities }) {
    const id7 = ownData(challenge, "id");
    if (ownData(challenge, "setId") !== setId || ownData(challenge, "status") !== "IN_PROGRESS" || ownData(challenge, "eligibilityOperation") !== "AND" || layout.status !== "observed" || layout.setId !== setId || layout.challengeId !== id7 || layout.slotCount !== 11 || ownData(keys2, "PLAYER_MIN_OVR") !== 26 || ownData(keys2, "PLAYER_MAX_OVR") !== 28 || ownData(scopes, "GREATER") !== 0 || ownData(scopes, "EXACT") !== 2) {
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
      id: id7,
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
    if (policy.schema !== 1 || policy.reviewed !== true || !integer2(policy.maxRating, 1, 99) || ["onlyUntradeable", "protectFsuLockedPlayers", "protectActiveSquad", "storageFirst"].some((key) => typeof policy[key] !== "boolean") || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2 || policy.goldRange.some((value) => !integer2(value, 75, 99)) || policy.goldRange[0] > policy.goldRange[1] || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200 || policy.excludedLeagueIds.some((id7) => !identity3(id7))) return stop2("PROTECTION_POLICY_UNVERIFIED");
    if (inventory.schema !== 1 || inventory.kind !== "normalized-inventory" || !["ready", "provisional"].includes(inventory.status) || !Array.isArray(inventory.items) || inventory.items.length > 2e4) return stop2("INVENTORY_UNVERIFIED");
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    let excluded = 0;
    const excludedByReason = {};
    for (const item2 of inventory.items) {
      if (!item2 || !identity3(item2.id) || !identity3(item2.definitionId) || seen.has(item2.id)) return stop2("INVENTORY_IDENTITY_CONFLICT");
      seen.add(item2.id);
      const checks = [
        ["type-or-pile-unverified", item2.type === "player" && ["club", "storage"].includes(item2.pile)],
        ["rating-outside-range", integer2(item2.rating, minRating, Math.min(maxRating, policy.maxRating))],
        ["fsu-gold-range", item2.rating < 75 || integer2(item2.rating, policy.goldRange[0], policy.goldRange[1])],
        ["special-or-unknown", item2.special === false],
        ["evolution-or-unknown", item2.evolution === false],
        ["cosmetic-or-unknown", item2.cosmetic === false],
        ["concept-or-unknown", item2.concept === false],
        ["academy-or-unknown", item2.academyEnrolled === false],
        ["active-trade-or-unknown", item2.activeTrade === false],
        ["limited-use-or-unknown", item2.limitedUse === false && item2.loans === -1],
        ["protected-or-unknown", item2.protected === false],
        ["tradeable-or-unknown", typeof item2.tradeable === "boolean" && (!policy.onlyUntradeable || item2.tradeable === false)],
        ["league-excluded-or-unknown", identity3(item2.leagueId) && !policy.excludedLeagueIds.includes(item2.leagueId)],
        ["locked-or-unknown", !policy.protectFsuLockedPlayers || item2.locked === false],
        ["active-squad-or-unknown", !policy.protectActiveSquad || item2.activeSquad === false]
      ];
      const rejection = checks.find(([, passed]) => !passed)?.[0];
      if (!rejection) candidates.push(item2);
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
    for (const item2 of candidates) {
      if (definitions.has(item2.definitionId)) continue;
      definitions.add(item2.definitionId);
      selected.push({ id: item2.id, definitionId: item2.definitionId, pile: item2.pile, rating: item2.rating });
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
      selected: selected.map((item2, index) => ({ ...item2, slot: slots[index] })),
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
      const flags2 = ["untradeable", "academy", "league", "firststorage"].map((key) => ownData(build, key));
      const goldenMax = ownData(set, "goldenrange");
      const rawLeagues = ownData(set, "shield_league");
      const leagues = Array.isArray(rawLeagues) && rawLeagues.length <= 200 ? Array.from({ length: rawLeagues.length }, (_, index) => ownData(rawLeagues, String(index))) : null;
      if (flags2.some((value) => typeof value !== "boolean") || !Number.isInteger(goldenMax) || goldenMax < 75 || goldenMax > 99 || !leagues || leagues.some((id7) => !Number.isSafeInteger(id7) || id7 < 1)) throw new Error("FC27_FSU_POLICY_UNVERIFIED");
      report.fsu.policy = {
        onlyUntradeable: flags2[0],
        excludeEvolution: flags2[1],
        excludeDesignatedLeagues: flags2[2],
        storageFirst: flags2[3],
        goldRange: [75, goldenMax],
        excludedLeagueCount: flags2[2] ? new Set(leagues).size : 0
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

  // src/adapters/ea/fc27-item-factory-observer.js
  var originals = /* @__PURE__ */ new WeakMap();
  function observeFc27ItemFactory(original, observe) {
    const wrapped = function(raw) {
      const item2 = original.apply(this, arguments);
      try {
        observe(item2, raw);
      } catch {
      }
      return item2;
    };
    originals.set(wrapped, original);
    return wrapped;
  }
  function unwrapFc27ItemFactory(fn) {
    for (let depth = 0; depth < 8 && originals.has(fn); depth++) fn = originals.get(fn);
    return fn;
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
  var FC27_CLUB_COMPATIBLE_HASHES = Object.freeze({
    UTHttpRequest: "2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925",
    EAHttpRequest: "76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1",
    "UTHttpRequest.prototype.setPath": "a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df",
    "UTHttpRequest.prototype.send": "da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81",
    "EAHttpRequest.prototype.send": "d19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452",
    "EAHttpRequest.prototype.setRequestBody": "b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9",
    "EAHttpRequest.prototype.abort": "a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419",
    // FC27 runtime review 2026-10-02: observer notification dispatch was
    // obfuscated again while its decoded contract stayed unchanged. This is
    // a local synchronization method, not a request or write method.
    "EAObservable.prototype.notify": "626035e884aceedbca0ba6ddf853134ffeecaba9414b92a6d7a41a78474063f2"
  });
  var at2 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var validId = (value) => Number.isSafeInteger(value) && value > 0;
  async function createFc27ClubReadTransport(root) {
    const context = readFc27Context(root);
    const reviewed = /* @__PURE__ */ new Map();
    let factoryOutputValidated = false;
    const assertScope = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_CLUB_SCOPE_CHANGED");
    };
    for (const [index, [path, expected]] of FC27_CLUB_READ_METHODS.entries()) {
      const binding = at2(root, path);
      const fn = path === "UTItemEntityFactory.prototype.createItem" ? unwrapFc27ItemFactory(binding) : binding;
      if (typeof fn !== "function") throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_MISSING`);
      const bytes = new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn));
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== expected && hash !== ownData(FC27_CLUB_COMPATIBLE_HASHES, path)) {
        if (path !== "UTItemEntityFactory.prototype.createItem") {
          throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_CHANGED`);
        }
        factoryOutputValidated = true;
        reviewed.set(path, binding);
      } else if (path === "UTItemEntityFactory.prototype.createItem") {
        reviewed.set(path, binding);
        if (binding !== fn) factoryOutputValidated = true;
      } else reviewed.set(path, fn);
    }
    const assertRuntime = () => {
      for (const [path, fn] of reviewed) if (at2(root, path) !== fn) throw new Error("FC27_CLUB_RUNTIME_UNVERIFIED");
    };
    assertRuntime();
    const Request = ownData(root, "UTHttpRequest");
    const factory = at2(root, "factories.Item");
    const createItem = reviewed.get("UTItemEntityFactory.prototype.createItem");
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
        if (!Number.isInteger(start) || start < 0 || start > 2e4 || !Number.isInteger(count2) || count2 < 1 || count2 > 250 || !Array.isArray(definitionIds) || definitionIds.length > 50 || definitionIds.some((id7) => !validId(id7)) || new Set(definitionIds).size !== definitionIds.length) throw new Error("FC27_CLUB_QUERY_INVALID");
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
          if (ownData(entity, "type") !== "player" || ownData(entity, "id") !== ownData(data, "id") || ownData(entity, "definitionId") !== ownData(data, "resourceId") || factoryOutputValidated && ownData(entity, "concept") === true) throw new Error("FC27_CLUB_ENTITY_UNVERIFIED");
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
  async function verifyFc27Methods(root, definitions, compatibleHashes2 = {}) {
    const methods = /* @__PURE__ */ new Map();
    for (const [path, expected] of definitions) {
      if (path === "UTItemEntityFactory.prototype.createItem") continue;
      const fn = at3(root, path);
      if (typeof fn !== "function") {
        const error2 = new Error("FC27_TRANSACTION_METHOD_UNREVIEWED");
        error2.methodPath = path;
        error2.observedHash = null;
        throw error2;
      }
      const source = Function.prototype.toString.call(fn).replace(/\r\n/g, "\n");
      if (source.length > 2e4) {
        const error2 = new Error("FC27_TRANSACTION_METHOD_UNREVIEWED");
        error2.methodPath = path;
        error2.observedHash = "oversized";
        throw error2;
      }
      const digest = await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(source));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== expected && hash !== ownData(FC27_CLUB_COMPATIBLE_HASHES, path) && hash !== ownData(compatibleHashes2, path)) {
        const error2 = new Error("FC27_TRANSACTION_METHOD_UNREVIEWED");
        error2.methodPath = path;
        error2.observedHash = hash;
        error2.expectedHash = expected;
        throw error2;
      }
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
      const id7 = target.challengeId;
      const mutation = action === "save" || action === "save-concept" || action === "save-purchase" || action === "submit";
      if (!["unassigned", "packs", "save", "save-concept", "save-purchase", "submit"].includes(action) || mutation && (!Number.isSafeInteger(id7) || id7 <= 0 || canWrite() !== true)) return fail3("FC27_LIVE_DISABLED");
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
        const endpoint = `/ut/game/${game}/${action === "unassigned" ? "purchased/items" : action === "packs" ? "store/purchaseGroup/all" : `sbs/challenge/${id7}${["save", "save-concept", "save-purchase"].includes(action) ? "/squad" : ""}`}`;
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
    const fail19 = () => {
      throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
    };
    const slots = ownData(squad, "_players");
    const simple = ownData(squad, "simpleBrickIndices");
    const custom = ownData(squad, "customBrickIndices");
    if (ownData(ownData(root, "UTSquadEntity"), "FIELD_PLAYERS") !== 11 || !Array.isArray(slots) || slots.length < 11 || slots.length > 32 || !Array.isArray(simple) || !Array.isArray(custom)) return fail19();
    const bricks = [...simple, ...custom];
    if (bricks.length >= 11 || new Set(bricks).size !== bricks.length || bricks.some((index) => !Number.isInteger(index) || index < 0 || index >= 11)) return fail19();
    const ids = Array.from({ length: slots.length }, (_, index) => {
      const slot = ownData(slots, String(index));
      const id8 = ownData(ownData(slot, "_item"), "id");
      if (ownData(slot, "index") !== index || !Number.isSafeInteger(id8) || id8 < -1 || (index >= 11 || simple.includes(index)) && id8 > 0) return fail19();
      return id8;
    });
    const formation = ownData(squad, "_formation");
    const id7 = ownData(formation, "id");
    const raw = ownData(formation, "positions");
    if (!Number.isSafeInteger(id7) || id7 <= 0 || !Array.isArray(raw) || raw.length !== 11) return fail19();
    const positions2 = Array.from({ length: 11 }, (_, index) => ownData(ownData(raw, String(index)), "typeId"));
    if (positions2.some((value) => !Number.isInteger(value) || value < 0 || value > 27)) return fail19();
    return {
      status: "observed",
      setId,
      challengeId,
      slotCount: 11,
      simpleBrickIndices: [...simple],
      customBrickIndices: [...custom],
      requiredPlayerCount: 11 - bricks.length,
      formation: { id: id7, positions: positions2 },
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
      const item2 = ownData(slot, "_item");
      const id7 = ownData(item2, "id");
      if (!Number.isSafeInteger(id7) || id7 < -1) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      if (id7 <= 0) return null;
      const definitionId = ownData(item2, "definitionId");
      const concept = ownData(item2, "concept");
      if (!Number.isSafeInteger(definitionId) || definitionId <= 0 || typeof concept !== "boolean" || concept && id7 !== definitionId) throw new Error("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
      return { id: id7, definitionId, concept };
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
        const item2 = slot.item ?? slot._item;
        return !item2 || [0, -1].includes(item2.id) ? null : { slot: index, id: item2.id, definitionId: item2.definitionId, concept: item2.concept };
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
      const item2 = ownData(slot, "_item");
      const id7 = ownData(item2, "id");
      return [0, -1].includes(id7) ? null : { slot: index, id: id7, definitionId: ownData(item2, "definitionId"), concept: ownData(item2, "concept") };
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
      const matches2 = values6(ownData(sets2[0], "challenges")).filter((challenge) => ownData(challenge, "id") === challengeId);
      return matches2.length === 1 ? matches2[0] : null;
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
    const fail19 = () => {
      throw new Error("FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED");
    };
    const runtime = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS);
    assertContext();
    const challenge = currentChallengeEntity(root, target);
    if (!challenge || ownData(challenge, "status") !== "IN_PROGRESS") return fail19();
    const local = ownData(challenge, "squad");
    const layout = projectFc27PuzzleLayout(root, local, target);
    const savedLayout = projectFc27PuzzleLayout(root, savedSquad, target);
    if (JSON.stringify({ ...layout, squadEmpty: false }) !== JSON.stringify({ ...savedLayout, squadEmpty: false }) || layout.customBrickIndices.length || !Array.isArray(refs3) || (previousRefs === null ? refs3.length !== layout.requiredPlayerCount : refs3.length > layout.requiredPlayerCount) || new Set(refs3.map((ref) => ref.slot)).size !== refs3.length || new Set(refs3.map((ref) => ref.kind === "concept" ? `concept:${ref.definitionId}` : `owned:${ref.id}`)).size !== refs3.length || new Set(refs3.map((ref) => ref.definitionId)).size !== refs3.length) return fail19();
    const matches2 = (squad) => refs3.every((ref) => {
      const item2 = ownData(ownData(squad, "_players")?.[ref.slot], "_item");
      return ownData(item2, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id) && ownData(item2, "definitionId") === ref.definitionId && ownData(item2, "concept") === (concepts && ref.kind === "concept");
    });
    const previousMatches = () => previousRefs !== null && previousRefs.every((ref) => {
      const item2 = ownData(ownData(local, "_players")?.[ref.slot], "_item");
      return ownData(item2, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id) && ownData(item2, "definitionId") === ref.definitionId && ownData(item2, "concept") === (ref.kind === "concept");
    });
    if (!matches2(savedSquad) || !layout.squadEmpty && !matches2(local) && !previousMatches()) return fail19();
    if (local.update !== root.UTSquadEntity.prototype.update || challenge.onDataChange?.notify !== root.EAObservable.prototype.notify) return fail19();
    runtime();
    if (currentChallengeEntity(root, target) !== challenge) return fail19();
    local.update(savedSquad);
    if (!matches2(local) && (layout.squadEmpty || previousMatches())) {
      const retained = ownData(ownData(ownData(root, "call"), "squad"), "setPlayers");
      const path = retained === void 0 ? "UTSquadEntity.prototype.setPlayers" : "call.squad.setPlayers";
      const checkPlayers = await verifyFc27Methods(root, [[path, "36369f3b5fec8c43f00f5078b5d5223b2d3fce1eaf9c47e9bd8355e6a3b53669"]]);
      assertContext();
      runtime();
      checkPlayers();
      if (currentChallengeEntity(root, target) !== challenge || ownData(challenge, "squad") !== local || !projectFc27PuzzleLayout(root, local, target).squadEmpty && !previousMatches() || !matches2(savedSquad)) return fail19();
      const players = ownData(savedSquad, "_players").map((slot, index) => refs3.some((ref) => ref.slot === index) ? ownData(slot, "_item") : null);
      const setPlayers = retained ?? ownData(ownData(ownData(root, "UTSquadEntity"), "prototype"), "setPlayers");
      setPlayers.call(local, players);
    }
    if (ownData(challenge, "squad") !== local || !matches2(local)) return fail19();
    challenge.onDataChange.notify({ squad: local });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertContext();
    if (!matches2(local)) return fail19();
    return { status: "synchronized", selectedCount: refs3.length };
  }

  // src/adapters/ea/fc27-traditional-provider.js
  var fail4 = (reason) => {
    throw new Error(reason);
  };
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var at4 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var protectedItem = (item2) => ({ ...item2, protected: item2.special !== false || item2.evolution !== false || item2.cosmetic !== false });
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
      if (cached.some(({ ref, item: item2 }) => item2 && (ownData(item2, "id") !== ref.id || ownData(item2, "definitionId") !== ref.definitionId))) return fail4("FC27_CACHE_RECONCILIATION_UNCONFIRMED");
      dirtyCache();
      for (const { ref, item: item2 } of cached) if (item2) items.remove(ref.id);
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
      if (items.length >= 250 || new Set(items.map((item2) => item2.id)).size !== items.length || items.some((item2) => !refs3.some((ref) => ref.definitionId === item2.definitionId))) {
        const error2 = new Error("FC27_EXACT_ITEMS_CHANGED");
        error2.mismatch = "club-response";
        throw error2;
      }
      return items.filter((item2) => refs3.some((ref) => ref.id === item2.id && ref.definitionId === item2.definitionId)).map(protectedItem);
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
        present: present.map(({ id: id7, definitionId, pile }) => ({ id: id7, definitionId, pile })),
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
            const item2 = ownData(ownData(loaded, "_players")?.[index], "_item");
            return ref ? ownData(item2, "id") !== (ref.kind === "concept" ? ref.definitionId : ref.id) || ownData(item2, "definitionId") !== ref.definitionId || ownData(item2, "concept") !== (ref.kind === "concept") : ![0, -1].includes(ownData(item2, "id"));
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
        const owned2 = [];
        const concepts = [];
        const playable = (index) => index < 11 && !plan.challenge.brickIndices.includes(index);
        const occupied = slots.slice(0, 11).filter((slot, index) => playable(index) && Number(ownData(ownData(slot, "_item"), "id")) > 0).length;
        if (occupied === 0) return fail4("FC27_CONCEPT_SQUAD_CLEARED");
        if (occupied !== plan.slots.filter(Boolean).length) return fail4("FC27_CONCEPT_SQUAD_MANUAL_EDITED");
        const identityMatches = plan.slots.filter(Boolean).every((ref) => {
          const item2 = ownData(slots[ref.slot], "_item");
          return ownData(item2, "definitionId") === ref.definitionId && ownData(item2, "concept") === (ref.kind === "concept") && ownData(item2, "id") === (ref.kind === "concept" ? ref.definitionId : ref.id);
        });
        if (!identityMatches) return fail4("FC27_CONCEPT_SQUAD_MANUAL_EDITED");
        for (const ref of plan.slots.filter(Boolean)) {
          const item2 = ownData(slots[ref.slot], "_item");
          if (ref.kind === "owned") owned2.push({ ...protectedItem(snapshotFc27ClubPlayer(item2, root)), slot: ref.slot });
          else {
            const expected = plan.purchases.find((entry) => entry.definitionId === ref.definitionId);
            const snapshot = snapshotFc27ClubPlayer(item2, root);
            for (const key of ["rating", "rarity", "nationId", "leagueId", "teamId", "positions", "groups", "special", "evolution", "cosmetic"]) {
              if (!same(snapshot[key], expected?.[key])) return fail4("FC27_CONCEPT_READBACK_UNVERIFIED");
            }
            concepts.push({ slot: ref.slot, definitionId: ref.definitionId });
          }
        }
        savedRead = { target, squad, concepts: true, observedAt: Date.now() };
        return { ...target, context, fresh: true, observedAt: savedRead.observedAt, owned: owned2, concepts, layout };
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
        if (ids.some((id7, index) => !Number.isSafeInteger(id7) || ownData(slots[index], "index") !== index || (index >= 11 || plan.challenge.brickIndices.includes(index)) && ![0, -1].includes(id7))) return fail4("FC27_SQUAD_STATE_UNVERIFIED");
        return {
          context,
          fresh: true,
          observedAt: Date.now(),
          setId: plan.challenge.setId,
          challengeId: plan.challenge.id,
          squadEmpty: ids.every((id7) => id7 === 0 || id7 === -1),
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
          const selected = plan.selected.find((item2) => item2.slot === index);
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
          const item2 = ownData(slots[index], "_item");
          if (index < 11 && !plan.challenge.brickIndices.includes(index)) {
            if (plan.kind !== "puzzle-fill-recovery" || ![0, -1].includes(ownData(item2, "id"))) {
              items.push({ ...protectedItem(snapshotFc27ClubPlayer(item2, root)), slot: index });
            }
          } else if (![0, -1].includes(ownData(item2, "id"))) return fail4("FC27_SAVED_SQUAD_UNVERIFIED");
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
        if (!["puzzle-fill", "puzzle-fill-recovery"].includes(plan.kind) || !read || !same(read.target, targetOf(plan)) || Date.now() - read.observedAt < 0 || Date.now() - read.observedAt > 15e3 || read.items.length !== plan.selected.length || !plan.selected.every((ref) => read.items.some((item2) => item2.id === ref.id && item2.definitionId === ref.definitionId && item2.slot === ref.slot && item2.pile === ref.pile))) {
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
          consumed: evidence.present.length === 0 ? plan.selected.map(({ id: id7, definitionId, pile }) => ({ id: id7, definitionId, pile })) : [],
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
      const pending2 = Promise.resolve().then(() => gmSetValue(key, value));
      pendingWrites.add(pending2);
      try {
        return await pending2;
      } finally {
        pendingWrites.delete(pending2);
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
    for (const validator2 of validators || []) {
      const result = await validator2(context);
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
  var refs = (items) => items.map((item2) => pick(item2, ["id", "definitionId", "pile"]));
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
    const byId = new Map(input.inventory.items.map((item2) => [item2.id, item2]));
    const selected = plan.selected.map((ref) => ({ ...pick(byId.get(ref.id), safetyKeys), slot: ref.slot }));
    if (selected.some((item2) => item2.pile !== "club" || ![0, 1].includes(item2.rarity) || item2.state !== "free")) {
      return blocked("FC27_ATTEMPT_ITEM_UNVERIFIED");
    }
    return freeze({ status: "prepared", ...bound, createdAt: now, selected });
  }
  function validateItems(plan, snapshot, saved = false) {
    if (snapshot?.fresh !== true || !scopeMatches(snapshot.context, plan.context) || !Array.isArray(snapshot.items) || snapshot.items.length !== plan.selected.length) return fail7("FC27_EXACT_ITEMS_CHANGED");
    if (saved && (snapshot.setId !== plan.set.id || snapshot.challengeId !== plan.challenge.id || snapshot.ready !== true)) {
      return fail7("FC27_SAVED_SQUAD_UNVERIFIED");
    }
    const byId = new Map(snapshot.items.map((item2) => [item2?.id, item2]));
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
    if (check.status !== "preview" || !same3(check.selected, plan.selected.map((item2) => pick(item2, ["id", "definitionId", "pile", "rating", "slot"])))) {
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
  function itemValue(item2, keys2) {
    for (const key of keys2) {
      const value = item2?.[key];
      if (integer4(value)) return value;
    }
    return null;
  }
  function itemQuality(item2) {
    if ([1, 2, 3].includes(item2?.quality)) return item2.quality;
    const rating = itemValue(item2, ["rating", "overall", "ovr"]);
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
    return (id7) => positive3(id7) ? links.get(id7) ?? id7 : null;
  }
  function matchFc27SbcItemRule(rule, item2, groupMatcher, clubResolver) {
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
    return ruleResult({ ...rule, count: 1, mode: "min" }, [item2], { groupMatcher, clubResolver });
  }
  function ruleResult(rule, squad, options) {
    const players = squad;
    const ids = (keys2) => players.map((item2) => {
      const value = itemValue(item2, keys2);
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
        const matches2 = qualities.filter((quality2) => {
          return rule.qualities.includes(quality2);
        }).length;
        return compareCount(matches2, rule.count, rule.mode);
      }
      case "max-quality":
        return countMatches(players.map(itemQuality), (value) => value <= rule.quality);
      case "player-min-overall":
      case "player-exact-overall":
      case "player-max-overall":
        return countMatches(players.map((item2) => {
          const rating = itemValue(item2, ["rating", "overall", "ovr"]);
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
        return countMatches(players.map((item2) => {
          const rarity = itemValue(item2, ["rarity", "rareflag"]);
          return nonnegative3(rarity) ? rarity === 1 : null;
        }), (value) => value === true);
      case "rarity-group":
        return countMatches(players.map((item2) => {
          if (typeof options.groupMatcher === "function") {
            try {
              const result = options.groupMatcher(item2, rule.groupId);
              return typeof result === "boolean" ? result : null;
            } catch {
              return null;
            }
          }
          return Array.isArray(item2?.groups) && item2.groups.every(nonnegative3) ? item2.groups.includes(rule.groupId) : null;
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
    if (!Array.isArray(requirements) || !requirements.length || !Array.isArray(squad) || !squad.length || squad.length > 11 || Array.from(squad).some((item2) => !item2 || typeof item2 !== "object") || requirements.some((rule) => !rule || rule.source?.required !== squad.length)) {
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
  function finishPuzzleSearch(iterator) {
    let step;
    do {
      step = iterator.next();
    } while (!step.done);
    return step.value;
  }
  async function finishPuzzleSearchCooperatively(iterator, {
    assertCurrent = () => {
    },
    yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
    sliceMs = 8
  } = {}) {
    let deadline = 0;
    try {
      for (; ; ) {
        if (Date.now() >= deadline) {
          assertCurrent();
          await yieldControl();
          assertCurrent();
          deadline = Date.now() + sliceMs;
        }
        const step = iterator.next();
        if (step.done) {
          assertCurrent();
          return step.value;
        }
      }
    } finally {
      iterator.return?.();
    }
  }
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
  function evaluatePlacement({ chosen, slots, formation, evaluateSquad, takeNode, validate: validate2, searchPositions }) {
    let found = null;
    let unavailable = null;
    let exhausted = false;
    const evaluate2 = (ordered) => {
      if (!takeNode("evaluations")) {
        exhausted = true;
        return;
      }
      let facts2;
      try {
        const brickIndices = Array.from({ length: formation?.slotCount ?? 0 }, (_, index) => index).filter((index) => !slots.includes(index));
        const detached = Array.from({ length: formation?.slotCount ?? ordered.length }, () => null);
        ordered.forEach((item2, index) => {
          detached[slots[index]] = { ...item2, slot: slots[index] };
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
      const validation = validate2(facts2);
      if (validation.status === "blocked") unavailable = "FC27_REQUIREMENT_VALUE_UNAVAILABLE";
      if (validation.status === "satisfied") found = {
        items: ordered.slice(),
        validation,
        facts: { chemistry: facts2.chemistry ?? null, teamRating: facts2.teamRating ?? null }
      };
    };
    const fits = (item2, index) => Array.isArray(item2.positions) && item2.positions.includes(formation?.positions?.[slots[index]]);
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
    evaluate2(preferred);
    if (found || unavailable || exhausted || !searchPositions) return { found, unavailable, exhausted };
    const order2 = slots.map((_slot, index) => index).sort((a, b) => chosen.filter((item2) => fits(item2, a)).length - chosen.filter((item2) => fits(item2, b)).length || a - b);
    const arranged = Array(chosen.length);
    const used = /* @__PURE__ */ new Set();
    const visit = (depth) => {
      if (found || unavailable || exhausted) return;
      if (!takeNode("placementNodes")) {
        exhausted = true;
        return;
      }
      if (depth === order2.length) {
        if (!arranged.every((item2, index) => item2 === preferred[index])) evaluate2(arranged);
        return;
      }
      const slotIndex = order2[depth];
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
  var relationValue = (rule, item2, resolveClub) => relationField(rule) === "teamId" ? resolveClub?.(item2.teamId ?? item2.clubId) ?? null : item2[relationField(rule)];
  function groupSuffixIndex(rule, candidates, resolveClub) {
    const groups = /* @__PURE__ */ new Map();
    candidates.forEach((item2, index) => {
      const value = relationValue(rule, item2, resolveClub);
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
    return existing + additional.slice(0, freeGroups).reduce((sum2, count2) => sum2 + count2, 0);
  }
  var hintGroup = (hint, item2, resolveClub) => hint.strategy === "club" ? resolveClub?.(item2.teamId ?? item2.clubId) : item2[hint.strategy === "nation" ? "nationId" : "leagueId"];
  function isFc27PuzzleSearchHintValid(hint, candidates, clubLinks) {
    if (hint === null) return true;
    if (!hint || Object.keys(hint).sort().join(",") !== "groupId,strategy" || !["balanced", "low-rating", "nation", "league", "club"].includes(hint.strategy) || !integer5(hint.groupId, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (["balanced", "low-rating"].includes(hint.strategy)) return hint.groupId === 0;
    const resolveClub = createFc27ClubResolver(clubLinks);
    return hint.groupId > 0 && candidates.some((item2) => hintGroup(hint, item2, resolveClub) === hint.groupId);
  }
  function filterUnaryCandidates(candidates, itemRules, required2, groupMatcher, resolveClub) {
    return candidates.filter((item2) => itemRules.every((rule) => {
      if (rule.count === required2 && rule.mode !== "max") return matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub) !== false;
      if (rule.count === 0 && ["max", "exact"].includes(rule.mode)) return matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub) !== true;
      return true;
    }));
  }
  var previewFc27PuzzleSquad = (input) => finishPuzzleSearch(iterateFc27PuzzleSquad(input));
  var previewFc27PuzzleSquadCooperatively = (input, options) => finishPuzzleSearchCooperatively(iterateFc27PuzzleSquad(input), options);
  function* iterateFc27PuzzleSquad({
    context,
    challenge,
    inventory,
    policy,
    evaluateSquad,
    boundSquad,
    groupMatcher,
    clubLinks,
    maxNodes = DEFAULT_MAX_NODES,
    searchHint = null,
    onProgress = null
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
    return yield* iterateFc27PuzzleCandidateRoutes({ ...options, maxNodes, searchHint, onProgress });
  }
  function* iterateFc27PuzzleCandidateRoutes({ maxNodes = DEFAULT_MAX_NODES, searchHint = null, onProgress = null, ...options }) {
    const { challenge, pool, groupMatcher, clubLinks } = options;
    const required2 = pool.required;
    const rules = parseFc27SbcRequirements(challenge.rawRequirements, required2);
    if (searchHint !== null || maxNodes < 1e3 || pool.candidates.length <= required2 || rules.status !== "observed" || !rules.rules.some((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind) && rule.value > 0)) {
      return yield* iterateFc27PuzzleCandidates({ ...options, maxNodes, searchHint, onProgress });
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
      for (const item2 of hintCandidates) {
        if (!integer5(item2[field], 1, Number.MAX_SAFE_INTEGER)) continue;
        if (!groups.has(item2[field])) groups.set(item2[field], /* @__PURE__ */ new Set());
        groups.get(item2[field]).add(item2.definitionId);
      }
      hints.push(...[...groups].filter(([, ids]) => ids.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0] - b[0]).slice(0, 2).map(([groupId]) => ({ strategy, groupId })));
    }
    let nodes = 0;
    let result;
    const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
    const reportProgress = (progress) => {
      if (typeof onProgress !== "function") return;
      try {
        onProgress({
          ...progress,
          nodes: nodes + progress.nodes,
          search: Object.fromEntries(Object.keys(search).map((key) => [key, search[key] + (progress.search?.[key] ?? 0)])),
          maxNodes,
          safeCandidates: pool.candidates.length,
          required: required2,
          attempt: progress.attempt,
          attempts: hints.length
        });
      } catch {
      }
    };
    for (const [index, hint] of hints.entries()) {
      const budget = Math.floor((maxNodes - nodes) / (hints.length - index));
      result = yield* iterateFc27PuzzleCandidates({
        ...options,
        maxNodes: budget,
        searchHint: hint,
        onProgress: (progress) => reportProgress({ ...progress, attempt: index + 1 })
      });
      nodes += result.nodes ?? 0;
      for (const key of Object.keys(search)) search[key] += result.search?.[key] ?? 0;
      if (result.reason !== "FC27_PUZZLE_SEARCH_LIMIT") {
        return { ...result, ...result.nodes !== void 0 ? { nodes, maxNodes, search, strategyAttempts: index + 1 } : {} };
      }
    }
    return { ...result, nodes, maxNodes, search, strategyAttempts: hints.length };
  }
  function* iterateFc27PuzzleCandidates({
    challenge,
    policy,
    evaluateSquad,
    boundSquad,
    groupMatcher,
    clubLinks,
    maxNodes = DEFAULT_MAX_NODES,
    searchHint = null,
    pool,
    procurement = null,
    onProgress = null
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
      const fields4 = [
        (item2) => item2.nationId,
        (item2) => item2.leagueId,
        (item2) => resolveClub?.(item2.teamId ?? item2.clubId)
      ];
      const frequencies = fields4.map((read) => {
        const groups = /* @__PURE__ */ new Map();
        for (const item2 of candidates) {
          const key = read(item2);
          if (!integer5(key, 1, Number.MAX_SAFE_INTEGER)) continue;
          if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
          groups.get(key).add(item2.definitionId);
        }
        return groups;
      });
      const scores = new Map(candidates.map((item2) => [item2, fields4.reduce((sum2, read, index) => sum2 + Math.min(required2, frequencies[index].get(read(item2))?.size ?? 0), 0)]));
      candidates = candidates.slice().sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || scores.get(b) - scores.get(a) || a.rating - b.rating || (Number.isSafeInteger(a.id) && Number.isSafeInteger(b.id) ? a.id - b.id : a.definitionId - b.definitionId));
    }
    if (["nation", "league", "club"].includes(searchHint?.strategy)) {
      const group = (item2) => hintGroup(searchHint, item2, resolveClub);
      candidates = candidates.slice().sort((a, b) => (policy.storageFirst ? Number(b.pile === "storage") - Number(a.pile === "storage") : 0) || Number(group(b) === searchHint.groupId) - Number(group(a) === searchHint.groupId));
    }
    const scarce = itemRules.filter((rule) => rule.mode !== "max" && rule.count > 0).map((rule) => ({
      minimum: rule.count,
      matching: candidates.filter((item2) => matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub) === true)
    }));
    for (const rule of parsed.rules.filter((rule2) => rule2.kind.startsWith("same-") && rule2.mode !== "max")) {
      const groups = /* @__PURE__ */ new Map();
      for (const item2 of candidates) {
        const key = relationValue(rule, item2, resolveClub);
        if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
        groups.get(key).add(item2.definitionId);
      }
      scarce.push({ minimum: rule.value, matching: candidates.filter((item2) => (groups.get(relationValue(rule, item2, resolveClub))?.size ?? 0) >= rule.value) });
    }
    const forced = new Set(scarce.filter((entry) => new Set(entry.matching.map((item2) => item2.definitionId)).size === entry.minimum).flatMap((entry) => entry.matching));
    const definitionCounts = /* @__PURE__ */ new Map();
    for (const item2 of candidates) definitionCounts.set(item2.definitionId, (definitionCounts.get(item2.definitionId) ?? 0) + 1);
    const certain = [...forced].filter((item2) => definitionCounts.get(item2.definitionId) === 1);
    for (const rule of itemRules.filter((rule2) => ["max", "exact"].includes(rule2.mode))) {
      const used = certain.filter((item2) => matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub) === true).length;
      if (used === rule.count) candidates = candidates.filter((item2) => forced.has(item2) || matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub) !== true);
    }
    if (forced.size && parsed.rules.some((rule) => rule.kind.endsWith("-chemistry"))) {
      candidates = candidates.slice().sort((a, b) => Number(forced.has(b)) - Number(forced.has(a)));
    }
    const metrics = { safeCandidates: candidates.length, excluded: pool.excluded, excludedByReason: pool.excludedByReason };
    const costs = procurement ? candidates.map(procurement.costOf) : candidates.map(() => 0);
    if (costs.some((cost) => !integer5(cost, 0, 1e7))) return blocked2("FC27_MARKET_QUOTE_INVALID");
    const uniqueDefinitions = new Set(candidates.map((item2) => item2.definitionId)).size;
    if (uniqueDefinitions < required2) return blocked2("SAFE_MATERIAL_SHORTAGE", { ...metrics, uniqueDefinitions, required: required2 });
    const counted = itemRules.map((rule) => ({
      rule,
      matches: candidates.map((item2) => matchFc27SbcItemRule(rule, item2, groupMatcher, resolveClub))
    }));
    const relations = parsed.rules.filter((rule) => /^(same|distinct)-/.test(rule.kind));
    if (counted.some(({ matches: matches2 }) => matches2.includes(null)) || relations.some((rule) => candidates.some((item2) => !integer5(relationValue(rule, item2, resolveClub), 1, Number.MAX_SAFE_INTEGER)))) {
      return blocked2("FC27_REQUIREMENT_VALUE_UNAVAILABLE", metrics);
    }
    const groupCaps = new Map(relations.filter((rule) => rule.kind.startsWith("distinct-") && rule.mode !== "min").map((rule) => [rule, groupSuffixIndex(rule, candidates, resolveClub)]));
    for (const rule of relations.filter((rule2) => rule2.kind.startsWith("same-") && rule2.mode !== "max")) {
      const groups = /* @__PURE__ */ new Map();
      for (const item2 of candidates) {
        const key = relationValue(rule, item2, resolveClub);
        if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Set());
        groups.get(key).add(item2.definitionId);
      }
      const viable = new Set([...groups].filter(([, ids]) => ids.size >= rule.value).map(([key]) => key));
      counted.push({
        rule: { ...rule, count: rule.value, mode: "min" },
        matches: candidates.map((item2) => viable.has(relationValue(rule, item2, resolveClub)))
      });
    }
    const deficits = counted.flatMap(({ rule, matches: matches2 }) => {
      if (rule.mode === "max") return [];
      const available = new Set(candidates.filter((_item, index) => matches2[index]).map((item2) => item2.definitionId)).size;
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
    const reportProgress = (force = false) => {
      if (typeof onProgress !== "function") return;
      const now = Date.now();
      if (!force && (nodes % 256 !== 0 || now - lastProgressAt < 100)) return;
      lastProgressAt = now;
      try {
        onProgress({
          phase: lastNodeKind,
          nodes,
          maxNodes,
          search: { ...search },
          safeCandidates: candidates.length,
          required: required2
        });
      } catch {
      }
    };
    let lastProgressAt = 0;
    let lastNodeKind = "combination";
    const takeNode = (kind) => {
      if (nodes >= maxNodes) {
        exhausted = true;
        return false;
      }
      nodes++;
      search[kind]++;
      lastNodeKind = kind === "combinationNodes" ? "combination" : kind === "placementNodes" ? "placement" : kind === "evaluations" ? "evaluation" : "bounds";
      reportProgress();
      return true;
    };
    const needsFacts = ruleNeedsTeamFacts(parsed.rules);
    const searchPositions = parsed.rules.some((rule) => rule.kind.endsWith("-chemistry"));
    const minimumChemistry = Math.max(0, ...parsed.rules.filter((rule) => ["min-chemistry", "exact-chemistry"].includes(rule.kind)).map((rule) => rule.value));
    const visit = function* (start) {
      if (finished() || unavailable || exhausted || !takeNode("combinationNodes")) return;
      yield;
      const remaining = required2 - chosen.length;
      if (procurement) {
        if (purchases > procurement.maxPurchases || spent > procurement.budget) return;
        const floor = spent + cheapest[start].slice(0, remaining).reduce((sum2, cost) => sum2 + cost, 0);
        if (floor > procurement.budget || best && floor >= best.cost) return;
      }
      for (const { rule, used, suffix } of counted) {
        const mode = rule.mode ?? "min";
        if (mode !== "min" && used > rule.count || mode !== "max" && used + Math.min(remaining, suffix[start]) < rule.count) return;
      }
      for (const rule of relations) {
        const counts = /* @__PURE__ */ new Map();
        for (const item2 of chosen) {
          const value = relationValue(rule, item2, resolveClub);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        const actual = rule.kind.startsWith("distinct-") ? counts.size : Math.max(0, ...counts.values());
        if (rule.mode !== "min" && actual > rule.value || rule.mode !== "max" && actual + remaining < rule.value) return;
        if (groupCaps.has(rule) && remainingGroupCapacity(groupCaps.get(rule), counts, start, rule.value - counts.size) < remaining) return;
      }
      if (chosen.length === required2) {
        const validate2 = (facts2) => matchFc27SbcRequirements({
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
              chosen.forEach((item2, index) => {
                squad[slots[index]] = { ...item2, slot: slots[index] };
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
            validate: validate2,
            searchPositions
          });
          found = result.found;
          unavailable = result.unavailable;
        } else {
          const validation = validate2({});
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
        const item2 = candidates[index];
        if (definitions.has(item2.definitionId)) continue;
        for (const entry of counted) entry.used += Number(entry.matches[index]);
        spent += costs[index];
        purchases += Number(costs[index] > 0);
        chosen.push(item2);
        definitions.add(item2.definitionId);
        yield* visit(index + 1);
        definitions.delete(item2.definitionId);
        chosen.pop();
        spent -= costs[index];
        purchases -= Number(costs[index] > 0);
        for (const entry of counted) entry.used -= Number(entry.matches[index]);
      }
    };
    yield* visit(0);
    reportProgress(true);
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
      selected: found.items.map((item2, index) => ({
        id: item2.id,
        definitionId: item2.definitionId,
        pile: item2.pile,
        rating: item2.rating,
        slot: slots[index],
        ...item2.catalogRef ? { catalogRef: item2.catalogRef } : {}
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
    if (!Array.isArray(squad) || !squad.length || squad.length > 11 || Array.from(squad).some((item2) => !integer6(item2?.rating, 1, 99))) return fail8("FC27_PUZZLE_RATING_ITEMS_UNAVAILABLE");
    if (typeof rating?.floatCalculationEnabled !== "boolean") return fail8("FC27_PUZZLE_RATING_CONFIG_UNAVAILABLE");
    let total = squad.reduce((sum2, item2) => sum2 + item2.rating, 0);
    const average = Math.min(rating.floatCalculationEnabled ? total / 11 : Math.floor(total / 11), 99);
    for (const item2 of squad) if (item2.rating > average) total += item2.rating - average;
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
    const optimistic = { ...formation, positions: squad.map((item2, index) => item2 === null ? formation.positions[index] : item2.positions[0]) };
    const result = evaluateFc27PuzzleSquad({ squad, formation: optimistic, chemistry, rating });
    if (result.status !== "observed") return result;
    const playable = squad.flatMap((item2, index) => item2 === null ? [] : [index]);
    let scores = /* @__PURE__ */ new Map([[0, 0]]);
    squad.forEach((item2, index) => {
      if (item2 === null || result.slotChemistry[index] === 0) return;
      const compatible = playable.filter((slot) => item2.positions.includes(formation.positions[slot]));
      const next = new Map(scores);
      for (const [mask, score2] of scores) for (const slot of compatible) {
        const bit = 1 << slot;
        if (mask & bit) continue;
        const value = score2 + result.slotChemistry[index];
        if (value > (next.get(mask | bit) ?? -1)) next.set(mask | bit, value);
      }
      scores = next;
    });
    return { status: "observed", maxChemistry: Math.max(...scores.values()) };
  }
  function evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating } = {}) {
    if (!Array.isArray(squad) || squad.length !== 11 || Array.from(squad).some((item2) => item2 === void 0)) return fail8("FC27_PUZZLE_SQUAD_SIZE_UNAVAILABLE");
    if (!Array.isArray(formation?.positions) || formation.positions.length !== 11 || Array.from(formation.positions).some((position) => !integer6(position, 0, 27))) return fail8("FC27_PUZZLE_FORMATION_UNAVAILABLE");
    if (typeof chemistry?.profilesEnabled !== "boolean") return fail8("FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED");
    const resolveClub = createFc27ClubResolver(chemistry.links);
    const parameters = parametersOf(chemistry.parameters);
    const profiles = profilesOf(chemistry);
    const identities = chemistry.identities;
    const identityKeys = ["legendClubId", "legendLeagueId", "heroClubId", "hallOfFutClubId"];
    if (!resolveClub || !parameters || chemistry.maxChemistryPerPlayer !== 3 || !identityKeys.every((key) => positive4(identities?.[key])) || !Array.isArray(chemistry.superChemRarityIds) || chemistry.superChemRarityIds.length > 10001 || Array.from(chemistry.superChemRarityIds).some((value) => !integer6(value, 0, 1e4))) return fail8("FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE");
    if (!profiles) return fail8("FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED");
    const players = squad.filter((item2) => item2 !== null);
    for (const item2 of players) {
      if (!item2 || item2.type !== "player" || !integer6(item2.rating, 1, 99) || !positive4(item2.nationId) || !positive4(item2.teamId) || !positive4(item2.leagueId) || !Array.isArray(item2.positions) || !item2.positions.length || item2.positions.length > 28 || Array.from(item2.positions).some((value) => !integer6(value, 0, 27)) || ![0, 1].includes(item2.rarity) || item2.special !== false || item2.evolution !== false || item2.cosmetic !== false || item2.concept !== false || item2.academyEnrolled !== false) return fail8("FC27_PUZZLE_POSITION_OR_ITEM_FACTS_UNAVAILABLE");
      if ([identities.legendClubId, identities.heroClubId, identities.hallOfFutClubId].includes(item2.teamId) || item2.leagueId === identities.legendLeagueId || chemistry.superChemRarityIds.includes(item2.rarity)) return fail8("FC27_PUZZLE_SPECIAL_CHEMISTRY_UNSUPPORTED");
      if (chemistry.profilesEnabled) {
        const profile = profiles.find((value) => value.applicableRarityIds.includes(item2.rarity)) ?? profiles.find((value) => value.id === 1);
        if (!ordinaryProfile(profile)) return fail8("FC27_PUZZLE_CHEMISTRY_PROFILE_UNSUPPORTED");
      }
    }
    const fields4 = [
      { id: 1, value: (item2) => item2.nationId },
      { id: 2, value: (item2) => item2.leagueId },
      { id: 3, value: (item2) => resolveClub(item2.teamId) }
    ];
    const counts = fields4.map(() => /* @__PURE__ */ new Map());
    const eligible = squad.map((item2, slot) => item2 !== null && item2.positions.includes(formation.positions[slot]));
    squad.forEach((item2, slot) => {
      if (eligible[slot]) fields4.forEach((field, index) => {
        const id7 = field.value(item2);
        counts[index].set(id7, (counts[index].get(id7) ?? 0) + 1);
      });
    });
    const slotChemistry = squad.map((item2, slot) => eligible[slot] ? Math.min(3, fields4.reduce((total, field, index) => {
      const count2 = counts[index].get(field.value(item2)) ?? 0;
      return total + parameters.get(field.id).reduce((points, threshold) => points + (count2 >= threshold.requirement ? threshold.points : 0), 0);
    }, 0)) : 0);
    const ratingResult = evaluateFc27PuzzleRating({ squad: players, rating });
    return {
      status: "observed",
      reason: "FC27_PUZZLE_FACTS_EVALUATED",
      chemistry: slotChemistry.reduce((sum2, value) => sum2 + value, 0),
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
    const failed = (mismatch2 = "shape") => ({
      status: "blocked",
      reason: "FC27_EXACT_ITEMS_CHANGED",
      mismatch: typeof mismatch2 === "string" && /^[a-z-]{1,40}$/.test(mismatch2) ? mismatch2 : "shape"
    });
    const validId12 = (value) => Number.isSafeInteger(value) && value > 0;
    if (!Array.isArray(selected) || !Array.isArray(freshItems) || selected.length < 1 || selected.length > 11 || freshItems.length >= 250 || !Array.isArray(plannedItems) || plannedItems.length !== selected.length) return failed();
    const fields4 = [
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
    const expected = new Map(plannedItems.map((item2) => [item2?.id, item2]));
    const byId = new Map(freshItems.map((item2) => [item2?.id, item2]));
    if (byId.size !== freshItems.length || expected.size !== selected.length || freshItems.some((item2) => !validId12(item2?.id) || !validId12(item2?.definitionId) || !selected.some((ref) => ref.definitionId === item2.definitionId))) return failed();
    const seenIds = /* @__PURE__ */ new Set();
    const seenDefinitions = /* @__PURE__ */ new Set();
    for (const plan of selected) {
      const current2 = byId.get(plan?.id);
      const before = expected.get(plan?.id);
      if (!validId12(plan?.id) || !validId12(plan?.definitionId) || plan.pile !== "club" || seenIds.has(plan.id) || seenDefinitions.has(plan.definitionId) || !current2 || !before || current2.id !== plan.id || current2.definitionId !== plan.definitionId || fields4.some((key) => !Object.hasOwn(current2, key) || !Object.hasOwn(before, key) || JSON.stringify(current2[key]) !== JSON.stringify(before[key])) || current2.type !== "player" || current2.pile !== "club" || current2.rating !== plan.rating || current2.special !== false || current2.evolution !== false || current2.cosmetic !== false || current2.concept !== false || current2.academyEnrolled !== false || current2.activeTrade !== false || current2.limitedUse !== false || current2.loans !== -1 || current2.tradeable !== false) {
        return failed("identity");
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
      if (links.length !== size || links.some((pair) => !pair.every((id7) => Number.isSafeInteger(id7) && id7 > 0))) return null;
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
    layout: suppliedLayout = null,
    excludedItemIds = [],
    excludedDefinitionIds = []
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
      const matches2 = catalog.challenges.filter((challenge2) => challenge2.id === challengeId && challenge2.status === "IN_PROGRESS");
      if (matches2.length !== 1 || matches2[0].eligibilityOperation !== "AND") return blocked3("FC27_IN_PROGRESS_PUZZLE_REQUIRED");
      const observed = matches2[0];
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
      if (!Array.isArray(excludedItemIds) || !Array.isArray(excludedDefinitionIds) || excludedItemIds.length > 500 || excludedDefinitionIds.length > 500 || excludedItemIds.some((value) => !Number.isSafeInteger(value) || value <= 0) || excludedDefinitionIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
        return blocked3("FC27_PUZZLE_RESERVATION_UNVERIFIED");
      }
      const excludedItems = new Set(excludedItemIds);
      const excludedDefinitions = new Set(excludedDefinitionIds);
      const cached = readFc27CachedClub(root);
      const inventory = {
        schema: 1,
        context,
        kind: "normalized-inventory",
        status: "provisional",
        scope: "club-only",
        complete: false,
        items: cached.items.filter((item2) => !excludedItems.has(item2.id) && !excludedDefinitions.has(item2.definitionId)).map((item2) => ({ ...item2, protected: item2.special !== false || item2.evolution !== false || item2.cosmetic !== false }))
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
          ratings: (plan.selected ?? []).map((item2) => item2.rating),
          slots: (plan.selected ?? []).map((item2) => item2.slot),
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
  var project = (item2) => Object.fromEntries(itemFields.map((key) => [key, item2?.[key]]));
  function assess(scope2, selected, items) {
    const { context, challenge, policy, clubLinks, chemistry } = scope2;
    if (challenge?.mechanism !== "traditional-puzzle" || challenge.slotCount !== 11 || !Array.isArray(challenge.brickIndices) || challenge.brickIndices.length >= 11 || new Set(challenge.brickIndices).size !== challenge.brickIndices.length || challenge.brickIndices.some((index) => !Number.isInteger(index) || index < 0 || index > 10) || !positive5(challenge.formation?.id) || challenge.formation.positions?.length !== 11 || Array.from(challenge.formation.positions).some((value) => !Number.isInteger(value) || value < 0 || value > 27)) {
      return fail9("FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED");
    }
    const required2 = 11 - challenge.brickIndices.length;
    if (!policy || policy.onlyUntradeable !== true || !positive5(policy.maxRating) || policy.maxRating > 99) {
      return fail9("FC27_PUZZLE_FILL_POLICY_UNVERIFIED");
    }
    if (!Array.isArray(selected) || selected.length !== required2 || !Array.isArray(items) || items.length !== required2 || new Set(selected.map((ref) => ref?.slot)).size !== required2 || selected.some((ref) => !ref || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || challenge.brickIndices.includes(ref.slot) || !positive5(ref.id) || !positive5(ref.definitionId) || ref.pile !== "club" || ref.catalogRef !== void 0) || new Set(selected.map((ref) => ref.id)).size !== required2 || new Set(selected.map((ref) => ref.definitionId)).size !== required2 || new Set(items.map((item2) => item2?.id)).size !== required2) return fail9("FC27_PUZZLE_FILL_SELECTION_CHANGED");
    const byId = new Map(items.map((item2) => [item2?.id, item2]));
    const squad = Array(11).fill(null);
    for (const ref of selected) {
      const item2 = byId.get(ref.id);
      if (!item2 || itemFields.some((key) => item2[key] === void 0) || item2.definitionId !== ref.definitionId || item2.pile !== ref.pile || item2.rating !== ref.rating || item2.state !== "free") {
        return fail9("FC27_PUZZLE_FILL_SELECTION_CHANGED");
      }
      squad[ref.slot] = { ...project(item2), slot: ref.slot };
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
        const matches2 = input.inventory.items.filter((item2) => item2.id === ref.id);
        return matches2.length === 1 ? project(matches2[0]) : null;
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
      if (!Array.isArray(freshItems) || freshItems.length < plan.selected.length || freshItems.length >= 250 || new Set(freshItems.map((item2) => item2?.id)).size !== freshItems.length || freshItems.some((item2) => !positive5(item2?.id) || !positive5(item2?.definitionId) || !plan.selected.some((ref) => ref.definitionId === item2.definitionId)) || saved && freshItems.length !== plan.selected.length) return fail9("FC27_EXACT_ITEMS_CHANGED");
      const currentById = new Map(freshItems.map((item2) => [item2.id, item2]));
      const expected = new Map(plan.items.map((item2) => [item2.id, item2]));
      const items = [];
      for (const ref of plan.selected) {
        const item2 = currentById.get(ref.id);
        const normalized = item2 && { ...item2, protected: item2.protected ?? expected.get(ref.id)?.protected };
        if (!normalized || !same4(project(normalized), expected.get(ref.id)) || saved && item2.slot !== ref.slot) return fail9("FC27_EXACT_ITEMS_CHANGED");
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
        const plannedItems = structuredClone(selected.map((ref) => inputs.inventory.items.find((item2) => item2.id === ref.id && item2.definitionId === ref.definitionId)));
        if (selected.some((item2) => item2.pile !== "club") || plannedItems.some((item2) => !item2)) {
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
            selected: selected.map((ref) => cached.items.find((item2) => item2.id === ref.id && item2.definitionId === ref.definitionId))
          });
        };
        const before = signature2();
        const transport = await createFc27ClubReadTransport(root);
        if (signature2() !== before) return stop6("FC27_RUNNER_INPUTS_CHANGED");
        const fresh = await transport.readPage({
          start: 0,
          count: 250,
          definitionIds: selected.map((item2) => item2.definitionId)
        });
        if (signature2() !== before) return stop6("FC27_RUNNER_INPUTS_CHANGED");
        const exactValidation = validateFc27PuzzleSelection(selected, fresh, plannedItems);
        if (exactValidation.status !== "verified") return stop6(exactValidation.reason);
        const fillPlan = prepareFc27PuzzleFillPlan(inputs, plan);
        const fillPreflight = fillPlan.status === "prepared" ? validateFc27PuzzleFillPlan(fillPlan, inputs, fresh) : fillPlan;
        if (typeof onVerifiedInputs === "function") {
          const fields4 = [
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
            squad[ref.slot] = Object.fromEntries(fields4.map((key) => [key, plannedItems[index][key]]));
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
          await gmSetValue(indexKey, Array.isArray(targets) ? targets.filter((item2) => item2?.setId !== target.setId || item2?.challengeId !== target.challengeId) : []);
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
    const validate2 = (result) => {
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
              itemRefs: plan.selected.map(({ id: id7, definitionId, pile, slot }) => ({ id: id7, definitionId, pile, slot })),
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
                validate2(validateFc27PuzzleFillPlan(plan, current2.input, exact.items));
                const latest = await adapter.readInputs(plan);
                evidence(latest, plan);
                if (latest.squadEmpty !== true) fail11("FC27_PUZZLE_EXISTING_SQUAD_BLOCKED");
                validate2(validateFc27PuzzleFillPlan(plan, latest.input, exact.items));
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
                validate2(validateFc27PuzzleFillPlan(plan, current2.input, saved.items, { saved: true }));
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
    const fields4 = { "from-nations": "nation", "from-leagues": "league", "from-clubs": "team" };
    const anchors = identities.flatMap((rule) => rule.ids.filter(validId2).slice(0, 2).map((id7) => ({ [fields4[rule.kind]]: id7 })));
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
  var findFc27PuzzleRepairSeedCooperatively = (input, onProgress, options) => finishPuzzleSearchCooperatively(iterateRepairSeed(input, onProgress), options);
  function* iterateRepairSeed(input, onProgress = null) {
    const parsed = parseFc27SbcRequirements(input?.challenge?.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const chemistry = parsed.rules.filter((rule) => rule.kind.endsWith("-chemistry"));
    if (chemistry.length !== 1 || chemistry[0].kind !== "min-chemistry") return stop4("FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE");
    const original = chemistry[0].value;
    const differences = Array.from({ length: Math.max(1, Math.min(4, original)) }, (_, index) => Math.min(index + 1, original));
    let nodes = 0;
    for (const [attempt, difference] of differences.entries()) {
      const challenge = structuredClone(input.challenge);
      const index = parsed.rules.indexOf(chemistry[0]);
      challenge.rawRequirements[index].pairs[0].values = [original - difference];
      const maxNodes = Math.floor((5e4 - nodes) / (differences.length - attempt));
      const preview = yield* iterateFc27PuzzleSquad({
        ...input,
        challenge,
        maxNodes,
        onProgress: typeof onProgress === "function" ? (value) => onProgress({
          ...value,
          nodes: nodes + value.nodes,
          maxNodes: 5e4,
          repairAttempt: attempt + 1,
          repairAttempts: differences.length
        }) : null
      });
      nodes += preview.nodes ?? 0;
      if (preview.status !== "preview") continue;
      const squad = Array(input.challenge.slotCount).fill(null);
      for (const ref of preview.selected) squad[ref.slot] = { ...structuredClone(input.inventory.items.find((item2) => item2.id === ref.id)), slot: ref.slot };
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
      for (const item2 of players) {
        const key = read(item2);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    };
    const tier = count2((item2) => quality(item2.rating))[0]?.[0];
    const level = { 1: "bronze", 2: "silver", 3: "gold" }[tier];
    const clubs = count2((item2) => resolveClub?.(item2.teamId));
    const leagues = count2((item2) => item2.leagueId);
    const queries = [];
    if (positive7(clubs[0]?.[0]) && clubs[0][1] >= 2) queries.push({ start: 0, count: 20, level, team: clubs[0][0] });
    for (const [league] of leagues) {
      if (queries.length >= 3) break;
      if (positive7(league) && !input.policy.excludedLeagueIds.includes(league)) queries.push({ start: 0, count: 20, level, league });
    }
    return { status: "ready", executable: false, queries, complete: false };
  }
  var suggestFc27PuzzlePurchasesCooperatively = (input, seed, entries2, options) => finishPuzzleSearchCooperatively(iteratePurchases(input, seed, entries2, options), options);
  function* iteratePurchases(input, seed, entries2, { maxChecks = 2e4, onProgress = null } = {}) {
    if (!validSeed(input, seed)) return stop4("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    if (!Array.isArray(entries2) || entries2.length > 60 || !Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 5e4) return stop4("FC27_PURCHASE_REPAIR_BUDGET_INVALID");
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop4(pool.reason);
    if (seed.squad.some((item2) => item2 && !pool.candidates.some((candidate) => candidate.id === item2.id && JSON.stringify({ ...candidate, slot: item2.slot }) === JSON.stringify(item2)))) return stop4("FC27_PURCHASE_REPAIR_INPUTS_CHANGED");
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const material = puzzleMaterialRules(parsed.rules, required(input));
    const candidates = marketCandidates(input, entries2);
    const slots = seed.squad.flatMap((item2, index) => item2 ? [index] : []);
    const plans = [];
    const combinations = /* @__PURE__ */ new Set();
    let checks = 0;
    let lastProgressAt = 0;
    const reportProgress = (force = false) => {
      if (typeof onProgress !== "function") return;
      const now = Date.now();
      if (!force && (checks % 256 !== 0 || now - lastProgressAt < 100)) return;
      lastProgressAt = now;
      try {
        onProgress({
          phase: "local-market-search",
          nodes: checks,
          maxNodes: maxChecks,
          checks,
          marketCandidates: candidates.length
        });
      } catch {
      }
    };
    const assess3 = (squad) => {
      if (checks >= maxChecks) return;
      checks++;
      reportProgress();
      const players = squad.filter(Boolean);
      if (new Set(players.map((item2) => item2.definitionId)).size !== players.length) return;
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
      const key = plan.purchases.map((item2) => item2.definitionId).sort((a, b) => a - b).join(",");
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
      yield;
    }
    if (!plans.length) for (let a = 0; a < Math.min(12, candidates.length); a++) for (let b = a + 1; b < Math.min(12, candidates.length); b++) {
      for (const first of slots) for (const second of slots) {
        if (first === second || checks >= maxChecks) continue;
        const squad = seed.squad.slice();
        squad[first] = candidates[a];
        squad[second] = candidates[b];
        assess3(squad);
        yield;
      }
    }
    reportProgress(true);
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
    const owned2 = new Set(input.inventory.items.map((item2) => item2.definitionId));
    const seen = /* @__PURE__ */ new Set();
    return entries2.filter((item2) => {
      if (!positive7(item2?.definitionId) || owned2.has(item2.definitionId) || seen.has(item2.definitionId)) return false;
      seen.add(item2.definitionId);
      return item2.special === false && item2.evolution === false && item2.cosmetic === false && [0, 1].includes(item2.rarity) && Number.isInteger(item2.rating) && item2.rating >= 1 && item2.rating <= input.policy.maxRating && (item2.rating < 75 || item2.rating >= input.policy.goldRange[0] && item2.rating <= input.policy.goldRange[1]) && [item2.nationId, item2.leagueId, item2.teamId].every(positive7) && !input.policy.excludedLeagueIds.includes(item2.leagueId) && Array.isArray(item2.positions) && item2.positions.length > 0 && item2.positions.every((position) => Number.isInteger(position) && position >= 0 && position <= 27) && Array.isArray(item2.groups) && item2.groups.every((group) => Number.isInteger(group) && group >= 0);
    }).map((item2) => ({
      definitionId: item2.definitionId,
      rating: item2.rating,
      rarity: item2.rarity,
      nationId: item2.nationId,
      ...typeof item2.displayName === "string" && item2.displayName.length <= 201 && !/[\u0000-\u001f]/.test(item2.displayName) ? { displayName: item2.displayName } : {},
      leagueId: item2.leagueId,
      teamId: item2.teamId,
      positions: [...item2.positions],
      groups: [...item2.groups],
      special: false,
      evolution: false,
      cosmetic: false,
      type: "player",
      concept: false,
      academyEnrolled: false,
      catalogRef: `fc27:${item2.definitionId}`
    }));
  }
  function projectSuggestion(squad, facts2, requirementCount) {
    const purchases = squad.flatMap((item2, slot) => item2?.catalogRef ? [{ ...item2, slot, quantity: 1 }] : []);
    return {
      executable: false,
      liveExecutionEnabled: false,
      purchaseCount: purchases.length,
      purchases,
      selectedOwned: squad.flatMap((item2, slot) => item2 && !item2.catalogRef ? [{
        id: item2.id,
        definitionId: item2.definitionId,
        pile: item2.pile,
        rating: item2.rating,
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
    const missing = material.filter((rule) => rule.count > new Set(pool.candidates.filter((item2) => quality(item2.rating) === rule.qualities[0]).map((item2) => item2.definitionId)).size);
    const generic = planFc27MarketQueryRoute(input);
    if (generic.status !== "ready") return generic;
    const levelOf = (tier) => ({ 1: "bronze", 2: "silver", 3: "gold" })[tier];
    const tiers = material.length ? material.filter((rule) => rule.count > 0).sort((a, b) => Number(missing.includes(b)) - Number(missing.includes(a)) || b.count - a.count).map((rule) => levelOf(rule.qualities[0])) : [...new Set(generic.queries.map((query) => query.level))];
    const queries = [];
    const add = (query) => {
      if (queries.length < 3 && !queries.some((existing) => JSON.stringify(existing) === JSON.stringify(query))) queries.push(query);
    };
    const cappedClubs = parsed.rules.some((rule) => rule.kind === "distinct-clubs" && rule.mode !== "min" && rule.value < required(input));
    const chemistryNeeded = parsed.rules.some((rule) => rule.kind === "min-chemistry" && rule.value > 0);
    const nations = parsed.rules.filter((rule) => rule.kind === "from-nations" && rule.mode === "min" && rule.count > 0).flatMap((rule) => rule.ids);
    if (!cappedClubs && chemistryNeeded && tiers.length > 1 && nations.length) {
      const ranked = [...new Set(nations)].map((nation) => ({
        nation,
        items: pool.candidates.filter((item2) => item2.nationId === nation && tiers.includes(levelOf(quality(item2.rating))))
      })).sort((a, b) => b.items.filter((item2) => levelOf(quality(item2.rating)) === tiers[0]).length - a.items.filter((item2) => levelOf(quality(item2.rating)) === tiers[0]).length || b.items.length - a.items.length || a.nation - b.nation);
      const anchor = ranked[0];
      for (const level of tiers) add({ start: 0, count: 20, level, nation: anchor.nation });
      const leagues2 = /* @__PURE__ */ new Map();
      for (const item2 of anchor.items) leagues2.set(item2.leagueId, (leagues2.get(item2.leagueId) ?? 0) + 1);
      const league = [...leagues2].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      add({ start: 0, count: 20, level: tiers[0], ...positive7(league) ? { league } : {} });
      return { status: "ready", executable: false, queries, complete: false };
    }
    if (cappedClubs) {
      const resolveClub = createFc27ClubResolver(input.clubLinks);
      if (!resolveClub) return stop4("FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE");
      const candidates = [...pool.candidates, ...marketCandidates(input, entries2)];
      const lanes = tiers.map((level) => {
        const groups = /* @__PURE__ */ new Map();
        for (const item2 of candidates.filter((item3) => levelOf(quality(item3.rating)) === level)) {
          const team = item2.teamId;
          const group = resolveClub(team);
          if (!positive7(team) || !positive7(group)) continue;
          if (!groups.has(group)) groups.set(group, { team, ids: /* @__PURE__ */ new Set() });
          groups.get(group).ids.add(item2.definitionId);
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
    for (const item2 of pool.candidates) leagues.set(item2.leagueId, (leagues.get(item2.leagueId) ?? 0) + 1);
    for (const [league] of [...leagues].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      for (const query of baseQueries.filter((query2) => !query2.team && !query2.league && !query2.nation)) add({ ...query, league });
      if (queries.length === 3) break;
    }
    return { status: "ready", executable: false, queries, complete: false };
  }
  var suggestFc27PuzzleJointPurchasesCooperatively = (input, entries2, options) => finishPuzzleSearchCooperatively(iterateJointPurchases(input, entries2, options), options);
  function* iterateJointPurchases(input, entries2, { maxNodes = 5e4, onProgress = null } = {}) {
    if (!Array.isArray(entries2) || entries2.length > 60) return stop4("FC27_PURCHASE_REPAIR_BUDGET_INVALID");
    const pool = poolOf(input);
    if (pool.status !== "candidates") return stop4(pool.reason);
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
    if (parsed.status !== "observed") return stop4(parsed.reason);
    const market = marketCandidates(input, entries2);
    if (!market.length) return {
      ...stop4("FC27_PURCHASE_REPAIR_NO_PLAN"),
      marketCandidates: 0,
      nodes: 0,
      truncated: false,
      marketWideInfeasibilityProven: false
    };
    const result = yield* iterateFc27PuzzleCandidateRoutes({
      ...input,
      maxNodes,
      pool: { ...pool, candidates: [...pool.candidates, ...market] },
      procurement: { budget: required(input), maxPurchases: required(input), costOf: (item2) => item2.catalogRef ? 1 : 0 },
      onProgress
    });
    if (result.status !== "preview") return {
      ...stop4(result.reason),
      marketCandidates: market.length,
      nodes: result.nodes ?? 0,
      truncated: result.reason === "FC27_PUZZLE_SEARCH_LIMIT"
    };
    const squad = Array(input.challenge.slotCount).fill(null);
    for (const ref of result.selected) squad[ref.slot] = ref.catalogRef ? market.find((item2) => item2.catalogRef === ref.catalogRef) : pool.candidates.find((item2) => item2.id === ref.id);
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
    if (!Array.isArray(plan.selectedOwned) || !Array.isArray(plan.purchases) || [...plan.selectedOwned, ...plan.purchases].some((item2) => !item2 || typeof item2 !== "object")) {
      return blocked5("FC27_PUZZLE_CONCEPT_PLAN_INVALID");
    }
    const owned2 = plan.selectedOwned;
    const purchases = plan.purchases;
    const entries2 = [
      ...owned2.map((item2) => ({ ...item2, kind: "owned" })),
      ...purchases.map((item2) => ({ ...item2, kind: "concept" }))
    ];
    if (entries2.length !== required2 || new Set(entries2.map((item2) => item2.slot)).size !== required2 || entries2.some((item2) => !integer7(item2.slot, 0, challenge.slotCount - 1) || challenge.brickIndices.includes(item2.slot) || !positive8(item2.definitionId) || !integer7(item2.rating, 1, 99)) || new Set(entries2.map((item2) => item2.definitionId)).size !== required2 || owned2.some((item2) => !positive8(item2.id) || item2.pile !== "club" || item2.catalogRef !== void 0) || new Set(owned2.map((item2) => item2.id)).size !== owned2.length || purchases.some((item2) => item2.id !== void 0 || item2.pile !== void 0 || item2.catalogRef !== `fc27:${item2.definitionId}` || item2.quantity !== 1 || !integer7(item2.observedBuyNow ?? item2.estimatedUnitPrice, 150, 15e6)) || (plan.purchaseCount ?? purchases.length) !== purchases.length) {
      return blocked5("FC27_PUZZLE_CONCEPT_PLAN_INVALID");
    }
    const slots = Array.from({ length: challenge.slotCount }, (_, slot) => {
      const item2 = entries2.find((entry) => entry.slot === slot);
      return item2 ? {
        slot,
        kind: item2.kind,
        definitionId: item2.definitionId,
        rating: item2.rating,
        ...item2.kind === "owned" ? { id: item2.id, pile: item2.pile } : {
          catalogRef: item2.catalogRef,
          quantity: item2.quantity ?? 1,
          estimatedUnitPrice: item2.estimatedUnitPrice ?? null,
          observedBuyNow: item2.observedBuyNow ?? null
        }
      } : null;
    });
    if (slots.some((item2, slot) => !challenge.brickIndices.includes(slot) && !item2)) {
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
      estimatedCost: purchases.reduce((sum2, item2) => sum2 + (item2.observedBuyNow ?? item2.estimatedUnitPrice ?? 0), 0),
      slots: Object.freeze(slots.map((item2) => item2 && Object.freeze(item2))),
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
  var retryableRuntimeFailure = (reason) => /^FC27_MARKET_METHOD_\d+_(?:MISSING|CHANGED)$/.test(reason) || /^FC27_MARKET_ENTITY_UNVERIFIED(?:_[A-Z0-9_]+)?$/.test(reason) || reason === "FC27_MARKET_ENTITY_FACTORY_FAILED";
  var failureDetails = (reason, value) => {
    const match = /^FC27_MARKET_HTTP_([1-5]\d{2})$/.exec(reason);
    const eaCode = Object.getOwnPropertyDescriptor(value ?? {}, "eaCode")?.value;
    const phase = Object.getOwnPropertyDescriptor(value ?? {}, "phase")?.value;
    return {
      httpStatus: match ? Number(match[1]) : null,
      eaCode: Number.isSafeInteger(eaCode) && eaCode >= 0 && eaCode <= 2147483647 ? eaCode : null,
      failurePhase: typeof phase === "string" && /^[a-z-]{1,40}$/.test(phase) ? phase : null
    };
  };
  function createFc27PuzzleProcurementSession({ createTransport, get, set, now = Date.now } = {}) {
    let busy = false;
    return Object.freeze({ async plan(input, {
      assertCurrent = () => {
      },
      quoteCeiling = DEFAULT_PUZZLE_QUOTE_CEILING,
      onProgress = null
    } = {}) {
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
        failurePhase: null,
        excludedUnavailable: 0,
        replans: 0
      };
      let quoteCompleted = 0;
      let quoteTotal = 0;
      const reportProgress = (value) => {
        if (typeof onProgress !== "function") return;
        try {
          onProgress({
            ...value,
            phase: value?.phase ?? diagnostics.stage,
            nodes: value?.nodes ?? null,
            maxNodes: value?.maxNodes ?? null,
            checks: value?.checks ?? diagnostics.checks,
            catalogPages: diagnostics.catalogPages,
            catalogCandidates: diagnostics.catalogCandidates,
            usableCandidates: diagnostics.usableCandidates,
            catalogTotal: 3,
            requests,
            cacheHits,
            quoteCompleted,
            quoteTotal
          });
        } catch {
        }
      };
      const finish = (result) => ({ ...result, quoteCeiling, requests, cacheHits, diagnostics: { ...diagnostics, cacheHits } });
      try {
        if (!isPuzzleQuoteCeiling(quoteCeiling)) return finish(stop5("FC27_PURCHASE_PRICE_LIMIT_INVALID"));
        const scope2 = traditionalJournalScope(input.context);
        assertCurrent();
        reportProgress();
        const seed = await findFc27PuzzleRepairSeedCooperatively(
          input,
          (value) => reportProgress({ ...value, phase: "repair-seed" }),
          { assertCurrent }
        );
        if (seed.status !== "ready" && seed.reason !== "FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE") return finish(seed);
        diagnostics.route = seed.status === "ready" ? "repair" : "joint";
        diagnostics.stage = "query-planning";
        const route = seed.status === "ready" ? planFc27PuzzleRepairQueries(input, seed) : planFc27PuzzleShortageQueries(input);
        if (route.status !== "ready") return finish(route);
        const cachedRead = async (kind, query) => {
          diagnostics.stage = kind === "catalog" ? "catalog-read" : "quote-read";
          reportProgress();
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
              const runtimeFailure = stored.state === "blocked" && retryableRuntimeFailure(reason);
              if (!runtimeFailure && (!authFailure || remaining > 0)) {
                Object.assign(diagnostics, failureDetails(reason, stored.details), {
                  failureSource: "cache",
                  retryAfterSeconds: authFailure ? Math.ceil(remaining / 1e3) : null
                });
                throw new Error(reason);
              }
              if (authFailure) diagnostics.authRecoveries++;
            } else {
              const ttl = kind === "catalog" ? 864e5 : 6e5;
              if (!id2(stored.result?.observedAt) || stored.result.observedAt > now()) throw new Error("FC27_PURCHASE_CACHE_UNVERIFIED");
              if (now() - Math.min(stored.at, stored.result.observedAt) <= ttl) {
                cacheHits++;
                reportProgress();
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
            reportProgress();
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
          if (page?.status !== "observed" || page.season !== "27" || page.source !== "ea-defid" || !same7(page.query, query) || !id2(page.observedAt) || page.observedAt > now() || now() - page.observedAt > 864e5 || !Array.isArray(page.entries) || page.entries.length > query.count || new Set(page.entries.map((item2) => item2?.definitionId)).size !== page.entries.length) throw new Error("FC27_PURCHASE_CATALOG_UNVERIFIED");
          for (const entry of page.entries) {
            if (entries2.has(entry.definitionId) && !same7(entries2.get(entry.definitionId), entry)) throw new Error("FC27_PURCHASE_CATALOG_CHANGED");
            entries2.set(entry.definitionId, entry);
          }
          diagnostics.catalogPages++;
          diagnostics.catalogCandidates = entries2.size;
          reportProgress();
          for (; ; ) {
            assertCurrent();
            diagnostics.stage = "local-market-search";
            const available = [...entries2.values()].filter((item2) => !unavailable.has(item2.definitionId));
            reportProgress();
            const suggestion = seed.status === "ready" ? await suggestFc27PuzzlePurchasesCooperatively(input, seed, available, {
              assertCurrent,
              onProgress: (value) => reportProgress(value)
            }) : await suggestFc27PuzzleJointPurchasesCooperatively(input, available, {
              assertCurrent,
              onProgress: (value) => reportProgress({ ...value, phase: "local-market-search" })
            });
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
              quoteTotal = plan.purchases.length;
              quoteCompleted = plan.purchases.filter((item2) => quotes.get(item2.definitionId)?.price > 0).length;
              for (const item2 of plan.purchases) {
                if (!quotes.has(item2.definitionId)) {
                  const quote2 = await cachedRead("quote", { definitionId: item2.definitionId, start: 0, count: 20, maxBuy: quoteCeiling });
                  if (quote2?.status !== "observed" || quote2.season !== "27" || quote2.platform !== input.context.platform || quote2.source !== "ea-visible-buy-now" || quote2.definitionId !== item2.definitionId || !id2(quote2.observedAt) || quote2.observedAt > now() || now() - quote2.observedAt > 6e5 || !Number.isInteger(quote2.eligible) || quote2.eligible < 0 || quote2.eligible > 20 || (quote2.eligible === 0 ? quote2.price !== null : !Number.isInteger(quote2.price) || quote2.price < 150 || quote2.price > (quoteCeiling ?? MAX_PUZZLE_QUOTE_PRICE))) throw new Error("FC27_PURCHASE_QUOTE_UNVERIFIED");
                  quotes.set(item2.definitionId, quote2);
                  quoteCompleted = plan.purchases.filter((card) => quotes.get(card.definitionId)?.price > 0).length;
                  reportProgress();
                }
                if (quotes.get(item2.definitionId).price === null) {
                  unavailable.add(item2.definitionId);
                  removed = true;
                  break;
                }
              }
              if (plan.purchases.every((item2) => quotes.get(item2.definitionId)?.price > 0)) break;
            }
            diagnostics.excludedUnavailable = unavailable.size;
            const priced2 = plans.filter((plan) => plan.purchases.every((item2) => quotes.get(item2.definitionId)?.price > 0)).map((plan) => ({
              ...plan,
              purchases: plan.purchases.map((item2) => ({
                ...item2,
                observedBuyNow: quotes.get(item2.definitionId).price,
                quotedAt: quotes.get(item2.definitionId).observedAt
              })),
              estimatedCost: plan.purchases.reduce((sum2, item2) => sum2 + quotes.get(item2.definitionId).price, 0)
            })).sort((a, b) => a.purchaseCount - b.purchaseCount || a.estimatedCost - b.estimatedCost);
            if (priced2.length) return finish({
              status: "suggested",
              reason: "FC27_PURCHASE_PLAN_PRICED",
              executable: false,
              liveExecutionEnabled: false,
              plans: priced2.slice(0, 3).map((plan) => ({
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
    ["factories.Item.generateItemsFromItemData", "6147c9f404a3638daa032c5ab89818f0856e56f7bb7192ae4e7a0ca988e5ce72"],
    ["UTItemDAO.prototype.searchConceptItems", "6d5080a272138db4e8ba514633e7678d43d065fde141d1cad0fa1246818aa788"],
    ["UTItemDAO.prototype.searchTransferMarket", "3894f730c0e1bbcf0ff8dc1f5290f35c21e8906fdcf6a6344714e66d0739d90e"],
    ["FCAuthenticationService.prototype.getIdentifier", "30d1c91b414f508725e07f81c0577e40308be93ea92925051b21740c2781dbc3"],
    ["Identification.prototype.handleRequest", "74627d97570009ea15aea10dd2ff26d4ac85c8eeaea55f53253b6d3f9bb0eb09"],
    ["Identification.prototype.handleResponse", "cc4de06cc8696a4723f9539159c912c6d7cd4b7263ccaf7db9d7198b2f31ff01"]
  ]);
  var compatibleHashes = Object.freeze({
    "UTHttpRequest": "2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925",
    "EAHttpRequest": "76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1",
    "UTHttpRequest.prototype.setPath": "a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df",
    "UTHttpRequest.prototype.send": "da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81",
    "EAHttpRequest.prototype.send": "d19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452",
    "EAHttpRequest.prototype.setRequestBody": "b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9",
    "EAHttpRequest.prototype.abort": "a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419",
    "UTItemDAO.prototype.searchConceptItems": "edcd06d35a1fed95ead779eb152e9fce08662855bfda6ded3f0933d40236c7cc",
    "UTItemDAO.prototype.searchTransferMarket": "dceda80c8f59ac33349b5fb1eeecb4705834e0c0bc094bdb80fc98494b561111",
    "FCAuthenticationService.prototype.getIdentifier": "963bdc4c7fca39df8d4865716ceae2e323da2e16ca70287be4c9f00149494dc2",
    "Identification.prototype.handleRequest": "b2c26d4d12aab146387df266044ffbab40e77b96d7b3328ac55f32d99d767949",
    "Identification.prototype.handleResponse": "2fb555ef84ebf2a1c71b05095ec37955733f40ab55e48e3849d3b49636f3abb4"
  });
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
    if (ownData(entity, "definitionId") !== resourceId) throw error("ENTITY_UNVERIFIED_DEFINITION_MISMATCH");
    if (ownData(entity, "type") !== "player") throw error("ENTITY_UNVERIFIED_TYPE_MISMATCH");
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
  var publicCatalogIdentityError = (entity, raw, definitionId) => {
    if (ownData(entity, "definitionId") !== definitionId) return error("ENTITY_UNVERIFIED_DEFINITION_MISMATCH");
    if (ownData(entity, "type") !== "player") return error("ENTITY_UNVERIFIED_TYPE_MISMATCH");
    const rawId = ownData(raw, "id");
    const entityId = ownData(entity, "id");
    if (num(rawId) !== null && num(entityId) !== null && rawId !== entityId) return error("ENTITY_UNVERIFIED_ID_MISMATCH");
    return null;
  };
  function method4(object, key) {
    for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
      const d = Object.getOwnPropertyDescriptor(object, key);
      if (d) return Object.hasOwn(d, "value") ? d.value : void 0;
    }
  }
  async function createFc27MarketReadTransport(root, { maxRequests = 8, quotesOnly = false } = {}) {
    if (!valid(maxRequests, 1, PUZZLE_MARKET_READ_LIMIT) || typeof quotesOnly !== "boolean") throw error("QUERY_INVALID");
    const context = readFc27Context(root);
    const reviewed = /* @__PURE__ */ new Map();
    const bindings = /* @__PURE__ */ new Map();
    let factoryOutputValidated = false;
    const marketFactory = quotesOnly ? null : at5(root, "factories.Item");
    for (const [index, [path, expected]] of FC27_MARKET_READ_METHODS.entries()) {
      if (quotesOnly && [
        "UTItemEntityFactory.prototype.createItem",
        "factories.Item.generateItemsFromItemData",
        "UTItemDAO.prototype.searchConceptItems"
      ].includes(path)) continue;
      const binding = path === "factories.Item.generateItemsFromItemData" ? method4(marketFactory, "generateItemsFromItemData") : at5(root, path);
      const fn = path === "UTItemEntityFactory.prototype.createItem" ? unwrapFc27ItemFactory(binding) : binding;
      if (typeof fn !== "function") throw error(`METHOD_${index}_MISSING`);
      const digest = await root.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn)));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (hash !== expected && hash !== ownData(compatibleHashes, path)) {
        if (path !== "UTItemEntityFactory.prototype.createItem") throw error(`METHOD_${index}_CHANGED`);
        factoryOutputValidated = true;
        reviewed.set(path, binding);
      } else reviewed.set(path, fn);
      bindings.set(path, binding);
    }
    const Request = at5(root, "UTHttpRequest");
    const auth = at5(root, "services.Item.itemDao.authDelegate");
    const factory = marketFactory;
    const generateItems = quotesOnly ? null : reviewed.get("factories.Item.generateItemsFromItemData");
    const createItem = reviewed.get("UTItemEntityFactory.prototype.createItem");
    const identifier = ownData(auth, "identification");
    const assertRuntime = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw error("SCOPE_CHANGED");
      for (const [path, fn] of bindings) {
        const current2 = path === "factories.Item.generateItemsFromItemData" ? method4(factory, "generateItemsFromItemData") : at5(root, path);
        if (current2 !== fn) throw error("RUNTIME_CHANGED");
      }
      if (at5(root, "GAME_NAME") !== "fc27" || at5(root, "HttpRequestMethod.GET") !== "GET" || at5(root, "services.Item.itemDao.authDelegate") !== auth || !auth || !identifier || ownData(auth, "identification") !== identifier || method4(auth, "getIdentifier") !== reviewed.get("FCAuthenticationService.prototype.getIdentifier") || method4(identifier, "handleRequest") !== reviewed.get("Identification.prototype.handleRequest") || method4(identifier, "handleResponse") !== reviewed.get("Identification.prototype.handleResponse") || !quotesOnly && (at5(root, "factories.Item") !== factory || method4(factory, "createItem") !== bindings.get("UTItemEntityFactory.prototype.createItem") || method4(factory, "generateItemsFromItemData") !== bindings.get("factories.Item.generateItemsFromItemData"))) throw error("DEPENDENCIES_UNVERIFIED");
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
      let failurePhase = "request-create";
      try {
        const delay = lastRequestAt === null ? 0 : Math.max(0, 800 - (Date.now() - lastRequestAt));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        assertRuntime();
        const req = new Request(auth);
        failurePhase = "request-create";
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
        if (kind === "quotes") {
          failurePhase = "identification-request";
          reviewed.get("Identification.prototype.handleRequest").call(identifier, req);
        }
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
                if (kind === "quotes") {
                  failurePhase = "identification-response";
                  reviewed.get("Identification.prototype.handleResponse").call(identifier, req);
                }
                failurePhase = "dto";
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
        failurePhase = "dto-status";
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
        failurePhase = "payload";
        const body = ownData(dto, "response");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw error("RESPONSE_UNVERIFIED");
        const result = project3(body);
        assertRuntime();
        return result;
      } catch (caught) {
        stopped = true;
        const failure = new Error(marketReadReason(caught));
        failure.marketFailure = failureDetails2 ?? { phase: failurePhase };
        throw failure;
      } finally {
        busy = false;
      }
    }
    function materialize3(raw) {
      const definitionId = num(ownData(raw, "resourceId"), 1, Number.MAX_SAFE_INTEGER);
      if (definitionId === null || ![void 0, "player"].includes(ownData(raw, "itemType")) || ownData(raw, "count") !== void 0 || ownData(raw, "cardassetid") !== void 0) throw error("PAYLOAD_UNVERIFIED");
      const source = structuredClone(raw);
      let entity;
      try {
        const generated = generateItems.call(factory, [source]);
        if (!Array.isArray(generated) || generated.length !== 1) throw new Error("factory output");
        entity = generated[0];
      } catch {
        throw error("ENTITY_FACTORY_FAILED");
      }
      const identityError = publicCatalogIdentityError(entity, raw, definitionId);
      if (identityError) throw identityError;
      const projected = publicPlayer(entity, definitionId);
      return projected;
    }
    return Object.freeze({
      getRequestCount: () => requests,
      readCatalogPage: async (query = {}) => {
        if (quotesOnly) throw error("CATALOG_DISABLED");
        if (!query || Object.keys(query).some((k) => !["start", "count", "level", "nation", "league", "team"].includes(k)) || !valid(query.start, 0, 1e3) || !valid(query.count, 1, 50) || !["bronze", "silver", "gold"].includes(query.level) || ["nation", "league", "team"].some((k) => query[k] !== void 0 && !valid(query[k], 1, 1e9))) throw error("QUERY_INVALID");
        return request("catalog", { type: "player", sort: "asc", ...query }, (body) => {
          const raw = ownData(body, "itemData");
          if (!Array.isArray(raw) || raw.length > query.count) throw error("PAYLOAD_UNVERIFIED");
          const entries2 = raw.map(materialize3);
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
          const listings = [];
          for (const row of rows) {
            const item2 = ownData(row, "itemData");
            if (ownData(item2, "resourceId") !== query.definitionId) throw error("DEFINITION_MISMATCH");
            const tradeId = ownData(row, "tradeId");
            if (!(valid(tradeId, 1, Number.MAX_SAFE_INTEGER) || typeof tradeId === "string" && /^[1-9]\d{0,19}$/.test(tradeId)) || ids.has(String(tradeId))) throw error("AUCTION_IDENTITY_UNVERIFIED");
            ids.add(String(tradeId));
            const price2 = ownData(row, "buyNowPrice");
            if (ownData(row, "tradeState") === "active" && valid(ownData(row, "expires"), 1, 604800) && valid(price2, 150, query.maxBuy ?? MAX_PUZZLE_QUOTE_PRICE) && ownData(row, "tradeOwner") === false && ownData(item2, "untradeable") === false) {
              prices.push(price2);
              const bid = ownData(row, "currentBid"), starting = ownData(row, "startingBid");
              listings.push({
                buyNow: price2,
                expires: ownData(row, "expires"),
                currentBid: valid(bid, 0, MAX_PUZZLE_QUOTE_PRICE) ? bid : null,
                startingBid: valid(starting, 150, MAX_PUZZLE_QUOTE_PRICE) ? starting : null
              });
            }
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
            listings: listings.sort((a, b) => a.buyNow - b.buyNow || a.expires - b.expires),
            executable: false,
            marketAvailabilityVerified: false
          };
        });
      }
    });
  }

  // src/fc27/puzzle-concept-draft.js
  var same8 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var blocked6 = (reason, mismatch2 = null) => ({
    status: "blocked",
    reason,
    executable: false,
    ...typeof mismatch2 === "string" ? { mismatch: mismatch2 } : {}
  });
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
  var project2 = (item2) => Object.fromEntries(fields2.map((key) => [key, item2?.[key]]));
  var freeze4 = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze4);
      Object.freeze(value);
    }
    return value;
  };
  function assess2(input, slots, owned2, purchases) {
    const { challenge, context, policy } = input;
    if (challenge?.mechanism !== "traditional-puzzle" || challenge.slotCount !== 11 || policy?.onlyUntradeable !== true || !same8(challenge.context, context)) return blocked6("FC27_CONCEPT_SCOPE_UNVERIFIED");
    const pool = collectSafeTraditionalCandidates({
      context,
      policy,
      challenge: { ...challenge, mechanism: "traditional", requirements: [{ kind: "player-count", count: slots.filter(Boolean).length }] },
      inventory: { schema: 1, context, kind: "normalized-inventory", status: "provisional", items: owned2 }
    });
    if (pool.status !== "candidates" || pool.candidates.length !== owned2.length || owned2.some((item2) => item2.pile !== "club" || item2.state !== "free" || fields2.some((key) => item2[key] === void 0))) {
      return blocked6("FC27_CONCEPT_MATERIAL_PROTECTED");
    }
    const squad = slots.map((slot) => {
      if (!slot) return null;
      const item2 = slot.kind === "owned" ? owned2.find((item3) => item3.id === slot.id) : purchases.find((item3) => item3.definitionId === slot.definitionId);
      return item2 && { ...item2, slot: slot.slot };
    });
    if (squad.some((item2, slot) => slots[slot] && (!item2 || item2.definitionId !== slots[slot].definitionId || item2.rating !== slots[slot].rating))) return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
    for (const item2 of purchases) {
      if (item2.id !== void 0 || item2.pile !== void 0 || item2.catalogRef !== `fc27:${item2.definitionId}` || item2.type !== "player" || item2.special !== false || item2.evolution !== false || item2.cosmetic !== false || item2.concept !== false || item2.academyEnrolled !== false || ![0, 1].includes(item2.rarity) || item2.rating > policy.maxRating || item2.rating >= 75 && (item2.rating < policy.goldRange[0] || item2.rating > policy.goldRange[1]) || policy.excludedLeagueIds.includes(item2.leagueId) || ![item2.nationId, item2.leagueId, item2.teamId].every((id7) => Number.isSafeInteger(id7) && id7 > 0) || !Array.isArray(item2.positions) || !item2.positions.length || item2.positions.some((p) => !Number.isInteger(p) || p < 0 || p > 27) || !Array.isArray(item2.groups) || item2.groups.some((id7) => !Number.isSafeInteger(id7) || id7 < 0)) return blocked6("FC27_CONCEPT_CATALOG_UNVERIFIED");
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
      const owned2 = suggestion.selectedOwned.map((ref) => {
        const found = input.inventory.items.filter((item2) => item2.id === ref.id);
        return found.length === 1 ? project2(found[0]) : null;
      });
      if (owned2.some((item2) => !item2) || suggestion.purchases.some((item2) => input.inventory.items.some((owned3) => owned3.definitionId === item2.definitionId))) {
        return blocked6("FC27_CONCEPT_ITEMS_CHANGED");
      }
      const detached = structuredClone(scope(input));
      const purchases = structuredClone(suggestion.purchases);
      const validation = assess2(detached, plan.slots, owned2, purchases);
      if (validation.status !== "verified") return validation;
      return freeze4({ ...plan, kind: "puzzle-concept-draft", ...detached, owned: owned2, purchases, validation });
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
        selectedOwned: plan.slots.filter((ref) => ref?.kind === "owned").map(({ id: id7, definitionId, rating, pile, slot }) => ({ id: id7, definitionId, rating, pile, slot })),
        purchases: plan.purchases,
        purchaseCount: plan.purchaseCount
      });
      if (rebuilt.status !== "prepared" || !same8(rebuilt.slots, plan.slots) || rebuilt.estimatedCost !== plan.estimatedCost) return blocked6("FC27_CONCEPT_PLAN_UNVERIFIED", "plan");
      if (!Array.isArray(freshOwned) || freshOwned.length >= 250 || new Set(freshOwned.map((item2) => item2.id)).size !== freshOwned.length || freshOwned.some((item2) => !plan.owned.some((ref) => ref.definitionId === item2.definitionId))) return blocked6("FC27_CONCEPT_ITEMS_CHANGED", "club-shape");
      const owned2 = plan.owned.map((expected) => {
        const fresh = freshOwned.find((item2) => item2.id === expected.id);
        const actual = fresh && project2({ ...fresh, protected: fresh.protected ?? expected.protected });
        return same8(actual, expected) ? actual : null;
      });
      if (owned2.some((item2) => !item2)) return blocked6("FC27_CONCEPT_ITEMS_CHANGED", "club-identity");
      return assess2(current2, plan.slots, owned2, plan.purchases);
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
  var mismatch = (value) => typeof value === "string" && /^[a-z-]{1,40}$/.test(value) ? value : null;
  var exactError = (reason = "FC27_EXACT_ITEMS_CHANGED", detail = null) => {
    const error2 = new Error(reason);
    if (mismatch(detail)) error2.mismatch = detail;
    return error2;
  };
  var fc27ConceptPendingKey = (scope2, target = null) => `fcat-fc27-concept-pending:${scope2}${target ? `:${target.setId}:${target.challengeId}` : ""}`;
  var fc27ConceptDraftKey = (scope2, target) => {
    if (!validTarget(target)) throw new Error("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
    return `fcat-fc27-concept-draft:${scope2}:${target.setId}:${target.challengeId}`;
  };
  var keyOf2 = (scope2, target) => `fcat-fc27-concept-draft:${scope2}:${target.setId}:${target.challengeId}`;
  var indexKeyOf2 = (scope2) => `${fc27ConceptPendingKey(scope2)}:index`;
  var sameTarget = (a, b) => a?.setId === b?.setId && a?.challengeId === b?.challengeId;
  var validTarget = (target) => [target?.setId, target?.challengeId].every((id7) => Number.isSafeInteger(id7) && id7 > 0);
  var accountOf = (context) => ({ accountScope: context?.accountScope, platform: context?.platform });
  var accountMatches = (record, context) => !record?.account || record.account.accountScope === context?.accountScope && record.account.platform === context?.platform;
  var validReservationId = (value) => Number.isSafeInteger(value) && value > 0;
  async function readFc27ConceptReservation(get, scope2, target, context) {
    try {
      if (typeof get !== "function" || typeof scope2 !== "string" || !validTarget(target)) return null;
      const record = await get(fc27ConceptDraftKey(scope2, target), null);
      if (!record || record.schema !== 1 || record.scope !== scope2 || record.phase !== "saved" || record.submitted !== false || !accountMatches(record, context) || record.plan?.challenge?.setId !== target.setId || record.plan?.challenge?.id !== target.challengeId) return null;
      const refs3 = Array.isArray(record.plan?.slots) ? record.plan.slots.filter((ref) => ref?.kind === "owned" && validReservationId(ref.id) && validReservationId(ref.definitionId) && Number.isSafeInteger(ref.slot) && ref.slot >= 0 && ref.slot < 11).map((ref) => ({ id: ref.id, definitionId: ref.definitionId })) : [];
      if (!refs3.length || refs3.length > 11 || new Set(refs3.map((ref) => ref.id)).size !== refs3.length || new Set(refs3.map((ref) => ref.definitionId)).size !== refs3.length) return null;
      return refs3;
    } catch {
      return null;
    }
  }
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
      const pending2 = await readFc27ConceptPending(get, scope2, entry);
      if (pending2 !== null) return pending2;
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
    const validate2 = (plan, current2, owned2) => {
      const result = validateFc27PuzzleConceptDraft(plan, current2, owned2);
      if (result.status !== "verified") throw exactError(result.reason, result.mismatch);
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
      validate2(plan, await readCurrent(plan, { afterSave: true }), saved.owned);
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
            validate2(plan, await readCurrent(plan), fresh.items);
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
              validate2(plan, latest, fresh.items);
              boundary = true;
              const pending2 = pendingOf(target, plan.context, record.operationId);
              const targets = await get(indexKeyOf2(scope2), []);
              if (!Array.isArray(targets) || targets.some((entry) => !validTarget(entry))) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
              await store(indexKeyOf2(scope2), [...targets.filter((entry) => !sameTarget(entry, target)), target]);
              await store(fc27ConceptPendingKey(scope2, target), pending2);
              await store(keyOf2(scope2, target), record);
              assertCurrent();
              evidence(fresh, plan);
            }, { replaceBaseline });
            if (receipt?.status !== "confirmed" || !same9({ setId: receipt.setId, challengeId: receipt.challengeId }, targetOf(plan))) fail12("FC27_CONCEPT_SAVE_UNCONFIRMED");
            return readback(provider, record);
          }) ?? blocked7("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
        } catch (error2) {
          const detail = mismatch(error2?.mismatch);
          return {
            ...blocked7(reasonOf(error2)),
            ...detail ? { mismatch: detail } : {},
            status: boundary ? "recovery-required" : "blocked",
            saved: boundary ? null : false
          };
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
            const pending2 = await readFc27ConceptPending(get, scope2, target);
            const record = await get(keyOf2(scope2, target), null);
            if (!pending2 && !record) return { status: "absent" };
            if (pending2 && (pending2.setId !== target.setId || pending2.challengeId !== target.challengeId)) {
              return { ...blocked7("FC27_CONCEPT_RECOVERY_REQUIRED"), recoverySetId: pending2.setId, recoveryChallengeId: pending2.challengeId };
            }
            if (!record || record.schema !== 1 || record.scope !== scope2 || record.submitted !== false || !same9(targetOf(record.plan), target) || !["saved", "save-pending"].includes(record.phase) || typeof record.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(record.operationId) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 || record.updatedAt > now() || !same9(record.plan?.context, context) || !accountMatches(record, record.plan?.context) || pending2?.account && !accountMatches(pending2, record.plan?.context) || pending2 && pending2.operationId !== record.operationId) fail12("FC27_CONCEPT_JOURNAL_UNCONFIRMED");
            validate2(record.plan, record.plan, record.plan.owned);
            if (restartIfEmpty && !pending2 && record.phase === "saved" && (await readCurrent(record.plan)).squadEmpty === true) {
              assertCurrent();
              return { status: "reset", reason: "FC27_PUZZLE_LOCAL_SQUAD_CLEARED", ...target, saved: false, submitted: false };
            }
            assertCurrent();
            provider = await createProvider();
            try {
              return { ...await readback(provider, record), restored: true };
            } catch (error2) {
              if (error2?.message === "FC27_CONCEPT_SQUAD_CLEARED") {
                if (pending2 || record.phase === "save-pending") fail12("FC27_CONCEPT_RECOVERY_REQUIRED");
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
    const summary2 = (record) => {
      const entries2 = Array.isArray(record?.entries) ? record.entries : [];
      const acquired = entries2.filter((e) => ["bought", "move-pending", "move-rejected", "club"].includes(e.state));
      return {
        purchased: acquired.filter((e) => e.source !== "owned").length,
        reused: acquired.filter((e) => e.source === "owned").length,
        fulfilled: acquired.length,
        total: entries2.length,
        spent: acquired.reduce((sum2, e) => sum2 + (integer8(e.price) ? e.price : 0), 0)
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
            const pending2 = await get(puzzleBuyPendingKey(scope2), null);
            if (pending2 !== null && (pending2.key !== key || pending2.operationId !== draft.operationId)) fail13("FC27_BUY_RECOVERY_REQUIRED");
            record = await get(key, null);
            if (record) {
              check(record);
              if (record.operationId !== draft.operationId) {
                if (!settled(record) || pending2) fail13("FC27_BUY_RECOVERY_REQUIRED");
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
                  ...summary2(record),
                  failures: failures.map((item2) => ({ ...item2 })),
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
                    const remaining = budget - summary2(record).spent;
                    await adapter.verifyCurrent(record);
                    report("search", entry);
                    const quote2 = await adapter.find(entry.definitionId, quoteCeiling ?? Infinity);
                    if (!quote2) {
                      failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: "FC27_BUY_NO_LISTING" });
                      report("failed", entry, { reason: "FC27_BUY_NO_LISTING" });
                      continue;
                    }
                    if (quote2.unavailable) {
                      failures.push({
                        slot: entry.slot,
                        definitionId: entry.definitionId,
                        reason: quote2.reason,
                        httpStatus: quote2.httpStatus,
                        errorCode: quote2.errorCode
                      });
                      report("failed", entry, quote2);
                      continue;
                    }
                    if (quote2.definitionId !== entry.definitionId || !integer8(quote2.itemId, 1) || !integer8(quote2.price, 150) || quoteCeiling !== null && quote2.price > quoteCeiling || typeof quote2.tradeId !== "string" || !/^[1-9]\d{0,19}$/.test(quote2.tradeId)) fail13("FC27_BUY_QUOTE_UNVERIFIED");
                    report("price-ready", entry, { price: quote2.price });
                    if (quote2.price > remaining) {
                      failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: "FC27_BUY_BUDGET_EXCEEDED" });
                      report("failed", entry, { reason: "FC27_BUY_BUDGET_EXCEEDED", price: quote2.price });
                      continue;
                    }
                    assertCurrent();
                    if (shouldStop()) {
                      stopReason = "FC27_BUY_STOPPED";
                      break;
                    }
                    Object.assign(entry, quote2, { state: "buy-pending" });
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
            if (!settled(record)) return { status: "recovery-required", ...record.lastResult, ...summary2(record) };
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
              ...summary2(record),
              saved: acquired.length > 0 && record.applied.length === acquired.length,
              replacementPending: record.applied.length !== acquired.length,
              submitted: false
            };
          });
        } catch (e) {
          if (record) {
            record.lastResult = { reason: safeReason4(e), failures: record.lastResult?.failures ?? [] };
            try {
              await set(`fcat-fc27-puzzle-buy-last:${scope2}`, { target: record.target, ...record.lastResult, ...summary2(record) });
            } catch {
            }
          }
          return {
            status: record && !settled(record) ? "recovery-required" : "blocked",
            reason: safeReason4(e),
            ...record ? summary2(record) : {},
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
    const same16 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return slots.every((slot, i) => same16(slot, old[i]) || same16(slot, next[i]));
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
    let price2 = Math.min(initial, ceiling);
    const queried = /* @__PURE__ */ new Set();
    let items = [];
    while (attempts-- > 0) {
      if (price2 > ceiling || queried.has(price2)) break;
      const response = await search(price2);
      const reply = Array.isArray(response) ? { success: true, data: { items: response } } : response;
      if (!reply.success) {
        onSearchFailure(reply);
        break;
      }
      onResults();
      const page = reply.data.items;
      items = items.concat(page);
      queried.add(price2);
      if (!page.length) price2 = above(price2);
      else if (page.length === 21) price2 = below(price2);
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
  var FC27_BUY_COMPATIBLE_HASHES = Object.freeze({
    "service.bid": "3d2e79b2534121b761fec1924de8b129270b8cd41243f4a368db49a9857ff98a",
    "service.move": "5ab5e0676e5323587ff68b71815fbe031a1e26742defe782c4f2b00a7f1889ef"
  });
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
      const item2 = items[ref.slot];
      return {
        definitionId: ref.definitionId,
        rating: item2._rating,
        nationId: item2.nationId,
        teamId: item2.teamId,
        leagueId: item2.leagueId,
        preferredPosition: item2.preferredPosition
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
    verifyCurrent: verifyCurrentOverride = null,
    verifySquad: verifySquadOverride = null,
    collectionState = null,
    confirmCollection = null,
    playerDetails = null,
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
      FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash]),
      FC27_BUY_COMPATIBLE_HASHES
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
      assertTarget?.();
      if (typeof verifyCurrentOverride === "function") return verifyCurrentOverride(record);
      const page = readFc27PurchasePageSlots(root, record.target, record);
      if (!puzzleBuyMatchesSlots(record, page)) fail14("FC27_BUY_SQUAD_CHANGED");
    };
    return Object.freeze({
      async verifySquad(record) {
        currentRecord = record;
        if (typeof verifySquadOverride === "function") return verifySquadOverride(record);
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
        const item2 = playerDetails?.get?.(definitionId) ?? (playerDetails === null ? readFc27PurchasePage(root, currentRecord.target)?.items.find((card) => card?.definitionId === definitionId) : null);
        if (!item2 || typeof referencePrice !== "function") fail14("FC27_BUY_REFERENCE_PRICE_UNAVAILABLE");
        const initial = Number(await referencePrice({
          definitionId,
          rating: item2._rating,
          nationId: item2.nationId,
          teamId: item2.teamId,
          leagueId: item2.leagueId,
          preferredPosition: item2.preferredPosition
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
          above: (price2) => root.UTCurrencyInputControl.getIncrementAboveVal(price2),
          below: (price2) => root.UTCurrencyInputControl.getIncrementBelowVal(price2),
          search: async (price2) => {
            verifyCurrent(currentRecord);
            criteria.maxBuy = price2;
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
        const item2 = auctions.get(entry.tradeId);
        const auction = item2?.getAuctionData();
        if (!item2 || item2.id !== entry.itemId || item2.definitionId !== entry.definitionId || String(auction.tradeId) !== entry.tradeId || auction.buyNowPrice !== entry.price) {
          return { status: "rejected", reason: "FC27_BUY_LISTING_CHANGED" };
        }
        if (!auction.canBuy(coins())) return { status: "rejected", reason: "FC27_BUY_INSUFFICIENT_COINS" };
        if (!(auction.getSecondsRemaining() > 0)) return { status: "rejected", reason: "FC27_BUY_LISTING_CHANGED" };
        pin("Item - Detail View");
        const reply = await observe(() => {
          verifyCurrent(currentRecord);
          return service.bid(item2, entry.price);
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
        const matches2 = await club.readPage({ start: 0, count: 250, definitionIds: [entry.definitionId] });
        const found = matches2.find((item2) => item2.id === entry.itemId && item2.definitionId === entry.definitionId);
        if (found) return "club";
        root.repositories.Item.setDirty(root.ItemPile.PURCHASED);
        const reply = await observe(() => service.requestUnassignedItems());
        if (reply?.success !== true || reply.status !== 200 || !Array.isArray(reply.response?.items)) fail14("FC27_BUY_RECEIPT_UNCONFIRMED");
        const items = reply.response.items.filter((item2) => item2.id === entry.itemId && item2.definitionId === entry.definitionId);
        if (items.length !== 1) return "unknown";
        auctions.set(entry.tradeId, items[0]);
        return "purchased";
      },
      async collectionState(definitionId) {
        return typeof collectionState === "function" ? collectionState(definitionId) : false;
      },
      async confirmCollection(definitionIds) {
        return typeof confirmCollection === "function" ? confirmCollection(definitionIds) : { status: "pending", definitionIds };
      },
      async move(entry) {
        writable();
        const item2 = auctions.get(entry.tradeId);
        if (!item2 || item2.id !== entry.itemId || item2.definitionId !== entry.definitionId) fail14("FC27_BUY_MOVE_UNCONFIRMED");
        const reply = await observe(() => service.move(item2, root.ItemPile.CLUB), true);
        diagnostic("move", { definitionId: entry.definitionId, ...responseCodes(reply) });
        if (reply?.success === false) return { status: "rejected", reason: "FC27_BUY_MOVE_REJECTED", ...responseCodes(reply) };
        if (reply?.success !== true || !Array.isArray(reply.data?.itemIds) || !reply.data.itemIds.includes(entry.itemId) || item2.pile !== root.ItemPile.CLUB) fail14("FC27_BUY_MOVE_UNCONFIRMED");
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

  // src/gallery/net-cost.js
  var GALLERY_NET_COST_SCHEMA = 1;
  var GALLERY_MARKET_TAX_BPS = 500;
  var STATES = /* @__PURE__ */ new Set(["held", "listed", "sold", "unsold", "unknown"]);
  var integer9 = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
  var id4 = (value) => integer9(value, 1);
  var price = (value) => integer9(value, 150, 15e6);
  function normalizePurchase(value) {
    if (!value || !id4(value.itemId) || !id4(value.definitionId) || !price(value.purchasePrice)) return null;
    const state = STATES.has(value.state) ? value.state : "held";
    if (value.listedPrice != null && !price(value.listedPrice)) return null;
    if (state === "sold" && !price(value.soldPrice)) return null;
    if (state !== "sold" && value.soldPrice != null) return null;
    return {
      itemId: value.itemId,
      definitionId: value.definitionId,
      purchasePrice: value.purchasePrice,
      tradeId: typeof value.tradeId === "string" && /^[1-9]\d{0,19}$/.test(value.tradeId) ? value.tradeId : null,
      purchasedAt: integer9(value.purchasedAt) ? value.purchasedAt : null,
      state,
      listedPrice: price(value.listedPrice) ? value.listedPrice : null,
      soldPrice: price(value.soldPrice) ? value.soldPrice : null,
      soldAt: integer9(value.soldAt) ? value.soldAt : null,
      reason: typeof value.reason === "string" ? value.reason.slice(0, 160) : null
    };
  }
  function normalizeGalleryNetCostLedger(input = {}) {
    if (!input || typeof input !== "object" || input.schema !== GALLERY_NET_COST_SCHEMA) return null;
    const entries2 = Array.isArray(input.entries) ? input.entries.map(normalizePurchase) : [];
    if (entries2.some((entry) => !entry) || new Set(entries2.map((entry) => entry.itemId)).size !== entries2.length) return null;
    const taxBps = input.taxBps ?? GALLERY_MARKET_TAX_BPS;
    if (!integer9(taxBps, 0, 1e4)) return null;
    return {
      schema: GALLERY_NET_COST_SCHEMA,
      scope: typeof input.scope === "string" ? input.scope.slice(0, 160) : null,
      taxBps,
      entries: entries2
    };
  }
  function galleryNetSale(priceValue, taxBps = GALLERY_MARKET_TAX_BPS) {
    if (!price(priceValue) || !integer9(taxBps, 0, 1e4)) return null;
    return Math.floor(priceValue * (1e4 - taxBps) / 1e4);
  }
  function summarizeGalleryNetCost(ledger) {
    const current2 = normalizeGalleryNetCostLedger(ledger);
    if (!current2) return { status: "blocked", reason: "FC27_GALLERY_NET_COST_LEDGER_INVALID" };
    const spent = current2.entries.reduce((sum2, entry) => sum2 + entry.purchasePrice, 0);
    const sold = current2.entries.filter((entry) => entry.state === "sold" && price(entry.soldPrice));
    const grossRevenue = sold.reduce((sum2, entry) => sum2 + entry.soldPrice, 0);
    const tax = sold.reduce((sum2, entry) => sum2 + (entry.soldPrice - galleryNetSale(entry.soldPrice, current2.taxBps)), 0);
    const netRevenue = grossRevenue - tax;
    const heldCost = current2.entries.filter((entry) => entry.state !== "sold").reduce((sum2, entry) => sum2 + entry.purchasePrice, 0);
    return {
      status: "observed",
      entries: current2.entries.length,
      sold: sold.length,
      held: current2.entries.length - sold.length,
      spent,
      grossRevenue,
      tax,
      netRevenue,
      netCost: spent - netRevenue,
      heldCost,
      taxBps: current2.taxBps
    };
  }

  // src/gallery/purchase-session.js
  var same13 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var id5 = (value) => Number.isSafeInteger(value) && value > 0;
  var safeReason5 = (error2) => /^FC27_[A-Z0-9_]+$/.test(error2?.message ?? "") ? error2.message : "FC27_GALLERY_PURCHASE_UNCONFIRMED";
  var states = /* @__PURE__ */ new Set(["waiting", "buy-pending", "bought", "move-pending", "move-rejected", "club", "collected"]);
  var galleryPurchaseKey = (scope2) => `fcat-fc27-gallery-purchase:${scope2}`;
  var galleryPurchasePendingKey = (scope2) => `fcat-fc27-gallery-purchase-pending:${scope2}`;
  var pending = (record) => record.entries.some((entry) => ["buy-pending", "bought", "move-pending", "move-rejected"].includes(entry.state));
  var quote = (value, definitionId) => value?.definitionId === definitionId && id5(value.itemId) && typeof value.tradeId === "string" && /^[1-9]\d{0,19}$/.test(value.tradeId) && Number.isSafeInteger(value.price) && value.price >= 150 && value.price <= 15e6;
  var summary = (record) => {
    const entries2 = record?.entries ?? [], acquired = entries2.filter((entry) => ["bought", "move-pending", "move-rejected", "club"].includes(entry.state));
    const purchases = acquired.filter((entry) => id5(entry.itemId) && id5(entry.definitionId) && Number.isSafeInteger(entry.price)).map((entry) => ({
      itemId: entry.itemId,
      definitionId: entry.definitionId,
      tradeId: entry.tradeId,
      purchasePrice: entry.price,
      state: "held"
    }));
    const accounting = summarizeGalleryNetCost({ schema: 1, scope: record?.scope ?? null, entries: purchases });
    return {
      total: entries2.length,
      purchased: acquired.length,
      completed: entries2.filter((entry) => ["club", "collected"].includes(entry.state)).length,
      spent: acquired.reduce((sum2, entry) => sum2 + (entry.price ?? 0), 0),
      accounting
    };
  };
  var itemResults = (record) => (record?.entries ?? []).map((entry, index) => ({
    definitionId: entry.definitionId,
    name: record?.plan?.[index]?.name ?? "",
    state: entry.state,
    price: !["waiting", "collected", "buy-pending"].includes(entry.state) ? entry.price : null,
    reason: record.lastResult?.failures?.find((row) => row.definitionId === entry.definitionId)?.reason ?? null
  }));
  function validateGalleryPurchaseRecord(record, scope2, context) {
    if (!record || record.schema !== 1 || record.scope !== scope2 || !same13(record.context, context) || typeof record.operationId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(record.operationId) || typeof record.binding !== "string" || !record.binding || record.binding.length > 12e3 || record.budget != null && (!Number.isSafeInteger(record.budget) || record.budget < 0 || record.budget > 165e6) || !Array.isArray(record.plan) || !Array.isArray(record.entries) || record.plan.length < 1 || record.plan.length > 256 || record.entries.length !== record.plan.length || new Set(record.plan.map((item2) => item2.definitionId)).size !== record.plan.length || record.entries.some((entry, index) => !id5(entry.definitionId) || entry.definitionId !== record.plan[index].definitionId || !states.has(entry.state) || !["waiting", "collected"].includes(entry.state) && !quote(entry, entry.definitionId))) throw new Error("FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED");
  }
  var validate = validateGalleryPurchaseRecord;
  function createGalleryPurchaseSession({
    scope: scope2,
    context,
    get,
    set,
    exclusive,
    createAdapter,
    assertCurrent = () => {
    },
    checkOtherTransactions = async () => {
    },
    shouldStop = () => false,
    onProgress = () => {
    },
    operationId = () => `gallery-${Date.now()}-${Math.random().toString(16).slice(2)}`
  } = {}) {
    const key = galleryPurchaseKey(scope2), pendingKey = galleryPurchasePendingKey(scope2);
    const write = async (storageKey, value) => {
      await set(storageKey, structuredClone(value));
      if (!same13(await get(storageKey, null), value)) throw new Error("FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED");
    };
    return Object.freeze({
      async inspect() {
        try {
          assertCurrent();
          const record = await get(key, null);
          assertCurrent();
          if (!record) return { status: "absent" };
          validate(record, scope2, context);
          return {
            status: "observed",
            recovery: pending(record),
            remaining: record.entries.filter((entry) => entry.state === "waiting").length,
            operationId: record.operationId,
            collection: record.collection,
            results: itemResults(record),
            ...summary(record)
          };
        } catch (error2) {
          return { status: "blocked", reason: safeReason5(error2) };
        }
      },
      async execute({ items, binding, resume = false, expectedOperationId = null, budget = null, quoteCeiling = null, approved = false } = {}) {
        if (approved !== true || !resume && (!Array.isArray(items) || !items.length || items.length > 256 || typeof binding !== "string" || !binding || binding.length > 12e3) || budget !== null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 165e6) || quoteCeiling !== null && (!Number.isSafeInteger(quoteCeiling) || quoteCeiling < 150 || quoteCeiling > 15e6)) return { status: "blocked", reason: "FC27_GALLERY_PURCHASE_APPROVAL_REQUIRED" };
        let record, adapter;
        try {
          const result = await exclusive(scope2, async () => {
            assertCurrent();
            await checkOtherTransactions();
            record = await get(key, null);
            const oldPending = await get(pendingKey, null);
            assertCurrent();
            if (record) validate(record, scope2, context);
            if (oldPending && (!record || oldPending.operationId !== record.operationId)) throw new Error("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
            if (resume && (!record || expectedOperationId !== record.operationId)) throw new Error("FC27_GALLERY_PURCHASE_PLAN_CHANGED");
            const plan = resume ? record.plan : items.map((item2) => ({
              definitionId: item2.definitionId ?? item2.eaId,
              name: typeof item2.name === "string" ? item2.name.slice(0, 120) : ""
            }));
            if (resume) {
              binding = record.binding;
              budget = record.budget ?? null;
            }
            if (plan.some((item2) => !id5(item2.definitionId)) || new Set(plan.map((item2) => item2.definitionId)).size !== plan.length) throw new Error("FC27_GALLERY_PURCHASE_PLAN_CHANGED");
            const changed = record && (!same13(record.binding, binding) || !same13(record.plan, plan));
            if (changed && (oldPending || pending(record))) throw new Error("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
            if (changed) await write(`${key}:${record.operationId}`, record);
            if (!record || changed) record = {
              schema: 1,
              scope: scope2,
              context,
              operationId: operationId(),
              binding,
              budget,
              plan: structuredClone(plan),
              entries: plan.map((item2) => ({ definitionId: item2.definitionId, state: "waiting" }))
            };
            else if (!resume) record.budget = budget;
            validate(record, scope2, context);
            await write(key, record);
            adapter = await createAdapter(record);
            await adapter.verifySquad(record);
            const failures = [], save = () => write(key, record), mark = async () => {
              await write(pendingKey, { schema: 1, operationId: record.operationId });
              await save();
            };
            const report = (phase, entry, extra = {}) => {
              try {
                onProgress({
                  ...summary(record),
                  phase,
                  index: entry ? record.entries.indexOf(entry) + 1 : 0,
                  definitionId: entry?.definitionId ?? null,
                  failures: [...failures],
                  ...extra
                });
              } catch {
              }
            };
            let stopReason = null;
            for (const entry of record.entries) {
              if (entry.state === "club" || entry.state === "collected") continue;
              try {
                assertCurrent();
                await adapter.verifyCurrent(record);
                if (["buy-pending", "bought", "move-pending", "move-rejected"].includes(entry.state)) {
                  const located = await adapter.locate(entry);
                  if (located === "club") entry.state = "club";
                  else if (located === "purchased") entry.state = "bought";
                  else throw new Error("FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED");
                  await save();
                }
                if (entry.state === "waiting") {
                  if (shouldStop()) {
                    stopReason = "FC27_GALLERY_PURCHASE_STOPPED";
                    break;
                  }
                  const collectionState = await adapter.collectionState(entry.definitionId);
                  if (typeof collectionState !== "boolean") throw new Error("FC27_GALLERY_COLLECTION_UNCONFIRMED");
                  if (collectionState) {
                    entry.state = "collected";
                    await save();
                    report("already-collected", entry);
                    continue;
                  }
                  report("search", entry);
                  const found = await adapter.find(entry.definitionId, quoteCeiling ?? Infinity);
                  if (!found || found.unavailable) {
                    failures.push({ definitionId: entry.definitionId, reason: found?.reason ?? "FC27_GALLERY_NO_LISTING" });
                    report("failed", entry);
                    continue;
                  }
                  if (!quote(found, entry.definitionId) || quoteCeiling !== null && found.price > quoteCeiling) throw new Error("FC27_BUY_QUOTE_UNVERIFIED");
                  if (budget !== null && summary(record).spent + found.price > budget) {
                    failures.push({ definitionId: entry.definitionId, reason: "FC27_GALLERY_BUDGET_EXCEEDED", observedPrice: found.price });
                    report("failed", entry);
                    continue;
                  }
                  assertCurrent();
                  await adapter.verifyCurrent(record);
                  if (shouldStop()) {
                    stopReason = "FC27_GALLERY_PURCHASE_STOPPED";
                    break;
                  }
                  Object.assign(entry, found, { state: "buy-pending" });
                  await mark();
                  assertCurrent();
                  await adapter.verifyCurrent(record);
                  if (shouldStop()) {
                    const definitionId = entry.definitionId;
                    Object.keys(entry).forEach((field) => delete entry[field]);
                    Object.assign(entry, { definitionId, state: "waiting" });
                    await save();
                    stopReason = "FC27_GALLERY_PURCHASE_STOPPED";
                    break;
                  }
                  report("buying", entry);
                  const receipt = await adapter.buy(entry);
                  if (receipt?.status === "rejected") {
                    const definitionId = entry.definitionId;
                    for (const field of Object.keys(entry)) delete entry[field];
                    Object.assign(entry, { definitionId, state: "waiting" });
                    await save();
                    failures.push({ definitionId, reason: receipt.reason });
                    report("failed", entry);
                    continue;
                  }
                  if (receipt?.status !== "bought" || !quote(receipt, entry.definitionId) || receipt.itemId !== entry.itemId || receipt.tradeId !== entry.tradeId || receipt.price !== entry.price) throw new Error("FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED");
                  entry.state = "bought";
                  await save();
                  report("bought", entry);
                }
                if (entry.state === "bought") {
                  entry.state = "move-pending";
                  await mark();
                  report("moving", entry);
                  const moved = await adapter.move(entry);
                  if (moved?.status === "rejected") {
                    entry.state = "move-rejected";
                    failures.push({ definitionId: entry.definitionId, reason: moved.reason });
                    await save();
                    continue;
                  }
                  if (await adapter.locate(entry) !== "club") throw new Error("FC27_GALLERY_MOVE_UNCONFIRMED");
                  entry.state = "club";
                  await save();
                  report("completed", entry);
                }
              } catch (error2) {
                stopReason = safeReason5(error2);
                break;
              } finally {
                report("progress", entry);
                try {
                  await adapter.afterPlayer?.();
                } catch (error2) {
                  stopReason ??= safeReason5(error2);
                }
              }
              if (stopReason) break;
            }
            record.lastResult = { reason: stopReason ?? failures[0]?.reason ?? "FC27_GALLERY_PURCHASE_COMPLETED", failures };
            await save();
            if (pending(record)) return { status: "recovery-required", ...record.lastResult, results: itemResults(record), ...summary(record) };
            try {
              record.collection = await adapter.confirmCollection(record.entries.filter((entry) => ["club", "collected"].includes(entry.state)).map((entry) => entry.definitionId));
            } catch (error2) {
              record.collection = { status: "pending", reason: safeReason5(error2) };
            }
            assertCurrent();
            await save();
            if (record.collection?.status === "confirmed" || summary(record).spent === 0) await write(pendingKey, null);
            else await write(pendingKey, { schema: 1, operationId: record.operationId });
            return { status: record.entries.every((entry) => ["club", "collected"].includes(entry.state)) ? "purchased" : "partial", ...record.lastResult, results: itemResults(record), ...summary(record), collection: record.collection, submitted: false };
          });
          return result ?? { status: "blocked", reason: "FC27_GALLERY_PURCHASE_BUSY" };
        } catch (error2) {
          return { status: record && pending(record) ? "recovery-required" : "blocked", reason: safeReason5(error2), results: itemResults(record), ...summary(record) };
        } finally {
          adapter?.cancel?.();
        }
      }
    });
  }

  // src/adapters/browser/fc27-acceptance-session.js
  var blocked8 = (reason) => ({ status: "blocked", reason });
  var safeReason6 = (error2) => /^FC27_[A-Z0-9_]{1,100}$/.test(error2?.message) ? error2.message : "FC27_ACCEPTANCE_UNCONFIRMED";
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
  var puzzleReservationKey = (scope2) => `fcat-fc27-puzzle-reservations:${scope2}`;
  var validReservationId2 = (value) => Number.isSafeInteger(value) && value > 0;
  var reservationTarget = (value) => Number.isSafeInteger(value) && value > 0;
  var readPuzzleReservations = async (get, scope2) => {
    const value = await get(puzzleReservationKey(scope2), null);
    if (value === null) return { schema: 1, targets: [] };
    if (!value || value.schema !== 1 || !Array.isArray(value.targets) || value.targets.length > 100) {
      throw new Error("FC27_PUZZLE_RESERVATION_UNVERIFIED");
    }
    const targets = value.targets.map((entry) => {
      if (!reservationTarget(entry?.setId) || !reservationTarget(entry?.challengeId) || !Array.isArray(entry.itemRefs) || entry.itemRefs.length > 11 || entry.itemRefs.some((ref) => !validReservationId2(ref?.id) || !validReservationId2(ref?.definitionId))) {
        throw new Error("FC27_PUZZLE_RESERVATION_UNVERIFIED");
      }
      return {
        setId: entry.setId,
        challengeId: entry.challengeId,
        itemRefs: entry.itemRefs.map((ref) => ({ id: ref.id, definitionId: ref.definitionId }))
      };
    });
    return { schema: 1, targets };
  };
  var writePuzzleReservations = async (get, set, scope2, value) => {
    await set(puzzleReservationKey(scope2), structuredClone(value));
    if (JSON.stringify(await get(puzzleReservationKey(scope2), null)) !== JSON.stringify(value)) {
      throw new Error("FC27_PUZZLE_RESERVATION_UNVERIFIED");
    }
  };
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
  function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, gmRequest, lockManager, diagnosticLog: diagnosticLog2, liveEnabled = false }) {
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
    const reservationSnapshot = async () => {
      const value = await readPuzzleReservations(gmGetValue, scope2);
      const itemIds = /* @__PURE__ */ new Set();
      const definitionIds = /* @__PURE__ */ new Set();
      for (const target of value.targets) for (const ref of target.itemRefs) {
        itemIds.add(ref.id);
        definitionIds.add(ref.definitionId);
      }
      return { value, itemIds, definitionIds };
    };
    const readCachedChallengeIds = (setId) => {
      try {
        const repository = ownData(ownData(root, "services"), "SBC")?.repository;
        const sets2 = ownData(repository, "sets");
        const collection = ownData(sets2, "_collection") ?? sets2;
        const set = ownData(collection, String(setId));
        const challenges = ownData(set, "challenges") ?? ownData(set, "_challenges");
        const entries2 = ownData(challenges, "_collection") ?? challenges;
        if (!entries2 || typeof entries2 !== "object") return [];
        const keys2 = Object.getOwnPropertyNames(entries2).filter((key) => key !== "length");
        if (keys2.length > 50) return [];
        const ids = keys2.map((key) => ownData(entries2, key)?.id).filter((id7) => Number.isSafeInteger(id7) && id7 > 0);
        return [...new Set(ids)];
      } catch {
        return [];
      }
    };
    const migratePuzzleReservations = async (setId, challengeId) => {
      const current2 = await readPuzzleReservations(gmGetValue, scope2);
      const targets = [...current2.targets];
      let changed = false;
      for (const candidate of readCachedChallengeIds(setId)) {
        if (candidate === challengeId || targets.some((entry) => entry.setId === setId && entry.challengeId === candidate)) continue;
        const refs3 = await readFc27ConceptReservation(gmGetValue, scope2, { setId, challengeId: candidate }, context);
        if (!refs3?.length) continue;
        targets.push({ setId, challengeId: candidate, itemRefs: refs3 });
        changed = true;
      }
      if (changed) await writePuzzleReservations(gmGetValue, gmSetValue, scope2, { schema: 1, targets });
      return reservationSnapshot();
    };
    const rememberPuzzleReservations = async (target, refs3) => {
      const current2 = await readPuzzleReservations(gmGetValue, scope2);
      const safeRefs = (Array.isArray(refs3) ? refs3 : []).filter((ref) => validReservationId2(ref?.id) && validReservationId2(ref?.definitionId)).map((ref) => ({ id: ref.id, definitionId: ref.definitionId }));
      if (!safeRefs.length) return;
      const targets = current2.targets.filter((entry) => entry.setId !== target.setId || entry.challengeId !== target.challengeId);
      targets.push({ setId: target.setId, challengeId: target.challengeId, itemRefs: safeRefs.slice(0, 11) });
      await writePuzzleReservations(gmGetValue, gmSetValue, scope2, { schema: 1, targets });
    };
    const releasePuzzleReservations = async (target) => {
      const current2 = await readPuzzleReservations(gmGetValue, scope2);
      const targets = current2.targets.filter((entry) => entry.setId !== target.setId || entry.challengeId !== target.challengeId);
      if (targets.length !== current2.targets.length) await writePuzzleReservations(gmGetValue, gmSetValue, scope2, { schema: 1, targets });
    };
    const invalidate = () => {
      prepared?.adapter.cancel();
      prepared = null;
      preparedPuzzle?.adapter.cancel();
      preparedPuzzle = null;
    };
    const traditionalExclusive = (requestedScope, task) => persistence.exclusive(requestedScope, async () => {
      if (await gmGetValue(galleryPurchasePendingKey(scope2), null) !== null) throw new Error("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
      return task();
    });
    const unchanged = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error("FC27_TRANSACTION_CONTEXT_CHANGED");
    };
    const assertNoPuzzlePending = async (target) => {
      if (await gmGetValue(galleryPurchasePendingKey(scope2), null) !== null) throw new Error("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
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
        if (await gmGetValue(galleryPurchasePendingKey(scope2), null) !== null) return false;
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
        return blocked8(safeReason6(error2));
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
        const valid2 = [conceptPending?.setId, conceptPending?.challengeId].every((id7) => Number.isSafeInteger(id7) && id7 > 0);
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
          return current3.items.length === record.itemRefs.length && record.itemRefs.every((ref) => current3.items.some((item2) => item2.id === ref.id && item2.definitionId === ref.definitionId && item2.pile === ref.pile)) ? "empty" : null;
        }
        if (saved.items.length === record.itemRefs.length && record.itemRefs.every((ref) => saved.items.some((item2) => item2.id === ref.id && item2.definitionId === ref.definitionId && item2.pile === ref.pile && item2.slot === ref.slot))) {
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
      const reservations = await migratePuzzleReservations(setId, challengeId);
      if (nativeOnly && pageSnapshot?.layout?.squadEmpty === true) {
        await releasePuzzleReservations({ setId, challengeId });
        reservations.value.targets = reservations.value.targets.filter((entry) => entry.setId !== setId || entry.challengeId !== challengeId);
        reservations.itemIds.clear();
        reservations.definitionIds.clear();
        for (const entry of reservations.value.targets) for (const ref of entry.itemRefs) {
          reservations.itemIds.add(ref.id);
          reservations.definitionIds.add(ref.definitionId);
        }
      }
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
      const excludedItemIds = pageSnapshot?.layout?.squadEmpty === true ? [...reservations.itemIds] : [];
      const excludedDefinitionIds = pageSnapshot?.layout?.squadEmpty === true ? [...reservations.definitionIds] : [];
      const puzzleOptions = {
        setId,
        challengeId: candidates[0].id,
        maxRating: requestedMaxRating,
        catalog,
        layout: pageSnapshot?.layout,
        excludedItemIds,
        excludedDefinitionIds
      };
      const report = nativeOnly ? await inspectFc27PuzzlePlan(root, puzzleOptions, async (inputs) => {
        const preview = await previewFc27PuzzleSquadCooperatively({
          ...inputs,
          onProgress: (value) => progress({ ...value, stage: "planning" })
        }, { assertCurrent: () => {
          assertTarget();
          unchanged();
        } });
        privateData = { inputs, preview };
        if (inputs.squadEmpty === true && [
          "SAFE_MATERIAL_SHORTAGE",
          "FC27_PUZZLE_CONSTRAINT_SHORTAGE",
          "FC27_PUZZLE_SEARCH_LIMIT",
          "FC27_PUZZLE_NO_PLAN_FOUND"
        ].includes(preview.reason)) {
          progress("procurement");
          const purchaseSuggestion = await persistence.exclusive(scope2, () => procurement.plan(inputs, {
            quoteCeiling: purchaseSettings.quoteCeiling,
            onProgress: (value) => progress({ ...value, stage: "procurement" }),
            assertCurrent: () => {
              assertTarget();
              unchanged();
              const latest = readFc27PuzzlePageSnapshot(root, { setId, challengeId: candidates[0].id });
              if (!latest?.layout?.squadEmpty || JSON.stringify(latest.challenge.requirements) !== JSON.stringify(inputs.challenge.rawRequirements) || JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(inputs.policy)) {
                throw new Error("FC27_PUZZLE_FILL_INPUTS_CHANGED");
              }
            }
          })) ?? blocked8("FC27_EXCLUSIVE_ACCESS_UNAVAILABLE");
          for (const plan of purchaseSuggestion.plans ?? []) for (const item2 of plan.purchases) {
            const name = readFc27MarketPlayerName(root, item2.definitionId);
            if (name) item2.displayName = name;
          }
          if (purchaseSuggestion.status === "suggested" && purchaseSuggestion.plans?.length) {
            assertTarget();
            progress("validating");
            armed = true;
            try {
              const result = await conceptSession(assertTarget, purchaseSettings).save(inputs, purchaseSuggestion.plans[0]);
              privateData.conceptResult = result;
              if (result?.status === "concept-filled") {
                try {
                  await rememberPuzzleReservations(
                    { setId, challengeId: candidates[0].id },
                    purchaseSuggestion.plans[0].selectedOwned ?? []
                  );
                } catch {
                }
              }
              return { ...preview, purchaseSuggestion, status: result.status, reason: result.reason };
            } finally {
              armed = false;
            }
          }
          const marketFailure = purchaseSuggestion.status === "blocked" && /^(?:FC27_MARKET_|FC27_PURCHASE_(?:READ|QUOTE|CATALOG))/.test(purchaseSuggestion.reason ?? "");
          return { ...preview, ...marketFailure ? { status: "blocked", reason: purchaseSuggestion.reason } : {}, purchaseSuggestion };
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
        const outcome = await current2.engine.execute(result.permit);
        if (outcome?.status === "filled") {
          try {
            await rememberPuzzleReservations(
              { setId: current2.plan.challenge.setId, challengeId: current2.plan.challenge.id },
              current2.plan.selected
            );
          } catch {
          }
        }
        return outcome;
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
      const spent = acquired.reduce((sum2, e) => sum2 + e.price, 0);
      const remaining = draft.plan.slots.filter((item2) => item2?.kind === "concept" && !acquired.some((e) => e.slot === item2.slot));
      const page = readFc27PurchasePageSlots(root, target, record);
      const pending2 = record?.phase === "save-pending" || entries2.some((e) => ["buy-pending", "bought", "move-pending", "move-rejected"].includes(e.state)) || entries2.filter((e) => e.state === "club").length !== (record?.applied?.length ?? 0);
      if (!pending2 && !puzzleBuyMatchesSlots(record ?? { base: draft.plan, entries: [], applied: [] }, page)) return { status: "blocked", reason: "FC27_BUY_SQUAD_CHANGED" };
      return {
        status: "ready",
        operationId: draft.operationId,
        total: draft.plan.purchaseCount,
        remaining: remaining.length,
        spent,
        budget: spent + remaining.reduce((sum2, item2) => sum2 + (item2.observedBuyNow ?? 0), 0),
        recovery: pending2,
        completed: remaining.length === 0 && !pending2
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
        let result;
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
              if (await gmGetValue(galleryPurchasePendingKey(scope2), null) !== null) throw new Error("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
              const other = await persistence.journal.read(scope2);
              if (other && !isTerminalTraditionalJournal(other)) throw new Error("FC27_RECOVERY_REQUIRED");
              if ((await puzzlePersistence.journal.read(scope2, currentTarget))?.phase === "save-pending" || await readFc27ConceptPending(gmGetValue, scope2, currentTarget) !== null) throw new Error("FC27_CONCEPT_RECOVERY_REQUIRED");
              return readBuyDraft(currentTarget);
            },
            createAdapter: async () => {
              try {
                return await createFc27PuzzleBuyAdapter(root, {
                  assertTarget,
                  referencePrice,
                  attempts: settings.queriesNumber,
                  onEvent: (event) => {
                    if (events.length < 300) events.push(event);
                  },
                  canWrite: () => liveEnabled === true && armed && persistence.inspect().active
                });
              } catch (error2) {
                if (error2?.message === "FC27_TRANSACTION_METHOD_UNREVIEWED") {
                  events.push({
                    stage: "method-check",
                    method: error2.methodPath,
                    status: "blocked",
                    reason: error2.message,
                    observedHash: error2.observedHash
                  });
                }
                throw error2;
              }
            }
          });
          const summary2 = await inspectPurchases(target);
          const coins = root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount;
          result = await buyer.execute(target, {
            ...approval,
            budget: approval.budget ?? (Number.isSafeInteger(coins) && coins >= 0 ? Math.min(165e6, coins + summary2.spent) : null),
            quoteCeiling: settings.quoteCeiling
          });
          return result;
        } catch (error2) {
          result = blocked8(safeReason6(error2));
          throw error2;
        } finally {
          armed = false;
          invalidate();
          try {
            await gmSetValue(`fcat-fc27-buy-trace:${scope2}`, { target: { setId: target.setId, challengeId: target.challengeId }, at: Date.now(), events });
          } catch {
          }
          try {
            for (const event of events.filter((event2) => event2.stage === "method-check")) {
              await diagnosticLog2?.record?.({
                area: "puzzle",
                event: "buy-method-check",
                setId: target.setId,
                challengeId: target.challengeId,
                phase: event.stage,
                status: event.status,
                reason: event.reason,
                method: event.method,
                observedHash: event.observedHash
              });
            }
            await diagnosticLog2?.record?.({
              area: "puzzle",
              event: "buy-result",
              setId: target.setId,
              challengeId: target.challengeId,
              status: result?.status,
              reason: result?.reason,
              count: result?.purchased,
              spent: result?.spent
            });
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
        if (await gmGetValue(galleryPurchasePendingKey(scope2), null) !== null) return blocked8("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
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
        let lastCallbackStage = null;
        const progress = (update) => {
          const stage = typeof update === "string" ? update : update?.stage ?? update?.phase ?? "planning";
          const evidence = typeof update === "string" ? { stage } : { ...update, stage };
          log.stages.push({ ...evidence, at: Date.now() });
          log.stages = log.stages.slice(-40);
          try {
            if (onProgress?.wantsPuzzleProgress === true || stage !== lastCallbackStage) {
              onProgress?.(typeof update === "object" && onProgress.wantsPuzzleProgress !== true ? stage : update);
              lastCallbackStage = stage;
            }
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
          result = blocked8(safeReason6(error2));
        } finally {
          invalidate();
        }
        log.result = result;
        log.finishedAt = Date.now();
        await persistLog();
        try {
          await diagnosticLog2?.record?.({
            area: "puzzle",
            event: "solve-result",
            setId: target.setId,
            challengeId: target.challengeId,
            status: result?.status,
            reason: result?.reason,
            source: log.catalogSource,
            mismatch: result?.mismatch,
            safeCandidates: result?.plan?.safeCandidates,
            evaluations: result?.plan?.nodes,
            durationMs: log.finishedAt - log.startedAt
          });
          const purchase = result?.purchaseSuggestion, d = purchase?.diagnostics;
          if (purchase) await diagnosticLog2?.record?.({
            area: "puzzle",
            event: "procurement-result",
            setId: target.setId,
            challengeId: target.challengeId,
            status: purchase.status,
            reason: purchase.reason,
            source: d?.failureSource,
            phase: d?.stage,
            transportPhase: d?.failurePhase,
            route: d?.route,
            httpStatus: d?.httpStatus,
            requests: purchase.requests,
            catalogAttempts: d?.catalogAttempts,
            quoteAttempts: d?.quoteAttempts,
            count: d?.catalogCandidates,
            evaluations: d?.nodes,
            cached: purchase.cacheHits > 0
          });
        } catch {
        }
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
            if (exact.items.length !== plan.selected.length || !plan.selected.every((item2) => exact.items.some((current2) => current2.id === item2.id && current2.definitionId === item2.definitionId && Object.keys(item2).filter((key) => key !== "slot").every((key) => item2[key] === current2[key])))) {
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
              ratings: plan.selected.map((item2) => item2.rating),
              selected: plan.selected.map((item2) => ({ slot: item2.slot, rating: item2.rating, pile: item2.pile })),
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
  var planned = (id7, title, description, features, status = "\u89C4\u5212\u4E2D \xB7 \u5C1A\u672A\u63A5\u5165") => `
  <section id="page-${id7}" role="tabpanel" aria-labelledby="tab-${id7}" tabindex="0" hidden>
    <div class="section-heading"><div><p class="eyebrow">${title}</p><h2>${description}</h2></div><span class="badge planned">${status}</span></div>
    <div class="feature-grid">${features.map(([name, text5]) => `<article class="card"><h3>${name}</h3><p>${text5}</p></article>`).join("")}</div>
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
    .gallery-toolbar{align-items:center;margin-top:0}.gallery-toolbar #gallery-status{color:#bdcbd3;font-size:13px}.gallery-background-progress{display:block;width:100%;height:6px;margin-top:12px;accent-color:#9df3d5}.gallery-categories{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gallery-categories button{display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;min-height:126px;padding:14px;text-align:left;border-radius:10px;background:#22323d;border-color:#455a66}.gallery-categories button:hover,.gallery-categories button[aria-pressed=true]{border-color:#9df3d5;background:#273f38;color:#b3ffe3}.gallery-category-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px}.gallery-category-icons{display:flex;align-items:center;gap:3px;min-width:44px}.gallery-category-icon{width:34px;height:34px;object-fit:contain}.gallery-category-count{color:#aabac3;font-size:11px;white-space:nowrap}.gallery-category-name{display:block;margin-top:14px;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-set-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gallery-set{display:flex;flex-direction:column;padding:0;background:#22323d;border:1px solid #455a66;border-radius:10px;cursor:pointer;overflow:hidden}.gallery-set:hover{border-color:#7abfa8}.gallery-set h4{font-size:15px;margin:0}.gallery-set button{min-height:34px;padding:6px 10px}.gallery-set-title{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 12px;background:#304451;border-bottom:1px solid #455a66}.gallery-set-title h4{grid-column:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-set-title .gallery-set-icons{grid-column:1;grid-row:1}.gallery-set-title .gallery-watch{grid-column:3;grid-row:1}.gallery-set-icons{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;min-height:24px}.gallery-set-icon{width:22px;height:22px;object-fit:contain}.gallery-set-metrics{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 12px 0;color:#c1ced5;font-size:12px}.gallery-set-metrics .gallery-collected{font-weight:700;color:#b3ffe3}.gallery-set-metrics .gallery-summary{color:#d9e5ec}.gallery-grades{margin:12px 12px 0}.gallery-grade-track{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;width:100%;min-width:0}.gallery-grade-cell{display:grid;justify-items:center;gap:3px;min-width:0}.gallery-grade-diamond{display:grid;place-items:center;width:24px;height:24px;transform:rotate(45deg);border:1px solid #667681;background:#26353e;color:#c0cbd1;font-size:11px}.gallery-grade-diamond::first-letter{transform:rotate(-45deg)}.gallery-grade-diamond.is-reached{color:#17251f;background:#b1f5d7;border-color:#d4fff0}.gallery-grade-diamond.is-current{transform:rotate(45deg) scale(1.25)}.gallery-grade-bar{display:block;width:100%;height:3px;border-radius:3px;background:#52616a;overflow:hidden}.gallery-grade-bar i{display:block;height:100%;background:#9df3d5}.gallery-grade-threshold{font-size:9px;color:#aabac3;white-space:nowrap}.gallery-unknown{color:#e7dbad}.gallery-set-detail{margin-top:18px;padding:16px;background:#22323d;border:1px solid #3a4b57;border-radius:10px}.gallery-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.gallery-identity{min-width:0}.gallery-emblems,.gallery-player-logos{display:flex;gap:6px;align-items:center}.gallery-emblem{width:34px;height:34px;object-fit:contain}.gallery-overview{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:4px 10px;margin-top:14px;padding:12px;background:#304451;border-radius:8px}.gallery-big-count{font-size:25px;color:#b3ffe3}.gallery-muted{font-size:11px;color:#c1ced5}.gallery-overview .gallery-grade-track{grid-column:1/-1}.gallery-facts{margin-top:8px}.gallery-facts>summary{padding:6px 0;font-size:12px}.gallery-reward-row{display:grid;grid-template-columns:32px 72px minmax(0,1fr);gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #455a66;font-size:12px}.gallery-player-card{display:grid;grid-template-columns:72px 1fr;gap:10px;padding:10px;background:#304451;border-radius:7px;font-size:12px;min-width:0;overflow:hidden}.gallery-card-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:8px;margin-top:12px}.gallery-player-art{display:grid;place-items:center;min-height:94px;border-radius:6px;background:linear-gradient(145deg,#b1f5d7,#427e70);overflow:hidden}.gallery-player-meta{display:grid;align-content:start;gap:4px;min-width:0}.gallery-player-meta strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gallery-player-version,.gallery-player-score{color:#c1ced5;font-size:11px}.gallery-mini-emblem{width:16px;height:16px;object-fit:contain}.gallery-player-flags{display:flex;gap:4px;align-items:center}.gallery-status-icon{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;font-size:12px;font-weight:700;border:1px solid currentColor}.gallery-status-icon.is-yes{color:#b1f5d7}.gallery-status-icon.is-no{color:#aabac3}.gallery-status-icon.is-unknown{color:#e7dbad}.gallery-set-detail h3{margin-top:14px}.gallery-set-detail button{min-height:44px}.gallery-set-detail button[aria-pressed=true]{border-color:#9df3d5;color:#b3ffe3}.gallery-set-detail:empty{display:none}
    .gallery-score{margin-top:16px;padding:14px;border:1px solid #517368;border-radius:8px;overflow-wrap:anywhere}.gallery-score>strong{font-size:17px;color:#b3ffe3}.gallery-score>p{margin-top:8px}.gallery-score summary{padding:12px 0;color:#c6e8dc}.gallery-lineup,.gallery-bonuses{font-size:12px}.gallery-grade[data-reached=true]{background:#32554a;color:#b3ffe3;border:1px solid #678e7c}.gallery-first-owner-toggle{min-height:30px!important;padding:4px 8px;font-size:11px;color:#c6e8dc;border-color:#637d78}.gallery-first-owner-toggle:hover{border-color:#9df3d5;color:#b3ffe3}
    .gallery-plan{margin-top:16px;padding:14px;border:1px solid #53616b;border-radius:8px}.gallery-plan>strong{display:block;color:#b3ffe3}.gallery-plan>.row{align-items:center}.gallery-plan select{min-width:170px;width:auto}.gallery-plan-output{margin-top:8px}.gallery-plan-output details{margin-top:6px}.gallery-plan-output summary{padding:7px 0;color:#c6e8dc}.gallery-plan-output ul{margin:6px 0 0}
    .gallery-modes{display:flex;gap:0;margin:16px 0}.gallery-modes button{border-radius:0}.gallery-modes button:first-child{border-radius:5px 0 0 5px}.gallery-modes button:last-child{border-radius:0 5px 5px 0}.gallery-modes button[aria-pressed=true]{border-color:#9df3d5;color:#b3ffe3;background:#273f38}
    .gallery-joint-target{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,160px) 40px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #455a66}.gallery-joint-target>strong{overflow-wrap:anywhere}.gallery-joint-target small{grid-column:1/-1;margin-top:0}.gallery-joint-target button{padding:4px;width:40px;height:40px}.gallery-joint-controls{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:16px 0}.gallery-joint-controls label{margin:0;max-width:260px}.gallery-joint-output{overflow-wrap:anywhere}.gallery-joint-output table{width:100%;border-collapse:collapse;font-size:12px}.gallery-joint-output td,.gallery-joint-output th{text-align:left;border-bottom:1px solid #455a66;padding:8px 4px;vertical-align:top}.gallery-joint-output details{margin-top:12px}.gallery-joint-output summary{padding:8px 0}.gallery-joint-add{min-width:44px}
    .card+.card-block,.card-block{margin-top:18px}.accent{color:#8bf0c8}label{display:grid;gap:7px;margin:12px 0;font-size:13px}select{width:100%}.row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .primary{background:#b1f5d7;color:#152c22;border-color:#b1f5d7;font-weight:600}small{display:block;color:#a5b7c4;font-size:12px;margin-top:8px}.advanced{border:1px solid #3a4b57;border-radius:12px;margin-top:18px;background:#1c2a34}.advanced>summary{padding:16px 20px;font-size:14px;color:#d9e5ec}.advanced-content{padding:0 20px 20px}
    .operation-status{margin:24px 24px 0;border-top:1px solid #36444e;padding:12px 0 20px;color:#b2c1cc;font-size:12px;overflow-wrap:anywhere}.operation-status output{display:block;color:#e7dbad;margin-top:4px}
    #detail,#requirements,#squad{overflow-wrap:anywhere}#detail{margin-top:12px}#requirements:empty,#squad:empty{display:none}#requirements,#squad{margin-top:18px;padding:16px;background:#22323d;border-radius:8px}.requirement{margin-top:10px;border-top:1px solid #45535c;padding-top:10px}ul{padding-left:20px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{padding:8px;background:#304451;border-radius:4px}
    dialog{max-width:min(440px,calc(100vw - 24px));color:#edf1f4;background:#22323d;border:1px solid #617781;border-radius:10px}dialog::backdrop{background:#0009}
    @media(max-width:650px){.body{padding:16px}.module-tabs{padding:10px 16px;gap:6px}.feature-grid,.settings-grid,.gallery-set-list,.gallery-categories{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column;gap:10px}h2{font-size:20px}.card{padding:16px}.operation-status{margin:16px 16px 0}#squad ol{grid-template-columns:repeat(2,minmax(0,1fr))}.gallery-browse-nav{top:60px}.gallery-header{align-items:flex-start}.gallery-header .gallery-toolbar{margin-top:-4px}}
    .gallery-player-card{isolation:isolate}
    .gallery-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.gallery-header h2{margin:0}.gallery-header .gallery-toolbar{margin:0;align-items:center}.gallery-header .gallery-toolbar button{min-width:40px;padding-inline:10px}.gallery-source-details{margin:0 0 12px;color:#9dabb7}.gallery-source-details summary{padding:4px 0}.gallery-source-details [role=status]{margin-left:4px}.gallery-browse-nav{position:sticky;top:68px;z-index:3;display:flex;align-items:center;gap:10px;margin:0 -2px 12px;padding:8px 2px;background:#17212c;border-bottom:1px solid #36444e}.gallery-browse-nav button{width:40px;min-height:40px;padding:0;font-size:22px;line-height:1}.gallery-browse-nav strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gallery-set>.gallery-open-set{align-self:flex-end;margin:12px}.gallery-set>.gallery-unknown,.gallery-set>.badge{margin:10px 12px}.gallery-set-title{min-width:0}.gallery-set-icon{width:32px;height:42px}
    @media(min-width:651px) and (max-width:1023px){.gallery-categories,.gallery-set-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:650px){.gallery-browse-nav{top:64px}.gallery-set>.gallery-open-set{align-self:stretch}}
    .gallery-grade-letter{display:block;transform:rotate(-45deg)}
    .gallery-category-top{flex-wrap:wrap}.gallery-category-icons{margin-right:auto}.gallery-category-rewards,.gallery-reward-summary{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:100%;font-size:12px;color:#b9c8d0}.gallery-reward-token{display:inline-flex;align-items:center;gap:5px;min-width:0}.gallery-reward-token-icon{width:16px;height:16px;object-fit:contain}.gallery-reward-label{overflow-wrap:anywhere}.gallery-reward-token-value{font-variant-numeric:tabular-nums;font-weight:600}.gallery-set-metrics .gallery-reward-summary{margin-left:auto}.gallery-score-caption{font-size:11px;color:#9dabb5}.gallery-collection-flag{color:#e7dbad}.gallery-browse-tools{margin-bottom:12px}.gallery-browse-tools>summary{padding:6px 0;font-size:12px;color:#9dabb5}.gallery-categories button,.gallery-set,.gallery-set-detail{border-radius:8px}
    .gallery-grade-diamond.grade-d{border-color:#b9703f}.gallery-grade-diamond.grade-c{border-color:#a3acb6}.gallery-grade-diamond.grade-b{border-color:#d8a93f}.gallery-grade-diamond.grade-a{border-color:#33b6a6}.gallery-grade-diamond.grade-s{border-color:#9b72ff}.gallery-grade-diamond.grade-d.is-reached{background:#b9703f;color:#fff}.gallery-grade-diamond.grade-c.is-reached{background:#a3acb6;color:#17212c}.gallery-grade-diamond.grade-b.is-reached{background:#d8a93f;color:#17212c}.gallery-grade-diamond.grade-a.is-reached{background:#33b6a6;color:#17212c}.gallery-grade-diamond.grade-s.is-reached{background:#9b72ff;color:#fff}
    .gallery-player-card{grid-template-columns:184px minmax(0,1fr)}.gallery-card-list{grid-template-columns:repeat(auto-fit,minmax(min(350px,100%),1fr))}.gallery-player-art{position:relative;align-content:start;min-height:228px;background:none;overflow:visible;gap:4px;padding-inline:20px;box-sizing:border-box}.gallery-card-pricebar{display:flex;justify-content:space-between;gap:4px;width:100%;align-items:center;color:#fff;font-size:10px;font-weight:700;pointer-events:none}.gallery-card-price,.gallery-card-gallery-score{padding:2px 4px;border-radius:4px;background:#1119;white-space:nowrap}.gallery-player-art>slot{display:block;width:144px;height:200px}.gallery-player-art>slot::slotted(.gallery-native-card){width:144px;height:200px}.gallery-card-select{position:absolute;top:38px;left:4px;width:20px;height:20px;min-height:20px;margin:0;padding:0;z-index:2;accent-color:#9df3d5}.gallery-text-card{box-sizing:border-box;width:144px;min-height:200px;border:1px solid #617883;border-radius:8px;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:12px;text-align:center;color:#dae9ef;background:#273944}.gallery-text-card-rating{font-size:28px}.gallery-text-card-name{font-size:13px}.gallery-text-card-meta{font-size:11px;color:#b5c5ce}
    @media(max-width:600px){.gallery-player-card{grid-template-columns:minmax(0,1fr)}.gallery-player-art{width:184px;justify-self:center}.gallery-player-meta{justify-items:center;text-align:center}}
    .gallery-card-tools{align-items:center;position:sticky;top:116px;z-index:2;padding:8px 0;background:#22323d;border-bottom:1px solid #455a66}.gallery-card-tools input[type=search]{flex:1;min-width:130px}.gallery-card-tools select{width:auto}.gallery-card-tools .gallery-cheapest-count{width:70px}.gallery-card-page{margin-inline:auto;color:#b9c8d0;font-size:12px}.gallery-card-select{position:static!important;top:auto;left:auto;width:auto;height:auto;z-index:auto;grid-column:1/-1;justify-self:stretch;min-height:36px;padding:6px 10px;border-radius:5px;background:#202d36;border-color:#617781;color:#d9e5ec}.gallery-card-select[aria-pressed=true]{background:#b1f5d7;color:#152c22;border-color:#b1f5d7}.gallery-purchase-selection{position:sticky;bottom:0;z-index:4;align-items:center;padding:10px 0;background:#22323d;border-top:1px solid #72808a;box-shadow:0 -8px 18px #17212ccc}.gallery-selection-summary,.gallery-selection-note{color:#b9c8d0;font-size:12px}.gallery-selection-preview{margin-top:8px;color:#b3ffe3;font-size:12px}.gallery-grade-overview{display:grid;gap:4px;margin-top:8px}.gallery-grade-overview-row{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 8px;background:#304451;border-radius:4px;font-size:12px}.gallery-grade-overview-row small{margin:0}
    .gallery-browse-controls{align-items:center;margin:10px 0}.gallery-browse-controls>input{flex:1;min-width:120px;width:auto}.gallery-browse-controls>select{width:auto;max-width:100%}.gallery-followed-toggle{display:flex;align-items:center;gap:6px;margin:0}.gallery-followed-toggle input{width:18px;height:18px}.gallery-watch{min-width:36px;width:36px;height:36px;flex:0 0 auto;padding:0!important}.gallery-watch[aria-pressed=true]{color:#b3ffe3;border-color:#9df3d5}.gallery-joint-target .gallery-target-open{width:auto;grid-column:1/-1;justify-self:start;padding:4px 10px}#gallery-target-status{display:block;font-size:12px;color:#e7dbad;overflow-wrap:anywhere}
    #gallery-selection-footer{position:fixed;bottom:8px;z-index:10;padding:10px 12px;margin:0;border:1px solid #72808a;border-radius:7px}#gallery-set-detail{padding-bottom:160px}.gallery-selection-preview{margin:0}.gallery-card-select{order:3}.gallery-card-pricebar{order:0}.gallery-player-art>slot,.gallery-text-card{order:1}.gallery-grade-overview-row{overflow-wrap:anywhere}@media(max-width:650px){#gallery-set-detail{padding-bottom:210px}.gallery-card-tools{position:static}}
    .gallery-unknown,.gallery-market-comparison{white-space:normal;overflow-wrap:anywhere;word-break:break-word;max-width:100%}
  </style><div class="workbench"><details open><summary></summary>
    <nav class="module-tabs" role="tablist" aria-label="FCAT \u529F\u80FD\u6A21\u5757">${FC27_WORKBENCH_TABS.map(([id7, label], index) => `<button type="button" role="tab" id="tab-${id7}" aria-controls="page-${id7}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join("")}</nav>
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
      <section id="page-gallery" role="tabpanel" aria-labelledby="tab-gallery" tabindex="0" hidden>
        <nav id="gallery-browse-nav" class="gallery-browse-nav" aria-label="Gallery \u5BFC\u822A" hidden><button id="gallery-back" type="button" aria-label="\u8FD4\u56DE\u96C6\u5408" title="\u8FD4\u56DE\u96C6\u5408">\u2190</button><strong id="gallery-browse-title"></strong></nav>
        <div class="gallery-header"><h2>Gallery</h2><div class="row gallery-toolbar"><button id="gallery-refresh" aria-label="\u66F4\u65B0\u96C6\u5408\u76EE\u5F55" title="\u66F4\u65B0\u96C6\u5408\u76EE\u5F55">\u21BB</button><button id="gallery-sync" hidden>\u540C\u6B65\u6536\u96C6</button><button id="gallery-purchase-resume" hidden>\u6838\u5BF9\u5E76\u7EE7\u7EED\u8D2D\u4E70</button><span id="gallery-sync-time"></span></div></div>
        <progress id="gallery-background-progress" class="gallery-background-progress" hidden max="1" value="0" aria-label="Gallery \u6536\u96C6\u540C\u6B65\u8FDB\u5EA6"></progress>
        <small id="gallery-source-error" class="gallery-unknown" role="status"></small><small id="gallery-progress-note"></small>
        <details class="gallery-source-details"><summary><span id="gallery-source">\u5C1A\u672A\u540C\u6B65\u76EE\u5F55</span></summary><span id="gallery-status" role="status">\u9996\u6B21\u6253\u5F00 Gallery \u65F6\u8BFB\u53D6\u516C\u5F00\u96C6\u5408\u76EE\u5F55\u3002</span></details>
        <dialog id="gallery-sync-dialog"><div class="row"><strong>\u540C\u6B65\u6536\u96C6</strong><button id="gallery-sync-stop" aria-label="\u505C\u6B62\u540C\u6B65" title="\u505C\u6B62\u540C\u6B65">\u505C\u6B62</button></div><progress id="gallery-sync-progress" max="1" value="0" style="width:100%"></progress><output id="gallery-sync-message" role="status"></output></dialog>
        <dialog id="gallery-purchase-dialog"><div class="row"><strong>Gallery \u8D2D\u4E70</strong><button id="gallery-purchase-stop">\u505C\u6B62</button><button id="gallery-purchase-close" hidden>\u5173\u95ED</button></div><progress id="gallery-purchase-progress" max="1" value="0" style="width:100%"></progress><output id="gallery-purchase-message" role="status"></output><ul id="gallery-purchase-results" aria-live="polite"></ul></dialog>
        <div class="gallery-modes" role="group" aria-label="Gallery \u89C6\u56FE"><button id="gallery-mode-browse" aria-pressed="true">\u6536\u96C6\u8FDB\u5EA6</button><button id="gallery-mode-joint" aria-pressed="false">\u8054\u5408\u89C4\u5212 <span id="gallery-joint-count">0</span></button></div>
        <output id="gallery-target-status" aria-live="polite"></output>
        <div id="gallery-browse">
        <div id="gallery-summary"><div id="gallery-categories" class="gallery-categories"></div></div>
        <section id="gallery-sets" hidden><h3 id="gallery-category-title" hidden>\u96C6\u5408</h3><details class="gallery-browse-tools"><summary>\u641C\u7D22\u4E0E\u6392\u5E8F</summary><div class="row gallery-browse-controls"><input id="gallery-search" type="search" placeholder="\u641C\u7D22\u96C6\u5408" aria-label="\u641C\u7D22\u96C6\u5408" maxlength="200"><select id="gallery-sort" aria-label="\u96C6\u5408\u6392\u5E8F"><option value="catalog">\u76EE\u5F55\u987A\u5E8F</option><option value="name">\u540D\u79F0</option><option value="cards">\u6240\u9700\u5361\u6570</option><option value="progress">\u5DF2\u540C\u6B65\u6536\u96C6\u8FDB\u5EA6</option></select><label class="gallery-followed-toggle"><input id="gallery-followed" type="checkbox">\u5173\u6CE8</label></div></details><div id="gallery-set-list" class="gallery-set-list"></div></section>
        <section id="gallery-set-detail" class="gallery-set-detail" aria-live="polite" hidden></section>
        </div>
        <div id="gallery-selection-footer" class="row gallery-purchase-selection" hidden></div>
        <section id="gallery-joint" hidden><h3>\u8054\u5408\u76EE\u6807</h3><div id="gallery-joint-targets"></div><div class="gallery-joint-controls"><label>\u603B\u9884\u7B97\uFF08\u91D1\u5E01\uFF09<input id="gallery-joint-budget" type="number" min="0" step="1" placeholder="\u4E0D\u9650"></label><button id="gallery-joint-plan" class="primary" disabled>\u751F\u6210\u8054\u5408\u65B9\u6848</button></div><div id="gallery-joint-output" class="gallery-joint-output" aria-live="polite"></div></section>
      </section>
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
        <div id="gallery-proxy-card" class="card"><h3>Gallery \u7F51\u7EDC</h3><label>FUT.GG HTTPS \u8F6C\u53D1\u4EE3\u7406<input id="gallery-proxy" type="url" placeholder="https://proxy.example/" autocomplete="off"><small>\u7528\u4E8E FUT.GG \u76F4\u8FDE\u53D7\u9650\u65F6\u7684 Gallery \u76EE\u5F55\u548C\u5361\u6C60\u8BFB\u53D6\u3002\u8FD9\u91CC\u9700\u8981 HTTPS \u8F6C\u53D1\u7AEF\u70B9\uFF1B127.0.0.1:1080 \u8FD9\u7C7B SOCKS/\u6D4F\u89C8\u5668\u4EE3\u7406\u8BF7\u5728\u4E13\u7528\u6D4F\u89C8\u5668\u6216\u7CFB\u7EDF\u5C42\u914D\u7F6E\uFF0C\u4E0D\u80FD\u76F4\u63A5\u586B\u5165\u3002</small></label><div class="row"><button id="gallery-proxy-save" class="primary">\u4FDD\u5B58\u4EE3\u7406</button><button id="gallery-proxy-clear">\u6E05\u9664\u4EE3\u7406</button></div></div>
        <div id="diagnostic-export-card" class="card"><h3>\u79BB\u7EBF\u8BCA\u65AD</h3><p>\u5BFC\u51FA\u6700\u8FD1\u7684\u8131\u654F\u8FD0\u884C\u4E8B\u4EF6\uFF0C\u7528\u4E8E\u79BB\u7EBF\u8C03\u67E5 Gallery \u56DE\u9000\u3001\u9650\u6D41\u548C\u7F51\u7EDC\u9519\u8BEF\u3002</p><small>\u4E0D\u5305\u542B URL\u3001\u54CD\u5E94\u6B63\u6587\u3001\u51ED\u8BC1\u3001\u8D26\u53F7\u6807\u8BC6\u6216\u5B8C\u6574\u7403\u5458\u6570\u636E\u3002</small><div class="row"><button id="export-diagnostics" class="primary">\u5BFC\u51FA\u8BCA\u65AD\u65E5\u5FD7</button></div><output id="diagnostic-export-status" aria-live="polite"></output></div>
        <div class="card"><h3>\u5B89\u88C5\u4E0E\u591A\u6807\u7B7E\u68C0\u67E5</h3><p>\u4EC5\u5728\u9700\u8981\u6392\u67E5\u5B58\u50A8\u6216\u591A\u6807\u7B7E\u5360\u7528\u95EE\u9898\u65F6\u8FD0\u884C\u3002</p><div class="row"><button id="gm">\u68C0\u67E5\u811A\u672C\u5B58\u50A8</button><button id="hold">\u68C0\u67E5\u6807\u7B7E\u9501</button></div></div></div>
      </section>
    </div><div class="operation-status" aria-live="polite">\u6700\u8FD1\u4E00\u6B21\u5DE5\u4F5C\u53F0\u64CD\u4F5C<output id="status">\u5C1A\u65E0\u64CD\u4F5C</output></div>
  </details></div><dialog id="action-approval-dialog"><p id="approval"></p><div class="row"><button id="cancel">\u53D6\u6D88</button><button id="confirm">\u786E\u8BA4</button></div></dialog>`;
  }
  function bindFc27WorkbenchTabs(shadow, host, onSelect = () => {
  }) {
    const tabs = FC27_WORKBENCH_TABS.map(([id7]) => shadow.getElementById(`tab-${id7}`));
    const select = (id7) => {
      if (!FC27_WORKBENCH_TABS.some(([key]) => key === id7)) return;
      for (const [key] of FC27_WORKBENCH_TABS) {
        const active = key === id7;
        const tab = shadow.getElementById(`tab-${key}`);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        shadow.getElementById(`page-${key}`).hidden = !active;
      }
      host.dataset.activeTab = id7;
      onSelect(id7);
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

  // src/gallery/catalog.js
  var GALLERY_GRADES = Object.freeze(["D", "C", "B", "A", "S"]);
  var invalid = () => {
    throw new Error("FC27_GALLERY_CATALOG_INVALID");
  };
  var integer10 = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  var text2 = (value, max = 500) => typeof value === "string" && value.length > 0 && value.length <= max;
  var slug = (value) => text2(value, 160) && /^[a-z0-9][a-z0-9-]*$/.test(value);
  var list = (value, max, nonempty = false) => {
    if (!Array.isArray(value) || value.length > max || nonempty && !value.length) invalid();
    return Array.from(value);
  };
  var unique = (values6) => {
    if (new Set(values6).size !== values6.length) invalid();
  };
  var freeze5 = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze5);
      Object.freeze(value);
    }
    return value;
  };
  var pick2 = (value, keys2) => Object.fromEntries(keys2.filter((key) => value?.[key] !== void 0).map((key) => [key, value[key]]));
  function definition(value, depth = 0) {
    if (depth > 8) invalid();
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.length <= 2e3) return value;
    if (Array.isArray(value)) return list(value, 256).map((row) => definition(row, depth + 1));
    if (!value || typeof value !== "object" || Object.keys(value).length > 40) return invalid();
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, definition(value[key], depth + 1)]));
  }
  function galleryCanonical(value) {
    if (Array.isArray(value)) return `[${value.map(galleryCanonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${galleryCanonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function galleryCatalogRevision(catalog) {
    const value = galleryCanonical(pick2(catalog, ["schema", "season", "source", "categories", "tags"]));
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
    return `g1-${hash.toString(16).padStart(8, "0")}-${value.length}`;
  }
  function grades(rows, source) {
    const result = list(rows, 5, true).map((row) => {
      if (!row) invalid();
      const name = source === "futgg" ? row.name : row.grade;
      const threshold = source === "futgg" ? row.threshold : row.score;
      if (!GALLERY_GRADES.includes(name) || !integer10(threshold)) invalid();
      let rewards2;
      if (source === "futgg") rewards2 = list(row.rewards, 32).map((reward) => {
        if (!text2(reward?.type, 100) || !text2(reward.label) || !integer10(reward.value) || !integer10(reward.count, 1)) invalid();
        return definition(pick2(reward, ["id", "type", "count", "label", "value", "assetId", "itemType", "teamEaId", "resourceId", "untradeable", "itemCategory"]));
      });
      else {
        if (!integer10(row.tokens)) invalid();
        rewards2 = row.tokens ? [{ type: "event_token_1", count: 1, value: row.tokens, label: `${row.tokens} Gallery Tokens` }] : [];
      }
      return { name, threshold, rewards: rewards2, rewardsComplete: source === "futgg" };
    }).sort((a, b) => GALLERY_GRADES.indexOf(a.name) - GALLERY_GRADES.indexOf(b.name));
    unique(result.map((row) => row.name));
    if (result.length !== 5 || result.some((row, i) => i > 0 && row.threshold < result[i - 1].threshold)) invalid();
    return result;
  }
  function normalizeGalleryCatalog(source, input, season = "27") {
    if (!["futgg", "fodder"].includes(source) || season !== "27") invalid();
    const data = source === "futgg" ? input?.data : input;
    if (!data || source === "futgg" && (data.game !== `fc${season}` || data.schemaVersion !== 1) || source === "fodder" && data.engine?.version !== 1) invalid();
    if (data.isTruncated === true || data.complete === false) invalid();
    const categoryIds = [], setIds = [];
    const categories = list(data.categories, 256, true).map((category) => {
      if (!text2(category?.name) || !slug(category.slug) || category.isTruncated === true || source === "futgg" && !integer10(category.id, 1)) invalid();
      const id7 = `${source}:${source === "futgg" ? category.id : category.slug}`;
      categoryIds.push(id7);
      const sets2 = list(category.sets, 4096).map((set) => {
        if (!text2(set?.name) || !slug(set.slug) || source === "futgg" && (!integer10(set.id, 1) || set.categoryId !== category.id)) invalid();
        const requiredCards = source === "futgg" ? set.requiredCards : set.required;
        if (!integer10(requiredCards, 1)) invalid();
        const setId = `${source}:${source === "futgg" ? set.id : `${category.slug}/${set.slug}`}`;
        setIds.push(setId);
        let conditions = null;
        if (source === "fodder") {
          for (const key of ["clubs", "leagues", "rareflags"]) {
            const values6 = list(set[key], 256);
            if (!values6.every((value) => integer10(value))) invalid();
            unique(values6);
          }
          if (typeof set.holo !== "boolean") invalid();
          conditions = definition(pick2(set, ["clubs", "leagues", "rareflags", "holo"]));
        }
        const description = set.description ?? null;
        if (description !== null && (typeof description !== "string" || description.length > 2e3)) invalid();
        return {
          id: setId,
          categoryId: id7,
          name: set.name,
          slug: set.slug,
          requiredCards,
          description,
          conditions,
          grades: grades(set.grades, source)
        };
      }).sort((a, b) => a.id.localeCompare(b.id));
      unique(sets2.map((set) => set.slug));
      return { id: id7, name: category.name, slug: category.slug, sets: sets2 };
    }).sort((a, b) => a.id.localeCompare(b.id));
    unique(categoryIds);
    unique(setIds);
    unique(categories.map((category) => category.slug));
    if (!setIds.length || setIds.length > 1e4) invalid();
    const tags = list(data.tags, 256).map((tag) => {
      if (!integer10(tag?.id, 1) || !text2(tag.name)) invalid();
      return definition(pick2(tag, source === "futgg" ? ["id", "name", "rules", "tiers", "bonusType", "thresholdType", "description"] : ["id", "name", "steps", "match"]));
    }).sort((a, b) => a.id - b.id);
    unique(tags.map((tag) => tag.id));
    const capturedAt = source === "futgg" ? data.capturedAt ?? null : null;
    if (capturedAt !== null && (typeof capturedAt !== "string" || !Number.isFinite(Date.parse(capturedAt)))) invalid();
    const catalog = {
      schema: 1,
      source,
      season,
      seasonEvidence: source === "futgg" ? "response-game" : "fc27-reviewed-endpoint",
      capturedAt,
      categories,
      tags
    };
    return freeze5({ ...catalog, revision: galleryCatalogRevision(catalog) });
  }
  function galleryCachePayload(catalog) {
    const futgg = catalog.source === "futgg";
    const categories = catalog.categories.map((category) => ({
      name: category.name,
      slug: category.slug,
      ...futgg ? { id: Number(category.id.split(":")[1]) } : {},
      sets: category.sets.map((set) => ({
        name: set.name,
        slug: set.slug,
        ...futgg ? {
          id: Number(set.id.split(":")[1]),
          categoryId: Number(category.id.split(":")[1]),
          requiredCards: set.requiredCards,
          description: set.description
        } : { required: set.requiredCards, ...set.conditions },
        grades: set.grades.map((grade) => futgg ? { name: grade.name, threshold: grade.threshold, rewards: grade.rewards } : { grade: grade.name, score: grade.threshold, tokens: grade.rewards.reduce((sum2, r) => sum2 + r.count * r.value, 0) })
      }))
    }));
    return futgg ? { data: { game: `fc${catalog.season}`, schemaVersion: 1, capturedAt: catalog.capturedAt, categories, tags: catalog.tags } } : { engine: { version: 1 }, categories, tags: catalog.tags };
  }
  function diffGalleryCatalog(previous, current2) {
    const result = {
      comparable: !!previous && previous.source === current2.source && previous.season === current2.season,
      added: [],
      removed: [],
      renamed: [],
      requirements: [],
      rewards: [],
      categoriesChanged: false,
      tagsChanged: false
    };
    if (!result.comparable) return result;
    const before = new Map(previous.categories.flatMap((category) => category.sets).map((set) => [set.id, set]));
    const after = new Map(current2.categories.flatMap((category) => category.sets).map((set) => [set.id, set]));
    const different = (a, b) => galleryCanonical(a) !== galleryCanonical(b);
    for (const [id7, set] of after) {
      const old = before.get(id7);
      if (!old) {
        result.added.push(id7);
        continue;
      }
      if (different([old.name, old.slug], [set.name, set.slug])) result.renamed.push(id7);
      const rules = (row) => [row.categoryId, row.requiredCards, row.description, row.conditions, row.grades.map((g) => [g.name, g.threshold])];
      if (different(rules(old), rules(set))) result.requirements.push(id7);
      if (different(old.grades.map((g) => g.rewards), set.grades.map((g) => g.rewards))) result.rewards.push(id7);
    }
    for (const id7 of before.keys()) if (!after.has(id7)) result.removed.push(id7);
    result.categoriesChanged = different(previous.categories.map((c) => [c.id, c.name, c.slug]), current2.categories.map((c) => [c.id, c.name, c.slug]));
    result.tagsChanged = different(previous.tags, current2.tags);
    return result;
  }

  // src/gallery/pool.js
  var fail15 = () => {
    throw new Error("FC27_GALLERY_POOL_INVALID");
  };
  var GALLERY_TOP_CANDIDATE_LIMIT = 100;
  var integer11 = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
  var text3 = (value, max = 500) => typeof value === "string" && value.length > 0 && value.length <= max;
  var optionalText = (value, max = 1e3) => value == null ? null : text3(value, max) ? value : fail15();
  var bool = (value) => typeof value === "boolean" ? value : null;
  function item(row, index) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail15();
    const eaId = row.eaId;
    const playerEaId = row.playerEaId;
    if (!integer11(eaId, 1) || !integer11(playerEaId, 1) || !integer11(row.score, 0, 1e8) || !integer11(row.overall, 1, 99) || !integer11(row.clubEaId, 0, 1e8) || !integer11(row.leagueEaId, 0, 1e8) || !integer11(row.nationEaId, 0, 1e8) || !integer11(row.rarityEaId, 0, 1e8) || !text3(row.cardName, 200) || !text3(row.rarityName, 200) || !Array.isArray(row.positions) || row.positions.length > 32 || row.positions.some((position) => !text3(position, 30))) fail15();
    return Object.freeze({
      eaId,
      playerEaId,
      score: row.score,
      overall: row.overall,
      gender: integer11(row.gender, 0, 10) ? row.gender : null,
      clubEaId: row.clubEaId,
      leagueEaId: row.leagueEaId,
      nationEaId: row.nationEaId,
      rarityEaId: row.rarityEaId,
      positions: Object.freeze([...row.positions]),
      weakFoot: integer11(row.weakFoot, 0, 10) ? row.weakFoot : null,
      skillMoves: integer11(row.skillMoves, 0, 10) ? row.skillMoves : null,
      holographic: bool(row.holographic),
      cardName: row.cardName,
      commonName: optionalText(row.commonName, 200),
      rarityName: row.rarityName,
      cardImageUrl: optionalText(row.cardImageUrl),
      simpleCardImageUrl: optionalText(row.simpleCardImageUrl),
      url: optionalText(row.url),
      index
    });
  }
  function normalizeGalleryPool(source, input, setId, season = "27") {
    if (source !== "futgg" || season !== "27" || !integer11(setId, 1)) fail15();
    const data = input?.data ?? input;
    if (!data || data.schemaVersion !== 1 || data.game !== `fc${season}` || data.setId !== setId || !integer11(data.requiredCards, 1) || !integer11(data.poolSize, 0, 1e5) || typeof data.isTruncated !== "boolean" || !Array.isArray(data.items) || data.items.length > 1e5 || data.items.length > data.poolSize || data.isTruncated === false && data.poolSize !== data.items.length || data.isTruncated === true && data.poolSize <= data.items.length) fail15();
    const rawItems = data.items.map(item);
    if (data.isTruncated && rawItems.some((row, index) => index > 0 && row.score > rawItems[index - 1].score)) fail15();
    const sourceIds = rawItems.map((row) => row.eaId);
    if (new Set(sourceIds).size !== sourceIds.length) fail15();
    const candidateOnly = data.isTruncated === true;
    const items = candidateOnly ? rawItems.slice(0, GALLERY_TOP_CANDIDATE_LIMIT) : rawItems;
    if (candidateOnly && items.length < data.requiredCards) fail15();
    const generatedAt = data.generatedAt == null ? null : data.generatedAt;
    if (generatedAt !== null && (typeof generatedAt !== "string" || !Number.isFinite(Date.parse(generatedAt)))) fail15();
    const pool = {
      schema: 1,
      source,
      season,
      setId,
      requiredCards: data.requiredCards,
      poolSize: data.poolSize,
      generatedAt,
      complete: !candidateOnly,
      candidateOnly,
      candidateLimit: candidateOnly ? items.length : null,
      items: Object.freeze(items)
    };
    const content = galleryCanonical({ ...pool, generatedAt: null });
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
    return Object.freeze({ ...pool, revision: `p1-${hash.toString(16)}-${content.length}` });
  }
  function galleryPoolCachePayload(pool) {
    return { data: {
      schemaVersion: 1,
      game: `fc${pool.season}`,
      setId: pool.setId,
      requiredCards: pool.requiredCards,
      poolSize: pool.poolSize,
      generatedAt: pool.generatedAt,
      isTruncated: !pool.complete,
      items: pool.items.map(({ index, ...row }) => row)
    } };
  }

  // src/gallery/prices.js
  var validId3 = (value) => Number.isSafeInteger(value) && value > 0;
  function parseGalleryPriceResponse(input) {
    let response = input;
    if (typeof input === "string") {
      try {
        response = JSON.parse(input);
      } catch {
        return Object.freeze({});
      }
    }
    const result = /* @__PURE__ */ Object.create(null);
    for (const entry of Array.isArray(response?.data) ? response.data : []) {
      const id7 = Number(entry?.eaId ?? entry?.definitionId), price2 = Number(entry?.price);
      if (validId3(id7) && Number.isSafeInteger(price2) && price2 > 0) result[String(id7)] = price2;
    }
    return Object.freeze(result);
  }
  function readCachedGalleryPrices(root, ids = []) {
    const data = root?.info?.roster?.data;
    const result = /* @__PURE__ */ Object.create(null);
    if (!data || typeof data !== "object") return result;
    for (const rawId of ids) {
      const id7 = Number(rawId);
      if (!validId3(id7)) continue;
      const entry = data[String(id7)] ?? data[id7];
      const value = Number(entry?.n);
      if (Number.isSafeInteger(value) && value > 0) result[String(id7)] = value;
    }
    return result;
  }
  function readCachedGalleryPrice(root, id7) {
    return readCachedGalleryPrices(root, [id7])[String(id7)] ?? null;
  }

  // src/adapters/browser/fc27-gallery-catalog.js
  var FC27_GALLERY_URLS = Object.freeze({
    futgg: "https://www.fut.gg/api/fut/gallery/fc27/",
    fodder: "https://fodder.gg/api/gallery"
  });
  var FUTGG_POOL_URL = (setId) => `https://www.fut.gg/api/fut/gallery/fc27/sets/${setId}/pool/`;
  var FUTGG_PRICE_URL = (ids, platform) => `https://www.fut.gg/api/fut/player-prices/27/?ids=${ids.join(",")}&platform=${platform}`;
  var FUTGG_PRICE_SIGN_URL = "https://www.fut.gg/api/fut/price-access/sign/";
  var FUTGG_PRICE_BATCH_SIZE = 50;
  var GALLERY_TTL_MS = 5 * 60 * 1e3;
  var validScope = (value) => typeof value === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
  var validator = (value) => typeof value === "string" && value.length <= 300 && !/[\r\n]/.test(value) ? value : null;
  function normalizeFc27GalleryProxy(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("FC27_GALLERY_PROXY_INVALID");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      throw new Error("FC27_GALLERY_PROXY_INVALID");
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  }
  function buildFutGgProxyUrl(proxy, targetUrl) {
    const normalized = normalizeFc27GalleryProxy(proxy);
    if (!normalized) return targetUrl;
    const target = new URL(targetUrl);
    const basePath = "/api/fut/";
    if (!target.pathname.startsWith(basePath)) throw new Error("FC27_GALLERY_PROXY_TARGET_INVALID");
    const relativePath = target.pathname.slice(basePath.length) + target.search;
    const separator = normalized.includes("?") ? /[?&]$/.test(normalized) ? "" : "&" : "?";
    return `${normalized}${separator}futggapi=${relativePath}`;
  }
  function createFc27GalleryTransport(gmRequest, { getProxy = null, proxy = "", diagnosticLog: diagnosticLog2 = null } = {}) {
    const record = (fields4) => {
      try {
        Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", event: "transport-request", ...fields4 })).catch(() => void 0);
      } catch {
      }
    };
    const readProxy = () => typeof getProxy === "function" ? getProxy() : proxy;
    const resolveUrl = (url) => {
      try {
        return url.includes("www.fut.gg") ? buildFutGgProxyUrl(readProxy(), url) : url;
      } catch (error2) {
        throw error2;
      }
    };
    const parseResponseHeaders = (response) => {
      const parsed = {};
      for (const line of String(response.responseHeaders ?? "").split(/\r?\n/)) {
        const index = line.indexOf(":");
        const key = line.slice(0, index).trim().toLowerCase();
        if (index > 0 && ["etag", "last-modified", "retry-after", "cache-control"].includes(key)) parsed[key] = line.slice(index + 1).trim();
      }
      return parsed;
    };
    const request = (url, headers = {}, phase = "catalog", source = "futgg") => new Promise((resolve, reject) => {
      let route = "direct";
      const fail19 = (reason) => {
        record({ source, phase, route, status: "failed", reason });
        reject(new Error(reason));
      };
      if (typeof gmRequest !== "function") {
        fail19("FC27_GALLERY_TRANSPORT_UNAVAILABLE");
        return;
      }
      let requestUrl;
      try {
        requestUrl = resolveUrl(url);
      } catch (error2) {
        fail19(error2.message);
        return;
      }
      route = requestUrl === url ? "direct" : "forwarding";
      record({ source, phase, route, status: "started" });
      const conditional = Object.fromEntries(["If-None-Match", "If-Modified-Since"].filter((key) => validator(headers[key])).map((key) => [key, headers[key]]));
      gmRequest({
        method: "GET",
        url: requestUrl,
        anonymous: true,
        timeout: 15e3,
        headers: conditional,
        onload: (response) => {
          const parsed = parseResponseHeaders(response);
          if (response.finalUrl && response.finalUrl !== requestUrl) {
            fail19("FC27_GALLERY_REDIRECT");
            return;
          }
          record({ source, phase, route, status: "received", httpStatus: response.status });
          resolve({ status: response.status, text: response.responseText, headers: parsed });
        },
        onerror: () => fail19("FC27_GALLERY_NETWORK_FAILED"),
        ontimeout: () => fail19("FC27_GALLERY_TIMEOUT")
      });
    });
    const postJson = (url, payload) => new Promise((resolve, reject) => {
      let route = "direct";
      const fail19 = (reason) => {
        record({ source: "futgg", phase: "price-sign", route, status: "failed", reason });
        reject(new Error(reason));
      };
      if (typeof gmRequest !== "function") {
        fail19("FC27_GALLERY_TRANSPORT_UNAVAILABLE");
        return;
      }
      let requestUrl;
      try {
        requestUrl = resolveUrl(url);
      } catch (error2) {
        fail19(error2.message);
        return;
      }
      route = requestUrl === url ? "direct" : "forwarding";
      record({ source: "futgg", phase: "price-sign", route, status: "started" });
      gmRequest({
        method: "POST",
        url: requestUrl,
        anonymous: true,
        timeout: 15e3,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        data: JSON.stringify(payload),
        onload: (response) => {
          if (response.finalUrl && response.finalUrl !== requestUrl) {
            fail19("FC27_GALLERY_REDIRECT");
            return;
          }
          record({ source: "futgg", phase: "price-sign", route, status: "received", httpStatus: response.status });
          resolve({ status: response.status, text: response.responseText, headers: parseResponseHeaders(response) });
        },
        onerror: () => fail19("FC27_GALLERY_NETWORK_FAILED"),
        ontimeout: () => fail19("FC27_GALLERY_TIMEOUT")
      });
    });
    return Object.freeze({
      get: (source, headers = {}) => {
        if (!Object.hasOwn(FC27_GALLERY_URLS, source)) return Promise.reject(new Error("FC27_GALLERY_TRANSPORT_UNAVAILABLE"));
        return request(FC27_GALLERY_URLS[source], headers, "catalog", source);
      },
      getPool: (setId, headers = {}) => {
        if (!Number.isSafeInteger(setId) || setId < 1 || setId > 1e6) {
          return Promise.reject(new Error("FC27_GALLERY_POOL_ID_INVALID"));
        }
        return request(FUTGG_POOL_URL(setId), headers, "pool");
      },
      getPrices: async (ids, { platform = "pc" } = {}) => {
        const values6 = [...new Set((ids ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
        if (!values6.length || values6.length > FUTGG_PRICE_BATCH_SIZE || !["pc", "console"].includes(platform)) {
          return Promise.reject(new Error("FC27_GALLERY_PRICE_IDS_INVALID"));
        }
        const target = new URL(FUTGG_PRICE_URL(values6, platform === "console" ? "ps5" : platform));
        const relative = `${target.pathname}${target.search}`;
        const signed = await postJson(FUTGG_PRICE_SIGN_URL, { url: relative });
        if (signed.status !== 200) return signed;
        let payload;
        try {
          payload = JSON.parse(signed.text);
        } catch {
          throw new Error("FC27_GALLERY_PRICE_SIGN_INVALID");
        }
        const signedPath = payload?.data?.url;
        if (typeof signedPath !== "string" || !signedPath.startsWith("/api/fut/player-prices/27/")) {
          throw new Error("FC27_GALLERY_PRICE_SIGN_INVALID");
        }
        return request(new URL(signedPath, "https://www.fut.gg").href, {}, "price-read");
      }
    });
  }
  function createFc27GalleryCatalogProvider({
    http,
    gmGetValue,
    gmSetValue,
    scope: scope2 = "public",
    season = "27",
    now = () => Date.now(),
    ttlMs = GALLERY_TTL_MS,
    diagnosticLog: diagnosticLog2 = null
  } = {}) {
    if (typeof http?.get !== "function" || !validScope(scope2) || season !== "27" || !Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError("FC27_GALLERY_PROVIDER_INVALID");
    const cacheKey = `fcat-fc27-gallery-catalog:${season}:${scope2}`;
    const poolCacheKey = `fcat-fc27-gallery-pools:${season}:${scope2}`;
    const entries2 = /* @__PURE__ */ new Map();
    let active = null;
    let inFlight = null;
    let reading = null;
    let lastSourceErrors = Object.freeze({});
    const pools = /* @__PURE__ */ new Map();
    let poolsReading = null;
    let poolsWriting = Promise.resolve();
    const poolInFlight = /* @__PURE__ */ new Map();
    const poolRetryAt = /* @__PURE__ */ new Map();
    const priceInFlight = /* @__PURE__ */ new Map();
    const priceMemory = /* @__PURE__ */ new Map();
    const priceErrors = /* @__PURE__ */ new Map();
    const retryAt = /* @__PURE__ */ new Map();
    const record = (event, fields4 = {}) => {
      try {
        const result = diagnosticLog2?.record?.({ area: "gallery", event, ...fields4 });
        if (result && typeof result.catch === "function") result.catch(() => void 0);
      } catch {
      }
    };
    const statusCode = (reason) => {
      const match = /^HTTP (\d{3})$/.exec(String(reason ?? ""));
      return match ? Number(match[1]) : void 0;
    };
    const safeReason8 = (error2) => /^(HTTP \d{3}|FC27_GALLERY_[A-Z_]+)$/.test(error2?.message) ? error2.message : "request-failed";
    const observe = (entry, reason, extra = {}) => ({
      status: "observed",
      reason,
      source: entry.source,
      catalog: entry.catalog,
      fetchedAt: entry.fetchedAt,
      revision: entry.catalog.revision,
      fallback: entry.source === "fodder",
      sourceErrors: lastSourceErrors,
      ...extra
    });
    const read = () => reading ??= (async () => {
      if (typeof gmGetValue !== "function") return;
      try {
        const saved = await gmGetValue(cacheKey, null);
        if (saved?.schema !== 2 || saved.season !== season || saved.scope !== scope2 || !Array.isArray(saved.entries)) return;
        for (const row of saved.entries.slice(0, 2)) try {
          if (!Number.isSafeInteger(row.fetchedAt) || row.fetchedAt < 0 || row.fetchedAt > now()) continue;
          const catalog = normalizeGalleryCatalog(row.source, row.payload, season);
          entries2.set(row.source, { source: row.source, catalog, fetchedAt: row.fetchedAt, etag: validator(row.etag), modified: validator(row.modified) });
        } catch {
        }
        active = entries2.get(saved.active) ?? null;
      } catch {
      }
    })();
    const readPools = () => poolsReading ??= (async () => {
      if (typeof gmGetValue !== "function") return;
      try {
        const saved = await gmGetValue(poolCacheKey, null);
        if (saved?.schema !== 1 || saved.season !== season || saved.scope !== scope2 || !Array.isArray(saved.entries)) return;
        for (const row of saved.entries.slice(0, 256)) try {
          if (!Number.isSafeInteger(row.setId) || row.setId < 1 || !Number.isSafeInteger(row.fetchedAt) || row.fetchedAt < 0 || row.fetchedAt > now()) continue;
          const pool = normalizeGalleryPool("futgg", row.payload, row.setId, season);
          pools.set(row.setId, {
            source: "futgg",
            setId: row.setId,
            pool,
            fetchedAt: row.fetchedAt,
            etag: validator(row.etag),
            modified: validator(row.modified)
          });
        } catch {
        }
      } catch {
      }
    })();
    const persist = async () => {
      if (typeof gmSetValue !== "function") return;
      const records = [...entries2.values()].map(({ catalog, ...entry }) => ({ ...entry, payload: galleryCachePayload(catalog) }));
      try {
        await gmSetValue(cacheKey, { schema: 2, season, scope: scope2, active: active?.source, entries: records });
      } catch {
      }
    };
    const persistPools = () => poolsWriting = poolsWriting.then(async () => {
      if (typeof gmSetValue !== "function") return;
      const records = [...pools.values()].map(({ pool, ...entry }) => ({ ...entry, payload: galleryPoolCachePayload(pool) }));
      try {
        await gmSetValue(poolCacheKey, { schema: 1, season, scope: scope2, entries: records });
      } catch {
      }
    });
    const peek = async () => {
      await read();
      return active ? observe(active, "FC27_GALLERY_CATALOG_CACHE", { cached: true, stale: now() - active.fetchedAt >= ttlMs }) : null;
    };
    const request = async (source) => {
      if (now() < (retryAt.get(source) ?? 0)) throw new Error("FC27_GALLERY_BACKOFF");
      record("catalog-request", { source, phase: "request", status: "started", cached: entries2.has(source) });
      const previous = entries2.get(source);
      const headers = {};
      if (previous?.etag) headers["If-None-Match"] = previous.etag;
      else if (previous?.modified) headers["If-Modified-Since"] = previous.modified;
      const response = await http.get(source, headers);
      const h = response.headers ?? {};
      if (response.status !== 200 && response.status !== 304) {
        const retry = /^\d+$/.test(h["retry-after"]) ? Number(h["retry-after"]) * 1e3 : Date.parse(h["retry-after"]) - now();
        if (Number.isFinite(retry) && retry > 0) retryAt.set(source, now() + Math.max(ttlMs, retry));
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status === 304 && !previous) throw new Error("FC27_GALLERY_304_WITHOUT_CACHE");
      let catalog;
      try {
        catalog = response.status === 304 ? previous.catalog : normalizeGalleryCatalog(source, JSON.parse(response.text), season);
      } catch {
        throw new Error("FC27_GALLERY_PAYLOAD_INVALID");
      }
      const current2 = {
        source,
        catalog,
        fetchedAt: now(),
        etag: validator(h.etag) ?? (response.status === 304 ? previous.etag : null),
        modified: validator(h["last-modified"]) ?? (response.status === 304 ? previous.modified : null)
      };
      entries2.set(source, current2);
      active = current2;
      await persist();
      record("catalog-request", {
        source,
        phase: "request",
        status: "success",
        httpStatus: response.status,
        count: catalog.categories.reduce((total, category) => total + category.sets.length, 0),
        cached: response.status === 304
      });
      return current2;
    };
    const observePool = (entry, reason, extra = {}) => ({
      status: "observed",
      reason,
      source: entry.source,
      setId: entry.setId,
      pool: entry.pool,
      fetchedAt: entry.fetchedAt,
      revision: entry.pool.revision,
      ...extra
    });
    const poolInput = (value) => {
      if (Number.isSafeInteger(value) && value > 0 && value <= 1e6) return value;
      if (typeof value === "string" && /^futgg:[1-9]\d{0,6}$/.test(value) && Number(value.slice(6)) <= 1e6) return Number(value.slice(6));
      return null;
    };
    const requestPool = async (setId) => {
      if (now() < (poolRetryAt.get(setId) ?? 0)) throw new Error("FC27_GALLERY_BACKOFF");
      record("pool-request", { source: "futgg", phase: "request", status: "started" });
      if (typeof http.getPool !== "function") throw new Error("FC27_GALLERY_POOL_TRANSPORT_UNAVAILABLE");
      const previous = pools.get(setId);
      const headers = {};
      if (previous?.etag) headers["If-None-Match"] = previous.etag;
      else if (previous?.modified) headers["If-Modified-Since"] = previous.modified;
      const response = await http.getPool(setId, headers);
      const h = response.headers ?? {};
      if (response.status !== 200 && response.status !== 304) {
        const retryAfter = /^\d+$/.test(h["retry-after"]) ? Number(h["retry-after"]) * 1e3 : Date.parse(h["retry-after"]) - now();
        if (Number.isFinite(retryAfter) && retryAfter > 0) poolRetryAt.set(setId, now() + Math.max(ttlMs, retryAfter));
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status === 304 && !previous) throw new Error("FC27_GALLERY_304_WITHOUT_CACHE");
      let pool;
      try {
        pool = response.status === 304 ? previous.pool : normalizeGalleryPool("futgg", JSON.parse(response.text), setId, season);
      } catch {
        throw new Error("FC27_GALLERY_POOL_PAYLOAD_INVALID");
      }
      const entry = {
        source: "futgg",
        setId,
        pool,
        fetchedAt: now(),
        etag: validator(h.etag) ?? (response.status === 304 ? previous.etag : null),
        modified: validator(h["last-modified"]) ?? (response.status === 304 ? previous.modified : null)
      };
      pools.set(setId, entry);
      await persistPools();
      record("pool-request", {
        source: "futgg",
        phase: "request",
        status: "success",
        count: pool.items.length,
        httpStatus: response.status,
        cached: response.status === 304
      });
      return entry;
    };
    const loadPool = ({ source = "futgg", setId, force = false } = {}) => {
      const numericId = poolInput(setId);
      if (source !== "futgg" || numericId === null) return Promise.resolve({ status: "blocked", reason: "FC27_GALLERY_POOL_UNAVAILABLE" });
      const current2 = poolInFlight.get(numericId);
      if (current2) return current2;
      const task = (async () => {
        await readPools();
        const previous = pools.get(numericId);
        if (!force && previous && now() - previous.fetchedAt < ttlMs) {
          record("pool-cache", { source: "futgg", status: "success", cached: true, count: previous.pool.items.length });
          return observePool(previous, "FC27_GALLERY_POOL_CACHE", { cached: true });
        }
        try {
          return observePool(await requestPool(numericId), "FC27_GALLERY_POOL_UPDATED", { cached: false });
        } catch (error2) {
          if (error2?.message !== "FC27_GALLERY_BACKOFF") poolRetryAt.set(numericId, Math.max(poolRetryAt.get(numericId) ?? 0, now() + ttlMs));
          const errorReason = safeReason8(error2);
          record("pool-request", {
            source: "futgg",
            phase: "request",
            status: "failed",
            reason: errorReason,
            httpStatus: statusCode(errorReason),
            count: 1,
            cached: !!previous,
            stale: !!previous,
            retryAt: poolRetryAt.get(numericId) ?? null
          });
          const extra = {
            cached: !!previous,
            stale: !!previous,
            error: errorReason,
            retryAt: poolRetryAt.get(numericId) ?? null
          };
          return previous ? observePool(previous, "FC27_GALLERY_POOL_REFRESH_FAILED", extra) : { status: "blocked", reason: error2.message.startsWith("FC27_") ? error2.message : "FC27_GALLERY_POOL_UNAVAILABLE", ...extra };
        }
      })().finally(() => poolInFlight.delete(numericId));
      poolInFlight.set(numericId, task);
      return task;
    };
    const peekPool = async ({ source = "futgg", setId } = {}) => {
      const numericId = poolInput(setId);
      if (source !== "futgg" || numericId === null) return null;
      await readPools();
      const entry = pools.get(numericId);
      return entry ? observePool(entry, "FC27_GALLERY_POOL_CACHE", { cached: true, stale: now() - entry.fetchedAt >= ttlMs }) : null;
    };
    const priceIds = (ids) => [...new Set((ids ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
    const priceKey = (ids, platform) => `${platform}:${ids.join(",")}`;
    const priceReason = (error2) => /^(HTTP \d{3}|FC27_GALLERY_[A-Z_]+)$/.test(error2?.message) ? error2.message : "FC27_GALLERY_PRICE_UNAVAILABLE";
    const priceReads = /* @__PURE__ */ new Map(), priceLegacyReads = /* @__PURE__ */ new Map(), priceBatchInFlight = /* @__PURE__ */ new Map();
    const freshPriceBatch = (entry) => Number.isSafeInteger(entry?.fetchedAt) && entry.fetchedAt >= 0 && entry.fetchedAt <= now() && now() - entry.fetchedAt < ttlMs;
    const readPriceBatch = (batch, platform) => {
      const key = priceKey(batch, platform);
      if (priceReads.has(key)) return priceReads.get(key);
      const task = (async () => {
        if (typeof gmGetValue !== "function") return;
        try {
          const cached = await gmGetValue(`${cacheKey}:prices:${key}`, null);
          if (![1, 2].includes(cached?.schema) || cached.season !== season || cached.platform !== platform || !Array.isArray(cached.ids) || cached.ids.join(",") !== batch.join(",")) return;
          if (cached.schema === 2 && cached.fetchedAt != null && (!Number.isSafeInteger(cached.fetchedAt) || cached.fetchedAt < 0 || cached.fetchedAt > now())) return;
          const prices = parseGalleryPriceResponse(JSON.stringify({ data: batch.map((eaId) => ({ eaId, price: cached.prices?.[eaId] })) }));
          priceMemory.set(key, {
            prices,
            fetchedAt: cached.schema === 2 ? cached.fetchedAt ?? null : null,
            retryAt: Number.isSafeInteger(cached.retryAt) && cached.retryAt > now() ? cached.retryAt : null,
            error: typeof cached.error === "string" ? priceReason({ message: cached.error }) : null
          });
        } catch {
        }
      })();
      priceReads.set(key, task);
      return task;
    };
    const requestPriceBatch = (batch, platform) => {
      const key = priceKey(batch, platform);
      if (priceBatchInFlight.has(key)) return priceBatchInFlight.get(key);
      const task = (async () => {
        await readPriceBatch(batch, platform);
        const previous = priceMemory.get(key);
        if (freshPriceBatch(previous) || now() < (previous?.retryAt ?? 0)) {
          record("price-cache", {
            source: "futgg",
            status: previous?.error ? "failed" : "success",
            reason: previous?.error ?? void 0,
            batchSize: batch.length,
            cached: true,
            stale: !freshPriceBatch(previous),
            retryAt: previous?.retryAt ?? void 0
          });
          return previous;
        }
        let entry;
        record("price-request", { source: "futgg", phase: "request", status: "started", batchSize: batch.length });
        try {
          if (typeof http.getPrices !== "function") throw new Error("FC27_GALLERY_PRICE_TRANSPORT_UNAVAILABLE");
          const response = await http.getPrices(batch, { platform });
          if (response.status !== 200) {
            const value = response.headers?.["retry-after"];
            const delay = /^\d+$/.test(value) ? Number(value) * 1e3 : Date.parse(value) - now();
            entry = {
              prices: previous?.prices ?? {},
              fetchedAt: previous?.fetchedAt ?? null,
              error: `HTTP ${response.status}`,
              retryAt: now() + Math.max(ttlMs, Number.isFinite(delay) ? delay : 0)
            };
          } else {
            let payload;
            try {
              payload = JSON.parse(response.text);
            } catch {
              throw new Error("FC27_GALLERY_PRICE_PAYLOAD_INVALID");
            }
            if (!Array.isArray(payload?.data)) throw new Error("FC27_GALLERY_PRICE_PAYLOAD_INVALID");
            const parsed = parseGalleryPriceResponse(response.text);
            const prices = Object.fromEntries(batch.filter((id7) => Object.hasOwn(parsed, id7)).map((id7) => [id7, parsed[id7]]));
            entry = { prices, fetchedAt: now(), retryAt: null, error: null };
          }
        } catch (error2) {
          entry = {
            prices: previous?.prices ?? {},
            fetchedAt: previous?.fetchedAt ?? null,
            error: priceReason(error2),
            retryAt: now() + ttlMs
          };
        }
        record("price-request", {
          source: "futgg",
          phase: "request",
          status: entry?.error ? "failed" : "success",
          reason: entry?.error ?? void 0,
          httpStatus: statusCode(entry?.error),
          batchSize: batch.length,
          cached: !!previous?.fetchedAt,
          count: Object.keys(entry.prices).length,
          retryAt: entry.retryAt ?? void 0
        });
        priceMemory.set(key, entry);
        try {
          await gmSetValue?.(`${cacheKey}:prices:${key}`, { schema: 2, season, platform, ids: batch, ...entry });
        } catch {
        }
        return entry;
      })().finally(() => priceBatchInFlight.delete(key));
      priceBatchInFlight.set(key, task);
      return task;
    };
    const loadPriceSnapshot = (ids, { platform = "pc" } = {}) => {
      const values6 = priceIds(ids);
      if (!values6.length || values6.length > 250 || !["pc", "console"].includes(platform)) return Promise.resolve(Object.freeze({
        prices: Object.freeze({}),
        freshPrices: Object.freeze({}),
        missingIds: values6,
        staleIds: [],
        stale: true,
        error: "FC27_GALLERY_PRICE_IDS_INVALID",
        retryAt: null,
        expiresAt: null
      }));
      const key = priceKey(values6, platform);
      if (priceInFlight.has(key)) return priceInFlight.get(key);
      const task = (async () => {
        const batches = [];
        for (let start = 0; start < values6.length; start += FUTGG_PRICE_BATCH_SIZE) batches.push(values6.slice(start, start + FUTGG_PRICE_BATCH_SIZE));
        if (batches.length > 1 && !priceLegacyReads.has(key)) priceLegacyReads.set(key, (async () => {
          try {
            const cached = await gmGetValue?.(`${cacheKey}:prices:${key}`, null);
            if (cached?.schema !== 1 || cached.season !== season || cached.platform !== platform || cached.ids?.join(",") !== values6.join(",")) return;
            for (const batch of batches) {
              const batchKey = priceKey(batch, platform);
              if (!priceMemory.has(batchKey)) priceMemory.set(batchKey, {
                fetchedAt: null,
                retryAt: null,
                error: null,
                prices: parseGalleryPriceResponse({ data: batch.map((eaId) => ({ eaId, price: cached.prices?.[eaId] })) })
              });
            }
          } catch {
          }
        })());
        await priceLegacyReads.get(key);
        for (const batch of batches) await readPriceBatch(batch, platform);
        for (const batch of batches) {
          const entry = await requestPriceBatch(batch, platform);
          if (entry?.error) break;
        }
        const prices = {}, freshPrices = {}, staleIds = [], missingIds = [];
        let error2 = null, retryAt2 = null, stale = false, expiresAt = null;
        for (const batch of batches) {
          const entry = priceMemory.get(priceKey(batch, platform)), fresh = freshPriceBatch(entry);
          if (!fresh) stale = true;
          if (entry?.error) error2 ??= entry.error;
          if (entry?.retryAt > now()) retryAt2 = Math.max(retryAt2 ?? 0, entry.retryAt);
          if (fresh) expiresAt = Math.min(expiresAt ?? Infinity, entry.fetchedAt + ttlMs);
          for (const id7 of batch) {
            const price2 = entry?.prices?.[id7];
            if (price2 == null) {
              missingIds.push(id7);
              continue;
            }
            prices[id7] = price2;
            if (fresh) freshPrices[id7] = price2;
            else staleIds.push(id7);
          }
        }
        if (error2) priceErrors.set(key, error2);
        else priceErrors.delete(key);
        return Object.freeze({
          prices: Object.freeze(prices),
          freshPrices: Object.freeze(freshPrices),
          missingIds: Object.freeze(missingIds),
          staleIds: Object.freeze(staleIds),
          stale,
          error: error2,
          retryAt: retryAt2,
          expiresAt
        });
      })().finally(() => priceInFlight.delete(key));
      priceInFlight.set(key, task);
      return task;
    };
    const loadPrices = async (ids, options) => (await loadPriceSnapshot(ids, options)).prices;
    const priceError = (ids, { platform = "pc" } = {}) => {
      const values6 = [...new Set((ids ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
      return priceErrors.get(`${platform}:${values6.join(",")}`) ?? null;
    };
    const refresh = async (force) => {
      await read();
      const previous = active;
      if (!force && active && now() - active.fetchedAt < ttlMs) {
        record("catalog-cache", { source: active.source, status: "success", cached: true });
        return observe(active, "FC27_GALLERY_CATALOG_CACHE", { cached: true });
      }
      const errors = {};
      for (const source of ["futgg", "fodder"]) try {
        const current2 = await request(source);
        lastSourceErrors = Object.freeze(errors);
        return observe(current2, "FC27_GALLERY_CATALOG_UPDATED", { cached: false, changes: diffGalleryCatalog(previous?.catalog, current2.catalog) });
      } catch (error2) {
        errors[source] = safeReason8(error2);
        if (error2?.message !== "FC27_GALLERY_BACKOFF") retryAt.set(source, Math.max(retryAt.get(source) ?? 0, now() + ttlMs));
        record("catalog-request", {
          source,
          phase: "request",
          status: "failed",
          reason: errors[source],
          httpStatus: statusCode(errors[source]),
          cached: !!entries2.get(source),
          retryAt: retryAt.get(source) ?? void 0
        });
      }
      lastSourceErrors = Object.freeze(errors);
      const extra = { errors, retryAt: Math.min(...retryAt.values()) };
      return active ? observe(active, "FC27_GALLERY_CATALOG_REFRESH_FAILED", { cached: true, stale: true, ...extra }) : { status: "blocked", reason: "FC27_GALLERY_CATALOG_UNAVAILABLE", ...extra };
    };
    const load = ({ force = false } = {}) => inFlight ??= refresh(force).finally(() => {
      inFlight = null;
    });
    return Object.freeze({ load, refresh: () => load({ force: true }), peek, loadPool, peekPool, loadPrices, loadPriceSnapshot, priceError, cacheKey, poolCacheKey });
  }

  // src/gallery/scoring.js
  var fields3 = Object.freeze({
    NATION: "nationEaId",
    CLUB: "clubEaId",
    LEAGUEID: "leagueEaId",
    BASE_DEF_ID: "playerEaId",
    LEVEL: "overall",
    RARE: "rarityEaId",
    HYPER_COSMETIC_TYPE: "holographic",
    FIRST_OWNED: "firstOwned",
    POSSIBLE_POSITIONS: "positions",
    WEAK_FOOT: "weakFoot",
    SKILL_MOVES: "skillMoves"
  });
  var grouped = /* @__PURE__ */ new Set(["NATION", "CLUB", "LEAGUEID", "BASE_DEF_ID"]);
  var fail16 = (reason) => ({ status: "unavailable", reason, grade: null });
  var validScore = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e8;
  var sum = (rows) => rows.reduce((total, row) => total + row.gradingScore, 0);
  var order = (a, b) => b.gradingScore - a.gradingScore || a.eaId - b.eaId;
  var bonusFor = (score2, percent) => Math.floor(score2 * percent / 100);
  var tierFor = (tiers, count2) => tiers.filter((tier) => count2 >= tier.at).at(-1);
  function compileGalleryScoringRules({ source, tags } = {}) {
    if (source !== "futgg" || !Array.isArray(tags) || !tags.length || tags.length > 256) return fail16("rules-unavailable");
    const result = [], ids = /* @__PURE__ */ new Set();
    for (const tag of tags) {
      const rule = tag?.rules?.length === 1 ? tag.rules[0] : null;
      if (!Number.isSafeInteger(tag?.id) || ids.has(tag.id) || !rule || !fields3[rule.attribute] || tag.bonusType !== "ITEM_SCORE_PERCENTAGE" || tag.thresholdType !== "ITEM_COUNT" || rule.target !== (rule.attribute === "BASE_DEF_ID" ? "BASE_DEF_ID" : "ATTRIBUTE") || !Array.isArray(rule.values) || !rule.values.length) return fail16("unknown-rule");
      const isGroup = grouped.has(rule.attribute), isMinimum = ["WEAK_FOOT", "SKILL_MOVES"].includes(rule.attribute);
      if (isGroup ? !["MAX_COUNT_ALL_SAME", "COUNT_DIFF"].includes(rule.type) : isMinimum ? rule.type !== "MIN_COUNT" : !["COUNT", "COUNT_ANY"].includes(rule.type)) return fail16("unknown-rule");
      const values6 = rule.values.map(String);
      if (isMinimum && (values6.length !== 1 || !/^\d+$/.test(values6[0])) || isGroup && (values6.length !== 1 || values6[0] !== "0") || rule.attribute === "FIRST_OWNED" && (values6.length !== 1 || values6[0] !== "1") || rule.attribute === "HYPER_COSMETIC_TYPE" && (values6.length !== 2 || !values6.includes("0") || !values6.includes("1")) || rule.attribute === "LEVEL" && values6.some((value) => !["gold", "silver", "bronze"].includes(value))) return fail16("unknown-values");
      if (!Array.isArray(tag.tiers) || !tag.tiers.length) return fail16("tiers-unavailable");
      const tiers = tag.tiers.map((tier) => ({ at: tier.minItems, pct: tier.bonus })).sort((a, b) => a.at - b.at);
      if (tiers.some((tier, i) => !Number.isSafeInteger(tier.at) || tier.at < 1 || !Number.isFinite(tier.pct) || tier.pct < 0 || tier.pct > 1e5 || i > 0 && (tier.at === tiers[i - 1].at || tier.pct < tiers[i - 1].pct))) return fail16("tiers-invalid");
      ids.add(tag.id);
      result.push({
        id: tag.id,
        name: tag.name,
        field: fields3[rule.attribute],
        mode: isGroup ? rule.type === "COUNT_DIFF" ? "different" : "same" : isMinimum ? "minimum" : "match",
        values: values6,
        threshold: isMinimum ? Number(values6[0]) + (rule.attribute === "SKILL_MOVES" ? 1 : 0) : null,
        tiers
      });
    }
    return { status: "ready", tags: result };
  }
  function attribute(row, field) {
    const value = row[field];
    if (value == null) return null;
    if (field === "overall") return value >= 75 ? "gold" : value >= 65 ? "silver" : "bronze";
    return value;
  }
  function matches(row, tag) {
    const value = attribute(row, tag.field);
    if (value == null) return null;
    if (["firstOwned", "holographic"].includes(tag.field)) return value === true;
    if (tag.mode === "minimum") return Number(value) >= tag.threshold;
    return (Array.isArray(value) ? value : [value]).some((item2) => tag.values.includes(String(item2)));
  }
  function galleryRuleKeys(row, tags) {
    return tags.flatMap((tag) => {
      if (tag.mode === "same" || tag.mode === "different") {
        const value = attribute(row, tag.field);
        return value == null ? [] : [`${tag.id}:${value}`];
      }
      return matches(row, tag) === true ? [`${tag.id}:match`] : [];
    });
  }
  function groupsOf(rows, field) {
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const key = attribute(row, field);
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()];
  }
  function matchTag(rows, tag, { unknown = "low", groupMode = "fodder" } = {}) {
    const unknownRows = rows.filter((row) => attribute(row, tag.field) == null);
    if (!["same", "different"].includes(tag.mode)) {
      const cards = rows.filter((row) => matches(row, tag) ?? unknown === "high");
      return { count: cards.length, cards, unknown: unknownRows.length };
    }
    const groups = groupsOf(rows, tag.field);
    if (unknown === "high" && unknownRows.length) return { count: rows.length, cards: rows, unknown: unknownRows.length };
    if (tag.mode === "different") return {
      count: groups.length,
      cards: groups.map((group) => group.slice().sort(order)[0]),
      unknown: unknownRows.length
    };
    if (tag.field === "playerEaId" && groupMode === "fodder") {
      const qualifying = groups.filter((group) => group.length >= tag.tiers[0].at);
      if (qualifying.length) return { count: Math.max(...qualifying.map((group) => group.length)), cards: qualifying.flat(), unknown: unknownRows.length };
    }
    const value = (group) => bonusFor(sum(group), tierFor(tag.tiers, group.length)?.pct ?? 0);
    groups.sort((a, b) => (groupMode === "fodder" ? value(b) - value(a) : 0) || b.length - a.length || sum(b) - sum(a));
    return { count: groups[0]?.length ?? 0, cards: groups[0] ?? [], unknown: unknownRows.length };
  }
  function evaluateGalleryLineup(rows, compiled, options = {}) {
    if (!Array.isArray(rows) || rows.some((row) => !Number.isSafeInteger(row.eaId) || row.eaId < 1 || !validScore(row.gradingScore)) || new Set(rows.map((row) => row.eaId)).size !== rows.length) throw Error("FC27_GALLERY_SCORING_INPUT_INVALID");
    if (compiled?.status !== "ready") return fail16(compiled?.reason ?? "rules-unavailable");
    const tags = compiled.tags.map((tag) => {
      const match = matchTag(rows, tag, options), tier = tierFor(tag.tiers, match.count);
      const next = tag.tiers.find((step) => match.count < step.at);
      return {
        id: tag.id,
        name: tag.name,
        count: match.count,
        matched: sum(match.cards),
        pct: tier?.pct ?? 0,
        bonus: bonusFor(sum(match.cards), tier?.pct ?? 0),
        unknown: match.unknown,
        counted: false,
        matchedEaIds: match.cards.map((row) => row.eaId),
        next: next ? { ...next, needed: next.at - match.count } : null
      };
    });
    const paid = tags.filter((tag) => tag.bonus > 0).sort((a, b) => b.bonus - a.bonus).slice(0, 10);
    for (const tag of paid) tag.counted = true;
    const base = sum(rows), bonus = paid.reduce((total, tag) => total + tag.bonus, 0);
    return { base, bonus, total: base + bonus, tags, lineupIds: rows.map((row) => row.eaId) };
  }
  function* chooseLineupSteps(rows, required2, compiled) {
    const base = rows.slice().sort((a, b) => b.gradingScore - a.gradingScore || b.overall - a.overall || a.eaId - b.eaId).slice(0, required2);
    if (rows.length <= required2 || !compiled.tags.length) return base;
    const ranked = rows.slice().sort(order), groups = [];
    for (const tag of compiled.tags) {
      const tiers = tag.tiers.filter((tier) => tier.at <= required2);
      if (!tiers.length) continue;
      if (tag.mode === "same") {
        const candidates2 = groupsOf(ranked, tag.field).sort((a, b) => sum(b.slice(0, required2)) - sum(a.slice(0, required2))).slice(0, 3);
        for (const cards of candidates2) groups.push({ cards, tiers });
      } else if (tag.mode !== "different") {
        const cards = matchTag(ranked, tag).cards.slice().sort(order);
        if (cards.length) groups.push({ cards, tiers });
      }
    }
    const candidateSet = new Set(ranked.slice(0, 60));
    for (const group of groups) if (group.tiers.at(-1).pct >= 10) {
      for (const row of group.cards.slice(0, group.tiers.at(-1).at)) candidateSet.add(row);
    }
    const candidates = [...candidateSet].sort(order), seeds2 = [base];
    const key = (cards) => cards.map((row) => row.eaId).sort().join(",");
    const seen = /* @__PURE__ */ new Set([key(base)]);
    for (const group of groups) for (const tier of group.tiers) {
      if (group.cards.length < tier.at) break;
      const cards = group.cards.slice(0, tier.at), ids = new Set(cards.map((row) => row.eaId));
      for (const row of ranked) {
        if (cards.length >= required2) break;
        if (!ids.has(row.eaId)) {
          cards.push(row);
          ids.add(row.eaId);
        }
      }
      const identity5 = key(cards);
      if (!seen.has(identity5)) {
        seen.add(identity5);
        seeds2.push(cards);
      }
    }
    const score2 = (cards) => evaluateGalleryLineup(cards, compiled).total;
    const scoredSeeds = [];
    for (const cards of seeds2) {
      scoredSeeds.push({ cards, total: score2(cards) });
      yield;
    }
    const starts = scoredSeeds.sort((a, b) => b.total - a.total).slice(0, 6);
    if (!starts.some((seed) => seed.cards === base)) starts.push({ cards: base, total: score2(base) });
    let evaluated = 0, best = null;
    for (const seed of starts) {
      let cards = seed.cards.slice(), total = seed.total, improved = true;
      while (improved && evaluated < 8e3) {
        improved = false;
        const ids = new Set(cards.map((row) => row.eaId));
        for (let slot = 0; slot < cards.length; slot++) for (const row of candidates) {
          if (ids.has(row.eaId)) continue;
          const next = cards.slice();
          next[slot] = row;
          const value = score2(next);
          evaluated++;
          yield;
          if (value > total) {
            ids.delete(cards[slot].eaId);
            ids.add(row.eaId);
            cards = next;
            total = value;
            improved = true;
            break;
          }
        }
      }
      if (!best || total > best.total) best = { cards, total };
    }
    return best.cards.slice().sort(order);
  }
  function* summarizeGalleryScoreSteps({ set, catalog, progress }) {
    if (!set || !progress || !Array.isArray(progress.rows) || catalog?.source !== "futgg" || set.id !== `futgg:${progress.setId}` || progress.season !== "27" || !Number.isSafeInteger(set.requiredCards) || set.requiredCards < 1) return fail16("input-invalid");
    const compiled = compileGalleryScoringRules(catalog);
    if (compiled.status !== "ready") return compiled;
    const collected = progress.rows.filter((row) => row.collected === true);
    const collectionUnknown = !progress.complete || progress.rows.some((row) => row.collected == null);
    const scoreUnknown = collected.some((row) => !validScore(row.gradingScore));
    if (scoreUnknown) return { status: "partial", reason: "base-score-unknown", full: false, grade: null };
    if (new Set(progress.rows.map((row) => row.eaId)).size !== progress.rows.length) return fail16("duplicate-version");
    const rows = collected.filter((row) => row.gradingScore > 0);
    const lineup = yield* chooseLineupSteps(rows, set.requiredCards, compiled), full = lineup.length >= set.requiredCards;
    const low = evaluateGalleryLineup(lineup, compiled), high = evaluateGalleryLineup(lineup, compiled, { unknown: "high" });
    const comparison = evaluateGalleryLineup(lineup, compiled, { groupMode: "futgg" });
    const comparisonHigh = evaluateGalleryLineup(lineup, compiled, { groupMode: "futgg", unknown: "high" });
    const ruleDifference = comparison.total !== low.total || comparisonHigh.total !== high.total;
    const unknownFields = [...new Set(compiled.tags.filter((tag) => lineup.some((row) => attribute(row, tag.field) == null)).map((tag) => tag.field))];
    const grades3 = [...set.grades].sort((a, b) => a.threshold - b.threshold);
    const gradeFor = (total) => full ? grades3.filter((g) => total >= g.threshold).at(-1)?.name ?? null : null;
    const next = grades3.find((g) => low.total < g.threshold) ?? null;
    const uncertain = collectionUnknown || low.total !== high.total || ruleDifference;
    return {
      status: collectionUnknown ? "partial" : uncertain ? "uncertain" : "calculated",
      full,
      lineup,
      selection: rows.length > set.requiredCards ? "bounded-search" : "all-collected",
      low,
      high,
      grade: uncertain ? null : gradeFor(low.total),
      lowGrade: gradeFor(low.total),
      highGrade: gradeFor(high.total),
      nextGrade: next?.name ?? null,
      pointsToNext: next ? next.threshold - low.total : null,
      missingCards: Math.max(0, set.requiredCards - rows.length),
      zeroScoreCards: collected.length - rows.length,
      unknownFields,
      collectionUnknown,
      ruleDifference,
      comparison: ruleDifference ? { low: comparison, high: comparisonHigh } : null
    };
  }
  function summarizeGalleryScore(input) {
    const steps = summarizeGalleryScoreSteps(input);
    let next;
    do {
      next = steps.next();
    } while (!next.done);
    return next.value;
  }

  // src/gallery/cooperative-plan.js
  async function runGalleryPlan(steps, {
    current: current2 = () => true,
    progress = () => {
    },
    now = () => performance.now(),
    schedule = () => new Promise((resolve) => setTimeout(resolve, 0)),
    sliceMs = 12,
    maxMs = 1e4
  } = {}) {
    const started = now();
    let slice = started, finish = false;
    try {
      for (; ; ) {
        if (!current2()) return null;
        const next = steps.next(finish);
        if (next.done) return current2() ? next.value : null;
        const time = now();
        finish = time - started >= maxMs;
        if (time - slice >= sliceMs || finish) {
          progress(next.value);
          await schedule();
          slice = now();
        }
      }
    } finally {
      steps.return();
    }
  }

  // src/gallery/score-queue.js
  function createGalleryScoreQueue({
    onUpdate = () => {
    },
    now = () => performance.now(),
    schedule = () => new Promise((resolve) => setTimeout(resolve, 0))
  } = {}) {
    const entries2 = /* @__PURE__ */ new Map();
    let task = null, epoch = 0, disposed = false;
    const start = () => {
      if (task || disposed || ![...entries2.values()].some((value) => value.pending)) return;
      const generation = epoch;
      task = (async () => {
        await schedule();
        while (!disposed && generation === epoch) {
          const entry = [...entries2.values()].find((value) => value.pending);
          if (!entry) break;
          const current2 = () => !disposed && generation === epoch && entries2.get(entry.id) === entry;
          let summary2;
          try {
            summary2 = await runGalleryPlan(summarizeGalleryScoreSteps(entry.input), {
              current: current2,
              now,
              schedule,
              sliceMs: 8,
              maxMs: Infinity
            });
          } catch {
            summary2 = { status: "unavailable", reason: "input-invalid" };
          }
          if (!current2() || !summary2) break;
          entry.summary = summary2;
          entry.pending = false;
          try {
            onUpdate(entry.input.set.id);
          } catch {
          }
          await schedule();
        }
      })().finally(() => {
        task = null;
        if ([...entries2.values()].some((value) => value.pending)) start();
      });
    };
    const cancel = () => {
      epoch++;
      for (const [key, entry] of entries2) if (entry.pending) entries2.delete(key);
    };
    return Object.freeze({
      read(scope2, input) {
        if (disposed) return null;
        const id7 = `${scope2}:${input.set.id}`;
        const key = JSON.stringify([input.set, input.catalog.source, input.catalog.tags, input.progress]);
        let entry = entries2.get(id7);
        if (entry?.key !== key) {
          entry = { id: id7, key, input, pending: true, summary: { status: "calculating" } };
          entries2.set(id7, entry);
          while (entries2.size > 256) entries2.delete(entries2.keys().next().value);
        }
        start();
        return entry.summary;
      },
      idle: async () => {
        while (task) await task;
      },
      cancel,
      dispose: () => {
        disposed = true;
        cancel();
        entries2.clear();
      }
    });
  }

  // src/gallery/cost-bundles.js
  var priced = (candidates) => candidates.filter((row) => Number.isSafeInteger(row.price) && row.price > 0).slice().sort((a, b) => a.price - b.price || (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
  function* galleryCostBundles(candidates, size, limit) {
    const rows = priced(candidates);
    if (size < 1 || size > rows.length || limit < 1) return;
    const heap = [], seen = /* @__PURE__ */ new Set();
    let sequence = 0;
    const before = (a, b) => a.cost < b.cost || a.cost === b.cost && a.sequence < b.sequence;
    const push = (indices) => {
      const key = indices.join(",");
      if (seen.has(key)) return;
      seen.add(key);
      const node = { indices, cost: indices.reduce((sum2, i2) => sum2 + rows[i2].price, 0), sequence: sequence++ };
      let i = heap.length;
      heap.push(node);
      while (i > 0) {
        const parent = i - 1 >> 1;
        if (!before(node, heap[parent])) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = node;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
          if (!before(heap[child], last)) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    push(Array.from({ length: size }, (_, i) => i));
    for (let count2 = 0; count2 < limit && heap.length; count2++) {
      const node = pop();
      yield node.indices.map((i) => rows[i].id);
      for (let slot = size - 1; slot >= 0; slot--) {
        const indices = node.indices.slice();
        if (indices[slot] + 1 >= (indices[slot + 1] ?? rows.length)) continue;
        indices[slot]++;
        push(indices);
      }
    }
  }
  function* galleryBonusBundles(candidates, size, limit) {
    const rows = priced(candidates), groups = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
    for (const price2 of new Set(rows.map((row) => row.price))) {
      groups.set(`price:${price2}`, rows.filter((row) => row.price <= price2).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.price - b.price || a.id - b.id));
    }
    for (const row of rows) for (const key of row.diversityKeys ?? []) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    let count2 = 0;
    if (size < 1 || size > rows.length) return;
    for (const group of groups.values()) for (let required2 = 1; required2 <= Math.min(size, group.length); required2++) {
      if (count2 >= limit) return;
      const ids = new Set(group.slice(0, required2).map((row) => row.id));
      for (const row of rows) {
        if (ids.size >= size) break;
        ids.add(row.id);
      }
      const key = [...ids].sort((a, b) => a - b).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      count2++;
      yield [...ids];
    }
  }

  // src/gallery/cost-search.js
  var bundleKey = (ids) => ids.slice().sort((a, b) => a - b).join(",");
  var costOf = (state) => Number.isFinite(state.cost) ? state.cost : Infinity;
  function candidateFrontier(candidates, limit) {
    const cheapest = candidates.slice().sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
    const picked = /* @__PURE__ */ new Map();
    for (const candidate of cheapest.slice(0, Math.min(32, limit))) picked.set(candidate.id, candidate);
    const signatures = new Set([...picked.values()].map((row) => (row.diversityKeys ?? []).join("|")));
    for (const candidate of cheapest) {
      if (picked.size >= limit) break;
      const signature2 = (candidate.diversityKeys ?? []).join("|");
      if (signatures.has(signature2)) continue;
      signatures.add(signature2);
      for (const peer of cheapest.filter((row) => (row.diversityKeys ?? []).join("|") === signature2).slice(0, 6)) {
        if (picked.size >= limit) break;
        picked.set(peer.id, peer);
      }
    }
    for (const candidate of cheapest.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.price ?? Infinity) - (b.price ?? Infinity) || a.id - b.id).slice(0, 8)) {
      if (picked.size >= limit) break;
      picked.set(candidate.id, candidate);
    }
    return [...picked.values()];
  }
  function frontier(states2, width, measure) {
    const equivalent = /* @__PURE__ */ new Map();
    for (const state of states2) {
      const key = bundleKey(state.ids);
      if (!equivalent.has(key)) equivalent.set(key, state);
    }
    const rows = [...equivalent.values()].map((state) => ({ state, cost: costOf(state), ...measure(state) }));
    const orderings = [
      rows.slice().sort((a, b) => a.cost - b.cost || b.progress - a.progress),
      rows.slice().sort((a, b) => b.progress - a.progress || a.cost - b.cost),
      rows.slice().sort((a, b) => Math.max(0, b.progress) / Math.max(1, b.cost) - Math.max(0, a.progress) / Math.max(1, a.cost) || a.cost - b.cost)
    ];
    const chosen = /* @__PURE__ */ new Set(), signatures = /* @__PURE__ */ new Set(), offsets = [0, 0, 0];
    while (chosen.size < width) {
      const before = chosen.size;
      for (let route = 0; route < orderings.length && chosen.size < width; route++) {
        const ordering = orderings[route];
        while (offsets[route] < ordering.length) {
          const row = ordering[offsets[route]++];
          const key = `${row.cost}:${row.progress}:${row.diversityKey ?? ""}`;
          if (chosen.has(row.state) || signatures.has(key)) continue;
          chosen.add(row.state);
          signatures.add(key);
          break;
        }
      }
      if (before === chosen.size) break;
    }
    for (const row of orderings[0]) {
      if (chosen.size >= width) break;
      chosen.add(row.state);
    }
    return [...chosen];
  }
  function* refineGalleryCostSteps({
    initial,
    candidates,
    evaluate: evaluate2,
    measure,
    maxEvaluations,
    beamWidth = 24,
    candidateLimit = 96,
    maxDepth = 12,
    seedSteps = null
  }) {
    let evaluations = 0, stopped = false, truncated = maxDepth < initial.ids.length;
    const plans = [], reached = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set([bundleKey(initial.ids)]);
    if (!Number.isFinite(initial.cost) || initial.missingPrices) return { plans, evaluations, stopped };
    if (measure(initial).reached) reached.set(bundleKey(initial.ids), initial);
    let beam = [initial];
    const seedStates = [initial];
    if (seedSteps) {
      try {
        let step = seedSteps.next();
        while (!step.done && !stopped) {
          const ids = step.value.ids;
          if (ids && !seen.has(bundleKey(ids))) {
            if (evaluations >= maxEvaluations) {
              stopped = true;
              break;
            }
            seen.add(bundleKey(ids));
            const state = evaluate2(ids);
            evaluations++;
            if (state && Number.isFinite(state.cost) && !state.missingPrices) {
              seedStates.push(state);
              if (measure(state).reached) reached.set(bundleKey(ids), state);
            }
          }
          if (yield { evaluations, seedWork: step.value.work }) {
            stopped = true;
            break;
          }
          step = seedSteps.next();
        }
      } finally {
        seedSteps.return();
      }
    }
    const seedLimit = Math.min(512, Math.floor(maxEvaluations / 4));
    const orderedLimit = Math.min(512, Math.floor(maxEvaluations / 4));
    const seedSources = [
      galleryBonusBundles(candidates, initial.ids.length, seedLimit),
      galleryCostBundles(candidates, initial.ids.length, orderedLimit)
    ];
    for (const source of seedSources) {
      if (stopped) break;
      for (const ids of source) {
        const key = bundleKey(ids);
        if (seen.has(key)) continue;
        if (evaluations >= maxEvaluations) {
          stopped = true;
          break;
        }
        seen.add(key);
        const state = evaluate2(ids);
        evaluations++;
        if (state && Number.isFinite(state.cost) && !state.missingPrices) {
          seedStates.push(state);
          if (measure(state).reached) reached.set(key, state);
        }
        if (yield { evaluations }) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    if (seedStates.length > beamWidth) truncated = true;
    beam = frontier(seedStates, beamWidth, measure);
    for (let depth = 0; depth < maxDepth && beam.length && evaluations < maxEvaluations && !stopped; depth++) {
      const next = [];
      expansion: for (const current2 of beam) {
        const selected = new Set(current2.ids);
        const available = candidates.filter((candidate) => !selected.has(candidate.id));
        if (available.length > candidateLimit) truncated = true;
        const alternatives = candidateFrontier(available, candidateLimit);
        for (let slot = 0; slot < current2.ids.length; slot++) for (const candidate of alternatives) {
          if (evaluations >= maxEvaluations) {
            stopped = true;
            break expansion;
          }
          const ids = [...current2.ids];
          ids[slot] = candidate.id;
          const key = bundleKey(ids);
          if (seen.has(key)) continue;
          seen.add(key);
          const state = evaluate2(ids);
          evaluations++;
          if (state && Number.isFinite(state.cost) && !state.missingPrices) {
            const value = measure(state);
            if (value.reached) {
              const previous = reached.get(key);
              if (!previous || state.cost < previous.cost) reached.set(key, state);
            }
            next.push(state);
          }
          if (yield { evaluations }) {
            stopped = true;
            break expansion;
          }
        }
        if (stopped) break;
      }
      if (next.length > beamWidth) truncated = true;
      beam = frontier(next, beamWidth, measure);
    }
    if (beam.length && evaluations < maxEvaluations && maxDepth > 0) truncated = true;
    stopped ||= evaluations >= maxEvaluations;
    plans.push(...[...reached.values()].sort((a, b) => b.cost - a.cost || measure(a).progress - measure(b).progress));
    return { plans, evaluations, stopped, ...truncated ? { truncated: true } : {} };
  }

  // src/gallery/candidate-pool.js
  var validPrice = (value) => Number.isSafeInteger(value) && value > 0;
  var priceOf = (candidate) => validPrice(candidate.price) ? candidate.price : Number.POSITIVE_INFINITY;
  var scoreOf = (candidate) => Number.isFinite(candidate.score) ? candidate.score : -Infinity;
  var priceOrder = (a, b) => priceOf(a) - priceOf(b) || scoreOf(b) - scoreOf(a) || a.id - b.id;
  var scoreOrder = (a, b) => Number.isFinite(priceOf(b)) - Number.isFinite(priceOf(a)) || scoreOf(b) - scoreOf(a) || priceOf(a) - priceOf(b) || a.id - b.id;
  function selectGalleryCandidatePool(candidates, limit) {
    if (!Array.isArray(candidates) || !Number.isSafeInteger(limit) || limit < 1) return [];
    const selected = /* @__PURE__ */ new Map();
    const add = (candidate) => {
      if (selected.size < limit) selected.set(candidate.id, candidate);
    };
    const byPrice = candidates.slice().sort(priceOrder);
    const byScore = candidates.slice().sort(scoreOrder);
    for (const candidate of byPrice.slice(0, Math.ceil(limit / 2))) add(candidate);
    for (const candidate of byScore.slice(0, Math.ceil(limit / 4))) add(candidate);
    const representatives = /* @__PURE__ */ new Map();
    for (const candidate of byPrice) for (const key of candidate.diversityKeys ?? []) {
      if (!representatives.has(key)) representatives.set(key, candidate);
    }
    for (const candidate of [...representatives.values()].sort(priceOrder)) add(candidate);
    for (const candidate of byPrice) add(candidate);
    for (const candidate of byScore) add(candidate);
    return [...selected.values()];
  }

  // src/gallery/price-band-seeds.js
  var owned = (row) => row.collected === true || row.inClub === true || row.held === true;
  function galleryPriceBands(candidates, limit = 8) {
    const prices = [...new Set(candidates.map((row) => row.price).filter((price2) => Number.isSafeInteger(price2) && price2 > 0))].sort((a, b) => a - b);
    if (!prices.length) return [];
    const gaps = prices.slice(0, -1).map((price2, i) => ({ price: price2, jump: prices[i + 1] / price2 })).sort((a, b) => b.jump - a.jump || a.price - b.price);
    return [...gaps.slice(0, limit - 1).map((row) => row.price), prices.at(-1)];
  }
  function* galleryPriceBandSeedSteps({ targets, candidates, maxWork = 16e3 }) {
    const byId = new Map(candidates.map((row) => [row.id, row]));
    const seen = /* @__PURE__ */ new Set();
    let work = 0;
    for (const price2 of galleryPriceBands(candidates)) {
      const ids = /* @__PURE__ */ new Set();
      let complete = true;
      for (const target of targets) {
        const rows = target.progress.rows.filter((row) => owned(row) || byId.get(row.eaId)?.price > 0 && byId.get(row.eaId).price <= price2).map((row) => owned(row) ? { ...row, collected: true } : {
          ...row,
          gradingScore: byId.get(row.eaId).score,
          collected: true,
          firstOwned: false
        });
        const steps = summarizeGalleryScoreSteps({ ...target, progress: {
          ...target.progress,
          season: "27",
          setId: Number(target.set.id.split(":").at(-1)),
          complete: true,
          rows
        } });
        let next;
        try {
          next = steps.next();
          while (!next.done) {
            work++;
            if ((yield { work }) || work >= maxWork) return;
            next = steps.next();
          }
        } finally {
          steps.return();
        }
        if (!next.value.full) {
          complete = false;
          break;
        }
        for (const row of next.value.lineup) if (!owned(target.progress.rows.find((original) => original.eaId === row.eaId))) ids.add(row.eaId);
      }
      const key = [...ids].sort((a, b) => a - b).join(",");
      if (complete && ids.size && !seen.has(key)) {
        seen.add(key);
        if (yield { ids: [...ids], work }) return;
      }
      if (work >= maxWork) return;
    }
  }

  // src/gallery/planner.js
  var validId4 = (value) => Number.isSafeInteger(value) && value > 0;
  var validScore2 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e8;
  var validPrice2 = (value) => Number.isSafeInteger(value) && value > 0 && value <= 15e6;
  var asPrice = (prices, id7) => {
    const value = prices?.[String(id7)] ?? prices?.[id7];
    return validPrice2(value) ? value : null;
  };
  var candidateScore = (row) => validScore2(row?.gradingScore) ? { value: row.gradingScore, source: "ea" } : validScore2(row?.galleryScore) ? { value: row.galleryScore, source: "catalog" } : null;
  var isGalleryOwned = (row) => row?.collected === true || row?.inClub === true || row?.held === true;
  var scoreOf2 = (state) => state.summary?.low?.total ?? -Infinity;
  var galleryCostSearchKeys = (row, tags) => galleryRuleKeys({ ...row, firstOwned: false }, tags);
  function targetThreshold(set, targetGrade) {
    if (Number.isSafeInteger(targetGrade) && targetGrade >= 0) return targetGrade;
    if (typeof targetGrade !== "string") return null;
    const grade = set?.grades?.find((row) => String(row.name).toLowerCase() === targetGrade.toLowerCase());
    return Number.isSafeInteger(grade?.threshold) && grade.threshold >= 0 ? grade.threshold : null;
  }
  function comparableRows(rows) {
    return rows.map((row) => ({ ...row, collected: true }));
  }
  function summarize(set, catalog, existing, selected) {
    const rows = comparableRows([...existing, ...selected]);
    try {
      return summarizeGalleryScore({ set, catalog, progress: {
        season: "27",
        setId: Number(String(set.id).split(":").at(-1)),
        complete: true,
        rows
      } });
    } catch {
      return { status: "unavailable", reason: "input-invalid" };
    }
  }
  function rank(a, b, threshold) {
    const aReached = a.summary?.full === true && scoreOf2(a) >= threshold;
    const bReached = b.summary?.full === true && scoreOf2(b) >= threshold;
    if (aReached !== bReached) return aReached ? -1 : 1;
    if (aReached && bReached) {
      const aCost = a.unknownPrice ? Number.POSITIVE_INFINITY : a.price;
      const bCost = b.unknownPrice ? Number.POSITIVE_INFINITY : b.price;
      if (aCost !== bCost) return aCost - bCost;
    }
    return scoreOf2(b) - scoreOf2(a) || a.ids.length - b.ids.length || a.price - b.price;
  }
  function priceOf2(state) {
    return state.unknownPrice ? Number.POSITIVE_INFINITY : state.price;
  }
  function cheaperState(a, b) {
    return priceOf2(a) - priceOf2(b) || scoreOf2(b) - scoreOf2(a) || a.ids.length - b.ids.length;
  }
  function materialize(state, targetGrade, threshold, currentScore = 0) {
    const missingPriceIds = state.items.filter((item2) => item2.price == null).map((item2) => item2.eaId);
    const estimated = state.items.some((item2) => item2.scoreSource !== "ea");
    const reached = scoreOf2(state) >= threshold;
    return {
      targetGrade,
      threshold,
      reached,
      currentScore,
      addedScore: Number.isFinite(scoreOf2(state)) ? scoreOf2(state) - currentScore : null,
      score: Number.isFinite(scoreOf2(state)) ? scoreOf2(state) : null,
      items: state.items.map((item2) => ({ ...item2 })),
      totalPrice: missingPriceIds.length ? null : state.price,
      missingPriceIds,
      estimated,
      confidence: estimated ? "catalog-estimate" : "ea-score-input",
      scoreHigh: state.summary?.high?.total ?? null,
      unknownFields: [...state.summary?.unknownFields ?? []]
    };
  }
  function* planGalleryGradeSteps({
    set,
    catalog,
    progress,
    prices = {},
    targetGrade,
    maxPlans = 3,
    beamWidth = 96,
    maxCandidates = 250,
    maxEvaluations = 3e4
  } = {}) {
    if (![maxPlans, beamWidth, maxCandidates, maxEvaluations].every((value) => Number.isSafeInteger(value) && value > 0) || maxPlans > 10 || beamWidth > 512 || maxCandidates > 250 || maxEvaluations > 1e5) {
      return { status: "unavailable", reason: "search-options-invalid" };
    }
    if (!set || !Array.isArray(set.grades) || !Number.isSafeInteger(set.requiredCards) || set.requiredCards < 1 || !catalog || catalog.source !== "futgg" || !progress || !Array.isArray(progress.rows)) {
      return { status: "unavailable", reason: "input-invalid" };
    }
    const threshold = targetThreshold(set, targetGrade);
    if (threshold == null) return { status: "unavailable", reason: "target-grade-unknown" };
    const compiled = compileGalleryScoringRules(catalog);
    if (compiled.status !== "ready") return { status: "unavailable", reason: compiled.reason };
    const rows = progress.rows.filter((row) => validId4(row?.eaId));
    if (rows.length !== progress.rows.length) return { status: "unavailable", reason: "input-invalid" };
    if (new Set(rows.map((row) => row.eaId)).size !== rows.length) return { status: "unavailable", reason: "duplicate-version" };
    if (progress.complete === false || rows.some((row) => typeof row.collected !== "boolean")) {
      return { status: "partial", reason: "collection-status-unknown", targetGrade, threshold, plans: [] };
    }
    const existing = rows.filter((row) => isGalleryOwned(row) && validScore2(row.gradingScore));
    const incompleteExisting = rows.filter((row) => isGalleryOwned(row) && !validScore2(row.gradingScore));
    const requiredSlots = Math.max(1, set.requiredCards - existing.length);
    const eligibleCandidates = rows.filter((row) => !isGalleryOwned(row)).map((row) => {
      const score2 = candidateScore(row);
      return score2 ? {
        row,
        score: score2,
        id: row.eaId,
        price: asPrice(prices, row.eaId),
        diversityKeys: galleryCostSearchKeys(row, compiled.tags)
      } : null;
    }).filter(Boolean);
    const eligibleById = new Map(eligibleCandidates.map((candidate) => [candidate.row.eaId, candidate]));
    const candidates = selectGalleryCandidatePool(eligibleCandidates.map((candidate) => ({
      ...candidate,
      score: candidate.score.value
    })), maxCandidates).map((candidate) => eligibleById.get(candidate.id));
    const omittedCandidates = rows.filter((row) => !isGalleryOwned(row)).length - candidates.length;
    const requestedCandidates = rows.filter((row) => !isGalleryOwned(row)).length;
    const quotedCandidateCount = eligibleCandidates.filter((candidate) => candidate.price != null).length;
    const scoreSourceCounts = eligibleCandidates.reduce((counts, candidate) => {
      counts[candidate.score.source]++;
      return counts;
    }, { ea: 0, catalog: 0 });
    if (incompleteExisting.length) return {
      status: "partial",
      reason: "existing-score-unknown",
      targetGrade,
      threshold,
      candidateCount: candidates.length,
      omittedCandidates,
      requestedCandidates,
      quotedCandidateCount,
      scoreSourceCounts,
      plans: []
    };
    const base = {
      ids: [],
      items: [],
      selected: [],
      price: 0,
      unknownPrice: false,
      nextIndex: 0,
      summary: summarize(set, catalog, existing, [])
    };
    if (!base.summary?.low) return { status: "unavailable", reason: base.summary?.reason ?? "input-invalid", plans: [] };
    if (scoreOf2(base) >= threshold) {
      return {
        status: "achieved",
        targetGrade,
        threshold,
        currentScore: scoreOf2(base),
        candidateCount: candidates.length,
        omittedCandidates,
        requestedCandidates,
        quotedCandidateCount,
        scoreSourceCounts,
        plans: []
      };
    }
    let states2 = [base];
    let evaluations = 1;
    const plans = [];
    let bestSeen = base;
    let cheapestSeed = null;
    const canEvaluateComplete = maxEvaluations >= requiredSlots + 1;
    if (canEvaluateComplete && candidates.length >= requiredSlots && requiredSlots > 0) {
      const greedyCandidates = candidates.slice().sort((a, b) => b.score.value - a.score.value || a.row.eaId - b.row.eaId).slice(0, requiredSlots);
      const greedySelected = greedyCandidates.map((candidate) => ({ ...candidate.row, gradingScore: candidate.score.value, firstOwned: false }));
      const greedy = {
        ids: greedyCandidates.map((candidate) => candidate.row.eaId),
        items: greedyCandidates.map((candidate) => ({
          ...candidate.row,
          score: candidate.score.value,
          scoreSource: candidate.score.source,
          price: asPrice(prices, candidate.row.eaId)
        })),
        selected: greedySelected,
        nextIndex: candidates.length,
        price: greedyCandidates.reduce((sum2, candidate) => sum2 + (asPrice(prices, candidate.row.eaId) ?? 0), 0),
        unknownPrice: greedyCandidates.some((candidate) => asPrice(prices, candidate.row.eaId) == null),
        summary: summarize(set, catalog, existing, greedySelected)
      };
      if (greedy.summary?.full === true && scoreOf2(greedy) >= threshold) plans.push(greedy);
    }
    if (canEvaluateComplete && candidates.length >= requiredSlots && requiredSlots > 0) {
      const cheapestCandidates = candidates.slice().sort((a, b) => {
        const aPrice = asPrice(prices, a.row.eaId), bPrice = asPrice(prices, b.row.eaId);
        return (aPrice == null ? Number.POSITIVE_INFINITY : aPrice) - (bPrice == null ? Number.POSITIVE_INFINITY : bPrice) || b.score.value - a.score.value || a.row.eaId - b.row.eaId;
      }).slice(0, requiredSlots);
      const selected = cheapestCandidates.map((candidate) => ({
        ...candidate.row,
        gradingScore: candidate.score.value,
        firstOwned: false
      }));
      const cheapest = {
        ids: cheapestCandidates.map((candidate) => candidate.row.eaId),
        items: cheapestCandidates.map((candidate) => ({
          ...candidate.row,
          score: candidate.score.value,
          scoreSource: candidate.score.source,
          price: asPrice(prices, candidate.row.eaId)
        })),
        selected,
        nextIndex: candidates.length,
        price: cheapestCandidates.reduce((sum2, candidate) => sum2 + (asPrice(prices, candidate.row.eaId) ?? 0), 0),
        unknownPrice: cheapestCandidates.some((candidate) => asPrice(prices, candidate.row.eaId) == null),
        summary: summarize(set, catalog, existing, selected)
      };
      cheapestSeed = cheapest;
      if (cheapest.summary?.full === true && scoreOf2(cheapest) >= threshold) plans.push(cheapest);
    }
    let budgetExhausted = false, beamTruncated = false, timeExhausted = false;
    if (cheapestSeed && !cheapestSeed.unknownPrice && candidates.length > requiredSlots && !timeExhausted && !(cheapestSeed.summary?.full && scoreOf2(cheapestSeed) >= threshold)) {
      const byId = new Map(candidates.map((candidate) => [candidate.row.eaId, candidate]));
      const refinement = refineGalleryCostSteps({
        initial: { ...cheapestSeed, cost: cheapestSeed.price, missingPrices: false },
        seedSteps: galleryPriceBandSeedSteps({
          targets: [{ set, catalog, progress }],
          candidates: candidates.map((candidate) => ({ id: candidate.row.eaId, price: asPrice(prices, candidate.row.eaId), score: candidate.score.value }))
        }),
        candidates: candidates.map((candidate) => ({
          id: candidate.row.eaId,
          price: asPrice(prices, candidate.row.eaId),
          score: candidate.score.value,
          diversityKeys: galleryCostSearchKeys(candidate.row, compiled.tags)
        })),
        maxEvaluations: maxEvaluations - evaluations,
        measure: (state) => ({
          reached: state.summary?.full === true && scoreOf2(state) >= threshold,
          progress: Math.min(1, scoreOf2(state) / Math.max(1, threshold)),
          diversityKey: (state.summary?.low?.tags ?? []).map((tag) => `${tag.id}:${tag.count}:${tag.pct}`).join("|")
        }),
        evaluate: (ids) => {
          const picked = ids.map((id7) => byId.get(id7));
          const selected = picked.map((candidate) => ({ ...candidate.row, gradingScore: candidate.score.value, firstOwned: false }));
          const items = picked.map((candidate) => ({
            ...candidate.row,
            score: candidate.score.value,
            scoreSource: candidate.score.source,
            price: asPrice(prices, candidate.row.eaId)
          }));
          const price2 = items.reduce((sum2, item2) => sum2 + (item2.price ?? 0), 0);
          return {
            ids,
            items,
            selected,
            nextIndex: candidates.length,
            price: price2,
            cost: price2,
            unknownPrice: items.some((item2) => item2.price == null),
            missingPrices: items.some((item2) => item2.price == null),
            summary: summarize(set, catalog, existing, selected)
          };
        }
      });
      let step = refinement.next();
      while (!step.done) {
        const stop6 = yield { evaluations: evaluations + step.value.evaluations };
        if (stop6) timeExhausted = true;
        step = refinement.next(stop6);
      }
      evaluations += step.value.evaluations;
      plans.push(...step.value.plans);
      beamTruncated ||= step.value.truncated === true;
    }
    let scoringBounded = base.summary.selection === "bounded-search";
    let scoreUncertain = base.summary.low.total !== base.summary.high.total || base.summary.ruleDifference;
    for (let depth = 0; depth < set.requiredCards && states2.length && evaluations < maxEvaluations && !timeExhausted; depth++) {
      const next = [];
      expansion: for (const state of states2) for (let index = state.nextIndex; index < candidates.length; index++) {
        if (evaluations >= maxEvaluations) {
          budgetExhausted = true;
          break expansion;
        }
        const candidate = candidates[index];
        const price2 = asPrice(prices, candidate.row.eaId);
        const item2 = { ...candidate.row, score: candidate.score.value, scoreSource: candidate.score.source, price: price2 };
        const selectedRow = { ...candidate.row, gradingScore: candidate.score.value, firstOwned: false };
        const selected = [...state.selected, selectedRow];
        const nextState = {
          ids: [...state.ids, candidate.row.eaId],
          items: [...state.items, item2],
          selected,
          nextIndex: index + 1,
          price: state.price + (price2 ?? 0),
          unknownPrice: state.unknownPrice || price2 == null,
          summary: summarize(set, catalog, existing, selected)
        };
        next.push(nextState);
        evaluations++;
        scoringBounded ||= nextState.summary.selection === "bounded-search";
        scoreUncertain ||= nextState.summary.low?.total !== nextState.summary.high?.total || nextState.summary.ruleDifference;
        if (rank(nextState, bestSeen, threshold) < 0 || scoreOf2(nextState) > scoreOf2(bestSeen)) bestSeen = nextState;
        if (nextState.summary?.full === true && scoreOf2(nextState) >= threshold) plans.push(nextState);
        if (yield { evaluations }) {
          timeExhausted = true;
          break expansion;
        }
      }
      next.sort((a, b) => rank(a, b, threshold));
      beamTruncated ||= next.length > beamWidth;
      states2 = next.slice(0, beamWidth);
      if (next.length > beamWidth && beamWidth > 1) {
        const cheapest = next.slice().sort(cheaperState)[0];
        if (cheapest && !states2.includes(cheapest)) states2[states2.length - 1] = cheapest;
      }
      if (budgetExhausted || timeExhausted) break;
    }
    budgetExhausted ||= evaluations >= maxEvaluations && states2.some((state) => state.ids.length < set.requiredCards && state.nextIndex < candidates.length);
    const scopeTruncated = progress.candidateOnly === true || progress.poolComplete === false;
    const proofInputsKnown = candidates.every((candidate) => candidate.score.source === "ea" && candidate.price != null) && plans.every((state) => !state.summary?.ruleDifference && state.summary?.low?.total === state.summary?.high?.total && state.summary?.selection !== "bounded-search");
    const searchComplete = !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated && omittedCandidates === 0 && !scoringBounded && !scoreUncertain && proofInputsKnown;
    const unique2 = /* @__PURE__ */ new Map();
    for (const state of plans.sort((a, b) => rank(a, b, threshold))) {
      const key = state.ids.slice().sort((a, b) => a - b).join(",");
      if (!unique2.has(key)) unique2.set(key, materialize(state, targetGrade, threshold, scoreOf2(base)));
      if (unique2.size >= Math.max(1, Math.min(10, maxPlans))) break;
    }
    const output = [...unique2.values()];
    if (!output.length) {
      const best = [bestSeen, ...states2].sort((a, b) => rank(a, b, threshold))[0];
      const reason = timeExhausted ? "search-time-exhausted" : budgetExhausted ? "search-budget-exhausted" : omittedCandidates > 0 ? "candidate-search-truncated" : beamTruncated ? "beam-search-truncated" : scoreUncertain ? "score-conditions-unknown" : scoringBounded ? "score-selection-bounded" : "target-unreachable";
      return {
        status: searchComplete ? "no-plan" : "partial",
        reason: scopeTruncated ? "candidate-search-truncated" : reason,
        targetGrade,
        threshold,
        currentScore: scoreOf2(base),
        bestScore: best ? scoreOf2(best) : null,
        candidateCount: candidates.length,
        omittedCandidates,
        requestedCandidates,
        quotedCandidateCount,
        scoreSourceCounts,
        evaluations,
        searchComplete,
        scopeTruncated,
        timeExhausted,
        beamTruncated,
        budgetExhausted,
        plans: []
      };
    }
    const costAudit = cheapestSeed && !cheapestSeed.unknownPrice && !(cheapestSeed.summary?.full === true && scoreOf2(cheapestSeed) >= threshold) ? {
      totalPrice: cheapestSeed.price,
      score: scoreOf2(cheapestSeed),
      missingCards: cheapestSeed.items.length,
      target: threshold,
      reached: false
    } : null;
    return {
      status: "ready",
      targetGrade,
      threshold,
      currentScore: scoreOf2(base),
      candidateCount: candidates.length,
      omittedCandidates,
      requestedCandidates,
      quotedCandidateCount,
      scoreSourceCounts,
      evaluations,
      searchComplete,
      scopeTruncated,
      timeExhausted,
      costAudit,
      beamTruncated,
      budgetExhausted,
      plans: output
    };
  }
  function planGalleryGrade(input) {
    const steps = planGalleryGradeSteps(input);
    let next;
    do {
      next = steps.next();
    } while (!next.done);
    return next.value;
  }

  // src/gallery/joint-planner.js
  var validId5 = (value) => Number.isSafeInteger(value) && value > 0;
  var validScore3 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e8;
  var validPrice3 = (value) => Number.isSafeInteger(value) && value > 0 && value <= 15e6;
  var score = (row) => validScore3(row.gradingScore) ? row.gradingScore : validScore3(row.galleryScore) ? row.galleryScore : null;
  var fail17 = (status, reason, extra = {}) => ({ status, reason, plans: [], ...extra });
  function evaluate(targets, selected) {
    return targets.map((target) => {
      const key = target.progress.rows.filter((row) => selected.has(row.eaId) && !isGalleryOwned(row)).map((row) => row.eaId).sort((a, b) => a - b).join(",");
      let summary2 = target.summaries.get(key);
      if (!summary2) {
        summary2 = summarizeGalleryScore({ set: target.set, catalog: target.catalog, progress: {
          ...target.progress,
          season: "27",
          setId: Number(target.set.id.slice(6)),
          complete: true,
          rows: target.progress.rows.map((row) => isGalleryOwned(row) ? { ...row, collected: true } : selected.has(row.eaId) ? { ...row, collected: true, gradingScore: score(row), firstOwned: false } : row)
        } });
        target.summaries.set(key, summary2);
      }
      return { target, summary: summary2, reached: summary2.full === true && summary2.low?.total >= target.threshold };
    });
  }
  function rank2(a, b, total) {
    const reached = (state) => state.results.filter((result) => result.reached).length;
    const ar = reached(a), br = reached(b);
    if (ar !== br) return br - ar;
    const cost = (state) => state.missingPrices ? Infinity : state.cost;
    if (ar === total) return cost(a) - cost(b) || a.ids.length - b.ids.length;
    const progress = (state) => state.results.reduce((sum2, result) => sum2 + Math.min(1, (result.summary.low?.total ?? 0) / Math.max(1, result.target.threshold)) + Math.min(1, (result.summary.lineup?.length ?? 0) / result.target.set.requiredCards), 0);
    return progress(b) - progress(a) || cost(a) - cost(b) || a.ids.length - b.ids.length;
  }
  function materialize2(state, candidates, budget) {
    const missingPriceIds = state.ids.filter((id7) => candidates.get(id7).price == null);
    return {
      totalPrice: missingPriceIds.length ? null : state.cost,
      missingPriceIds,
      remainingBudget: budget == null || missingPriceIds.length ? null : budget - state.cost,
      items: state.ids.map((id7) => {
        const candidate = candidates.get(id7);
        return {
          ...candidate.row,
          price: candidate.price,
          scoreSource: validScore3(candidate.row.gradingScore) ? "ea" : "catalog",
          targetIds: state.results.filter((result) => result.summary.lineup?.some((row) => row.eaId === id7)).map((result) => result.target.set.id)
        };
      }),
      targets: state.results.map(({ target, summary: summary2, reached }) => ({
        setId: target.set.id,
        name: target.set.name,
        targetGrade: target.targetGrade,
        threshold: target.threshold,
        reached,
        score: summary2.low?.total ?? null,
        scoreHigh: summary2.high?.total ?? null,
        pointsMissing: Math.max(0, target.threshold - (summary2.low?.total ?? 0)),
        unknownFields: summary2.unknownFields ?? [],
        // Directory rewards are not EA claim receipts and are not summed.
        rewards: (target.grade.rewards ?? []).map((reward) => ({ ...reward })),
        rewardStatus: "catalog-only"
      })),
      estimated: state.results.some(({ target, summary: summary2 }) => summary2.lineup?.some((row) => !validScore3(target.progress.rows.find((original) => original.eaId === row.eaId)?.gradingScore)))
    };
  }
  function* planGalleryJointSteps({
    targets,
    budget = null,
    maxPlans = 3,
    maxCandidates = 192,
    maxEvaluations = 3e3,
    beamWidth = 64
  } = {}) {
    if (!Array.isArray(targets) || !targets.length) return fail17("unavailable", "targets-invalid");
    if (budget != null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 1e9)) return fail17("unavailable", "budget-invalid");
    if (![maxPlans, maxCandidates, maxEvaluations, beamWidth].every((value) => Number.isSafeInteger(value) && value > 0) || maxPlans > 10 || maxCandidates > 512 || maxEvaluations > 2e4 || beamWidth > 256) return fail17("unavailable", "search-options-invalid");
    const targetIds = /* @__PURE__ */ new Set(), identities = /* @__PURE__ */ new Map(), allCandidates = /* @__PURE__ */ new Map(), prepared = [], ownedIds = /* @__PURE__ */ new Set();
    const scopes = new Set(targets.map((target) => target.scope).filter((value) => value != null));
    const platforms = new Set(targets.map((target) => target.platform).filter((value) => value != null));
    if (scopes.size > 1 || platforms.size > 1) return fail17("unavailable", "target-context-mismatch");
    for (const target of targets) {
      const { set, catalog, progress } = target;
      if (!/^futgg:[1-9]\d*$/.test(set?.id) || targetIds.has(set.id) || !Array.isArray(set.grades) || !validId5(set.requiredCards) || set.requiredCards > 256 || catalog?.source !== "futgg" || !Array.isArray(progress?.rows) || progress.rows.length > 2e3 || progress.season != null && progress.season !== "27" || progress.setId != null && progress.setId !== Number(set.id.slice(6))) return fail17("unavailable", "target-input-invalid");
      targetIds.add(set.id);
      const grade = set.grades.find((row) => row.name === target.targetGrade);
      if (!grade || !Number.isSafeInteger(grade.threshold) || grade.threshold < 0) return fail17("unavailable", "target-grade-unknown");
      const compiled = compileGalleryScoringRules(catalog);
      if (compiled.status !== "ready") return fail17("unavailable", compiled.reason);
      if (progress.complete === false || progress.rows.some((row) => typeof row.collected !== "boolean" || isGalleryOwned(row) && !validScore3(row.gradingScore))) return fail17("partial", "target-state-unknown");
      const seen = /* @__PURE__ */ new Set();
      for (const row of progress.rows) {
        if (!validId5(row.eaId) || seen.has(row.eaId)) return fail17("unavailable", "duplicate-version");
        seen.add(row.eaId);
        const previous = identities.get(row.eaId);
        if (previous && [
          "collected",
          "gradingScore",
          "galleryScore",
          "playerEaId",
          "firstOwned",
          "holographic",
          "rarityEaId",
          "clubEaId",
          "leagueEaId",
          "nationEaId",
          "overall",
          "weakFoot",
          "skillMoves",
          "positions"
        ].some((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(row[key] ?? null))) return fail17("partial", "version-facts-conflict");
        identities.set(row.eaId, row);
        if (isGalleryOwned(row)) {
          ownedIds.add(row.eaId);
          continue;
        }
        const quote2 = target.prices?.[row.eaId], price2 = validPrice3(quote2) ? quote2 : null;
        const existing = allCandidates.get(row.eaId);
        if (existing) {
          existing.memberships++;
          existing.diversityKeys.push(...galleryCostSearchKeys(row, compiled.tags).map((key) => `${set.id}:${key}`));
          if (existing.price != null && price2 != null && existing.price !== price2) existing.priceConflict = true;
          existing.price = existing.priceConflict ? null : price2 ?? existing.price;
        } else allCandidates.set(row.eaId, {
          row,
          price: price2,
          memberships: 1,
          diversityKeys: galleryCostSearchKeys(row, compiled.tags).map((key) => `${set.id}:${key}`)
        });
      }
      prepared.push({ ...target, grade, threshold: grade.threshold, summaries: /* @__PURE__ */ new Map() });
    }
    for (const id7 of ownedIds) allCandidates.delete(id7);
    for (const target of prepared) target.progress = { ...target.progress, rows: target.progress.rows.map((row) => ownedIds.has(row.eaId) && !isGalleryOwned(row) ? { ...row, held: true } : row) };
    const candidateRows = [...allCandidates.values()].filter((candidate) => score(candidate.row) != null).map((candidate) => ({ ...candidate, id: candidate.row.eaId, score: score(candidate.row) }));
    const selectedCandidates = selectGalleryCandidatePool(candidateRows, maxCandidates);
    const omittedCandidates = allCandidates.size - selectedCandidates.length;
    const candidateMap = new Map(selectedCandidates.map((candidate) => [candidate.row.eaId, candidate]));
    const base = { ids: [], nextIndex: 0, cost: 0, missingPrices: false, results: evaluate(prepared, /* @__PURE__ */ new Set()) };
    if (base.results.some((result) => !result.summary.low)) return fail17("unavailable", "scoring-unavailable");
    if (base.results.every((result) => result.reached)) return { status: "achieved", plans: [], targets: materialize2(base, candidateMap, budget).targets };
    let states2 = [base], evaluations = 1, budgetExhausted = false, beamTruncated = false, timeExhausted = false;
    let bestSeen = base;
    let scoringBounded = base.results.some((result) => result.summary.selection === "bounded-search");
    let uncertain = base.results.some((result) => result.summary.status === "uncertain"), missingPrice = false, overBudget = false;
    const plans = [], depthLimit = prepared.reduce((sum2, target) => sum2 + target.set.requiredCards, 0);
    let cheapestComplete = null;
    for (const mode of ["price", "score"]) {
      if (evaluations >= maxEvaluations) break;
      const selected = /* @__PURE__ */ new Set();
      for (const target of prepared) {
        const missingSlots = Math.max(0, target.set.requiredCards - target.progress.rows.filter(isGalleryOwned).length);
        const candidates = target.progress.rows.filter((row) => !isGalleryOwned(row) && candidateMap.has(row.eaId)).map((row) => candidateMap.get(row.eaId)).sort((a, b) => {
          const price2 = (a.price ?? Infinity) - (b.price ?? Infinity);
          return (mode === "price" ? price2 : score(b.row) - score(a.row)) || score(b.row) - score(a.row) || a.row.eaId - b.row.eaId;
        });
        for (const candidate of candidates.slice(0, Math.max(1, missingSlots))) selected.add(candidate.row.eaId);
      }
      if (!selected.size) continue;
      const ids = [...selected], cost = ids.reduce((sum2, id7) => sum2 + (candidateMap.get(id7).price ?? 0), 0);
      const missingPrices = ids.some((id7) => candidateMap.get(id7).price == null);
      if (budget != null && (missingPrices || cost > budget)) continue;
      const results = evaluate(prepared, selected);
      evaluations++;
      const value = { ids, nextIndex: selectedCandidates.length, cost, missingPrices, results };
      if (!missingPrices && !results.every((result) => result.reached) && (!cheapestComplete || cost < cheapestComplete.cost)) cheapestComplete = value;
      if (rank2(value, bestSeen, prepared.length) < 0) bestSeen = value;
      if (results.every((result) => result.reached)) plans.push(value);
      if (yield { evaluations }) {
        timeExhausted = true;
        break;
      }
      if (mode === "price" && !missingPrices && !results.every((result) => result.reached)) {
        const refinement = refineGalleryCostSteps({
          initial: value,
          seedSteps: galleryPriceBandSeedSteps({
            targets: prepared,
            candidates: selectedCandidates.map((candidate) => ({ id: candidate.row.eaId, price: candidate.price, score: score(candidate.row) }))
          }),
          candidates: selectedCandidates.map((candidate) => ({
            id: candidate.row.eaId,
            price: candidate.price,
            score: score(candidate.row),
            diversityKeys: candidate.diversityKeys
          })),
          maxEvaluations: maxEvaluations - evaluations,
          measure: (state) => ({
            reached: state.results.every((result) => result.reached),
            progress: state.results.reduce((sum2, result) => sum2 + Math.min(
              1,
              (result.summary.low?.total ?? 0) / Math.max(1, result.target.threshold)
            ), 0),
            diversityKey: state.results.map((result) => (result.summary.low?.tags ?? []).map((tag) => `${result.target.set.id}:${tag.id}:${tag.count}:${tag.pct}`).join("|")).join(";")
          }),
          evaluate: (ids2) => {
            const cost2 = ids2.reduce((sum2, id7) => sum2 + (candidateMap.get(id7).price ?? 0), 0);
            if (budget != null && cost2 > budget) return null;
            return {
              ids: ids2,
              nextIndex: selectedCandidates.length,
              cost: cost2,
              missingPrices: ids2.some((id7) => candidateMap.get(id7).price == null),
              results: evaluate(prepared, new Set(ids2))
            };
          }
        });
        let step = refinement.next();
        while (!step.done) {
          const stop6 = yield { evaluations: evaluations + step.value.evaluations };
          if (stop6) timeExhausted = true;
          step = refinement.next(stop6);
        }
        evaluations += step.value.evaluations;
        plans.push(...step.value.plans);
        beamTruncated ||= step.value.truncated === true;
        if (timeExhausted) break;
      }
    }
    for (let depth = 0; depth < depthLimit && states2.length && !timeExhausted; depth++) {
      const next = [];
      expansion: for (const state of states2) for (let index = state.nextIndex; index < selectedCandidates.length; index++) {
        if (evaluations >= maxEvaluations) {
          budgetExhausted = true;
          break expansion;
        }
        const candidate = selectedCandidates[index];
        if (budget != null && candidate.price == null) {
          missingPrice = true;
          continue;
        }
        const cost = state.cost + (candidate.price ?? 0);
        if (budget != null && cost > budget) {
          overBudget = true;
          continue;
        }
        const ids = [...state.ids, candidate.row.eaId];
        const results = evaluate(prepared, new Set(ids));
        evaluations++;
        const value = { ids, nextIndex: index + 1, cost, missingPrices: state.missingPrices || candidate.price == null, results };
        if (rank2(value, bestSeen, prepared.length) < 0) bestSeen = value;
        scoringBounded ||= results.some((result) => result.summary.selection === "bounded-search");
        uncertain ||= results.some((result) => result.summary.status === "uncertain");
        if (results.every((result) => result.reached)) plans.push(value);
        next.push(value);
        if (yield { evaluations }) {
          timeExhausted = true;
          break expansion;
        }
      }
      next.sort((a, b) => rank2(a, b, prepared.length));
      beamTruncated ||= next.length > beamWidth;
      states2 = next.slice(0, beamWidth);
      if (budgetExhausted || timeExhausted) break;
    }
    const scopeTruncated = prepared.some((target) => target.progress.candidateOnly === true || target.progress.poolComplete === false);
    const proofInputsKnown = candidateRows.every((candidate) => validScore3(candidate.row.gradingScore) && candidate.price != null) && plans.every((state) => state.results.every((result) => result.summary.selection !== "bounded-search" && !result.summary.ruleDifference && result.summary.low?.total === result.summary.high?.total));
    const searchComplete = !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated && !omittedCandidates && !scoringBounded && !uncertain && !missingPrice && proofInputsKnown;
    const common = {
      budget,
      evaluations,
      searchComplete,
      scopeTruncated,
      timeExhausted,
      beamTruncated,
      budgetExhausted,
      candidateCount: selectedCandidates.length,
      omittedCandidates,
      requestedCandidates: allCandidates.size,
      quotedCandidateCount: candidateRows.filter((candidate) => candidate.price != null).length
    };
    const output = plans.sort((a, b) => rank2(a, b, prepared.length)).slice(0, maxPlans).map((state) => materialize2(state, candidateMap, budget));
    const costAudit = cheapestComplete ? {
      totalPrice: cheapestComplete.cost,
      score: Math.min(...cheapestComplete.results.map((result) => result.summary.low?.total ?? 0)),
      target: Math.max(...prepared.map((target) => target.threshold)),
      reached: false
    } : null;
    if (output.length) return { status: "ready", ...common, costAudit, plans: output };
    const reason = timeExhausted ? "search-time-exhausted" : budgetExhausted ? "search-budget-exhausted" : omittedCandidates ? "candidate-search-truncated" : beamTruncated ? "beam-search-truncated" : missingPrice ? "price-unknown" : uncertain ? "score-conditions-unknown" : scoringBounded ? "score-selection-bounded" : overBudget ? "budget-unreachable" : "target-unreachable";
    return fail17(
      searchComplete ? "no-plan" : "partial",
      scopeTruncated ? "candidate-search-truncated" : reason,
      { ...common, targets: materialize2(bestSeen, candidateMap, budget).targets }
    );
  }

  // src/gallery/targets.js
  var sources = /* @__PURE__ */ new Set(["futgg", "fodder"]);
  var grades2 = /* @__PURE__ */ new Set(["D", "C", "B", "A", "S"]);
  var validScope2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
  var validId6 = (id7, source) => typeof id7 === "string" && id7.length <= 330 && id7.startsWith(`${source}:`) && (source === "futgg" ? /^futgg:[1-9]\d{0,15}$/.test(id7) : /^fodder:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id7));
  var emptyGalleryTargets = () => ({ targets: [], budget: null });
  function normalizeGalleryTargets(value, source) {
    if (!sources.has(source) || !Array.isArray(value?.targets) || value.targets.length > 1024 || value.targets.some((row) => !validId6(row?.setId, source) || !grades2.has(row?.grade)) || new Set(value.targets.map((row) => row.setId)).size !== value.targets.length || value.budget !== null && (!Number.isSafeInteger(value.budget) || value.budget < 0)) {
      throw new Error("FC27_GALLERY_TARGETS_INVALID");
    }
    return { targets: value.targets.map(({ setId, grade }) => ({ setId, grade })), budget: value.budget };
  }
  function reconcileGalleryTargets(value, catalog) {
    const clean = normalizeGalleryTargets(value, catalog?.source);
    const sets2 = new Map(catalog.categories.flatMap((category) => category.sets).map((set) => [set.id, set]));
    return { ...clean, targets: clean.targets.filter((row) => sets2.get(row.setId)?.grades.some((grade) => grade.name === row.grade)) };
  }
  function createGalleryTargetStore({ get, set } = {}) {
    let tail = Promise.resolve();
    const key = (scope2, source) => {
      if (!validScope2(scope2) || !sources.has(source)) throw new Error("FC27_GALLERY_TARGETS_SCOPE_INVALID");
      return `fcat-fc27-gallery-targets:${JSON.stringify([scope2, source])}`;
    };
    return Object.freeze({
      async load(scope2, source) {
        try {
          await tail;
          const stored = await get(key(scope2, source), null);
          if (stored === null || stored === void 0) return { status: "observed", ...emptyGalleryTargets() };
          if (stored.schema !== 1 || stored.scope !== scope2 || stored.source !== source) throw new Error();
          return { status: "observed", ...normalizeGalleryTargets(stored, source) };
        } catch {
          return { status: "unavailable", reason: "FC27_GALLERY_TARGETS_READ_FAILED", ...emptyGalleryTargets() };
        }
      },
      save(scope2, source, value) {
        let record, storageKey;
        try {
          storageKey = key(scope2, source);
          record = { schema: 1, scope: scope2, source, ...normalizeGalleryTargets(value, source) };
        } catch {
          return Promise.resolve({ status: "unavailable", reason: "FC27_GALLERY_TARGETS_INVALID" });
        }
        const task = tail.then(async () => {
          try {
            await set(storageKey, record);
            return { status: "observed" };
          } catch {
            return { status: "unavailable", reason: "FC27_GALLERY_TARGETS_SAVE_FAILED" };
          }
        });
        tail = task;
        return task;
      }
    });
  }

  // src/gallery/browse.js
  var text4 = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
  function browseGallerySets(catalog, {
    categoryId = null,
    query = "",
    order: order2 = "catalog",
    followedOnly = false,
    targets = [],
    summaries = /* @__PURE__ */ new Map()
  } = {}) {
    const needle = text4(query), followed = new Set(targets.map((row) => row.setId));
    const rows = (catalog?.categories ?? []).filter((category) => !categoryId || category.id === categoryId).flatMap((category) => category.sets.map((set) => ({ category, set }))).filter(({ category, set }) => (!followedOnly || followed.has(set.id)) && (!needle || text4(`${category.name} ${set.name} ${set.description ?? ""}`).includes(needle)));
    const name = (a, b) => a.set.name.localeCompare(b.set.name) || a.set.id.localeCompare(b.set.id);
    if (order2 === "name") rows.sort(name);
    if (order2 === "cards") rows.sort((a, b) => a.set.requiredCards - b.set.requiredCards || name(a, b));
    if (order2 === "progress") {
      const progress = (row) => {
        const summary2 = summaries.get(row.set.id);
        return Number.isSafeInteger(summary2?.collected) && summary2.collected >= 0 ? summary2.collected / row.set.requiredCards : null;
      };
      rows.sort((a, b) => {
        const x = progress(a), y = progress(b);
        return x === null && y !== null ? 1 : y === null && x !== null ? -1 : (y ?? 0) - (x ?? 0) || name(a, b);
      });
    }
    return rows;
  }

  // src/gallery/selection.js
  var validId7 = (value) => Number.isSafeInteger(value) && value > 0;
  var keyOf3 = (row) => validId7(row?.eaId) ? String(row.eaId) : null;
  var textOf = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
  var priceOf3 = (prices, id7) => {
    const value = prices?.[id7] ?? prices?.[Number(id7)];
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  function filterGalleryCards(rows, { filter = "all", query = "", order: order2 = "catalog", prices = {}, lineupIds = [] } = {}) {
    const needle = textOf(query);
    const lineup = new Set(lineupIds);
    const output = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!keyOf3(row)) return false;
      if (filter === "lineup" ? !lineup.has(row.eaId) : filter === "firstOwned" ? row.firstOwned !== true : filter === "held" ? row.held !== true : filter === "selected" ? false : filter !== "all" && row.status !== filter) return false;
      return !needle || textOf(`${row.name ?? ""} ${row.version ?? ""} ${row.overall ?? ""}`).includes(needle);
    });
    const name = (a, b) => textOf(a.name).localeCompare(textOf(b.name)) || Number(a.eaId) - Number(b.eaId);
    if (order2 === "name") output.sort(name);
    else if (order2 === "score") output.sort((a, b) => (b.galleryScore ?? -Infinity) - (a.galleryScore ?? -Infinity) || name(a, b));
    else if (order2 === "price") output.sort((a, b) => {
      const x = priceOf3(prices, a.eaId), y = priceOf3(prices, b.eaId);
      return (x == null) - (y == null) || (x ?? Infinity) - (y ?? Infinity) || name(a, b);
    });
    return output;
  }
  function paginateGalleryCards(rows, { page = 1, pageSize = 24 } = {}) {
    const size = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 24;
    const total = Array.isArray(rows) ? rows.length : 0;
    const pages = Math.max(1, Math.ceil(total / size));
    const current2 = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
    return { rows: (rows ?? []).slice((current2 - 1) * size, current2 * size), page: current2, pages, total, pageSize: size };
  }
  function reconcileGallerySelection(selection, rows) {
    const allowed = new Map((Array.isArray(rows) ? rows : []).filter((row) => !isGalleryOwned(row) && row?.collected === false && keyOf3(row)).map((row) => [keyOf3(row), row]));
    const next = /* @__PURE__ */ new Map();
    for (const [id7, value] of selection instanceof Map ? selection : []) {
      if (allowed.has(String(id7))) next.set(String(id7), { ...value, eaId: Number(id7), name: allowed.get(String(id7)).name });
    }
    return next;
  }
  function selectCheapestGalleryCards(rows, count2, prices) {
    if (!Number.isSafeInteger(count2) || count2 < 1) return [];
    return (Array.isArray(rows) ? rows : []).filter((row) => !isGalleryOwned(row) && row?.collected === false && priceOf3(prices, row.eaId) != null).slice().sort((a, b) => priceOf3(prices, a.eaId) - priceOf3(prices, b.eaId) || (b.galleryScore ?? -Infinity) - (a.galleryScore ?? -Infinity) || Number(a.eaId) - Number(b.eaId)).slice(0, count2);
  }
  function summarizeGallerySelection(selection, rows, prices = {}) {
    const rowMap = new Map((Array.isArray(rows) ? rows : []).map((row) => [keyOf3(row), row]));
    const selected = [];
    let total = 0, unknownPrice = false, score2 = 0;
    for (const [id7] of selection instanceof Map ? selection : []) {
      const row = rowMap.get(String(id7));
      if (!row || isGalleryOwned(row) || row.collected !== false) continue;
      selected.push(row);
      const price2 = priceOf3(prices, id7);
      if (price2 == null) unknownPrice = true;
      else total += price2;
      const value = Number.isSafeInteger(row.gradingScore) ? row.gradingScore : row.galleryScore;
      if (Number.isSafeInteger(value)) score2 += value;
    }
    return { selected, count: selected.length, totalPrice: unknownPrice ? null : total, unknownPrice, score: score2 };
  }

  // src/gallery/preview.js
  function* previewGallerySelectionSteps({ set, catalog, progress, selectedIds = [] } = {}) {
    const ids = new Set(selectedIds);
    if (!progress?.rows) return { status: "unavailable", reason: "input-invalid" };
    const candidates = progress.rows.filter((row) => ids.has(row.eaId) && !isGalleryOwned(row) && row.collected === false);
    const estimated = candidates.some((row) => !Number.isSafeInteger(row.gradingScore));
    const rows = progress.rows.map((row) => ids.has(row.eaId) && !isGalleryOwned(row) && row.collected === false ? {
      ...row,
      collected: true,
      firstOwned: false,
      gradingScore: Number.isSafeInteger(row.gradingScore) ? row.gradingScore : row.galleryScore
    } : row);
    const summary2 = yield* summarizeGalleryScoreSteps({ set, catalog, progress: { ...progress, rows } });
    return { ...summary2, estimated, selectedCount: candidates.length, preview: true };
  }
  function* planGalleryGradeOverviewSteps(input) {
    if (!Array.isArray(input?.set?.grades)) return { status: "unavailable", reason: "input-invalid", grades: [] };
    const grades3 = [];
    for (const grade of input.set.grades) {
      const result = yield* planGalleryGradeSteps({ ...input, targetGrade: grade.name, maxPlans: 1 });
      grades3.push({
        grade: grade.name,
        threshold: grade.threshold,
        status: result.status,
        reason: result.reason ?? null,
        searchComplete: result.searchComplete === true,
        candidate: result.plans?.[0] ?? null
      });
      if (yield { phase: "grade", completed: grades3.length, total: input.set.grades.length }) break;
    }
    return { status: grades3.length === input.set.grades.length ? "observed" : "partial", grades: grades3 };
  }

  // src/gallery/benchmark.js
  function benchmarkGalleryPlans({ jointPlan, individualPlans = [] } = {}) {
    if (!jointPlan || !Array.isArray(jointPlan.items) || !Array.isArray(individualPlans)) {
      return { status: "unavailable", reason: "benchmark-input-invalid" };
    }
    const jointIds = new Set(jointPlan.items.map((item2) => item2.eaId));
    if (jointPlan.totalPrice == null || individualPlans.some((plan) => plan?.totalPrice == null)) {
      return { status: "partial", reason: "price-unknown", sharedVersions: 0, savings: null };
    }
    const separate = individualPlans.reduce((sum2, plan) => sum2 + plan.totalPrice, 0);
    const memberships = /* @__PURE__ */ new Map();
    for (const plan of individualPlans) for (const item2 of plan.items ?? []) memberships.set(item2.eaId, (memberships.get(item2.eaId) ?? 0) + 1);
    const uniqueSeparate = new Set(individualPlans.flatMap((plan) => (plan.items ?? []).map((item2) => item2.eaId)));
    return {
      status: "observed",
      jointPrice: jointPlan.totalPrice,
      separatePrice: separate,
      savings: separate - jointPlan.totalPrice,
      sharedVersions: [...memberships.values()].filter((value) => value > 1).length,
      jointCardCount: jointIds.size,
      separateCardCount: uniqueSeparate.size,
      equivalentInput: true
    };
  }
  function* planGallerySequentialSteps({ targets = [] } = {}) {
    const acquired = /* @__PURE__ */ new Map(), plans = [];
    for (const target of targets) {
      const progress = { ...target.progress, rows: target.progress.rows.map((row) => acquired.has(row.eaId) && row.collected === false ? { ...row, collected: true, firstOwned: false, gradingScore: acquired.get(row.eaId).score } : row) };
      const result = yield* planGalleryGradeSteps({ ...target, progress, maxPlans: 1 });
      if (result.status === "achieved") {
        plans.push({ items: [], totalPrice: 0 });
        continue;
      }
      const candidate = result.plans?.[0];
      if (result.status !== "ready" || !candidate || candidate.totalPrice == null) return { status: "partial", reason: result.reason ?? "price-unknown", plans };
      plans.push(candidate);
      for (const item2 of candidate.items) acquired.set(item2.eaId, item2);
      if (yield { completed: plans.length, total: targets.length }) return { status: "partial", reason: "search-time-exhausted", plans };
    }
    return { status: "observed", plans, totalPrice: plans.reduce((sum2, plan) => sum2 + plan.totalPrice, 0), order: targets.map((target) => target.set.id) };
  }

  // src/gallery/replan.js
  var validId8 = (value) => Number.isSafeInteger(value) && value > 0;
  var validPrice4 = (value) => Number.isSafeInteger(value) && value >= 150 && value <= 15e6;
  var safeFailures = /* @__PURE__ */ new Set([
    "FC27_GALLERY_NO_LISTING",
    "FC27_BUY_NO_LISTING",
    "FC27_GALLERY_BUDGET_EXCEEDED",
    "FC27_BUY_LISTING_CHANGED",
    "FC27_BUY_LISTING_UNAVAILABLE",
    "FC27_BUY_REJECTED",
    "FC27_BUY_INSUFFICIENT_COINS"
  ]);
  var noListing = /* @__PURE__ */ new Set(["FC27_GALLERY_NO_LISTING", "FC27_BUY_NO_LISTING"]);
  var blocked9 = (reason) => ({ status: "blocked", reason, plans: [] });
  function isGalleryPurchaseReplanSafe(outcome = {}) {
    if (outcome?.status !== "partial" || outcome?.collection?.status !== "confirmed" || !Array.isArray(outcome.results) || !outcome.failures?.length || !safeFailures.has(outcome.reason)) return false;
    const resultIds = /* @__PURE__ */ new Set();
    for (const result of outcome.results) {
      if (!validId8(result?.definitionId) || resultIds.has(result.definitionId) || !["waiting", "club", "collected"].includes(result.state)) return false;
      resultIds.add(result.definitionId);
    }
    return outcome.failures.every((failure) => resultIds.has(failure.definitionId) && safeFailures.has(failure.reason) && outcome.results.some((result) => result.definitionId === failure.definitionId && result.state === "waiting")) && Number.isSafeInteger(outcome.spent) && outcome.spent >= 0;
  }
  function replanableGalleryFailures(outcome = {}) {
    if (!isGalleryPurchaseReplanSafe(outcome)) return [];
    return outcome.failures.map((row) => row.definitionId).filter((id7, index, values6) => values6.indexOf(id7) === index);
  }
  function* planGalleryRemainderSteps({
    targets,
    outcome,
    ledger = {},
    budget = null,
    mode = "single",
    searchOptions = {}
  } = {}) {
    if (!["single", "joint"].includes(mode) || !Array.isArray(targets) || !targets.length || mode === "single" && targets.length !== 1 || targets.some((target) => !Array.isArray(target?.progress?.rows))) return blocked9("target-input-invalid");
    if (!isGalleryPurchaseReplanSafe(outcome)) {
      return blocked9("purchase-recovery-required");
    }
    if (budget !== null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 165e6)) return blocked9("budget-invalid");
    const rows = new Map(targets.flatMap((target) => target.progress.rows).map((row) => [row.eaId, row]));
    const receipts = /* @__PURE__ */ new Map(), exclusions = new Set(ledger.excludedIds ?? []), quotes = { ...ledger.quotes };
    for (const entry of ledger.receipts ?? []) {
      if (!validId8(entry.definitionId) || !rows.has(entry.definitionId) || receipts.has(entry.definitionId) || entry.price !== 0 && !validPrice4(entry.price)) return blocked9("purchase-ledger-invalid");
      receipts.set(entry.definitionId, { ...entry });
    }
    let attemptSpent = 0;
    for (const entry of outcome.results) {
      if (!rows.has(entry.definitionId)) return blocked9("purchase-result-mismatch");
      if (entry.state === "waiting") continue;
      const price2 = entry.state === "club" ? entry.price : 0;
      if (entry.state === "club" && !validPrice4(price2)) return blocked9("purchase-result-mismatch");
      attemptSpent += price2;
      const previous = receipts.get(entry.definitionId);
      if (previous && previous.price !== price2) return blocked9("purchase-result-mismatch");
      receipts.set(entry.definitionId, { definitionId: entry.definitionId, price: price2 });
    }
    if (attemptSpent !== outcome.spent || new Set(outcome.results.map((row) => row.definitionId)).size !== outcome.results.length) {
      return blocked9("purchase-result-mismatch");
    }
    for (const failure of outcome.failures) {
      if (!outcome.results.some((row) => row.definitionId === failure.definitionId && row.state === "waiting")) return blocked9("purchase-result-mismatch");
      if (noListing.has(failure.reason)) exclusions.add(failure.definitionId);
      if (failure.observedPrice != null) {
        if (!validPrice4(failure.observedPrice)) return blocked9("purchase-result-mismatch");
        quotes[failure.definitionId] = failure.observedPrice;
      }
    }
    if ([...exclusions].some((id7) => !validId8(id7))) return blocked9("purchase-ledger-invalid");
    const spent = [...receipts.values()].reduce((sum2, row) => sum2 + row.price, 0);
    if (budget !== null && spent > budget) return blocked9("purchase-ledger-invalid");
    const remainingBudget = budget === null ? null : budget - spent;
    const nextTargets = targets.map((target) => ({
      ...target,
      prices: { ...target.prices, ...quotes },
      progress: { ...target.progress, rows: target.progress.rows.map((row) => {
        const receipt = receipts.get(row.eaId);
        if (!receipt || row.collected === true) return { ...row };
        const score2 = row.gradingScore ?? row.galleryScore;
        return { ...row, collected: true, gradingScore: score2, firstOwned: false, purchaseProjected: true };
      }) }
    }));
    const nextLedger = { receipts: [...receipts.values()], excludedIds: [...exclusions], quotes };
    const searchTargets = nextTargets.map((target) => ({ ...target, progress: {
      ...target.progress,
      rows: target.progress.rows.filter((row) => !exclusions.has(row.eaId) || row.collected)
    } }));
    const result = mode === "single" ? yield* planGalleryGradeSteps({ ...searchTargets[0], ...searchOptions }) : yield* planGalleryJointSteps({ targets: searchTargets, ...searchOptions, budget: remainingBudget });
    const common = { ...result, targets: nextTargets, ledger: nextLedger, spent, remainingBudget };
    if (result.status !== "ready" || remainingBudget === null) return common;
    const plans = result.plans.filter((plan) => plan.totalPrice !== null && plan.totalPrice <= remainingBudget);
    return plans.length ? { ...common, plans } : {
      ...common,
      status: "partial",
      reason: result.plans.some((plan) => plan.totalPrice === null) ? "price-unknown" : "budget-unreachable",
      plans: []
    };
  }

  // src/gallery/first-owner-history.js
  var validId9 = (value) => Number.isSafeInteger(value) && value > 0;
  function galleryFirstOwnerHistoryAction(row) {
    if (row?.firstOwnedSource === "local-history") return "clear";
    return row?.collected === true && row.firstOwned !== true ? "mark" : null;
  }
  function normalizeGalleryFirstOwnerHistory(rows, { max = 1e5 } = {}) {
    if (!Array.isArray(rows) || rows.length > max) return [];
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const definitionId = Number(row?.definitionId);
      if (!validId9(definitionId) || typeof row?.firstOwned !== "boolean") continue;
      const updatedAt = Number.isSafeInteger(row.updatedAt) && row.updatedAt >= 0 ? row.updatedAt : 0;
      result.set(definitionId, { definitionId, firstOwned: row.firstOwned, updatedAt });
    }
    return [...result.values()].sort((a, b) => a.definitionId - b.definitionId);
  }
  function toggleGalleryFirstOwnerHistory(history, definitionId, firstOwned, updatedAt = Date.now()) {
    const current2 = normalizeGalleryFirstOwnerHistory(history);
    const id7 = Number(definitionId);
    if (!validId9(id7) || typeof firstOwned !== "boolean" || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return current2;
    const next = current2.filter((row) => row.definitionId !== id7);
    next.push({ definitionId: id7, firstOwned, updatedAt });
    return normalizeGalleryFirstOwnerHistory(next);
  }
  function removeGalleryFirstOwnerHistory(history, definitionId) {
    const id7 = Number(definitionId);
    return normalizeGalleryFirstOwnerHistory(history).filter((row) => row.definitionId !== id7);
  }

  // src/adapters/browser/fc27-gallery-view.js
  function selectGallerySetIcon(candidates, random = Math.random) {
    const images = candidates.filter((value) => typeof value === "string" && value.startsWith("https://"));
    return images.length ? images[Math.floor(random() * images.length)] : null;
  }
  function galleryGradeSegments(grades3, summary2) {
    const score2 = Number.isFinite(summary2?.low?.total) ? summary2.low.total : null;
    return grades3.map((grade, index) => {
      const previous = grades3[index - 1]?.threshold ?? 0;
      const reached = score2 !== null && score2 >= grade.threshold;
      return {
        grade,
        reached,
        current: reached && !(score2 >= grades3[index + 1]?.threshold),
        fraction: score2 === null ? 0 : grade.threshold > previous ? Math.max(0, Math.min(1, (score2 - previous) / (grade.threshold - previous))) : 1
      };
    });
  }
  function sameGalleryRuntimeCards(left, right) {
    if (left === right) return true;
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
    for (const [id7, card] of left) if (!right.has(id7) || right.get(id7) !== card) return false;
    return true;
  }
  function galleryPlanningStateKey(detail) {
    const progress = detail?.progress;
    const fields4 = [
      "eaId",
      "playerEaId",
      "collected",
      "inClub",
      "held",
      "gradingScore",
      "galleryScore",
      "firstOwned",
      "holographic",
      "overall",
      "nationEaId",
      "clubEaId",
      "leagueEaId",
      "rarityEaId",
      "positions",
      "weakFoot",
      "skillMoves"
    ];
    const expired = detail?.priceSnapshot?.expiresAt != null && Date.now() >= detail.priceSnapshot.expiresAt;
    const quotes = detail?.priceSnapshot ? expired ? {} : detail.priceSnapshot.freshPrices : detail?.prices;
    return JSON.stringify([
      detail?.status,
      detail?.scope,
      detail?.stale === true,
      detail?.poolStale === true,
      detail?.pool?.revision,
      progress?.complete !== false,
      progress?.candidateOnly === true,
      progress?.poolComplete !== false,
      (progress?.rows ?? []).map((row) => fields4.map((key) => row[key] ?? null)).sort((a, b) => a[0] - b[0]),
      (progress?.rows ?? []).map((row) => [row.eaId, quotes?.[row.eaId] ?? null]).sort((a, b) => a[0] - b[0])
    ]);
  }
  function mountFc27GalleryView({
    document,
    shadow,
    host,
    provider,
    loadSet = null,
    loadPrices = null,
    accountScope = () => null,
    assets = null,
    prices = null,
    marketCompare = null,
    diagnosticLog: diagnosticLog2 = null,
    nativeRenderer = null,
    gradePlanner = planGalleryGrade,
    targetStore = null,
    sync = null,
    purchase = null,
    setFirstOwner = null,
    planStore = null,
    timers = document.defaultView,
    visible = () => host.isConnected && host.getClientRects().length > 0 && document.visibilityState !== "hidden"
  }) {
    const node = (id7) => shadow.getElementById(id7);
    const add = (parent, tag, value = "", className = "") => {
      const child = document.createElement(tag);
      child.textContent = value;
      child.className = className;
      parent.append(child);
      return child;
    };
    const diag = (input) => {
      try {
        return Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", ...input })).catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    };
    let buying = false, purchaseSummary = null;
    let purchaseReplan = null;
    const refreshPurchases = async () => {
      if (typeof purchase?.inspect !== "function" || buying) return;
      const identity5 = scope2();
      try {
        const value = await purchase.inspect();
        if (disposed || !active || identity5 !== scope2()) return;
        purchaseSummary = value;
        node("gallery-purchase-resume").hidden = value.status !== "observed" || !(value.recovery || value.remaining > 0 || value.collection?.status === "pending");
      } catch {
      }
    };
    const runPurchase = async (input) => {
      if (buying || typeof purchase !== "function" || checkScope() === false) return;
      const identity5 = scope2();
      buying = true;
      const dialog = node("gallery-purchase-dialog"), output = node("gallery-purchase-message");
      node("gallery-purchase-close").hidden = true;
      node("gallery-purchase-stop").hidden = false;
      node("gallery-purchase-stop").disabled = false;
      node("gallery-purchase-progress").value = 0;
      output.textContent = "\u6B63\u5728\u6838\u5BF9\u8D2D\u4E70\u6E05\u5355\u2026";
      node("gallery-purchase-results")?.replaceChildren();
      dialog.showModal();
      const phases = {
        search: "\u67E5\u4EF7",
        buying: "\u4E70\u5165",
        bought: "\u5DF2\u4E70\u5165",
        moving: "\u5165\u5E93",
        completed: "\u5DF2\u5165\u5E93",
        "already-collected": "\u5DF2\u6536\u96C6\uFF0C\u8DF3\u8FC7",
        failed: "\u672A\u4E70\u5230\uFF0C\u7EE7\u7EED\u5176\u4F59\u5361",
        progress: "\u5904\u7406\u4E2D"
      };
      try {
        const outcome = await purchase({
          ...input,
          approved: true,
          isCurrent: () => !disposed && active && identity5 === scope2(),
          onProgress: (progress) => {
            node("gallery-purchase-progress").max = progress.total || 1;
            node("gallery-purchase-progress").value = progress.completed;
            output.textContent = `${phases[progress.phase] ?? "\u5904\u7406\u4E2D"} ${progress.index}/${progress.total} \xB7 \u5DF2\u8D2D\u4E70 ${progress.purchased} \u5F20 \xB7 ${count2(progress.spent)} \u91D1\u5E01`;
          }
        });
        if (disposed || !active || identity5 !== scope2()) return;
        output.textContent = `${outcome.status === "purchased" ? "\u8D2D\u4E70\u5B8C\u6210" : "\u8D2D\u4E70\u672A\u5B8C\u6210"} \xB7 \u5DF2\u8D2D\u4E70 ${outcome.purchased ?? 0} \u5F20 \xB7 ${count2(outcome.spent ?? 0)} \u91D1\u5E01`;
        if (outcome.status !== "purchased") output.textContent += ` \xB7 ${outcome.reason ?? outcome.status}`;
        output.textContent += " \xB7 \u51FA\u552E\u8BA1\u5212\uFF1A\u4E70\u5165\u540E\u9ED8\u8BA4\u8FDB\u5165 Club \u5E76\u4FDD\u7559\uFF0C\u4E0D\u81EA\u52A8\u6302\u724C\uFF1B\u6302\u724C/\u91CD\u6302\u9700\u5355\u72EC\u786E\u8BA4\u3002";
        if (outcome.collection?.status === "pending") output.textContent += " \xB7 \u6536\u96C6\u5F85\u786E\u8BA4\uFF1B\u518D\u6B21\u6838\u5BF9\u4E0D\u4F1A\u91CD\u590D\u4E70\u5165";
        if (outcome.failures?.length) output.textContent += ` \xB7 ${outcome.failures.length} \u5F20\u672A\u5B8C\u6210\uFF0C\u53EF\u7EED\u8D2D`;
        const resultList = node("gallery-purchase-results");
        if (resultList) {
          resultList.replaceChildren();
          for (const item2 of outcome.results ?? []) {
            const state2 = {
              waiting: "\u5F85\u5904\u7406",
              "buy-pending": "\u6210\u4EA4\u6838\u5BF9\u4E2D",
              bought: "\u5DF2\u4E70\u5165\uFF0C\u5F85\u5165\u5E93",
              "move-pending": "\u5165\u5E93\u4E2D",
              "move-rejected": "\u5165\u5E93\u5931\u8D25",
              club: "\u5DF2\u5165\u5E93",
              collected: "\u5DF2\u786E\u8BA4\u6536\u96C6"
            }[item2.state] ?? item2.reason ?? item2.state;
            add(resultList, "li", `${item2.name || item2.definitionId} \xB7 ${state2}${item2.price == null ? "" : ` \xB7 ${count2(item2.price)} \u91D1\u5E01`}`);
          }
        }
        purchaseReplan = null;
        if (isGalleryPurchaseReplanSafe(outcome) && outcome.status !== "purchased" && input.replanContext?.targets?.length) {
          const remaining = replanableGalleryFailures(outcome);
          if (remaining.length) {
            purchaseReplan = { ...input.replanContext, outcome };
            const acquired = (outcome.results ?? []).filter((item2) => ["club", "collected"].includes(item2.state)).length;
            const replan = add(resultList ?? dialog, "li", `\u5DF2\u786E\u8BA4 ${acquired} \u5F20\uFF1B\u5269\u4F59 ${remaining.length} \u5F20\u53EF\u91CD\u65B0\u8BA1\u7B97\u65B9\u6848`, "gallery-replan-ready");
            const replanButton = add(replan, "button", "\u91CD\u65B0\u89C4\u5212\u5269\u4F59\u76EE\u6807");
            replanButton.type = "button";
            replanButton.addEventListener("click", (event) => {
              if (event.isTrusted && !buying) {
                node("gallery-purchase-close").click();
                renderPurchaseReplan(purchaseReplan);
              }
            });
          }
        }
      } catch {
        output.textContent = "\u8D2D\u4E70\u7ED3\u679C\u5F85\u6838\u5BF9\uFF0C\u8BB0\u5F55\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u52FF\u91CD\u590D\u4E0B\u5355\u3002";
      } finally {
        buying = false;
        node("gallery-purchase-stop").hidden = true;
        node("gallery-purchase-close").hidden = false;
        void refreshPurchases();
      }
    };
    const renderPurchaseReplan = (input) => {
      const target = node(input?.mode === "joint" ? "gallery-joint-output" : "gallery-set-detail");
      if (!target || !input?.targets?.length || !input.outcome) return;
      const message = input.mode === "joint" ? target : target.querySelector(".gallery-plan-output") ?? add(target, "div", "", "gallery-plan-output");
      message.replaceChildren();
      message.textContent = "\u6B63\u5728\u6839\u636E\u5DF2\u786E\u8BA4\u6536\u96C6\u548C\u5269\u4F59\u9884\u7B97\u91CD\u65B0\u89C4\u5212\u2026";
      const identity5 = scope2(), token = ++planningEpoch;
      const catalogAtStart = result?.catalog, setAtStart = selectedSetId, jointAtStart = jointMode;
      const current2 = () => !disposed && active && identity5 === scope2() && token === planningEpoch && message.isConnected && result?.catalog === catalogAtStart && selectedSetId === setAtStart && jointMode === jointAtStart;
      const steps = planGalleryRemainderSteps({
        targets: input.targets,
        outcome: input.outcome,
        ledger: input.ledger,
        budget: input.budget,
        mode: input.mode ?? (input.targets.length === 1 ? "single" : "joint")
      });
      void runGalleryPlan(steps, {
        current: current2,
        progress: (state2) => {
          message.textContent = `\u6B63\u5728\u91CD\u7B97\u2026 ${state2.evaluations} \u4E2A\u5019\u9009`;
        }
      }).then((plan) => {
        if (!plan || !current2()) return;
        message.replaceChildren();
        if (plan.status === "ready") {
          add(message, "small", "\u539F\u8D2D\u4E70\u7ED3\u679C\u5DF2\u4FDD\u7559\uFF1B\u4EE5\u4E0B\u4EC5\u662F\u65B0\u7684\u672C\u5730\u66FF\u4EE3\u65B9\u6848\uFF0C\u9700\u8981\u518D\u6B21\u70B9\u51FB\u8D2D\u4E70\u3002", "gallery-unknown");
          for (const candidate of plan.plans) {
            const detail = add(message, "details");
            add(detail, "summary", `${candidate.items.length} \u5F20 \xB7 ${candidate.totalPrice == null ? "\u62A5\u4EF7\u672A\u77E5" : `${count2(candidate.totalPrice)} \u{1FA99}`}${candidate.score == null ? "" : ` \xB7 \u6700\u7EC8 ${count2(candidate.score)} \u5206`}`);
            const list2 = add(detail, "ul");
            for (const item2 of candidate.items) add(list2, "li", `${item2.name ?? item2.eaId} \xB7 ${item2.version ?? "\u7248\u672C\u672A\u77E5"} \xB7 ${item2.price == null ? "\u4EF7\u683C\u672A\u77E5" : `${count2(item2.price)} \u91D1\u5E01`}`);
            const executionBudget = plan.remainingBudget ?? input.budget;
            purchaseButton(detail, candidate.items, `${input.binding ?? "gallery"}:replan:${candidate.items.map((item2) => item2.eaId).join(",")}`, {
              budget: executionBudget,
              label: "\u8D2D\u4E70\u66FF\u4EE3\u65B9\u6848",
              replanContext: { targets: plan.targets, ledger: plan.ledger, budget: input.budget, mode: input.mode },
              valid: () => current2() && !buying
            });
          }
        } else if (plan.status === "achieved") add(message, "small", "\u5F53\u524D\u76EE\u6807\u5DF2\u8FBE\u5230\uFF0C\u65E0\u9700\u7EE7\u7EED\u8D2D\u4E70\u3002");
        else add(message, "small", `\u5269\u4F59\u76EE\u6807\u6682\u4E0D\u53EF\u89C4\u5212\uFF1A${plan.reason ?? plan.status}`, "gallery-unknown");
      }).catch(() => {
        if (current2()) message.textContent = "\u5269\u4F59\u76EE\u6807\u91CD\u89C4\u5212\u5931\u8D25\uFF0C\u539F Journal \u4FDD\u7559\u3002";
      });
    };
    const purchaseButton = (parent, items, binding, {
      budget = null,
      label = "\u6279\u91CF\u8D2D\u4E70",
      valid: valid2 = () => true,
      progress = null,
      targetGrade = null,
      replanContext = null
    } = {}) => {
      if (typeof purchase !== "function" || !items.length) return null;
      const button = add(parent, "button", label, "primary gallery-purchase");
      button.type = "button";
      const identity5 = scope2();
      button.addEventListener("click", (event) => {
        if (!event.isTrusted || buying || identity5 !== scope2() || !valid2()) return;
        void runPurchase({
          items,
          binding,
          budget,
          progress,
          targetGrade,
          replanContext: replanContext ? structuredClone(replanContext) : null
        });
      });
      return button;
    };
    node("gallery-purchase-stop").addEventListener("click", (event) => {
      if (event.isTrusted && buying) {
        purchase?.stop?.();
        node("gallery-purchase-stop").disabled = true;
        node("gallery-purchase-message").textContent = "\u5F53\u524D\u6210\u4EA4\u6838\u5BF9\u5B8C\u6210\u540E\u505C\u6B62\u2026";
      }
    });
    node("gallery-purchase-close").addEventListener("click", () => {
      if (!buying) node("gallery-purchase-dialog").close();
    });
    node("gallery-purchase-dialog").addEventListener("cancel", (event) => {
      if (buying) event.preventDefault();
    });
    node("gallery-purchase-resume").addEventListener("click", (event) => {
      if (event.isTrusted && purchaseSummary?.status === "observed") void runPurchase({ resume: true, expectedOperationId: purchaseSummary.operationId });
    });
    const asset = (kind, id7) => {
      try {
        const value = assets?.[kind]?.(id7);
        return typeof value === "string" && /^https:\/\/www\.ea\.com\//i.test(value) ? value : "";
      } catch {
        return "";
      }
    };
    const image = (parent, src, alt, className = "") => {
      if (!src) return null;
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.className = className;
      img.referrerPolicy = "no-referrer";
      parent.append(img);
      return img;
    };
    const nativeCards = /* @__PURE__ */ new Set();
    let cardSequence = 0, disposed = false;
    const disposeNativeCards = () => {
      for (const card of nativeCards) {
        try {
          card.__fcatDealloc?.();
        } catch {
        }
        card.remove();
      }
      nativeCards.clear();
    };
    const renderTextCard = (parent, row) => {
      const fallback = add(parent, "div", "", "gallery-text-card");
      add(fallback, "strong", String(row.overall ?? "\u2014"), "gallery-text-card-rating");
      add(fallback, "span", row.name, "gallery-text-card-name");
      add(fallback, "small", `${row.version ?? "\u7248\u672C\u672A\u77E5"} \xB7 ${row.positions?.[0] ?? "\u4F4D\u7F6E\u672A\u77E5"}`, "gallery-text-card-meta");
      fallback.title = "EA \u539F\u751F\u5361\u9762\u6682\u672A\u53D6\u5F97";
      return fallback;
    };
    const cardImage = (parent, row, runtimeCards, setId) => {
      if (!active || disposed || jointMode) return;
      let native, fallbackRendered = false;
      const slot = add(parent, "slot");
      slot.name = `gallery-card-${++cardSequence}`;
      const fallback = () => {
        if (fallbackRendered || disposed || !active || !slot.isConnected || selectedSetId !== setId) return;
        fallbackRendered = true;
        slot.remove();
        nativeCards.delete(native);
        try {
          native?.__fcatDealloc?.();
        } catch {
        }
        try {
          native?.remove?.();
        } catch {
        }
        const text5 = renderTextCard(parent, row);
        parent.insertBefore(text5, parent.querySelector(".gallery-card-select"));
      };
      try {
        native = nativeRenderer?.render?.({
          parent: host,
          raw: runtimeCards?.get?.(row.eaId),
          slot: slot.name,
          label: `${row.name} ${row.version ?? ""}`,
          onUnavailable: fallback
        });
        if (native) {
          nativeCards.add(native);
          return;
        }
      } catch {
      }
      fallback();
    };
    const cachedPrice = (row, detail = null) => {
      try {
        const value = detail?.prices?.[row.eaId] ?? (typeof prices === "function" ? prices(row.eaId, row) : prices?.[row.eaId]);
        return Number.isSafeInteger(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    };
    const priceExpired = (detail) => detail?.priceSnapshot?.expiresAt != null && Date.now() >= detail.priceSnapshot.expiresAt;
    const planningPrices = (detail) => detail?.priceSnapshot ? priceExpired(detail) ? {} : detail.priceSnapshot.freshPrices : detail?.prices;
    const needsPriceRefresh = (detail) => !detail?.priceSnapshot || priceExpired(detail) || detail.priceSnapshot.expiresAt == null && !Object.keys(detail.priceSnapshot.freshPrices ?? {}).length;
    const statusIcon = (parent, value, label) => {
      const icon = add(parent, "span", value === true ? "\u2713" : value === false ? "\u25CB" : "?", `gallery-status-icon ${value === true ? "is-yes" : value === false ? "is-no" : "is-unknown"}`);
      icon.title = label;
      icon.setAttribute("aria-label", label);
      return icon;
    };
    const gradeTrack = (parent, grades3, summary2 = null) => {
      const state2 = summary2?.status ?? "";
      const track = add(parent, "div", "", `gallery-grade-track ${state2}`);
      track.setAttribute("role", "list");
      for (const { grade, reached, current: current2, fraction } of galleryGradeSegments(grades3, summary2)) {
        const cell = add(track, "span", "", "gallery-grade-cell");
        cell.setAttribute("role", "listitem");
        const bar = add(cell, "span", "", "gallery-grade-bar");
        const fill = add(bar, "i");
        fill.style.width = `${Math.round(fraction * 100)}%`;
        const diamond = add(cell, "span", "", `gallery-grade-diamond grade-${String(grade.name).toLowerCase()} ${reached ? "is-reached" : ""} ${current2 ? "is-current" : ""}`);
        add(diamond, "span", grade.name, "gallery-grade-letter");
        diamond.title = `${grade.name} \xB7 ${count2(grade.threshold)} \u5206 \xB7 ${grade.rewards.map((reward) => reward.label).join("\u3001") || "\u65E0\u5956\u52B1"}${grade.rewardsComplete ? "" : " \xB7 \u672A\u63D0\u4F9B\u975E\u4EE3\u5E01\u5956\u52B1"}`;
        diamond.setAttribute("aria-label", `${grade.name} \u6863\uFF0C${count2(grade.threshold)} \u5206${reached ? "\uFF0C\u5DF2\u8FBE\u5230" : ""}`);
        add(cell, "small", count2(grade.threshold), "gallery-grade-threshold");
      }
      return track;
    };
    const date = (value) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : "\u672A\u77E5";
    const count2 = (value) => Number.isFinite(value) ? value.toLocaleString() : "\u672A\u77E5";
    const state = (value) => value === true ? "\u662F" : value === false ? "\u5426" : "\u672A\u77E5";
    const summarizeRewards = (sets2) => {
      const byType = /* @__PURE__ */ new Map();
      for (const set of sets2 ?? []) for (const grade of set.grades ?? []) for (const reward of grade.rewards ?? []) {
        const type = String(reward.type ?? "unknown");
        const previous = byType.get(type) ?? { type, value: 0 };
        previous.value += Number.isSafeInteger(reward.value) ? reward.value : 0;
        byType.set(type, previous);
      }
      return [...byType.values()].filter((row) => row.value > 0);
    };
    const renderRewardSummary = (parent, sets2, className = "gallery-reward-summary") => {
      const rewards2 = summarizeRewards(sets2).map((reward) => ({ ...reward, icon: asset("reward", reward.type) })).filter((reward) => reward.icon);
      if (!rewards2.length) return null;
      const summary2 = add(parent, "span", "", className);
      summary2.setAttribute("aria-label", "\u5956\u52B1\u6C47\u603B");
      for (const reward of rewards2) {
        const item2 = add(summary2, "span", "", "gallery-reward-token");
        item2.dataset.rewardType = reward.type;
        image(item2, reward.icon, reward.type, "gallery-reward-token-icon");
        add(item2, "span", count2(reward.value), "gallery-reward-token-value");
        item2.title = `${reward.type} ${count2(reward.value)}`;
        item2.setAttribute("aria-label", item2.title);
      }
      return summary2;
    };
    let scoreRenderTimer = null;
    const scoredSets = /* @__PURE__ */ new Set();
    const scoreQueue = createGalleryScoreQueue({ onUpdate: (setId) => {
      scoredSets.add(setId);
      if (disposed || !active || scoreRenderTimer !== null) return;
      scoreRenderTimer = setTimeout(() => {
        scoreRenderTimer = null;
        if (disposed || !active) return;
        const changed = new Set(scoredSets);
        scoredSets.clear();
        const sets2 = result?.catalog?.categories.flatMap((category) => category.sets) ?? [];
        for (const card of node("gallery-set-list").querySelectorAll(".gallery-set")) {
          if (!changed.has(card.dataset.setId)) continue;
          const set = sets2.find((row) => row.id === card.dataset.setId), detail = details.get(set?.id);
          const summary2 = set && scoreSummary(detail, set);
          const label = card.querySelector(".gallery-summary"), grades3 = card.querySelector(".gallery-grades");
          if (!summary2 || !label || !grades3) continue;
          label.textContent = compactScore(summary2);
          label.title = `Base score \xB7 ${scoreText(summary2)}`;
          label.setAttribute("aria-label", `Base score ${scoreText(summary2)}`);
          grades3.replaceChildren();
          gradeTrack(grades3, set.grades, summary2);
        }
        if ([...changed].some((id7) => jointTargets.has(id7))) renderJoint();
        if (changed.has(selectedSetId) && !activePlans && !foregroundSync && !jointMode && selectedSetId && details.has(selectedSetId)) {
          const set = result?.catalog?.categories.flatMap((category) => category.sets).find((row) => row.id === selectedSetId);
          const value = details.get(selectedSetId), summary2 = set && scoreSummary(value, set);
          const target = node("gallery-set-detail"), section = target.querySelector(".gallery-score");
          if (section && summary2) {
            const fragment = document.createDocumentFragment();
            renderScoring(fragment, summary2, value);
            section.replaceWith(fragment);
            const track = target.querySelector(".gallery-overview .gallery-grade-track");
            if (track) {
              const next = document.createDocumentFragment();
              gradeTrack(next, set.grades, summary2);
              track.replaceWith(next);
            }
            const select = target.querySelector(".gallery-plan select");
            if (select && !select.dataset.edited && summary2.nextGrade) select.value = summary2.nextGrade;
            const ids = new Set(summary2.lineup?.map((row) => String(row.eaId)) ?? []);
            for (const card of target.querySelectorAll(".gallery-card")) {
              card.querySelector(".gallery-score-member")?.remove();
              if (ids.has(card.dataset.definitionId)) add(card.querySelector(".gallery-player-meta"), "span", "\u8BA1\u5206\u9635\u5BB9\u6210\u5458", "badge gallery-score-member");
            }
          }
        }
      }, 100);
    } });
    const scoreSummary = (value, set) => {
      if (!active || !value?.progress || !result?.catalog) return null;
      return scoreQueue.read(scope2(), { set, catalog: result.catalog, progress: value.progress });
    };
    const scoreText = (summary2) => {
      if (summary2?.status === "calculating") return "\u8BA1\u5206\u4E2D\u2026";
      if (!summary2 || summary2.status === "unavailable") return "\u8BA1\u5206\u89C4\u5219\u5F85\u6838\u5B9E";
      if (!summary2.low || summary2.status === "partial") return "\u8BA1\u5206\u6570\u636E\u672A\u5B8C\u6574\u540C\u6B65";
      const points = summary2.low.total === summary2.high.total ? count2(summary2.low.total) : `${count2(summary2.low.total)}\u2013${count2(summary2.high.total)}`;
      if (!summary2.full) return `${points} \u5206 \xB7 \u8FD8\u7F3A ${summary2.missingCards} \u5F20\u8BA1\u5206\u5361\uFF0C\u6682\u4E0D\u8BA1\u7B49\u7EA7`;
      if (summary2.status === "uncertain") return `${points} \u5206 \xB7 \u7B49\u7EA7\u5F85\u6838\u5B9E`;
      return `${points} \u5206 \xB7 \u8BA1\u7B97\u7B49\u7EA7 ${summary2.grade ?? "\u672A\u8FBE D"}`;
    };
    const compactScore = (summary2) => !summary2?.low ? summary2?.status === "calculating" ? "\u8BA1\u5206\u4E2D\u2026" : "\u8BA1\u5206\u5F85\u540C\u6B65" : `${count2(summary2.low.total)}${summary2.low.total !== summary2.high?.total ? `\u2013${count2(summary2.high?.total)}` : ""} \u5206`;
    const renderScoring = (target, summary2, value) => {
      const section = add(target, "section", "", "gallery-score");
      add(section, "strong", `${value.stale || value.poolStale || result?.stale ? "\u5FEB\u7167" : "\u5F53\u524D"}\u8BA1\u5206\uFF1A${scoreText(summary2)}`);
      if (!summary2?.low) {
        if (summary2?.status === "calculating") {
          add(section, "small", "\u6B63\u5728\u540E\u53F0\u8BA1\u7B97\uFF0C\u53EF\u7EE7\u7EED\u6D4F\u89C8\u6216\u5207\u6362\u9875\u9762\u3002");
          return;
        }
        add(section, "small", summary2?.reason === "base-score-unknown" ? "\u90E8\u5206\u5DF2\u6536\u96C6\u5361\u7F3A\u5C11 EA \u57FA\u7840\u5206\uFF1B\u516C\u5F00\u4F30\u503C\u4E0D\u4F1A\u4EE3\u66FF\u8D26\u53F7\u5206\u503C\u3002" : "\u76EE\u5F55\u5305\u542B\u672A\u8BC6\u522B\u7684\u8BA1\u5206\u6761\u4EF6\uFF0C\u4FDD\u7559\u6536\u96C6\u8FDB\u5EA6\u5E76\u7B49\u5F85\u89C4\u5219\u9002\u914D\u3002");
        return;
      }
      add(section, "small", `\u57FA\u7840\u5206 ${count2(summary2.low.base)} \uFF0B \u5DF2\u77E5\u52A0\u6210 ${count2(summary2.low.bonus)} \xB7 \u8BA1\u5206 ${summary2.lineup.length} \u5F20`);
      if (summary2.zeroScoreCards) add(section, "small", `${summary2.zeroScoreCards} \u5F20\u5DF2\u6536\u96C6\u7248\u672C\u7684 EA \u57FA\u7840\u5206\u4E3A 0\uFF0C\u6309\u53C2\u8003\u89C4\u5219\u4E0D\u8BA1\u5165\u8BA1\u5206\u4EBA\u6570\u3002`);
      if (summary2.full && summary2.nextGrade) add(section, "p", `\u4E0B\u4E00\u6863 ${summary2.nextGrade}\uFF1A\u6309\u5DF2\u77E5\u8D21\u732E\u8FD8\u5DEE ${count2(summary2.pointsToNext)} \u5206`);
      else if (summary2.full) add(section, "p", "\u6309\u5DF2\u77E5\u8D21\u732E\u8FBE\u5230\u6700\u9AD8\u6863\u95E8\u69DB");
      if (summary2.full && summary2.low.total !== summary2.high.total) {
        add(section, "small", `\u540C\u4E00\u8BA1\u5206\u7EC4\u5408\u7684\u6761\u4EF6\u7B49\u7EA7\uFF1A${summary2.lowGrade ?? "\u672A\u8FBE D"}\u2013${summary2.highGrade ?? "\u672A\u8FBE D"}\u3002\u533A\u95F4\u4EC5\u9488\u5BF9\u5DF2\u9009\u7EC4\u5408\uFF0C\u4E0D\u4EE3\u8868\u6240\u6709\u7EC4\u5408\u7684\u6700\u9AD8\u5206\u3002`, "gallery-unknown");
      }
      const names = {
        firstOwned: "First Owner \u5386\u53F2",
        holographic: "\u95EA\u5361\u5C5E\u6027",
        weakFoot: "\u9006\u8DB3",
        skillMoves: "\u82B1\u5F0F",
        nationEaId: "\u56FD\u7C4D",
        clubEaId: "\u4FF1\u4E50\u90E8",
        leagueEaId: "\u8054\u8D5B",
        playerEaId: "\u7403\u5458\u8EAB\u4EFD",
        positions: "\u4F4D\u7F6E",
        overall: "\u8BC4\u5206",
        rarityEaId: "\u5361\u79CD"
      };
      if (summary2.unknownFields.length) add(section, "small", `\u672A\u77E5\uFF1A${summary2.unknownFields.map((field) => names[field] ?? field).join("\u3001")}\u3002\u5DF2\u77E5\u8D21\u732E\u4E0D\u8BA1\u672A\u77E5\u9879\uFF0C\u533A\u95F4\u53E6\u4E00\u7AEF\u6309\u672A\u77E5\u9879\u6EE1\u8DB3\u6761\u4EF6\u8BA1\u7B97\uFF1B\u91CD\u65B0\u540C\u6B65\u672A\u5FC5\u80FD\u627E\u56DE\u5DF2\u79BB\u961F\u5361\u7684\u9996\u4EFB\u5386\u53F2\u3002`, "gallery-unknown");
      if (summary2.ruleDifference) add(section, "small", `\u5206\u7EC4\u89C4\u5219\u6709\u5DEE\u5F02\uFF1A\u540C\u7EC4\u5408 Fodder ${count2(summary2.low.total)}\u2013${count2(summary2.high.total)}\uFF0CFUT.GG ${count2(summary2.comparison.low.total)}\u2013${count2(summary2.comparison.high.total)}\uFF1BEA \u89C4\u5219\u4ECD\u5F85\u5BF9\u7167\u3002`, "gallery-unknown");
      if (summary2.collectionUnknown) add(section, "small", "\u6536\u96C6\u72B6\u6001\u5C1A\u672A\u5B8C\u6574\uFF0C\u5F53\u524D\u4EC5\u8BA1\u7B97\u5DF2\u786E\u8BA4\u6536\u96C6\u5361\u3002", "gallery-unknown");
      add(section, "small", `${summary2.selection === "bounded-search" ? "\u6309\u53C2\u8003\u63D2\u4EF6\u6709\u754C\u6362\u9635\u9009\u51FA\u7EC4\u5408\uFF0C\u4E0D\u4FDD\u8BC1\u5168\u5C40\u6700\u4F18\u3002" : ""}\u672C\u5730\u8BA1\u7B97\u53C2\u8003\u7B49\u7EA7\uFF0C\u4E0D\u4EE3\u8868 EA \u5DF2\u786E\u8BA4\u7B49\u7EA7\u6216\u5956\u52B1\u53EF\u9886\u53D6\uFF1B\u9996\u4EFB\u8BC1\u636E\u6765\u81EA\u5F53\u524D Club \u7F13\u5B58\u3002`);
      const explanation = add(section, "details");
      add(explanation, "summary", "\u8BA1\u5206\u5361\u7247\u4E0E\u52A0\u6210\u660E\u7EC6");
      const selected = add(explanation, "ul", "", "gallery-lineup");
      for (const row of summary2.lineup) add(selected, "li", `${row.name ?? row.eaId} \xB7 ${row.version ?? ""} \xB7 EA ${count2(row.gradingScore)}`);
      add(explanation, "p", "\u53EA\u8BA1\u6536\u76CA\u6700\u9AD8\u7684\u5341\u9879\u52A0\u6210\uFF1B\u6BCF\u9879\u6309\u5339\u914D\u5361\u7247\u7684\u57FA\u7840\u5206\u5411\u4E0B\u53D6\u6574\u3002");
      const bonuses = add(explanation, "ul", "", "gallery-bonuses");
      for (const tag of summary2.low.tags) {
        const high = summary2.high.tags.find((row) => row.id === tag.id);
        const suffix = tag.bonus > 0 && !tag.counted ? " \xB7 \u672A\u8FDB\u524D\u5341\uFF0C\u4E0D\u8BA1\u5165" : tag.counted ? " \xB7 \u8BA1\u5165" : "";
        add(bonuses, "li", `${tag.name}\uFF1A${tag.count} \u5F20 \xB7 ${count2(tag.matched)} \xD7 ${tag.pct}% = ${count2(tag.bonus)}${suffix}${high.bonus !== tag.bonus ? ` \xB7 \u672A\u77E5\u9879\u6EE1\u8DB3\u65F6 ${count2(high.bonus)}` : ""}${tag.next ? ` \xB7 \u518D ${tag.next.needed} \u5F20\u8FBE ${tag.next.pct}%` : ""}`);
      }
    };
    const renderPlan = (target, value, set, summary2) => {
      if (typeof gradePlanner !== "function" || !value?.progress || !result?.catalog) return;
      const section = add(target, "section", "", "gallery-plan");
      add(section, "strong", "\u6307\u5B9A\u7B49\u7EA7\u8865\u5361\u65B9\u6848");
      const row = add(section, "div", "", "row");
      const select = document.createElement("select");
      for (const grade of set.grades) {
        const option = document.createElement("option");
        option.value = grade.name;
        option.textContent = `${grade.name} \xB7 ${count2(grade.threshold)} \u5206`;
        select.append(option);
      }
      if (summary2?.nextGrade) select.value = summary2.nextGrade;
      select.addEventListener("change", () => {
        select.dataset.edited = "true";
      });
      row.append(select);
      const button = add(row, "button", "\u751F\u6210\u65B9\u6848");
      button.type = "button";
      const overviewButton = add(row, "button", "\u5404\u6863\u8D39\u7528");
      overviewButton.type = "button";
      const jointAdd = add(row, "button", "+", "gallery-joint-add");
      jointAdd.type = "button";
      jointAdd.title = "\u52A0\u5165\u8054\u5408\u76EE\u6807";
      jointAdd.setAttribute("aria-label", "\u52A0\u5165\u8054\u5408\u76EE\u6807");
      jointAdd.disabled = restoringTargets || value.status !== "observed" || value.stale === true || value.poolStale === true;
      jointAdd.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        if (restoringTargets) return;
        if (checkScope() === false) return;
        jointTargets.set(set.id, select.value);
        invalidateJoint();
        renderJoint();
        renderSets();
        persistTargets();
        jointAdd.title = "\u5DF2\u52A0\u5165\u8054\u5408\u76EE\u6807";
      });
      const output = add(section, "div", "", "gallery-plan-output");
      output.setAttribute("aria-live", "polite");
      const overview = add(section, "div", "", "gallery-grade-overview");
      overview.setAttribute("aria-live", "polite");
      const overviewKey = JSON.stringify([scope2(), set, result.catalog.tags, value.progress, planningPrices(value)]);
      const showOverview = (plan) => {
        overview.replaceChildren();
        if (!plan) return;
        for (const item2 of plan.grades ?? []) {
          const saved2 = planCache.get(set.id)?.plan;
          const candidate = saved2?.status === "ready" && saved2.targetGrade === item2.grade ? saved2.plans?.[0] ?? item2.candidate : item2.candidate;
          const line = add(overview, "div", "", "gallery-grade-overview-row");
          add(line, "strong", `${item2.grade} \xB7 ${count2(item2.threshold)} \u5206`);
          add(line, "span", item2.status === "achieved" ? "\u5DF2\u8FBE\u5230 \xB7 0 \u91D1\u5E01" : candidate?.totalPrice == null ? item2.status === "ready" ? "\u62A5\u4EF7\u672A\u77E5" : item2.reason ?? "\u6682\u4E0D\u53EF\u8FBE" : `${count2(candidate.totalPrice)} \u91D1\u5E01`);
          if (candidate?.score != null) add(line, "small", `${count2(candidate.score)} \u5206 \xB7 ${candidate.items?.length ?? 0} \u5F20\u8865\u5361`);
        }
      };
      const show = (plan) => {
        output.replaceChildren();
        if (!plan || plan.status === "unavailable") {
          add(output, "small", `\u6682\u4E0D\u53EF\u89C4\u5212\uFF1A${plan?.reason ?? "\u8F93\u5165\u4E0D\u5B8C\u6574"}`, "gallery-unknown");
          return;
        }
        if (plan.status === "achieved") {
          add(output, "small", `\u5F53\u524D\u5DF2\u8FBE\u5230 ${plan.targetGrade} \u6863\uFF0C\u65E0\u9700\u8865\u5361\u3002`);
          return;
        }
        const reasons2 = {
          "search-time-exhausted": "\u8BA1\u7B97\u65F6\u95F4\u9884\u7B97\u5DF2\u7528\u5B8C\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3\uFF1B\u53EF\u964D\u4F4E\u76EE\u6807\u7B49\u7EA7\u518D\u8BD5",
          "search-budget-exhausted": "\u641C\u7D22\u9884\u7B97\u8017\u5C3D\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "candidate-search-truncated": "\u5019\u9009\u8303\u56F4\u672A\u5B8C\u6574\u641C\u7D22\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "beam-search-truncated": "\u6709\u754C\u641C\u7D22\u672A\u627E\u5230\u65B9\u6848\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "score-selection-bounded": "\u8BA1\u5206\u9009\u961F\u4F7F\u7528\u6709\u754C\u641C\u7D22\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "score-conditions-unknown": "\u90E8\u5206\u8BA1\u5206\u5C5E\u6027\u5F85\u6838\u5B9E",
          "collection-status-unknown": "\u6536\u96C6\u72B6\u6001\u5F85\u6838\u5B9E",
          "existing-score-unknown": "\u5DF2\u6536\u96C6\u5361\u7684 EA \u57FA\u7840\u5206\u5F85\u6838\u5B9E",
          "target-unreachable": "\u5F53\u524D\u6750\u6599\u8FBE\u4E0D\u5230\u76EE\u6807"
        };
        if (plan.status !== "ready") {
          add(output, "small", reasons2[plan.reason] ?? "\u6682\u672A\u627E\u5230\u53EF\u884C\u65B9\u6848", "gallery-unknown");
          return;
        }
        add(output, "small", `\u627E\u5230 ${plan.plans.length} \u4E2A\u5019\u9009\u65B9\u6848\uFF1B\u53EA\u8BFB\u7ED3\u679C\uFF0C\u4E0D\u4EE3\u8868 EA \u5DF2\u786E\u8BA4\u7B49\u7EA7\u3002`);
        if (!plan.searchComplete) add(output, "small", "\u6709\u754C\u5019\u9009\u65B9\u6848\uFF0C\u4E0D\u4FDD\u8BC1\u6700\u4F4E\u603B\u4EF7\u3002", "gallery-unknown");
        if (plan.costAudit) add(output, "small", `\u6309\u5355\u5361\u4EF7\u683C\u9009\u53D6\u7684\u5B8C\u6574\u7EC4\u5408\u4E3A ${count2(plan.costAudit.totalPrice)} \u91D1\u5E01\u3001${count2(plan.costAudit.score)} \u5206\uFF08\u76EE\u6807 ${count2(plan.costAudit.target)}\uFF09\u3002`, "gallery-unknown");
        for (const [index, candidate] of plan.plans.entries()) {
          const details2 = add(output, "details");
          const scoreNote = candidate.currentScore != null ? `\u5F53\u524D ${count2(candidate.currentScore)} + \u65B0\u589E ${count2(candidate.addedScore ?? 0)} = ${count2(candidate.score)} \u5206` : `${count2(candidate.score)} \u5206`;
          add(details2, "summary", `\u65B9\u6848 ${index + 1} \xB7 ${candidate.items.length} \u5F20 \xB7 ${candidate.totalPrice == null ? "\u62A5\u4EF7\u672A\u77E5" : `${count2(candidate.totalPrice)} \u{1FA99}`} \xB7 ${scoreNote}`);
          const list2 = add(details2, "ul");
          for (const item2 of candidate.items) add(list2, "li", `${item2.name ?? item2.eaId} \xB7 ${item2.version ?? "\u7248\u672C\u672A\u77E5"} \xB7 ${item2.price == null ? "\u4EF7\u683C\u672A\u77E5" : `${count2(item2.price)} \u{1FA99}`}${item2.scoreSource === "catalog" ? " \xB7 \u516C\u5F00\u4F30\u5206" : ""}`);
          if (candidate.missingPriceIds.length) add(details2, "small", `${candidate.missingPriceIds.length} \u5F20\u5361\u7F3A\u5C11\u62A5\u4EF7\uFF0C\u6267\u884C\u524D\u5FC5\u987B\u91CD\u65B0\u67E5\u4EF7\u3002`, "gallery-unknown");
          if (candidate.unknownFields?.length) add(details2, "small", "\u90E8\u5206\u8BA1\u5206\u5C5E\u6027\u672A\u77E5\uFF0C\u65B9\u6848\u6309\u5DF2\u77E5\u8D21\u732E\u8BA1\u7B97\u3002", "gallery-unknown");
          const planIsCurrent = !planCache.get(set.id)?.stale && planCache.get(set.id)?.binding === planBinding(value, set);
          purchaseButton(
            details2,
            candidate.items,
            `set:${set.id}:${value.pool?.revision}:${candidate.items.map((item2) => item2.eaId).join(",")}`,
            {
              progress: value.progress,
              targetGrade: candidate.targetGrade,
              replanContext: {
                targets: [{
                  set,
                  catalog: result.catalog,
                  progress: value.progress,
                  prices: planningPrices(value),
                  targetGrade: candidate.targetGrade,
                  scope: currentScope
                }],
                mode: "single",
                ledger: { receipts: [], excludedIds: [], quotes: {} },
                budget: null
              },
              valid: () => planIsCurrent && value.status === "observed" && !value.stale && !value.poolStale && thisDetailCurrent(value, set.id)
            }
          );
        }
      };
      const saved = planCache.get(set.id);
      if (saved?.plan) {
        show(saved.plan);
        if (saved.binding !== planBinding(value, set))
          add(output, "small", "\u96C6\u5408\u6570\u636E\u6216\u62A5\u4EF7\u5DF2\u66F4\u65B0\uFF0C\u4EE5\u4E0B\u4FDD\u7559\u4E0A\u6B21\u65B9\u6848\uFF1B\u8BF7\u91CD\u65B0\u751F\u6210\u4EE5\u786E\u8BA4\u91D1\u989D\u3002", "gallery-unknown");
      }
      if (saved?.overview) {
        showOverview(saved.overview);
        if (saved.overviewBinding !== planBinding(value, set)) add(overview, "small", "\u6570\u636E\u6216\u62A5\u4EF7\u5DF2\u66F4\u65B0\uFF0C\u4FDD\u7559\u4E0A\u6B21\u5404\u6863\u8D39\u7528\uFF1B\u8BF7\u91CD\u65B0\u8BA1\u7B97\u3002", "gallery-unknown");
      }
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
        button.disabled = true;
        output.replaceChildren();
        add(output, "small", "\u6B63\u5728\u8BA1\u7B97\u2026");
        const token = ++planningEpoch, identity5 = scope2(), revision = result, binding = planBinding(value, set);
        activePlans++;
        const current2 = () => !disposed && active && token === planningEpoch && identity5 === scope2() && revision === result && output.isConnected && selectedSetId === set.id && !jointMode;
        const cancel = add(row, "button", "\u53D6\u6D88");
        cancel.type = "button";
        cancel.addEventListener("click", () => {
          planningEpoch++;
          output.replaceChildren();
          add(output, "small", "\u8BA1\u7B97\u5DF2\u53D6\u6D88");
        });
        try {
          const input = { set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value), targetGrade: select.value };
          const plan = gradePlanner === planGalleryGrade ? await runGalleryPlan(planGalleryGradeSteps(input), {
            current: current2,
            progress: (value2) => {
              output.textContent = `\u6B63\u5728\u8BA1\u7B97\u2026 ${value2.evaluations} \u4E2A\u5019\u9009`;
            }
          }) : await gradePlanner(input);
          if (plan) void diag({
            event: "grade-plan",
            phase: "planner",
            replayInput: input,
            status: plan.status === "ready" || plan.status === "achieved" ? "success" : "blocked",
            reason: /^[a-z]+(?:-[a-z]+)*$/.test(plan.reason ?? "") ? `FC27_GALLERY_${plan.reason.replaceAll("-", "_").toUpperCase()}` : void 0,
            count: plan.candidateCount,
            requestedCount: plan.requestedCandidates,
            quotedCount: plan.quotedCandidateCount,
            eaScoreCount: plan.scoreSourceCounts?.ea,
            catalogScoreCount: plan.scoreSourceCounts?.catalog,
            targetScore: plan.threshold,
            currentScore: plan.currentScore,
            evaluations: plan.evaluations,
            searchComplete: plan.searchComplete === true,
            scopeTruncated: plan.scopeTruncated === true,
            beamTruncated: plan.beamTruncated === true,
            budgetExhausted: plan.budgetExhausted === true,
            timeExhausted: plan.timeExhausted === true,
            expandedCount: plan.omittedCandidates,
            cheapestPrice: plan.costAudit?.totalPrice,
            cheapestScore: plan.costAudit?.score,
            bestPrice: plan.plans?.[0]?.totalPrice,
            bestScore: plan.plans?.[0]?.score
          });
          if (plan && current2()) {
            savePlanCache(set, value, { binding, plan });
            show(plan);
            if (planCache.get(set.id)?.overview) showOverview(planCache.get(set.id).overview);
          }
        } catch {
          void diag({ event: "grade-plan", phase: "planner", status: "failed", reason: "FC27_GALLERY_GRADE_PLANNER_FAILED" });
          if (current2()) show({ status: "unavailable", reason: "planner-failed" });
        } finally {
          activePlans = Math.max(0, activePlans - 1);
          button.disabled = false;
          cancel.remove();
        }
      });
      overviewButton.addEventListener("click", async (event) => {
        if (!event.isTrusted || overviewButton.disabled) return;
        const cached = overviewCache.get(overviewKey);
        if (cached) {
          showOverview(cached);
          return;
        }
        overviewButton.disabled = true;
        overview.textContent = "\u6B63\u5728\u8BA1\u7B97\u5404\u6863\u8D39\u7528\u2026";
        const token = ++planningEpoch, identity5 = scope2(), revision = result, binding = planBinding(value, set);
        activePlans++;
        try {
          const plan = await runGalleryPlan(planGalleryGradeOverviewSteps({ set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value) }), {
            current: () => !disposed && active && token === planningEpoch && identity5 === scope2() && revision === result && overview.isConnected,
            maxMs: 8e3,
            progress: (state2) => {
              overview.textContent = `\u6B63\u5728\u8BA1\u7B97\u5404\u6863\u8D39\u7528\u2026 ${state2.completed}/${state2.total}`;
            }
          });
          if (plan && token === planningEpoch) {
            if (plan.status === "observed" || plan.status === "partial") {
              overviewCache.set(overviewKey, plan);
              savePlanCache(set, value, { overviewBinding: binding, overview: plan });
              while (overviewCache.size > 8) overviewCache.delete(overviewCache.keys().next().value);
            }
            showOverview(plan);
            if (plan.status === "partial") add(overview, "small", "\u8D39\u7528\u8BA1\u7B97\u672A\u5B8C\u6210\uFF1B\u5DF2\u663E\u793A\u90E8\u5206\u6863\u4F4D\uFF0C\u53EF\u5355\u72EC\u9009\u62E9\u76EE\u6807\u6863\u4F4D\u8BA1\u7B97\u3002", "gallery-unknown");
          }
        } catch {
          if (token === planningEpoch) overview.textContent = "\u5404\u6863\u8D39\u7528\u6682\u4E0D\u53EF\u7528";
        } finally {
          activePlans = Math.max(0, activePlans - 1);
          overviewButton.disabled = false;
        }
      });
    };
    const setIconSelections = /* @__PURE__ */ new Map();
    let categoryId = null, result = null, pending2 = null, timer = null, active = false;
    let selectedSetId = null, selection = 0, scopeTimer = null, filter = "all", cardPage = 1, cardQuery = "", cardOrder = "catalog";
    const selectedCards = /* @__PURE__ */ new Map();
    let selectionSource = null;
    let selectionBudget = "";
    const updateFooterGeometry = () => {
      const footer = node("gallery-selection-footer");
      if (!footer || footer.hidden) return;
      const box = shadow.querySelector(".body")?.getBoundingClientRect();
      const viewport = document.defaultView?.innerWidth ?? 0;
      if (!box || box.width <= 0) return;
      const inset = Math.min(24, box.width * 0.04), left = Math.max(8, box.left + inset);
      footer.style.left = `${left}px`;
      footer.style.width = `${Math.max(0, Math.min(box.width - inset * 2, viewport - left - 8))}px`;
    };
    const selectionContext = () => {
      const rows = /* @__PURE__ */ new Map(), prices2 = {}, confirmedMissing = /* @__PURE__ */ new Set();
      for (const detail of details.values()) {
        const fresh = detail.status === "observed" && detail.stale !== true && detail.poolStale !== true;
        for (const row of detail.progress?.rows ?? []) {
          const id7 = String(row.eaId), previous = rows.get(id7);
          if (!previous || row.collected === true || fresh && previous.collected !== true) rows.set(id7, row);
          if (fresh && !isGalleryOwned(row) && row.collected === false) confirmedMissing.add(id7);
        }
        Object.assign(prices2, planningPrices(detail) ?? {});
      }
      return { rows: [...rows.values()], prices: prices2, valid: [...selectedCards.keys()].every((id7) => confirmedMissing.has(id7)) };
    };
    const showBrowseLevel = () => {
      const detail = selectedSetId !== null, category = categoryId !== null;
      node("gallery-summary").hidden = detail || category;
      node("gallery-sets").hidden = detail || !category;
      node("gallery-set-detail").hidden = !detail;
      const back = node("gallery-back");
      back.hidden = !detail && !category;
      back.setAttribute("aria-label", detail ? "\u8FD4\u56DE\u96C6\u5408" : "\u8FD4\u56DE\u5206\u7C7B");
      back.title = detail ? "\u8FD4\u56DE\u96C6\u5408" : "\u8FD4\u56DE\u5206\u7C7B";
      node("gallery-browse-title").textContent = detail ? result?.catalog?.categories.flatMap((row) => row.sets).find((row) => row.id === selectedSetId)?.name ?? "" : result?.catalog?.categories.find((row) => row.id === categoryId)?.name ?? "";
      node("gallery-browse-nav").hidden = jointMode || !detail && !category;
      node("gallery-selection-footer").hidden = !active || !detail || jointMode;
      updateFooterGeometry();
    };
    const details = /* @__PURE__ */ new Map();
    const overviewCache = /* @__PURE__ */ new Map();
    const planCache = /* @__PURE__ */ new Map();
    const planBinding = (value, set) => JSON.stringify([scope2(), result?.source, set, result?.catalog?.tags, galleryPlanningStateKey(value)]);
    const savePlanCache = (set, value, patch) => {
      const current2 = planCache.get(set.id) ?? { binding: planBinding(value, set), overviewBinding: planBinding(value, set), plan: null, overview: null, stale: false };
      const next = { ...current2, ...patch, binding: patch.binding ?? current2.binding, stale: false };
      planCache.set(set.id, next);
      if (planStore && currentScope && result?.source) {
        const scopeAtStart = currentScope, source = result.source, record = { binding: next.binding, overviewBinding: next.overviewBinding, plan: next.plan, overview: next.overview };
        void Promise.resolve(planStore.save(scopeAtStart, source, set.id, record)).catch(() => {
        });
      }
      return next;
    };
    const restorePlanCache = async (set, value) => {
      if (!planStore || !currentScope || !result?.source) return;
      const scopeAtStart = currentScope, source = result.source, expected = planBinding(value, set);
      if (planCache.has(set.id)) return;
      try {
        const loaded = await planStore.load(scopeAtStart, source, set.id);
        if (disposed || scopeAtStart !== currentScope || source !== result?.source || selectedSetId !== set.id) return;
        if (loaded?.status === "observed") {
          const record = loaded.record;
          planCache.set(set.id, { binding: record.binding, overviewBinding: record.overviewBinding, plan: record.plan, overview: record.overview, stale: record.binding !== expected });
        }
      } catch {
      }
    };
    const thisDetailCurrent = (value, id7) => details.get(id7) === value && selectedSetId === id7 && !jointMode;
    const jointTargets = /* @__PURE__ */ new Map();
    let jointMode = false;
    let targetsIdentity = null, targetsEpoch = 0, restoringTargets = false;
    let planningEpoch = 0;
    let activePlans = 0;
    let jointRun = null;
    let syncing = false, syncRefresh = null;
    let foregroundSync = null, resumeBackground = false;
    let autoSyncKey = null;
    const targetStatus = (text5) => {
      node("gallery-target-status").textContent = text5;
    };
    const targetValue = () => ({
      targets: [...jointTargets].map(([setId, grade]) => ({ setId, grade })),
      budget: node("gallery-joint-budget").value.trim() ? Number(node("gallery-joint-budget").value) : null
    });
    const persistTargets = () => {
      if (!targetStore || restoringTargets || !currentScope || !result?.source) return;
      const scopeAtStart = currentScope, source = result.source, epoch = targetsEpoch;
      const value = targetValue();
      if (value.budget !== null && (!Number.isSafeInteger(value.budget) || value.budget < 0)) {
        targetStatus("\u8BF7\u8F93\u5165\u975E\u8D1F\u6574\u6570\u9884\u7B97\uFF0C\u5F53\u524D\u8F93\u5165\u672A\u4FDD\u5B58");
        return;
      }
      targetStatus("\u6B63\u5728\u4FDD\u5B58\u76EE\u6807\u2026");
      void Promise.resolve().then(() => targetStore.save(scopeAtStart, source, value)).then((saved) => {
        if (!disposed && epoch === targetsEpoch && scopeAtStart === currentScope && source === result?.source) {
          targetStatus(saved?.status === "observed" ? "" : "\u76EE\u6807\u4FDD\u5B58\u5931\u8D25\uFF0C\u5F53\u524D\u9009\u62E9\u4ECD\u53EF\u4F7F\u7528");
        }
      }).catch(() => {
        if (!disposed && epoch === targetsEpoch) targetStatus("\u76EE\u6807\u4FDD\u5B58\u5931\u8D25\uFF0C\u5F53\u524D\u9009\u62E9\u4ECD\u53EF\u4F7F\u7528");
      });
    };
    const reconcileTargets = () => {
      if (!result?.catalog || result.stale || result.cached === true || result.status !== "observed" || restoringTargets) return;
      const before = targetValue(), after = reconcileGalleryTargets({ ...before, budget: null }, result.catalog);
      if (JSON.stringify(before.targets) === JSON.stringify(after.targets)) return;
      jointTargets.clear();
      for (const row of after.targets) jointTargets.set(row.setId, row.grade);
      invalidateJoint();
      persistTargets();
    };
    const restoreTargets = () => {
      if (!targetStore || !currentScope || !result?.source) return;
      const identity5 = JSON.stringify([currentScope, result.source]);
      if (targetsIdentity === identity5) return;
      targetsIdentity = identity5;
      const epoch = ++targetsEpoch, scopeAtStart = currentScope, source = result.source;
      restoringTargets = true;
      targetStatus("\u6B63\u5728\u6062\u590D\u76EE\u6807\u2026");
      node("gallery-joint-budget").disabled = true;
      void Promise.resolve().then(() => targetStore.load(scopeAtStart, source)).then((saved) => {
        if (disposed || epoch !== targetsEpoch || scopeAtStart !== scope2() || source !== result?.source) return;
        if (saved?.status === "observed") {
          jointTargets.clear();
          for (const row of saved.targets) jointTargets.set(row.setId, row.grade);
          node("gallery-joint-budget").value = saved.budget === null ? "" : String(saved.budget);
          targetStatus("");
        } else targetStatus("\u76EE\u6807\u6062\u590D\u5931\u8D25\uFF0C\u6682\u7528\u5F53\u524D\u9875\u9762\u9009\u62E9");
      }).catch(() => {
        if (!disposed && epoch === targetsEpoch) targetStatus("\u76EE\u6807\u6062\u590D\u5931\u8D25\uFF0C\u6682\u7528\u5F53\u524D\u9875\u9762\u9009\u62E9");
      }).finally(() => {
        if (disposed || epoch !== targetsEpoch) return;
        if (checkScope() === false || source !== result?.source) return;
        restoringTargets = false;
        node("gallery-joint-budget").disabled = false;
        reconcileTargets();
        renderJoint();
        renderSets();
        if (!activePlans && !jointMode && selectedSetId && details.has(selectedSetId)) {
          const set = result?.catalog.categories.flatMap((category) => category.sets).find((set2) => set2.id === selectedSetId);
          if (set) renderSetDetail(details.get(selectedSetId), set);
        }
      });
    };
    const invalidateJoint = (message = "") => {
      planningEpoch++;
      const output = node("gallery-joint-output");
      const hadPlan = output.hasChildNodes();
      output.replaceChildren();
      if (message && hadPlan) add(output, "small", message, "gallery-unknown");
    };
    const renderJoint = () => {
      const container = node("gallery-joint-targets");
      container.replaceChildren();
      node("gallery-joint-count").textContent = String(jointTargets.size);
      node("gallery-joint-plan").disabled = !jointTargets.size || restoringTargets || jointRun === planningEpoch;
      if (!jointTargets.size) {
        add(container, "small", "\u5C1A\u65E0\u8054\u5408\u76EE\u6807");
        return;
      }
      const sets2 = result?.catalog?.categories.flatMap((category) => category.sets) ?? [];
      for (const [id7, grade] of jointTargets) {
        const set = sets2.find((set2) => set2.id === id7);
        const row = add(container, "div", "", "gallery-joint-target");
        row.dataset.setId = id7;
        if (!set) {
          add(row, "strong", id7);
          add(row, "small", "\u96C6\u5408\u6682\u4E0D\u5728\u5F53\u524D\u76EE\u5F55\uFF0C\u76EE\u6807\u4FDD\u7559\u5F85\u6838\u5B9E");
          const remove2 = add(row, "button", "\xD7");
          remove2.title = "\u79FB\u9664\u76EE\u6807";
          remove2.setAttribute("aria-label", `\u79FB\u9664 ${id7}`);
          remove2.disabled = restoringTargets;
          remove2.addEventListener("click", (event) => {
            if (!event.isTrusted || checkScope() === false) return;
            jointTargets.delete(id7);
            invalidateJoint();
            renderJoint();
            renderSets();
            persistTargets();
          });
          continue;
        }
        add(row, "strong", set.name);
        const select = document.createElement("select");
        select.setAttribute("aria-label", `${set.name} \u76EE\u6807\u7B49\u7EA7`);
        for (const grade2 of set.grades) {
          const option = document.createElement("option");
          option.value = grade2.name;
          option.textContent = `${grade2.name} \xB7 ${count2(grade2.threshold)}`;
          select.append(option);
        }
        select.value = grade;
        select.disabled = restoringTargets;
        row.append(select);
        select.addEventListener("change", () => {
          if (restoringTargets || checkScope() === false) return;
          jointTargets.set(id7, select.value);
          invalidateJoint();
          persistTargets();
        });
        const remove = add(row, "button", "\xD7");
        remove.title = "\u79FB\u9664\u76EE\u6807";
        remove.setAttribute("aria-label", `\u79FB\u9664 ${set.name}`);
        remove.disabled = restoringTargets;
        remove.addEventListener("click", (event) => {
          if (!event.isTrusted || checkScope() === false) return;
          jointTargets.delete(id7);
          invalidateJoint();
          renderJoint();
          renderSets();
          persistTargets();
        });
        const value = details.get(id7);
        if (!value?.progress || value.status !== "observed" || value.stale || value.poolStale) add(row, "small", "\u96C6\u5408\u72B6\u6001\u5F85\u66F4\u65B0", "gallery-unknown");
        else add(row, "small", scoreText(scoreSummary(value, set)));
        if (typeof loadSet === "function" && result.source === "futgg") {
          const open = add(row, "button", "\u67E5\u770B\u5361\u7247", "gallery-target-open");
          open.addEventListener("click", (event) => {
            if (!event.isTrusted) return;
            setJointMode(false);
            void loadSetDetails(set);
          });
        }
      }
    };
    const setJointMode = (enabled) => {
      if (jointMode !== enabled) planningEpoch++;
      jointMode = enabled;
      node("gallery-browse").hidden = enabled;
      node("gallery-joint").hidden = !enabled;
      node("gallery-mode-browse").setAttribute("aria-pressed", String(!enabled));
      node("gallery-mode-joint").setAttribute("aria-pressed", String(enabled));
      showBrowseLevel();
      if (enabled) {
        disposeNativeCards();
        renderJoint();
      } else if (selectedSetId && details.has(selectedSetId)) {
        const set = result?.catalog.categories.flatMap((category) => category.sets).find((set2) => set2.id === selectedSetId);
        if (set) renderSetDetail(details.get(selectedSetId), set);
      }
    };
    const showJointPlan = (plan, inputs = []) => {
      const output = node("gallery-joint-output");
      output.replaceChildren();
      if (plan.status === "achieved") {
        add(output, "p", "\u5F53\u524D\u8054\u5408\u76EE\u6807\u5DF2\u8FBE\u5230\uFF0C\u65E0\u9700\u8865\u5361\u3002");
        return;
      }
      if (plan.status !== "ready") {
        const messages = {
          "search-time-exhausted": "\u8BA1\u7B97\u65F6\u95F4\u9884\u7B97\u5DF2\u7528\u5B8C\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3\uFF1B\u53EF\u7F29\u5C0F\u76EE\u6807\u8303\u56F4\u518D\u8BD5",
          "target-state-unknown": "\u96C6\u5408\u72B6\u6001\u5F85\u66F4\u65B0",
          "price-unknown": "\u7F3A\u5C11\u6709\u6548\u62A5\u4EF7\uFF0C\u9884\u7B97\u65B9\u6848\u5C1A\u672A\u786E\u5B9A",
          "search-budget-exhausted": "\u641C\u7D22\u9884\u7B97\u8017\u5C3D\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "candidate-search-truncated": "\u5019\u9009\u8303\u56F4\u4E0D\u5B8C\u6574\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "beam-search-truncated": "\u6709\u754C\u641C\u7D22\u672A\u627E\u5230\u65B9\u6848\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "score-selection-bounded": "\u8BA1\u5206\u9009\u961F\u5C1A\u672A\u7A77\u5C3D\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u65E0\u89E3",
          "score-conditions-unknown": "\u90E8\u5206\u8BA1\u5206\u5C5E\u6027\u5F85\u6838\u5B9E",
          "budget-unreachable": "\u5F53\u524D\u9884\u7B97\u4E0D\u8DB3",
          "target-unreachable": "\u5F53\u524D\u6750\u6599\u8FBE\u4E0D\u5230\u8054\u5408\u76EE\u6807",
          "version-facts-conflict": "\u96C6\u5408\u95F4\u7684\u7248\u672C\u72B6\u6001\u4E0D\u4E00\u81F4\uFF0C\u9700\u8981\u66F4\u65B0",
          "budget-invalid": "\u8BF7\u8F93\u5165\u975E\u8D1F\u6574\u6570\u9884\u7B97",
          "target-context-mismatch": "\u96C6\u5408\u8D26\u53F7\u6216\u5E73\u53F0\u4E0D\u4E00\u81F4"
        };
        add(output, "p", messages[plan.reason] ?? "\u8054\u5408\u89C4\u5212\u6682\u4E0D\u53EF\u7528", "gallery-unknown");
        for (const target of plan.targets ?? []) add(output, "small", `${target.name} \xB7 ${target.targetGrade} \xB7 \u5DF2\u77E5\u8D21\u732E\u8FD8\u5DEE ${count2(target.pointsMissing)} \u5206`);
        return;
      }
      if (!plan.searchComplete) add(output, "small", "\u6709\u754C\u5019\u9009\u65B9\u6848\uFF0C\u4E0D\u4FDD\u8BC1\u6700\u4F4E\u603B\u4EF7\u3002", "gallery-unknown");
      if (plan.costAudit) add(output, "small", `\u6309\u5355\u5361\u4EF7\u683C\u9009\u53D6\u7684\u5B8C\u6574\u7EC4\u5408\u4E3A ${count2(plan.costAudit.totalPrice)} \u91D1\u5E01\uFF0C\u6700\u4F4E\u76EE\u6807\u8BA1\u5206 ${count2(plan.costAudit.score)} \u5206\u3002`, "gallery-unknown");
      for (const [index, planRow] of plan.plans.entries()) {
        const detail = add(output, "details");
        detail.open = index === 0;
        add(detail, "summary", `\u65B9\u6848 ${index + 1} \xB7 ${planRow.items.length} \u5F20 \xB7 ${planRow.totalPrice == null ? "\u62A5\u4EF7\u672A\u77E5" : `${count2(planRow.totalPrice)} \u{1FA99}`}`);
        if (planRow.remainingBudget != null) add(detail, "small", `\u5269\u4F59\u9884\u7B97 ${count2(planRow.remainingBudget)} \u{1FA99}`);
        if (planRow.estimated) add(detail, "small", "\u5305\u542B\u516C\u5F00\u4F30\u5206", "gallery-unknown");
        if (inputs.length) {
          const benchmark = add(detail, "button", "\u5BF9\u7167\u9010\u96C6\u5408");
          benchmark.type = "button";
          const comparison = add(detail, "output", "", "gallery-joint-benchmark");
          const frozen = structuredClone(inputs), identity5 = scope2();
          benchmark.addEventListener("click", async (event) => {
            if (!event.isTrusted || benchmark.disabled) return;
            benchmark.disabled = true;
            comparison.textContent = "\u8BA1\u7B97\u9010\u96C6\u5408\u57FA\u51C6\u2026";
            const token = ++planningEpoch;
            try {
              const baseline = await runGalleryPlan(planGallerySequentialSteps({ targets: frozen }), {
                current: () => active && !disposed && token === planningEpoch && identity5 === scope2() && comparison.isConnected
              });
              if (!baseline) return;
              const value = baseline.status === "observed" ? benchmarkGalleryPlans({ jointPlan: planRow, individualPlans: baseline.plans }) : baseline;
              comparison.textContent = value.status === "observed" ? `\u9010\u96C6\u5408 ${count2(value.separatePrice)} \u91D1\u5E01 \xB7 \u8054\u5408 ${count2(value.jointPrice)} \u91D1\u5E01 \xB7 \u5DEE\u989D ${count2(value.savings)} \u91D1\u5E01` : `\u57FA\u51C6\u672A\u5B8C\u6574\u8BA1\u7B97 \xB7 ${value.reason ?? "\u5F85\u6838\u5B9E"}`;
            } catch {
              void diag({ event: "joint-benchmark", phase: "planner", status: "failed", reason: "FC27_GALLERY_JOINT_BENCHMARK_FAILED" });
              if (comparison.isConnected) comparison.textContent = "\u57FA\u51C6\u6682\u4E0D\u53EF\u7528";
            } finally {
              benchmark.disabled = false;
            }
          });
        }
        const targets = add(detail, "table");
        for (const target of planRow.targets) {
          const row = add(targets, "tr");
          add(row, "th", `${target.name} \xB7 ${target.targetGrade}`);
          add(row, "td", `${count2(target.score)} \u5206`);
          add(row, "td", target.rewards.map((reward) => reward.label).join("\u3001") || "\u65E0\u76EE\u5F55\u5956\u52B1");
        }
        add(detail, "small", "\u5956\u52B1\u4E3A\u76EE\u5F55\u5185\u5BB9\uFF0C\u672A\u786E\u8BA4\u53EF\u9886\u6216\u65B0\u589E\u6536\u76CA\u3002");
        const list2 = add(detail, "ul");
        for (const item2 of planRow.items) add(list2, "li", `${item2.name ?? item2.eaId} \xB7 ${item2.version ?? ""} \xB7 ${item2.price == null ? "\u4EF7\u683C\u672A\u77E5" : `${count2(item2.price)} \u{1FA99}`}${item2.targetIds.length > 1 ? ` \xB7 \u5171\u7528 ${item2.targetIds.length} \u4E2A\u76EE\u6807` : ""}`);
        const targetsBinding = JSON.stringify([...jointTargets]);
        const catalogAtPlan = result.catalog;
        purchaseButton(
          detail,
          planRow.items,
          `joint:${targetsBinding}:${planRow.items.map((item2) => item2.eaId).join(",")}`,
          {
            budget: targetValue().budget,
            replanContext: { targets: inputs, mode: "joint", ledger: { receipts: [], excludedIds: [], quotes: {} }, budget: targetValue().budget },
            valid: () => jointMode && result.catalog === catalogAtPlan && JSON.stringify([...jointTargets]) === targetsBinding
          }
        );
      }
    };
    node("gallery-mode-browse").addEventListener("click", () => setJointMode(false));
    node("gallery-mode-joint").addEventListener("click", () => setJointMode(true));
    node("gallery-joint-budget").addEventListener("input", (event) => {
      if (!event.isTrusted || checkScope() === false) return;
      invalidateJoint();
      persistTargets();
    });
    node("gallery-joint-plan").addEventListener("click", async (event) => {
      if (!event.isTrusted || restoringTargets) return;
      checkScope();
      const sets2 = result?.catalog?.categories.flatMap((category) => category.sets) ?? [];
      const targets = [];
      for (const [id7, targetGrade] of jointTargets) {
        const value = details.get(id7), set = sets2.find((set2) => set2.id === id7);
        if (!set || !value?.progress || value.status !== "observed" || value.stale || value.poolStale) {
          void diag({ event: "joint-plan", phase: "preflight", status: "blocked", reason: "FC27_GALLERY_JOINT_TARGET_STATE_UNKNOWN", count: targets.length });
          showJointPlan({ status: "partial", reason: "target-state-unknown" });
          return;
        }
        targets.push({
          set,
          catalog: result.catalog,
          progress: value.progress,
          prices: planningPrices(value),
          scope: currentScope,
          targetGrade
        });
      }
      const rawBudget = node("gallery-joint-budget").value.trim(), budget = rawBudget ? Number(rawBudget) : null;
      const token = ++planningEpoch, identity5 = scope2();
      jointRun = token;
      const current2 = () => !disposed && active && token === planningEpoch && identity5 === scope2() && jointMode;
      const button = node("gallery-joint-plan");
      button.disabled = true;
      const output = node("gallery-joint-output");
      output.textContent = "\u6B63\u5728\u8BA1\u7B97\u2026";
      const cancel = add(node("gallery-joint-controls") ?? button.parentElement, "button", "\u53D6\u6D88");
      cancel.addEventListener("click", () => {
        planningEpoch++;
        output.textContent = "\u8BA1\u7B97\u5DF2\u53D6\u6D88";
      });
      try {
        const refreshIds = [...new Set(targets.filter((target) => {
          const value = details.get(target.set.id);
          return needsPriceRefresh(value);
        }).flatMap((target) => target.progress.rows.filter((row) => !isGalleryOwned(row)).map((row) => row.eaId)))].sort((a, b) => a - b);
        if (refreshIds.length && typeof loadPrices === "function") {
          output.textContent = "\u6B63\u5728\u66F4\u65B0\u516C\u5F00\u62A5\u4EF7\u2026";
          const snapshots = [];
          for (let start = 0; start < refreshIds.length; start += 250) {
            if (!current2()) return;
            snapshots.push(await loadPrices(refreshIds.slice(start, start + 250)));
          }
          if (!current2()) return;
          const priceSnapshot = { prices: {}, freshPrices: {}, expiresAt: null };
          for (const snapshot of snapshots) {
            Object.assign(priceSnapshot.prices, snapshot?.prices ?? {});
            Object.assign(priceSnapshot.freshPrices, snapshot?.freshPrices ?? {});
            if (snapshot?.expiresAt != null) priceSnapshot.expiresAt = Math.min(priceSnapshot.expiresAt ?? Infinity, snapshot.expiresAt);
          }
          for (const target of targets) {
            const previous = details.get(target.set.id);
            if (!needsPriceRefresh(previous)) continue;
            const value = { ...previous, priceSnapshot, prices: priceSnapshot.prices };
            details.set(target.set.id, value);
            target.prices = planningPrices(value);
          }
        }
        void diag({ event: "joint-plan", phase: "planner", status: "started", count: targets.length });
        const plan = await runGalleryPlan(planGalleryJointSteps({ targets, budget }), {
          current: current2,
          progress: (value) => {
            output.textContent = `\u6B63\u5728\u8BA1\u7B97\u2026 ${value.evaluations} \u4E2A\u5019\u9009`;
          }
        });
        if (plan) void diag({
          event: "joint-plan",
          phase: "planner",
          status: plan.status === "ready" || plan.status === "achieved" ? "success" : "blocked",
          replayInput: { targets, budget },
          reason: /^[a-z]+(?:-[a-z]+)*$/.test(plan.reason ?? "") ? `FC27_GALLERY_JOINT_${plan.reason.replaceAll("-", "_").toUpperCase()}` : void 0,
          evaluations: plan.evaluations,
          count: targets.length,
          requestedCount: plan.candidateCount,
          retainedCount: plan.candidateCount,
          expandedCount: plan.omittedCandidates,
          quotedCount: plan.quotedCandidateCount,
          bestPrice: plan.plans?.[0]?.totalPrice,
          beamTruncated: plan.beamTruncated === true,
          budgetExhausted: plan.budgetExhausted === true,
          timeExhausted: plan.timeExhausted === true,
          searchComplete: plan.searchComplete === true,
          scopeTruncated: plan.scopeTruncated === true
        });
        if (plan && current2()) showJointPlan(plan, targets);
      } catch {
        void diag({ event: "joint-plan", phase: "planner", status: "failed", reason: "FC27_GALLERY_JOINT_PLANNER_FAILED", count: targets.length });
        if (current2()) showJointPlan({ status: "unavailable", reason: "planner-failed" });
      } finally {
        if (jointRun === token) {
          jointRun = null;
          button.disabled = !jointTargets.size || restoringTargets;
        }
        cancel.remove();
      }
    });
    const invalidated = /* @__PURE__ */ new Set();
    let detailRequest = null;
    const scope2 = () => {
      try {
        return accountScope();
      } catch {
        return null;
      }
    };
    let currentScope = scope2();
    const checkScope = () => {
      const next = scope2();
      if (next === currentScope) return true;
      scoreQueue.cancel();
      scoredSets.clear();
      overviewCache.clear();
      planCache.clear();
      currentScope = next;
      selection++;
      selectedSetId = null;
      details.clear();
      selectedCards.clear();
      selectionSource = null;
      selectionBudget = "";
      cardPage = 1;
      foregroundSync = null;
      resumeBackground = false;
      if (syncing) sync?.stop();
      jointTargets.clear();
      node("gallery-joint-budget").value = "";
      targetsIdentity = null;
      ++targetsEpoch;
      restoringTargets = false;
      node("gallery-joint-budget").disabled = false;
      targetStatus("");
      invalidateJoint();
      restoreTargets();
      renderJoint();
      disposeNativeCards(node("gallery-set-detail"));
      node("gallery-set-detail").replaceChildren();
      categoryId = null;
      showBrowseLevel();
      if (result) renderSets();
      updateSyncButton();
      void refreshShared();
      return false;
    };
    const renderSetDetail = (value, set) => {
      const target = node("gallery-set-detail");
      disposeNativeCards(target);
      target.replaceChildren();
      showBrowseLevel();
      node("gallery-selection-footer").replaceChildren();
      node("gallery-selection-footer").hidden = true;
      const heading = add(target, "div", "", "gallery-detail-heading");
      const headingIdentity = add(heading, "div", "", "gallery-identity");
      add(headingIdentity, "h3", set.name);
      if (sync) {
        const button = add(heading, "button", "\u540C\u6B65\u5F53\u524D\u96C6\u5408");
        button.title = "\u540C\u6B65\u5F53\u524D\u96C6\u5408";
        button.disabled = foregroundSync?.setId === set.id;
        button.addEventListener("click", (event) => {
          if (event.isTrusted) void loadSetDetails(set, { force: true });
        });
      }
      if (!value) return;
      if (value.status === "loading") {
        add(target, "p", "\u6B63\u5728\u8BFB\u53D6\u5361\u6C60\u548C\u8D26\u53F7\u72B6\u6001\u2026");
        return;
      }
      if (!value.progress) {
        add(target, "p", value.reason ?? "\u96C6\u5408\u5361\u6C60\u6216\u8D26\u53F7\u8FDB\u5EA6\u6682\u4E0D\u53EF\u7528", "gallery-unknown");
        return;
      }
      const progress = value.progress;
      const summary2 = scoreSummary(value, set);
      if (value.status !== "observed") add(target, "small", `\u8D26\u53F7\u72B6\u6001\u672A\u540C\u6B65 \xB7 ${value.reason ?? "\u8BFB\u53D6\u5931\u8D25"}`, "gallery-unknown");
      if (value.priceError) add(target, "small", `\u4EF7\u683C\u8BFB\u53D6\u5931\u8D25 \xB7 ${value.priceError}`, "gallery-unknown");
      if (value.priceSnapshot?.stale || priceExpired(value)) add(target, "small", "\u62A5\u4EF7\u5FEB\u7167\u5F85\u66F4\u65B0", "gallery-unknown");
      const first = progress.rows[0];
      const emblems = add(headingIdentity, "div", "", "gallery-emblems");
      image(emblems, asset("club", first?.clubEaId), "\u4FF1\u4E50\u90E8\u5FBD\u7AE0", "gallery-emblem");
      image(emblems, asset("league", first?.leagueEaId), "\u8054\u8D5B\u6807\u5FD7", "gallery-emblem");
      const overview = add(target, "div", "", "gallery-overview");
      const unconfirmed = progress.totals.unknown === progress.totals.total && progress.totals.total > 0;
      add(overview, "strong", unconfirmed ? `?/${set.requiredCards}` : `${progress.totals.collected}/${set.requiredCards}`, "gallery-big-count");
      add(overview, "span", unconfirmed ? "\u5F85\u540C\u6B65" : progress.candidateOnly ? "\u5019\u9009\u5185\u5DF2\u6536\u96C6" : "\u5DF2\u786E\u8BA4\u6536\u96C6", "gallery-muted");
      add(overview, "span", `${progress.totals.missing} \u7F3A\u5931 \xB7 ${progress.totals.unknown} \u5F85\u6838\u5B9E`, "gallery-muted");
      add(overview, "span", progress.candidateOnly ? `\u9AD8\u5206\u5019\u9009 ${progress.totals.total} / \u5168\u90E8 ${progress.poolSize ?? "?"}` : `\u5361\u6C60 ${progress.totals.total}`, "gallery-muted");
      gradeTrack(overview, set.grades, summary2);
      const rewards2 = add(target, "details", "", "gallery-rewards");
      add(rewards2, "summary", "\u7B49\u7EA7\u5956\u52B1");
      for (const grade of set.grades) {
        const row = add(rewards2, "div", "", "gallery-reward-row");
        add(row, "strong", grade.name);
        add(row, "span", `${count2(grade.threshold)} \u5206`);
        add(row, "span", grade.rewards.map((reward) => reward.label).join("\u3001") || (grade.rewardsComplete ? "\u65E0\u5956\u52B1" : "\u975E\u4EE3\u5E01\u5956\u52B1\u672A\u63D0\u4F9B"));
      }
      const facts2 = add(target, "details", "", "gallery-facts");
      add(facts2, "summary", "\u6536\u96C6\u72B6\u6001\u8BE6\u60C5");
      add(facts2, "small", `Club \u53EF\u89C1 ${progress.totals.inClub} / \u672A\u77E5 ${progress.totals.clubUnknown} \xB7 \u9996\u4EFB\u53EF\u89C1 ${progress.totals.firstOwned} / \u672A\u77E5 ${progress.totals.firstOwnedUnknown}`);
      add(facts2, "small", "Club \u6765\u81EA\u5F53\u524D\u7F13\u5B58\uFF1B\u672A\u770B\u5230\u4E0D\u7B49\u4E8E\u6CA1\u6709\u3002\u516C\u5F00\u5206\u503C\u4E0E EA \u5355\u5361\u57FA\u7840\u5206\u5206\u522B\u663E\u793A\u3002");
      if (value.stale) add(target, "small", `\u66F4\u65B0\u672A\u6210\u529F\uFF0C\u4FDD\u7559\u6700\u8FD1\u5FEB\u7167 \xB7 ${value.reason ?? ""}`, "gallery-unknown");
      if (value.poolStale) add(target, "small", "\u516C\u5171\u5361\u6C60\u6682\u65F6\u65E0\u6CD5\u66F4\u65B0\uFF0C\u4F7F\u7528\u4E0A\u6B21\u5361\u6C60\u3002", "gallery-unknown");
      if (value.fetchedAt) add(target, "small", `\u6536\u96C6\u72B6\u6001\u8BFB\u53D6\u4E8E ${date(value.fetchedAt)}`);
      renderScoring(target, summary2, value);
      const cachedPlan = planCache.get(set.id);
      if (cachedPlan && cachedPlan.binding !== planBinding(value, set)) cachedPlan.stale = true;
      renderPlan(target, value, set, summary2);
      if (selectionSource !== result?.source) {
        selectedCards.clear();
        selectionSource = result?.source ?? null;
        cardPage = 1;
      }
      const filters = add(target, "div", "", "row gallery-card-filters");
      for (const [key, label] of [["all", "\u5168\u90E8"], ["collected", "\u5DF2\u6536\u96C6"], ["missing", "\u672A\u6536\u96C6"], ["unknown", "\u5F85\u6838\u5B9E"], ["held", "\u6301\u6709"], ["lineup", "\u8BA1\u5206\u9635\u5BB9"], ["firstOwned", "First Owner"]]) {
        const button = add(filters, "button", label);
        button.setAttribute("aria-pressed", String(filter === key));
        button.addEventListener("click", (event) => {
          if (!event.isTrusted) return;
          filter = key;
          cardPage = 1;
          renderSetDetail(value, set);
        });
      }
      const cardTools = add(target, "div", "", "row gallery-card-tools");
      const search = add(cardTools, "input");
      search.type = "search";
      search.value = cardQuery;
      search.placeholder = "\u641C\u7D22\u7403\u5458";
      search.setAttribute("aria-label", "\u641C\u7D22\u7403\u5458");
      const order2 = document.createElement("select");
      order2.setAttribute("aria-label", "\u5361\u7247\u6392\u5E8F");
      for (const [key, label] of [["catalog", "\u76EE\u5F55\u987A\u5E8F"], ["name", "\u540D\u79F0"], ["score", "Gallery \u5206\u6570"], ["price", "\u4EF7\u683C"]]) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = label;
        option.selected = cardOrder === key;
        order2.append(option);
      }
      cardTools.append(order2);
      const clear = add(cardTools, "button", "\xD7");
      clear.title = "\u6E05\u9664\u9009\u62E9";
      clear.setAttribute("aria-label", "\u6E05\u9664\u9009\u62E9");
      clear.type = "button";
      clear.disabled = !selectedCards.size;
      const missingRows = progress.rows.filter((row) => !isGalleryOwned(row) && row.collected === false);
      const cheapCount = add(cardTools, "input");
      cheapCount.type = "number";
      cheapCount.min = "1";
      cheapCount.max = String(Math.max(1, missingRows.length));
      cheapCount.value = String(Math.max(1, set.requiredCards - progress.totals.collected));
      cheapCount.setAttribute("aria-label", "\u6700\u4F4E\u4EF7\u9009\u5361\u6570\u91CF");
      cheapCount.className = "gallery-cheapest-count";
      const cheapest = add(cardTools, "button", "\u6700\u4F4E\u4EF7 N \u5F20");
      cheapest.type = "button";
      cheapest.disabled = typeof purchase !== "function" || !missingRows.length;
      const filtered = filterGalleryCards(progress.rows, { filter, query: cardQuery, order: cardOrder, prices: planningPrices(value) ?? {}, lineupIds: summary2?.lineup?.map((row) => row.eaId) ?? [] });
      const page = paginateGalleryCards(filtered, { page: cardPage, pageSize: 24 });
      cardPage = page.page;
      add(cardTools, "span", `${page.total ? `${(page.page - 1) * page.pageSize + 1}-${Math.min(page.page * page.pageSize, page.total)}` : 0} / ${page.total}`, "gallery-card-page");
      const previous = add(cardTools, "button", "\u2190");
      previous.type = "button";
      previous.title = "\u4E0A\u4E00\u9875";
      previous.setAttribute("aria-label", "\u4E0A\u4E00\u9875");
      previous.disabled = page.page <= 1;
      const next = add(cardTools, "button", "\u2192");
      next.type = "button";
      next.title = "\u4E0B\u4E00\u9875";
      next.setAttribute("aria-label", "\u4E0B\u4E00\u9875");
      next.disabled = page.page >= page.pages;
      const reconciled = reconcileGallerySelection(selectedCards, selectionContext().rows);
      selectedCards.clear();
      for (const [id7, row] of reconciled) selectedCards.set(id7, row);
      const list2 = add(target, "div", "", "gallery-card-list");
      const selectionBar = node("gallery-selection-footer");
      selectionBar.hidden = typeof purchase !== "function" || !selectedCards.size;
      const selectedBuy = typeof purchase === "function" ? add(selectionBar, "button", "Buy 0", "primary gallery-purchase") : null;
      const selectionSummary = add(selectionBar, "span", "", "gallery-selection-summary");
      const preview = add(selectionBar, "div", "", "gallery-selection-preview");
      preview.setAttribute("role", "status");
      let selectedSummary, previewEpoch = 0;
      const updateSelected = () => {
        const context = selectionContext();
        selectedSummary = summarizeGallerySelection(selectedCards, context.rows, context.prices);
        if (selectedBuy) {
          selectedBuy.disabled = !selectedSummary.count || buying || !context.valid || value.status !== "observed" || value.stale || value.poolStale;
          selectedBuy.textContent = `Buy ${selectedSummary.count}`;
        }
        selectionBar.hidden = typeof purchase !== "function" || !selectedSummary.count;
        updateFooterGeometry();
        clear.disabled = !selectedSummary.count;
        selectionSummary.textContent = `${selectedSummary.count} \u5F20 \xB7 ${selectedSummary.totalPrice == null ? "\u62A5\u4EF7\u672A\u77E5" : `${count2(selectedSummary.totalPrice)} \u91D1\u5E01`}`;
        for (const button of list2.querySelectorAll(".gallery-card-select")) {
          const id7 = button.closest("[data-definition-id]").dataset.definitionId, added = selectedCards.has(id7);
          button.textContent = added ? "Added" : "Buy";
          button.setAttribute("aria-pressed", String(added));
          button.style.color = added ? "#152c22" : "";
          button.style.opacity = added ? "1" : "";
          button.style.fontWeight = added ? "700" : "";
          button.setAttribute("aria-label", `${added ? "\u79FB\u9664" : "\u6DFB\u52A0"} ${button.dataset.cardName}`);
        }
        const token = ++previewEpoch;
        if (!selectedSummary.count) {
          preview.replaceChildren();
          return;
        }
        preview.textContent = "\u9884\u8BA1\u7B49\u7EA7\u8BA1\u7B97\u4E2D\u2026";
        void runGalleryPlan(previewGallerySelectionSteps({
          set,
          catalog: result.catalog,
          progress,
          selectedIds: selectedSummary.selected.map((row) => row.eaId)
        }), {
          current: () => token === previewEpoch && thisDetailCurrent(value, set.id) && preview.isConnected,
          maxMs: 1500
        }).then((summary3) => {
          if (!summary3) return;
          preview.textContent = `\u9884\u8BA1 ${scoreText(summary3)}${summary3.estimated ? " \xB7 \u516C\u5F00\u4F30\u5206" : ""}`;
        }).catch(() => {
          if (preview.isConnected && token === previewEpoch) preview.textContent = "\u9884\u8BA1\u7B49\u7EA7\u6682\u4E0D\u53EF\u7528";
        });
      };
      if (selectedBuy) {
        const budget = add(selectionBar, "input");
        budget.type = "number";
        budget.min = "0";
        budget.max = "165000000";
        budget.step = "1";
        budget.value = selectionBudget;
        budget.placeholder = "\u603B\u9884\u7B97\uFF08\u53EF\u9009\uFF09";
        budget.setAttribute("aria-label", "\u8D2D\u4E70\u603B\u9884\u7B97");
        budget.style.maxWidth = "160px";
        budget.addEventListener("input", (event) => {
          if (event.isTrusted) selectionBudget = budget.value;
        });
        selectedBuy.addEventListener("click", (event) => {
          if (!event.isTrusted || !thisDetailCurrent(value, set.id) || value.stale || value.poolStale || buying || checkScope() === false) return;
          const context = selectionContext();
          if (!context.valid) return;
          const currentSelection = summarizeGallerySelection(selectedCards, context.rows, context.prices);
          if (currentSelection.count !== selectedCards.size) {
            updateSelected();
            return;
          }
          const total = budget.value.trim() ? Number(budget.value) : null;
          void runPurchase({ items: currentSelection.selected.map((row) => ({ eaId: row.eaId, name: row.name, definitionId: row.eaId })), binding: `cards:${result.source}:${[...selectedCards.keys()].sort().join(",")}`, budget: total });
        });
      }
      clear.disabled = !selectedCards.size;
      clear.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        selectedCards.clear();
        updateSelected();
      });
      cheapest.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        const candidates = selectCheapestGalleryCards(filtered, Number(cheapCount.value), planningPrices(value) ?? {});
        for (const row of candidates) selectedCards.set(String(row.eaId), { eaId: row.eaId, name: row.name });
        updateSelected();
      });
      search.addEventListener("change", (event) => {
        if (!event.isTrusted) return;
        cardQuery = search.value;
        cardPage = 1;
        renderSetDetail(value, set);
      });
      order2.addEventListener("change", (event) => {
        if (!event.isTrusted) return;
        cardOrder = order2.value;
        cardPage = 1;
        renderSetDetail(value, set);
      });
      previous.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        cardPage--;
        renderSetDetail(value, set);
      });
      next.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        cardPage++;
        renderSetDetail(value, set);
      });
      const scoredIds = new Set(summary2?.lineup?.map((row) => row.eaId) ?? []);
      for (const row of page.rows) {
        const card = add(list2, "article", "", "gallery-card gallery-player-card");
        card.dataset.definitionId = String(row.eaId);
        card.dataset.rarityId = String(row.rarityEaId ?? "");
        const art = add(card, "div", "", "gallery-player-art");
        art.dataset.galleryCardArt = String(row.eaId);
        if (selectedBuy && !isGalleryOwned(row) && row.collected === false && value.status === "observed" && !value.stale && !value.poolStale) {
          const select = add(art, "button", selectedCards.has(String(row.eaId)) ? "Added" : "Buy", "gallery-card-select");
          select.type = "button";
          select.setAttribute("aria-label", `${selectedCards.has(String(row.eaId)) ? "\u79FB\u9664" : "\u6DFB\u52A0"} ${row.name} ${row.version ?? ""}`);
          select.dataset.cardName = `${row.name} ${row.version ?? ""}`;
          select.setAttribute("aria-pressed", String(selectedCards.has(String(row.eaId))));
          if (selectedCards.has(String(row.eaId))) {
            select.style.color = "#152c22";
            select.style.opacity = "1";
            select.style.fontWeight = "700";
          }
          select.addEventListener("click", (event) => {
            if (!event.isTrusted) return;
            if (selectedCards.has(String(row.eaId))) selectedCards.delete(String(row.eaId));
            else selectedCards.set(String(row.eaId), { eaId: row.eaId, name: row.name });
            updateSelected();
          });
        }
        const price2 = cachedPrice(row, value);
        const priceBar = add(art, "div", "", "gallery-card-pricebar");
        const priceLabel = add(priceBar, "span", price2 == null ? "\u4EF7\u683C\u672A\u77E5" : `${price2.toLocaleString()} \u{1FA99}`, "gallery-card-price");
        const stalePrice = price2 != null && (priceExpired(value) || value.priceSnapshot?.staleIds?.includes(row.eaId) || value.priceSnapshot && !Object.hasOwn(value.priceSnapshot.prices, row.eaId));
        if (stalePrice) {
          priceLabel.dataset.priceState = "snapshot";
          priceLabel.title = "\u65E7\u62A5\u4EF7\u5FEB\u7167\uFF0C\u4E0D\u7528\u4E8E\u65B9\u6848\u6210\u672C";
          priceLabel.classList.add("gallery-unknown");
        }
        add(priceBar, "span", `Gallery ${row.galleryScore == null ? "\u2014" : row.galleryScore.toLocaleString()}`, "gallery-card-gallery-score");
        cardImage(art, row, value.runtimeCards, set.id);
        const selectControl = art.querySelector(".gallery-card-select");
        if (selectControl) art.append(selectControl);
        const meta = add(card, "div", "", "gallery-player-meta");
        add(meta, "strong", row.name);
        add(meta, "span", `${row.overall ?? "\u2014"} OVR \xB7 ${row.version ?? "\u7248\u672C\u672A\u77E5"}`, "gallery-player-version");
        const logos = add(meta, "div", "", "gallery-player-logos");
        image(logos, asset("club", row.clubEaId), "\u4FF1\u4E50\u90E8", "gallery-mini-emblem");
        image(logos, asset("league", row.leagueEaId), "\u8054\u8D5B", "gallery-mini-emblem");
        image(logos, asset("nation", row.nationEaId), "\u56FD\u7C4D", "gallery-mini-emblem");
        const flags2 = add(meta, "div", "", "gallery-player-flags");
        statusIcon(flags2, row.collected, row.collected === true ? "\u5DF2\u6536\u96C6" : row.collected === false ? "\u672A\u6536\u96C6" : "\u6536\u96C6\u72B6\u6001\u672A\u77E5");
        statusIcon(flags2, row.inClub, row.inClub === true ? "Club \u53EF\u89C1" : row.inClub === false && row.held ? "\u5176\u4ED6\u5E93\u5B58\u533A\u6301\u6709\uFF0CClub \u672A\u770B\u5230" : row.inClub === false ? "Club \u672A\u770B\u5230" : "Club \u72B6\u6001\u672A\u77E5");
        statusIcon(flags2, row.firstOwned, row.firstOwned === true ? "First Owner" : row.firstOwned === false ? "\u975E First Owner" : "First Owner \u672A\u77E5");
        add(meta, "span", `EA ${row.gradingScore == null ? "\u672A\u77E5" : row.gradingScore}`, "gallery-player-score");
        const firstOwnerAction = galleryFirstOwnerHistoryAction(row);
        if (typeof setFirstOwner === "function" && firstOwnerAction) {
          const localFirstOwner = firstOwnerAction === "clear";
          const firstOwner = add(meta, "button", localFirstOwner ? "\u6E05\u9664\u5386\u53F2 FO" : "\u6807\u8BB0\u5386\u53F2 FO", "gallery-first-owner-toggle");
          firstOwner.type = "button";
          firstOwner.title = localFirstOwner ? "\u6E05\u9664\u672C\u5730\u9996\u4EFB\u5386\u53F2\u58F0\u660E\uFF0C\u6062\u590D\u81EA\u52A8\u8BC6\u522B\u7ED3\u679C\uFF1B\u4E0D\u6539\u53D8 EA \u8BB0\u5F55" : "\u4EC5\u5728\u786E\u5B9A\u66FE\u9996\u4EFB\u83B7\u5F97\u8FD9\u4E2A\u7248\u672C\u65F6\u6807\u8BB0\uFF1B\u4EC5\u4ECE\u5E02\u573A\u4E70\u8FC7\u7684\u4E0D\u8981\u6807\u8BB0\u3002\u53EA\u5F71\u54CD FCAT \u672C\u5730\u4F30\u5206\uFF0C\u4E0D\u6539\u53D8 EA \u8BB0\u5F55";
          firstOwner.addEventListener("click", async (event) => {
            if (!event.isTrusted || checkScope() === false || !thisDetailCurrent(value, set.id)) return;
            const identity5 = scope2();
            firstOwner.disabled = true;
            try {
              await setFirstOwner(row.eaId, localFirstOwner ? null : true);
              const current2 = details.get(set.id);
              if (!current2 || current2 !== value || identity5 !== scope2() || !thisDetailCurrent(value, set.id)) return;
              for (const [id7, detail] of details) {
                if (!detail.progress?.rows.some((item2) => item2.eaId === row.eaId)) continue;
                const rows = detail.progress.rows.map((item2) => {
                  if (item2.eaId !== row.eaId) return item2;
                  const observed = item2.observedFirstOwned ?? (item2.firstOwnedSource === "ea-observed" ? item2.firstOwned : null);
                  return {
                    ...item2,
                    observedFirstOwned: observed,
                    firstOwned: localFirstOwner ? observed : true,
                    firstOwnedSource: localFirstOwner ? observed === null ? null : "ea-observed" : "local-history"
                  };
                });
                details.set(id7, { ...detail, progress: { ...detail.progress, rows, totals: {
                  ...detail.progress.totals,
                  firstOwned: rows.filter((item2) => item2.firstOwned === true).length,
                  firstOwnedUnknown: rows.filter((item2) => item2.firstOwned === null).length
                } } });
              }
              invalidateJoint("First Owner \u5386\u53F2\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210");
              renderSetDetail(details.get(set.id), set);
            } catch {
              firstOwner.title = "\u672C\u5730 FO \u5386\u53F2\u4FDD\u5B58\u5931\u8D25";
              if (identity5 === scope2() && thisDetailCurrent(value, set.id)) {
                const failure = meta.querySelector(".gallery-first-owner-error") ?? add(meta, "small", "", "gallery-first-owner-error");
                failure.textContent = "\u672C\u5730 FO \u5386\u53F2\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5";
              }
            } finally {
              if (firstOwner.isConnected) firstOwner.disabled = false;
            }
          });
        }
        if (scoredIds.has(row.eaId)) add(meta, "span", "\u8BA1\u5206\u9635\u5BB9\u6210\u5458", "badge gallery-score-member");
        if (typeof marketCompare === "function" && !isGalleryOwned(row) && row.collected === false) {
          const compare = add(meta, "button", "\u6BD4\u4EF7", "gallery-card-compare");
          compare.type = "button";
          const comparison = add(meta, "small", "", "gallery-market-comparison");
          compare.addEventListener("click", async (event) => {
            if (!event.isTrusted || !thisDetailCurrent(value, set.id)) return;
            compare.disabled = true;
            comparison.textContent = "\u8BFB\u53D6 EA \u53EF\u89C1\u6700\u4F4E\u4EF7\u2026";
            meta.querySelector(".gallery-market-listings")?.remove();
            const compareScope = scope2();
            try {
              const quote2 = await marketCompare(row.eaId);
              if (!comparison.isConnected || !thisDetailCurrent(value, set.id) || compareScope !== scope2()) return;
              if (quote2?.status !== "observed") {
                comparison.textContent = `\u6BD4\u4EF7\u6682\u4E0D\u53EF\u7528 \xB7 ${quote2?.reason ?? "\u672A\u77E5"}`;
                comparison.title = quote2?.reason ?? "";
                return;
              }
              comparison.title = "";
              const reference = cachedPrice(row, value);
              comparison.textContent = `EA ${quote2.price == null ? "\u65E0\u6709\u6548\u6302\u724C" : `${count2(quote2.price)} \u91D1\u5E01`} \xB7 \u53C2\u8003 ${reference == null ? "\u672A\u77E5" : `${count2(reference)} \u91D1\u5E01`}`;
              if (quote2.listings?.length) {
                const detail = add(meta, "details", "", "gallery-market-listings");
                add(detail, "summary", `EA \u53EF\u89C1\u62A5\u4EF7 ${quote2.listings.length} \u6761`);
                for (const listing of quote2.listings.slice(0, 3)) add(detail, "small", `${count2(listing.buyNow)} \u91D1\u5E01 \xB7 \u5269\u4F59 ${listing.expires ?? "?"} \u79D2`);
              }
            } catch {
              void diag({ event: "market-compare", phase: "view", status: "failed", reason: "FC27_GALLERY_COMPARE_VIEW_FAILED" });
              if (comparison.isConnected && thisDetailCurrent(value, set.id) && compareScope === scope2()) comparison.textContent = "\u6BD4\u4EF7\u6682\u4E0D\u53EF\u7528";
            } finally {
              compare.disabled = false;
            }
          });
        }
      }
      updateSelected();
      updateFooterGeometry();
    };
    const loadSetDetails = (set, { force = false } = {}) => {
      if (typeof loadSet !== "function") return;
      if (checkScope() === false) return;
      if (!force && !invalidated.has(set.id) && foregroundSync?.setId === set.id && detailRequest?.id === set.id) return detailRequest.task;
      const priority = sync?.prioritize?.(set.id);
      categoryId = result?.catalog?.categories.find((row) => row.sets.some((candidate) => candidate.id === set.id))?.id ?? null;
      const changingSet = selectedSetId !== set.id;
      selectedSetId = set.id;
      if (changingSet) {
        cardPage = 1;
        cardQuery = "";
        cardOrder = "catalog";
      }
      filter = "all";
      const token = ++selection, startedScope = currentScope, source = result?.source;
      force = force || invalidated.has(set.id);
      foregroundSync = { token, setId: set.id, name: set.name, progress: { phase: "catalog", index: 0, total: 1, completed: 0 } };
      const prior = force && detailRequest?.id === set.id && detailRequest.source === source ? detailRequest.task : null;
      renderSetDetail({ status: "loading" }, set);
      updateSyncButton();
      const task = Promise.resolve(priority).then(() => prior).then(() => {
        checkScope();
        if (token !== selection || startedScope !== currentScope) return null;
        return loadSet({ source, setId: set.id, set, force, onProgress: (progress) => {
          if (foregroundSync?.token !== token || startedScope !== scope2() || disposed) return;
          foregroundSync.progress = progress;
          updateSyncButton();
        } });
      }).then(async (value) => {
        checkScope();
        if (!value || token !== selection || source !== result?.source || startedScope !== currentScope || value.scope && value.scope !== currentScope) return;
        if (value.status === "observed" && !value.poolStale) invalidated.delete(set.id);
        const changed = galleryPlanningStateKey(details.get(set.id)) !== galleryPlanningStateKey(value);
        details.set(set.id, value);
        await restorePlanCache(set, value);
        if (token !== selection || source !== result?.source || startedScope !== currentScope) return;
        if (changed && jointTargets.has(set.id)) invalidateJoint("\u76EE\u6807\u6750\u6599\u6216\u62A5\u4EF7\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u65B9\u6848\u3002");
        renderJoint();
        renderSets();
        const currentSet = result.catalog.categories.flatMap((category) => category.sets).find((row) => row.id === set.id);
        if (currentSet && !jointMode) renderSetDetail(value, currentSet);
      }).catch((error2) => {
        checkScope();
        const value = { status: "blocked", reason: /^FC27_[A-Z_]+$/.test(error2?.message) ? error2.message : "FC27_GALLERY_PROGRESS_UNAVAILABLE" };
        if (token === selection) renderSetDetail(value, set);
      }).finally(() => {
        if (foregroundSync?.token === token) {
          foregroundSync = null;
          updateSyncButton();
        }
        Promise.resolve(priority).then((interrupted) => {
          if (interrupted && !disposed && active && startedScope === scope2()) resumeBackground = true;
          if (resumeBackground && !foregroundSync && !disposed && active && !syncing) {
            resumeBackground = false;
            void synchronize2(null, { background: true });
          }
        });
      });
      detailRequest = { id: set.id, source, task };
      return task;
    };
    const renderSets = () => {
      const categories = result?.catalog?.categories ?? [];
      const category = categories.find((row) => row.id === categoryId);
      const list2 = node("gallery-set-list");
      list2.replaceChildren();
      if (!category) {
        showBrowseLevel();
        return;
      }
      node("gallery-category-title").textContent = category.name;
      const summaries = new Map([...details].map(([id7, value]) => [id7, value?.progress?.totals]));
      const filtered = browseGallerySets(result?.catalog, {
        categoryId,
        query: node("gallery-search").value,
        order: node("gallery-sort").value,
        followedOnly: node("gallery-followed").checked,
        targets: targetValue().targets,
        summaries
      });
      if (!filtered.length) add(list2, "p", "\u6CA1\u6709\u5339\u914D\u7684\u96C6\u5408", "gallery-unknown");
      for (const { set } of filtered) {
        const card = add(list2, "article", "", "gallery-set");
        card.dataset.setId = set.id;
        const title = add(card, "div", "", "gallery-set-title");
        const configuredIcons = assets?.set?.(set.name);
        const titleIcons = Array.isArray(configuredIcons) && configuredIcons.length ? configuredIcons : details.get(set.id)?.pool?.items?.slice(0, 3).map((item2) => asset("club", item2.clubEaId)) ?? [];
        const iconBox = add(title, "span", "", "gallery-set-icons");
        const candidates = (Array.isArray(titleIcons) ? titleIcons : [titleIcons]).map((value) => typeof value === "string" && value.startsWith("https://") ? value : asset("club", value)).filter(Boolean);
        let chosen = setIconSelections.get(set.id);
        if (!chosen || chosen.key !== JSON.stringify(candidates)) {
          chosen = { key: JSON.stringify(candidates), src: selectGallerySetIcon(candidates) };
          setIconSelections.set(set.id, chosen);
        }
        if (chosen.src) image(iconBox, chosen.src, set.name, "gallery-set-icon");
        add(title, "h4", set.name);
        const watch = add(title, "button", jointTargets.has(set.id) ? "\u2605" : "\u2606", "gallery-watch");
        watch.type = "button";
        watch.title = jointTargets.has(set.id) ? "\u53D6\u6D88\u5173\u6CE8" : "\u5173\u6CE8\u96C6\u5408";
        watch.setAttribute("aria-label", `${watch.title} ${set.name}`);
        watch.setAttribute("aria-pressed", String(jointTargets.has(set.id)));
        watch.disabled = restoringTargets;
        watch.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!event.isTrusted || restoringTargets) return;
          if (checkScope() === false) return;
          if (restoringTargets) return;
          if (jointTargets.has(set.id)) jointTargets.delete(set.id);
          else jointTargets.set(set.id, scoreSummary(details.get(set.id), set)?.nextGrade ?? set.grades[0].name);
          invalidateJoint();
          renderJoint();
          renderSets();
          persistTargets();
        });
        if (result.changes?.added.includes(set.id)) add(card, "span", "\u65B0\u96C6\u5408", "badge");
        const detail = details.get(set.id), totals = detail?.progress?.totals, summary2 = scoreSummary(detail, set);
        const grades3 = add(card, "div", "", "gallery-grades");
        gradeTrack(grades3, set.grades, summary2);
        const metrics = add(card, "div", "", "gallery-set-metrics");
        const collected = add(metrics, "span", totals ? `${totals.collected} / ${set.requiredCards}` : `? / ${set.requiredCards}`, "gallery-collected");
        collected.title = totals ? `\u5DF2\u6536\u96C6 / \u76EE\u6807 \xB7 ${totals.unknown} \u5F85\u6838\u5B9E` : "\u6536\u96C6\u8FDB\u5EA6\uFF1A\u672A\u540C\u6B65";
        if (!totals || totals.total > 0 && totals.unknown === totals.total) collected.textContent = `? / ${set.requiredCards}`;
        const scoreCaption = add(metrics, "span", "Base score", "gallery-score-caption");
        scoreCaption.title = "\u96C6\u5408\u57FA\u7840\u5206\uFF08\u672C\u5730\u53C2\u8003\u8BA1\u5206\uFF09";
        const score2 = add(metrics, "span", compactScore(summary2), "gallery-summary");
        score2.title = `Base score \xB7 ${scoreText(summary2)}`;
        score2.setAttribute("aria-label", `Base score ${scoreText(summary2)}`);
        renderRewardSummary(metrics, [set]);
        if (detail?.progress?.candidateOnly) {
          const candidate = add(metrics, "span", "\u25A3", "gallery-collection-flag");
          candidate.title = `\u9AD8\u5206\u5019\u9009 ${detail.progress.totals?.total ?? "?"} / \u5168\u90E8 ${detail.progress.poolSize ?? "?"}`;
          candidate.setAttribute("aria-label", candidate.title);
        }
        if (detail?.stale || detail?.poolStale) {
          const snapshot = add(metrics, "span", "\u25F7", "gallery-collection-flag");
          snapshot.title = "\u5F53\u524D\u663E\u793A\u6700\u8FD1\u4E00\u6B21\u5FEB\u7167";
          snapshot.setAttribute("aria-label", snapshot.title);
        }
        if (typeof loadSet === "function" && result.source === "futgg") {
          const button = add(card, "button", "\u67E5\u770B\u5361\u7247", "gallery-open-set");
          button.type = "button";
          button.addEventListener("click", (event) => {
            if (event.isTrusted) void loadSetDetails(set);
          });
          card.addEventListener("click", (event) => {
            if (event.isTrusted && !event.target.closest?.("button")) void loadSetDetails(set);
          });
        } else if (typeof loadSet === "function" && result.source === "fodder") {
          add(card, "small", "\u5F53\u524D\u4F7F\u7528 Fodder \u56DE\u9000\u76EE\u5F55\uFF1B\u8BE5\u6765\u6E90\u6CA1\u6709\u5DF2\u6838\u5B9E\u5361\u6C60\u63A5\u53E3\uFF0C\u6682\u4E0D\u80FD\u8BFB\u53D6\u5361\u7247\u548C EA \u6536\u96C6\u72B6\u6001\u3002", "gallery-unknown");
        }
      }
      showBrowseLevel();
    };
    const applySyncDetails = (values6) => {
      const sets2 = result?.catalog?.categories.flatMap((category) => category.sets) ?? [];
      let changed = false, selectedChanged = false, jointChanged = false;
      for (const value of values6 ?? []) {
        const setId = value?.pool?.setId ?? value?.progress?.setId;
        const source = value?.pool?.source ?? value?.progress?.source;
        const id7 = `${source}:${setId}`;
        if (source !== result?.source || !sets2.some((set) => set.id === id7) || value.scope && value.scope !== currentScope || !value.progress) continue;
        const previous = details.get(id7);
        if (previous && JSON.stringify(previous.progress) === JSON.stringify(value.progress) && previous.pool?.revision === value.pool?.revision && previous.stale === value.stale && sameGalleryRuntimeCards(previous.runtimeCards, value.runtimeCards)) continue;
        const merged = { ...previous, ...value };
        if (jointTargets.has(id7) && galleryPlanningStateKey(previous) !== galleryPlanningStateKey(merged)) jointChanged = true;
        details.set(id7, merged);
        changed = true;
        if (id7 === selectedSetId) selectedChanged = true;
      }
      if (!changed) return;
      if (jointChanged) invalidateJoint("\u76EE\u6807\u6750\u6599\u6216\u62A5\u4EF7\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u65B9\u6848\u3002");
      renderJoint();
      renderSets();
      if (selectedChanged && !activePlans && !foregroundSync && !jointMode && selectedSetId != null && details.has(selectedSetId)) {
        const set = result?.catalog?.categories.flatMap((category) => category.sets).find((row) => row.id === selectedSetId);
        if (set) renderSetDetail(details.get(selectedSetId), set);
      }
    };
    const updateSyncButton = () => {
      if (!sync) return;
      const state2 = sync.state();
      node("gallery-sync").hidden = false;
      node("gallery-sync").disabled = syncing || state2.busy || !result?.catalog || result.source !== "futgg";
      node("gallery-sync").title = "\u5B8C\u6574\u590D\u6838\u5168\u90E8\u6536\u96C6\uFF1B\u5E73\u65F6\u81EA\u52A8\u589E\u91CF\u5408\u5E76";
      node("gallery-sync-time").textContent = state2.syncedAt ? `\u4E0A\u6B21\u540C\u6B65 ${date(state2.syncedAt)}` : "\u5C1A\u672A\u540C\u6B65";
      const progress = foregroundSync?.progress ?? state2.progress;
      const bar = node("gallery-background-progress");
      if (progress && (foregroundSync || state2.busy && !state2.synced) && result?.source === "futgg") {
        const phase = progress.phase === "pools" ? "\u540C\u6B65\u96C6\u5408\u5361\u6C60" : progress.phase === "catalog" ? "\u8BFB\u53D6\u96C6\u5408\u76EE\u5F55" : "\u540C\u6B65 EA \u6536\u96C6";
        const index = Number.isSafeInteger(progress.index) ? progress.index : 0;
        const total = Number.isSafeInteger(progress.total) ? progress.total : 0;
        bar.hidden = false;
        bar.max = total || 1;
        bar.value = Math.min(progress.completed ?? Math.max(0, index - 1), total || 1);
        const page = Number.isSafeInteger(progress.pages) ? ` \xB7 \u5DF2\u8BFB ${progress.pages} \u9875` : "";
        const count3 = Number.isSafeInteger(progress.count) ? ` \xB7 \u5DF2\u8BFB ${progress.count}` : "";
        const collection = foregroundSync ? `${foregroundSync.name} \xB7 ` : "";
        node("gallery-progress-note").textContent = `${collection}${phase} ${index}/${total}${page}${count3}`;
      } else if (bar) {
        bar.hidden = true;
        bar.value = 0;
      }
    };
    const refreshShared = () => {
      if (!sync || disposed || !active || syncing || !result || syncRefresh) return syncRefresh;
      const identity5 = scope2(), source = result.source;
      syncRefresh = Promise.resolve(sync.peekDetails(source)).then((values6) => {
        if (!disposed && active && !syncing && scope2() === identity5 && result?.source === source) applySyncDetails(values6);
      }).catch(() => {
      }).finally(() => {
        syncRefresh = null;
        updateSyncButton();
      });
      return syncRefresh;
    };
    const synchronize2 = async (setId = null, { background = false } = {}) => {
      if (!sync || syncing || !active || checkScope() === false) return;
      const identity5 = scope2(), source = result?.source;
      syncing = true;
      updateSyncButton();
      const dialog = node("gallery-sync-dialog");
      node("gallery-sync-message").textContent = "\u6B63\u5728\u540C\u6B65\u6536\u96C6\u2026";
      node("gallery-sync-progress").value = 0;
      if (!background && !dialog.open) dialog.showModal();
      let outcome;
      try {
        outcome = await sync.sync({ source, setId, force: !background, onProgress: (progress) => {
          if (disposed || identity5 !== scope2()) {
            sync.stop();
            return;
          }
          node("gallery-sync-progress").max = progress.total || 1;
          node("gallery-sync-progress").value = progress.completed ?? Math.max(0, progress.index - 1);
          const page = Number.isSafeInteger(progress.pages) ? ` \xB7 \u5DF2\u8BFB ${progress.pages} \u9875` : "";
          const count3 = Number.isSafeInteger(progress.count) ? ` \xB7 \u5DF2\u8BFB ${progress.count}` : "";
          node("gallery-sync-message").textContent = `${progress.phase === "pools" ? "\u6620\u5C04\u96C6\u5408" : "\u540C\u6B65\u6536\u96C6"} ${progress.index}/${progress.total}${page}${count3}`;
          if (progress.details?.length) applySyncDetails(progress.details);
          updateSyncButton();
        } });
        if (!disposed && identity5 === scope2() && result?.source === source) {
          applySyncDetails(outcome.details ?? await sync.peekDetails(source));
          node("gallery-progress-note").textContent = outcome.status === "observed" ? "\u6536\u96C6\u5DF2\u540C\u6B65" : outcome.status === "stopped" ? "\u540C\u6B65\u5DF2\u505C\u6B62\uFF0C\u5DF2\u786E\u8BA4\u8BB0\u5F55\u4FDD\u7559" : outcome.status === "partial" ? `\u6536\u96C6\u5DF2\u540C\u6B65\uFF0C${outcome.failures.length} \u4E2A\u96C6\u5408\u5361\u6C60\u5F85\u66F4\u65B0` : `\u540C\u6B65\u672A\u5B8C\u6210 \xB7 ${outcome.reason ?? "\u8BFB\u53D6\u5931\u8D25"}`;
        }
      } catch {
        if (identity5 === scope2()) node("gallery-progress-note").textContent = "\u540C\u6B65\u672A\u5B8C\u6210\uFF0C\u5DF2\u786E\u8BA4\u8BB0\u5F55\u4FDD\u7559";
      } finally {
        syncing = false;
        if (dialog.open) dialog.close();
        updateSyncButton();
        if (resumeBackground && !foregroundSync && !disposed && active && identity5 === scope2()) {
          resumeBackground = false;
          void synchronize2(null, { background: true });
        }
        if (!activePlans && !foregroundSync && selectedSetId && details.has(selectedSetId)) {
          const set = result?.catalog?.categories.flatMap((category) => category.sets).find((row) => row.id === selectedSetId);
          if (set) renderSetDetail(details.get(selectedSetId), set);
        }
      }
    };
    const unsubscribeSync = sync?.subscribe(refreshShared);
    node("gallery-sync").addEventListener("click", (event) => {
      if (event.isTrusted) void synchronize2();
    });
    node("gallery-sync-stop").addEventListener("click", () => sync?.stop());
    node("gallery-sync-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      sync?.stop();
    });
    const render = (value) => {
      if (disposed) return;
      const previous = result;
      result = value;
      const catalog = value?.catalog;
      if (!catalog) {
        node("gallery-source").textContent = "\u76EE\u5F55\u6682\u4E0D\u53EF\u7528";
        node("gallery-status").textContent = "\u516C\u5F00\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u6709\u5FEB\u7167\u4F1A\u4FDD\u7559\u3002";
        return;
      }
      const changed = diffGalleryCatalog(previous?.catalog, catalog);
      const sourceChanged = previous?.source && previous.source !== value.source;
      const removed = new Set(changed?.removed ?? []);
      for (const id7 of removed) setIconSelections.delete(id7);
      const requirementChanges = new Set(changed?.requirements ?? []);
      const selectedStillExists = selectedSetId != null && catalog.categories.some((category) => category.sets.some((set) => set.id === selectedSetId));
      const selectedRemoved = selectedSetId != null && !selectedStillExists;
      for (const id7 of [...removed, ...requirementChanges]) {
        details.delete(id7);
        if (requirementChanges.has(id7)) invalidated.add(id7);
        else invalidated.delete(id7);
      }
      if (sourceChanged || selectedRemoved) {
        disposeNativeCards();
        selectedCards.clear();
        selectionSource = null;
        selectionBudget = "";
        cardPage = 1;
        if (sourceChanged) {
          details.clear();
          invalidated.clear();
          setIconSelections.clear();
          planCache.clear();
        }
        if (sourceChanged) {
          jointTargets.clear();
          node("gallery-joint-budget").value = "";
          targetsIdentity = null;
          ++targetsEpoch;
          restoringTargets = false;
          node("gallery-joint-budget").disabled = false;
          targetStatus("");
        }
        selection++;
        selectedSetId = null;
        node("gallery-set-detail").replaceChildren();
        categoryId = null;
        showBrowseLevel();
      }
      if (!catalog.categories.some((row) => row.id === categoryId)) categoryId = null;
      const targetCatalogChanged = [...changed.requirements, ...changed.rewards, ...changed.removed, ...changed.renamed].some((id7) => jointTargets.has(id7));
      if (changed.tagsChanged || targetCatalogChanged || sourceChanged) invalidateJoint("\u76EE\u6807\u89C4\u5219\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u65B9\u6848\u3002");
      if (changed.tagsChanged || changed.requirements.length || changed.rewards.length || changed.removed.length || changed.renamed.length || sourceChanged) overviewCache.clear();
      restoreTargets();
      reconcileTargets();
      renderJoint();
      node("gallery-source").textContent = value.source === "futgg" ? "FUT.GG" : "Fodder \xB7 \u56DE\u9000\u76EE\u5F55";
      const sets2 = catalog.categories.reduce((sum2, row) => sum2 + row.sets.length, 0);
      const notice = value.reason === "FC27_GALLERY_CATALOG_REFRESH_FAILED" ? "\u66F4\u65B0\u672A\u6210\u529F\uFF0C\u4FDD\u7559\u65E7\u76EE\u5F55\uFF1B" : value.stale ? "\u7F13\u5B58\u5F85\u66F4\u65B0\uFF1B" : "";
      node("gallery-status").textContent = `${catalog.categories.length} \u7C7B \xB7 ${sets2} \u4E2A\u96C6\u5408 \xB7 ${notice}\u6838\u9A8C ${date(value.fetchedAt)}`;
      const sourceErrors = value.sourceErrors ?? {};
      const futggError = sourceErrors.futgg;
      const sourceErrorNote = node("gallery-source-error");
      if (sourceErrorNote) sourceErrorNote.textContent = value.source === "fodder" && futggError ? `FUT.GG \u672A\u8FDE\u63A5\uFF08${futggError}\uFF09\uFF0C\u5F53\u524D\u4F7F\u7528 Fodder \u56DE\u9000\u76EE\u5F55\uFF1B\u70B9\u51FB\u201C\u66F4\u65B0\u96C6\u5408\u76EE\u5F55\u201D\u53EF\u5728\u9000\u907F\u7ED3\u675F\u540E\u91CD\u8BD5\u3002` : "";
      const note = node("gallery-progress-note");
      if (!sync || !sync.state().syncedAt) note.textContent = typeof loadSet === "function" ? sync ? "\u6536\u96C6\u72B6\u6001\u5C1A\u672A\u540C\u6B65" : "\u9009\u62E9\u96C6\u5408\u540E\u8BFB\u53D6\u8BE5\u96C6\u5408\u5361\u6C60\u548C\u8D26\u53F7\u6536\u96C6\u72B6\u6001\uFF1B\u672A\u8BFB\u53D6\u7684\u96C6\u5408\u4E0D\u4F1A\u89E6\u53D1 EA \u67E5\u8BE2\u3002" : "\u8D26\u53F7\u6536\u96C6\u8FDB\u5EA6\u5C1A\u672A\u63A5\u5165\u3002";
      const buttons = node("gallery-categories");
      buttons.replaceChildren();
      for (const row of catalog.categories) {
        const button = add(buttons, "button");
        const top = add(button, "span", "", "gallery-category-top");
        const iconsBox = add(top, "span", "", "gallery-category-icons");
        const icons = assets?.category?.(row.slug, row.name) ?? [];
        for (const src of (Array.isArray(icons) ? icons : [icons]).slice(0, 3)) image(iconsBox, src, row.name, "gallery-category-icon");
        add(top, "span", `${row.sets.length} \u4E2A\u96C6\u5408`, "gallery-category-count");
        renderRewardSummary(top, row.sets, "gallery-category-rewards");
        add(button, "strong", row.name, "gallery-category-name");
        button.type = "button";
        button.dataset.categoryId = row.id;
        button.addEventListener("click", () => {
          categoryId = row.id;
          renderSets();
        });
      }
      renderSets();
      updateSyncButton();
      void refreshShared();
      if (active && sync && value.source === "futgg") {
        const state2 = sync.state();
        const key = `${scope2() ?? "unknown"}:${catalog.revision ?? value.fetchedAt ?? "catalog"}:${state2.needsRefresh ? Math.floor(Date.now() / GALLERY_TTL_MS) : "baseline"}`;
        if ((!state2.synced || state2.needsRefresh) && autoSyncKey !== key) {
          autoSyncKey = key;
          queueMicrotask(() => {
            if (active && result === value && !syncing) void synchronize2(null, { background: true });
          });
        }
      }
      if (!sourceChanged && !selectedRemoved && selectedSetId != null && requirementChanges.has(selectedSetId)) {
        const selected = catalog.categories.flatMap((category) => category.sets).find((set) => set.id === selectedSetId);
        if (selected) {
          details.delete(selected.id);
          void loadSetDetails(selected, { force: true });
        }
      } else if (!activePlans && !jointMode && selectedSetId != null && details.has(selectedSetId)) {
        const selected = catalog.categories.flatMap((category) => category.sets).find((set) => set.id === selectedSetId);
        if (selected) renderSetDetail(details.get(selectedSetId), selected);
      }
    };
    const load = (force) => {
      checkScope();
      if (!provider || pending2) return pending2;
      node("gallery-refresh").disabled = true;
      pending2 = (async () => {
        const cached = await provider.peek();
        if (cached) render(cached);
        node("gallery-status").textContent = cached ? `${node("gallery-status").textContent} \xB7 \u68C0\u67E5\u66F4\u65B0\u4E2D\u2026` : "\u6B63\u5728\u8BFB\u53D6\u516C\u5F00\u96C6\u5408\u76EE\u5F55\u2026";
        render(force ? await provider.refresh() : await provider.load());
      })().catch(() => {
        node("gallery-status").textContent = "\u516C\u5F00\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF1B\u5DF2\u6709\u76EE\u5F55\u4F1A\u4FDD\u7559\uFF0C\u8BF7\u7A0D\u540E\u66F4\u65B0\u3002";
      }).finally(() => {
        pending2 = null;
        node("gallery-refresh").disabled = !provider;
      });
      return pending2;
    };
    const check = () => {
      checkScope();
      if (active && visible()) void load(false);
    };
    const setActive = (value) => {
      const wasActive = active;
      active = value && !disposed;
      if (!active) {
        planningEpoch++;
        scoreQueue.cancel();
        selection++;
        selectedSetId = null;
        categoryId = null;
        overviewCache.clear();
        disposeNativeCards();
        node("gallery-set-detail").replaceChildren();
        node("gallery-set-list").replaceChildren();
        showBrowseLevel();
      }
      if (timer !== null) timers?.clearInterval(timer);
      if (scopeTimer !== null) timers?.clearInterval(scopeTimer);
      timer = null;
      scopeTimer = null;
      if (active && provider) {
        void refreshPurchases();
        if (!wasActive) {
          jointMode = false;
          node("gallery-browse").hidden = false;
          node("gallery-joint").hidden = true;
          node("gallery-mode-browse").setAttribute("aria-pressed", "true");
          node("gallery-mode-joint").setAttribute("aria-pressed", "false");
          selectedSetId = null;
          categoryId = null;
          overviewCache.clear();
          showBrowseLevel();
        }
        check();
        timer = timers?.setInterval(check, GALLERY_TTL_MS) ?? null;
        if (loadSet) scopeTimer = timers?.setInterval(checkScope, 1e3) ?? null;
      }
    };
    node("gallery-refresh").disabled = !provider;
    node("gallery-back").addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      if (selectedSetId !== null) {
        selection++;
        selectedSetId = null;
        cardPage = 1;
        disposeNativeCards();
        node("gallery-set-detail").replaceChildren();
        renderSets();
      } else if (categoryId !== null) {
        categoryId = null;
        node("gallery-set-list").replaceChildren();
        showBrowseLevel();
      }
    });
    node("gallery-search").addEventListener("input", renderSets);
    node("gallery-sort").addEventListener("change", renderSets);
    node("gallery-followed").addEventListener("change", renderSets);
    node("gallery-refresh").addEventListener("click", () => {
      if (provider && active) void load(true);
    });
    document.addEventListener("visibilitychange", check);
    document.defaultView?.addEventListener("resize", updateFooterGeometry);
    if (!provider) {
      const message = "\u6B64\u68C0\u67E5\u5165\u53E3\u672A\u63A5\u5165\u516C\u5F00\u76EE\u5F55\uFF0C\u8BF7\u4F7F\u7528 FC Automation Tool \u6B63\u5F0F\u811A\u672C\u3002";
      node("gallery-status").textContent = message;
      node("gallery-progress-note").textContent = message;
    }
    return Object.freeze({ setActive, dispose: () => {
      disposed = true;
      selection++;
      setIconSelections.clear();
      scoreQueue.dispose();
      clearTimeout(scoreRenderTimer);
      sync?.stop();
      unsubscribeSync?.();
      purchase?.stop?.();
      node("gallery-purchase-dialog").close();
      node("gallery-sync-dialog").close();
      setActive(false);
      document.removeEventListener("visibilitychange", check);
      document.defaultView?.removeEventListener("resize", updateFooterGeometry);
    } });
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
    galleryCatalog: galleryCatalog2 = null,
    gallerySetLoader = null,
    galleryPriceLoader = null,
    galleryAccountScope = void 0,
    galleryProxy: galleryProxy2 = "",
    setGalleryProxy: setGalleryProxy2 = null,
    galleryAssets: galleryAssets2 = null,
    galleryPrices: galleryPrices2 = null,
    galleryMarketCompare = null,
    galleryDiagnosticLog = null,
    galleryNativeRenderer: galleryNativeRenderer2 = null,
    galleryTargetStore = null,
    galleryPlanStore = null,
    gallerySync: gallerySync2 = null,
    purchaseGallery = null,
    galleryFirstOwnerHistory = null,
    exportDiagnostics = null,
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
    const gallery = mountFc27GalleryView({ document, shadow, host, provider: galleryCatalog2, loadSet: gallerySetLoader, loadPrices: galleryPriceLoader, accountScope: galleryAccountScope, assets: galleryAssets2, prices: galleryPrices2, marketCompare: galleryMarketCompare, diagnosticLog: galleryDiagnosticLog, nativeRenderer: galleryNativeRenderer2, targetStore: galleryTargetStore, planStore: galleryPlanStore, sync: gallerySync2, purchase: purchaseGallery, setFirstOwner: galleryFirstOwnerHistory });
    const selectTab = bindFc27WorkbenchTabs(shadow, host, (id7) => gallery.setActive(id7 === "gallery"));
    const node = (id7) => shadow.getElementById(id7);
    node("workbench-version").textContent = version ?? title;
    node("workbench-mode").textContent = liveEnabled === true ? "\u5DF2\u5F00\u653E\u73B0\u6709\u5355\u6B21\u64CD\u4F5C\uFF1B\u63D0\u4EA4\u9700\u5355\u72EC\u786E\u8BA4\u3002" : "\u5F53\u524D\u4E3A\u53EA\u8BFB\u6A21\u5F0F\u3002";
    node("gallery-proxy-card").hidden = typeof setGalleryProxy2 !== "function";
    node("diagnostic-export-card").hidden = typeof exportDiagnostics !== "function";
    node("gallery-proxy").value = typeof galleryProxy2 === "function" ? String(galleryProxy2() || "") : String(galleryProxy2 || "");
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
      for (const button of shadow.querySelectorAll('button:not([role="tab"]),select,input')) {
        if (!button.closest("#page-gallery")) button.disabled = busy;
      }
      node("execute").disabled = busy || liveEnabled !== true || plan?.liveEnabled !== true;
      node("fill").disabled = busy || liveEnabled !== true || puzzlePlan?.fillReady !== true || typeof fillPuzzle !== "function";
      node("resolve").disabled = busy || recovery?.status !== "recoverable";
      node("catalog").disabled = busy || !node("target").value || typeof inspectCatalog !== "function";
      node("puzzle").disabled = busy || !node("target").value || typeof inspectPuzzle !== "function";
      node("prepare").disabled = busy || !node("target").value;
      node("export-diagnostics").disabled = busy || typeof exportDiagnostics !== "function";
    };
    const appendText = (parent, tag, text5) => {
      const element = document.createElement(tag);
      element.textContent = text5;
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
      const list2 = appendText(squad, "ol", "");
      for (const item2 of result.selected ?? []) appendText(list2, "li", `Slot ${item2.slot + 1} \xB7 ${item2.rating} OVR \xB7 ${item2.pile}`);
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
        const list2 = document.createElement("ul");
        for (const rule of challenge.requirements ?? []) {
          const item2 = document.createElement("li");
          const description = describeCatalogRule(rule);
          item2.textContent = description.label;
          appendText(item2, "small", description.raw);
          list2.append(item2);
        }
        if (!challenge.requirements?.length) {
          const item2 = document.createElement("li");
          item2.textContent = "No requirement rows observed";
          list2.append(item2);
        }
        block.append(list2);
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
      const list2 = appendText(node("squad"), "ol", "");
      for (const [index, slot] of (result.plan?.slots ?? []).entries()) {
        appendText(list2, "li", `Slot ${slot + 1} \xB7 ${result.plan.ratings[index]} OVR \xB7 club`);
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
    const on = (id7, callback) => node(id7).addEventListener("click", (event) => {
      if (event.isTrusted && !busy) callback();
    });
    on("refresh", () => {
      renderTargets();
      clear();
      update();
    });
    on("gallery-proxy-save", () => {
      if (typeof setGalleryProxy2 !== "function") return;
      void run(async () => {
        const result = await setGalleryProxy2(node("gallery-proxy").value);
        node("gallery-proxy").value = result.proxy || "";
        return { ...result, reason: result.proxy ? "Gallery FUT.GG \u8F6C\u53D1\u4EE3\u7406\u5DF2\u4FDD\u5B58\uFF1B\u4E0B\u6B21\u66F4\u65B0\u76EE\u5F55\u65F6\u751F\u6548" : "Gallery FUT.GG \u8F6C\u53D1\u4EE3\u7406\u5DF2\u6E05\u9664\uFF1B\u5C06\u5C1D\u8BD5\u76F4\u8FDE" };
      });
    });
    on("gallery-proxy-clear", () => {
      if (typeof setGalleryProxy2 !== "function") return;
      void run(async () => {
        const result = await setGalleryProxy2("");
        node("gallery-proxy").value = "";
        return { ...result, reason: "Gallery FUT.GG \u8F6C\u53D1\u4EE3\u7406\u5DF2\u6E05\u9664\uFF1B\u5C06\u5C1D\u8BD5\u76F4\u8FDE" };
      });
    });
    on("export-diagnostics", () => {
      if (typeof exportDiagnostics !== "function") return;
      void run(async () => {
        node("diagnostic-export-status").textContent = "\u6B63\u5728\u5BFC\u51FA\u2026";
        try {
          const result = await exportDiagnostics();
          node("diagnostic-export-status").textContent = `\u5DF2\u5BFC\u51FA ${result.count ?? 0} \u6761\u65E5\u5FD7`;
          return { status: "observed", reason: "FC27_DIAGNOSTICS_EXPORTED", ...result };
        } catch {
          node("diagnostic-export-status").textContent = "\u5BFC\u51FA\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5";
          return { status: "blocked", reason: "FC27_DIAGNOSTICS_EXPORT_FAILED" };
        }
      });
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
    const dialog = node("action-approval-dialog");
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
    for (const id7 of ["target", "rating"]) node(id7).addEventListener("change", () => {
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
      gallery.setActive(host.dataset.activeTab === "gallery");
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
        gallery.setActive(false);
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
  var progressCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "?";
  var formatFc27PuzzleProgress = (progress) => {
    if (typeof progress === "string") return stageText[progress] ?? "\u6B63\u5728\u5904\u7406\u2026";
    if (!progress || typeof progress !== "object") return "\u6B63\u5728\u5904\u7406\u2026";
    const procurementPhases = {
      "repair-seed": "\u6B63\u5728\u5BFB\u627E\u8865\u5361\u8D77\u70B9\u2026",
      "query-planning": "\u6B63\u5728\u89C4\u5212\u5361\u6C60\u67E5\u8BE2\u2026",
      "catalog-read": "\u6B63\u5728\u8BFB\u53D6\u5019\u9009\u5361\u6C60\u2026",
      "local-market-search": "\u6B63\u5728\u8BA1\u7B97\u8865\u5361\u7EC4\u5408\u2026",
      "quote-read": "\u6B63\u5728\u67E5\u8BE2\u65B9\u6848\u62A5\u4EF7\u2026"
    };
    const stage = procurementPhases[progress.phase] ?? stageText[progress.stage] ?? stageText[progress.phase] ?? stageText.planning;
    const hasBudget = Number.isSafeInteger(progress.nodes) && Number.isSafeInteger(progress.maxNodes);
    const lines = [hasBudget ? `${stage}
\u8282\u70B9 ${progressCount(progress.nodes)} / ${progressCount(progress.maxNodes)}` : stage];
    const search = progress.search;
    if (search && typeof search === "object") {
      const parts = [["combinationNodes", "\u7EC4\u5408"], ["placementNodes", "\u9635\u4F4D"], ["evaluations", "\u8BC4\u4F30"], ["bounds", "\u526A\u679D"]].filter(([key]) => Number.isSafeInteger(search[key])).map(([key, label]) => `${label} ${progressCount(search[key])}`);
      if (parts.length) lines.push(parts.join(" \xB7 "));
    }
    const candidates = progress.safeCandidates ?? progress.marketCandidates;
    if (Number.isSafeInteger(candidates)) lines.push(`\u5019\u9009 ${progressCount(candidates)} \u4EBA`);
    if (Number.isSafeInteger(progress.attempts) && Number.isSafeInteger(progress.attempt)) {
      lines.push(`\u7B56\u7565 ${progress.attempt} / ${progress.attempts}`);
    }
    if (Number.isSafeInteger(progress.checks) && !search) lines.push(`\u8BC4\u4F30 ${progressCount(progress.checks)} / ${progressCount(progress.maxNodes)}`);
    if (Number.isSafeInteger(progress.catalogPages)) lines.push(`\u5361\u6C60 ${progressCount(progress.catalogPages)} / ${progressCount(progress.catalogTotal)} \u9875 \xB7 ${progressCount(progress.catalogCandidates)} \u4E2A\u7248\u672C`);
    if (progress.phase === "quote-read") lines.push(`\u62A5\u4EF7 ${progressCount(progress.quoteCompleted)} / ${progressCount(progress.quoteTotal)}`);
    if (Number.isSafeInteger(progress.requests)) lines.push(`\u8BF7\u6C42 ${progressCount(progress.requests)} \xB7 \u7F13\u5B58 ${progressCount(progress.cacheHits)}`);
    return lines.join("\n");
  };
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
      const cards = plan.purchases.map((item2) => `${item2.displayName && /[\p{L}\p{N}]/u.test(item2.displayName) ? item2.displayName : "\u7403\u5458"}\uFF08${item2.rating} \u5206\uFF0C\u7248\u672C ${item2.definitionId}\uFF09\uFF0C\u89C2\u5BDF\u4EF7 ${item2.observedBuyNow}`).join("\uFF1B");
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
    const runtimeFailure = /^FC27_MARKET_METHOD_\d+_(?:MISSING|CHANGED)$/.test(reason);
    const explanation = runtimeFailure ? "\u5E02\u573A\u8FD0\u884C\u65F6\u65B9\u6CD5\u517C\u5BB9\u6027\u68C0\u67E5\u5931\u8D25\uFF0C\u672A\u53D1\u9001 EA \u5E02\u573A\u8BF7\u6C42" : purchaseReasons[reason] ?? "\u89C4\u5212\u672A\u5B8C\u6210";
    const lines = [message, `\u8865\u5361\uFF1A${explanation}${reason ? `\uFF08${reason}\uFF09` : ""}\u3002`];
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
      if (runtimeFailure) {
        lines.push("\u8FD9\u662F\u8FD0\u884C\u65F6\u517C\u5BB9\u6027\u68C0\u67E5\u5931\u8D25\uFF0C\u4E0D\u662F\u5E93\u5B58\u65E0\u89E3\uFF1B\u672C\u6B21\u6CA1\u6709\u53D1\u9001\u5E02\u573A\u8BF7\u6C42\u3002\u5237\u65B0 Web App \u540E\u518D\u6B21\u70B9\u51FB\u53EF\u91CD\u65B0\u63A2\u6D4B\u3002");
      }
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
      const onProgress = (progress) => {
        if (!isCurrent()) return;
        status.hidden = false;
        status.textContent = formatFc27PuzzleProgress(progress);
      };
      onProgress.wantsPuzzleProgress = true;
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
    const message = (text5) => {
      output.textContent = text5;
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
    let summary2 = null;
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
        summary2 = result;
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
      if (!event.isTrusted || busy || !target || summary2?.status !== "ready") return;
      const selected = target;
      busy = true;
      button.disabled = true;
      cancel.hidden = false;
      cancel.disabled = false;
      try {
        await wait(500);
        loading(true);
        message("\u6B63\u5728\u67E5\u8BE2\u5E76\u8D2D\u4E70\u5F53\u524D\u6982\u5FF5\u7403\u5458\u2026");
        const result = await buy(selected, { approved: true, budget: null, expectedOperationId: summary2.operationId }, {
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
        const item2 = new TabItem();
        item2.init?.();
        const tags = (existing ?? []).map((value) => value?.tabBarItem?.getTag?.()).filter(Number.isFinite);
        item2.setTag?.(Math.max(19, ...tags) + 1);
        item2.setText?.("FCAT");
        item2.addClass?.("icon-transfer");
        item2.addClass?.("fcat-navigation-entry");
        const controller = new Flow();
        controller.initWithRootController?.(new WorkbenchController());
        controller.tabBarItem = item2;
        controller[TAB_OWNER] = true;
        return controller;
      };
      const prototype = runtime.UTGameTabBarController.prototype;
      if (!prototype[TAB_PATCH]) {
        const original = prototype.initWithViewControllers;
        if (typeof original !== "function") return null;
        const patched = function initWithViewControllers(viewControllers, ...args) {
          const list2 = Array.isArray(viewControllers) ? viewControllers : [];
          if (prototype[TAB_PATCH]?.active && !list2.some((value) => value?.[TAB_OWNER])) list2.push(createController(list2));
          return original.call(this, list2, ...args);
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

  // src/gallery/progress.js
  var validId10 = (value) => Number.isSafeInteger(value) && value > 0;
  var booleanOrUnknown = (value) => typeof value === "boolean" ? value : null;
  var scoreOrUnknown = (value) => Number.isFinite(value) && value >= 0 && value <= 1e8 ? Number(value) : null;
  function accountRow(item2, concept, club, clubKnown, history, held) {
    const collected = booleanOrUnknown(concept?.isCollected);
    const inClub = club ? true : clubKnown ? false : null;
    const observedFirstOwned = history?.collectedOwners === 1 || club?.some((row) => row.owners === 1) ? true : Number.isSafeInteger(history?.collectedOwners) && history.collectedOwners > 1 ? false : club?.every((row) => Number.isSafeInteger(row.owners) && row.owners > 1) ? false : null;
    const firstOwned = typeof history?.firstOwned === "boolean" ? history.firstOwned : observedFirstOwned;
    return Object.freeze({
      eaId: item2.eaId,
      playerEaId: item2.playerEaId,
      name: item2.cardName,
      version: item2.rarityName,
      overall: item2.overall,
      galleryScore: item2.score,
      cardImageUrl: item2.cardImageUrl,
      simpleCardImageUrl: item2.simpleCardImageUrl,
      nationEaId: item2.nationEaId,
      clubEaId: item2.clubEaId,
      leagueEaId: item2.leagueEaId,
      rarityEaId: item2.rarityEaId,
      positions: item2.positions,
      weakFoot: item2.weakFoot,
      skillMoves: item2.skillMoves,
      holographic: item2.holographic,
      gradingScore: scoreOrUnknown(concept?.gradingScore),
      collected,
      inClub,
      // Club remains the authoritative submission pile. Other piles are
      // display-only evidence and never change collected or inClub semantics.
      held: inClub === true || held === true ? true : null,
      firstOwned,
      observedFirstOwned,
      firstOwnedSource: typeof history?.firstOwned === "boolean" ? "local-history" : firstOwned !== null ? "ea-observed" : null,
      status: collected === true ? "collected" : collected === false ? "missing" : "unknown"
    });
  }
  function mergeGalleryAccountProgress(pool, { conceptItems = [], clubItems = [], clubKnown = false, collectionHistory = [], heldItems = [] } = {}) {
    if (!pool || !Array.isArray(pool.items)) throw new TypeError("FC27_GALLERY_PROGRESS_INPUT_INVALID");
    const concepts = /* @__PURE__ */ new Map();
    const allowed = new Set(pool.items.map((item2) => item2.eaId));
    for (const raw of conceptItems) {
      const id7 = raw?.definitionId ?? raw?.resourceId;
      if (!validId10(id7) || !allowed.has(id7)) throw new Error("FC27_GALLERY_CONCEPT_ID_UNVERIFIED");
      if (concepts.has(id7)) throw new Error("FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT");
      concepts.set(id7, raw);
    }
    const club = /* @__PURE__ */ new Map();
    for (const raw of clubItems) {
      if (!validId10(raw?.definitionId)) continue;
      if (!allowed.has(raw.definitionId)) continue;
      if (!club.has(raw.definitionId)) club.set(raw.definitionId, []);
      club.get(raw.definitionId).push(raw);
    }
    const history = /* @__PURE__ */ new Map();
    for (const row of collectionHistory) history.set(row.definitionId, { ...history.get(row.definitionId), ...row });
    const held = new Set(heldItems.map((row) => row?.definitionId).filter(validId10));
    const rows = pool.items.map((item2) => accountRow(item2, concepts.get(item2.eaId), club.get(item2.eaId), clubKnown, history.get(item2.eaId), held.has(item2.eaId)));
    const count2 = (key) => rows.filter((row) => row[key] === true).length;
    return Object.freeze({
      schema: 1,
      source: "ea-gallery-progress",
      season: pool.season,
      setId: pool.setId,
      poolRevision: pool.revision,
      complete: concepts.size === pool.items.length,
      poolComplete: pool.complete === true,
      candidateOnly: pool.candidateOnly === true,
      poolSize: pool.poolSize,
      candidateLimit: pool.candidateLimit ?? pool.items.length,
      clubKnown: clubKnown === true,
      rows: Object.freeze(rows),
      totals: Object.freeze({
        total: rows.length,
        collected: count2("collected"),
        inClub: count2("inClub"),
        firstOwned: count2("firstOwned"),
        missing: rows.filter((row) => row.collected === false).length,
        unknown: rows.filter((row) => row.collected === null).length,
        clubUnknown: rows.filter((row) => row.inClub === null).length,
        firstOwnedUnknown: rows.filter((row) => row.firstOwned === null).length
      })
    });
  }

  // src/adapters/ea/fc27-gallery-progress.js
  var at6 = (root, path) => path.split(".").reduce((value, key) => ownData(value, key), root);
  var id6 = (value) => Number.isSafeInteger(value) && value > 0;
  var databaseId = (value) => id6(value) ? value % 16777216 : null;
  var sameDatabaseId = (left, right) => databaseId(left) === databaseId(right);
  var same14 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var safeReason7 = (error2) => /^FC27_[A-Z0-9_]+$/.test(error2?.message) ? error2.message : "FC27_GALLERY_PROGRESS_UNAVAILABLE";
  var fail18 = (reason) => {
    throw new Error(reason);
  };
  var CARD_KEYS = Object.freeze([
    "id",
    "definitionId",
    "timestamp",
    "formation",
    "untradeable",
    "assetId",
    "rating",
    "dream",
    "itemType",
    "resourceId",
    "owners",
    "discardValue",
    "cardsubtypeid",
    "lastSalePrice",
    "injuryType",
    "injuryGames",
    "preferredPosition",
    "statsList",
    "lifetimeStats",
    "contract",
    "rareflag",
    "playStyle",
    "leagueId",
    "loyaltyBonus",
    "pile",
    "nation",
    "resourceGameYear",
    "guidAssetId",
    "attributeArray",
    "skillmoves",
    "weakfootabilitytypecode",
    "preferredfoot",
    "rankId",
    "possiblePositions",
    "gender",
    "baseTraits",
    "iconTraits",
    "hyperCosmetics",
    "plusRoles",
    "plusPlusRoles",
    "gradingScore",
    "isCollected",
    "teamId",
    "firstName",
    "lastName",
    "knownAs"
  ]);
  var arrayCopy = (value, max = 128) => Array.isArray(value) && value.length <= max ? value.map((item2) => Number.isFinite(item2) || typeof item2 === "string" ? item2 : null) : [];
  var nativeCardData = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const result = {};
    for (const key of CARD_KEYS) {
      const value = ownData(raw, key);
      if (value === void 0) continue;
      if (["statsList", "lifetimeStats", "attributeArray", "possiblePositions", "baseTraits", "iconTraits", "plusRoles", "plusPlusRoles"].includes(key)) {
        result[key] = arrayCopy(value);
      } else if (key === "hyperCosmetics" && value && typeof value === "object" && !Array.isArray(value)) {
        const entries2 = Object.entries(value).slice(0, 32).filter(([, item2]) => Number.isFinite(item2));
        result[key] = Object.fromEntries(entries2);
      } else if (typeof value === "boolean" || Number.isFinite(value) || typeof value === "string" && value.length <= 200) result[key] = value;
    }
    const definitionId = ownData(raw, "resourceId") ?? ownData(raw, "definitionId");
    const guid = result.guidAssetId;
    if (!id6(definitionId) || result.itemType !== "player" || result.dream !== true || result.definitionId != null && result.definitionId !== definitionId || !Number.isSafeInteger(result.rareflag) || !Number.isFinite(result.rating) || !Array.isArray(result.attributeArray) || result.attributeArray.length !== 6 || !result.attributeArray.every(Number.isFinite) || guid != null && (typeof guid !== "string" || guid.length > 100)) return null;
    result.resourceId = definitionId;
    result.definitionId = definitionId;
    result.id = id6(result.id) ? result.id : definitionId;
    return Object.freeze(result);
  };
  function sanitizeRows(rows, allowed, accepts = (value) => allowed.has(value), maxRows = allowed.size) {
    if (!Array.isArray(rows) || rows.length > maxRows) fail18("FC27_GALLERY_CONCEPT_PAYLOAD_UNVERIFIED");
    const result = rows.map((raw) => {
      const definitionId = ownData(raw, "resourceId") ?? ownData(raw, "definitionId");
      if (!id6(definitionId) || !accepts(definitionId)) fail18("FC27_GALLERY_CONCEPT_ID_UNVERIFIED");
      const flag = ownData(raw, "isCollected"), score2 = ownData(raw, "gradingScore");
      const cardData = nativeCardData(ownData(raw, "cardData") ?? raw);
      return {
        definitionId,
        isCollected: typeof flag === "boolean" ? flag : null,
        gradingScore: Number.isFinite(score2) && score2 >= 0 && score2 <= 1e8 ? score2 : null,
        ...cardData?.resourceId === definitionId ? { cardData } : {}
      };
    });
    if (new Set(result.map((row) => row.definitionId)).size !== result.length) fail18("FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT");
    return result;
  }
  function readClubSnapshot(root) {
    const result = [];
    let items = at6(root, "repositories.Item.club.items");
    for (let depth = 0; depth < 3 && ownData(items, "_collection"); depth++) items = ownData(items, "_collection");
    if (!items || typeof items !== "object" || Object.keys(items).length > 2e4) return result;
    for (const key of Object.keys(items)) {
      const raw = ownData(items, key), definitionId = ownData(raw, "definitionId");
      if (ownData(raw, "type") !== "player" || ownData(raw, "concept") !== false || !id6(ownData(raw, "id"))) continue;
      const owners = ownData(raw, "owners");
      result.push({ definitionId, owners: Number.isSafeInteger(owners) && owners > 0 && owners <= 1e4 ? owners : null });
    }
    return result;
  }
  function readHeldSnapshot(root) {
    const result = [], sources2 = [
      at6(root, "repositories.Item.storage"),
      at6(root, "repositories.Item.transfer"),
      at6(root, "repositories.Item.unassigned"),
      at6(root, "services.Item.itemDao.itemRepo.storage"),
      at6(root, "services.Item.itemDao.itemRepo.transfer"),
      at6(root, "services.Item.itemDao.itemRepo.unassigned")
    ];
    for (let source of sources2) {
      source = ownData(source, "items") ?? source;
      for (let depth = 0; depth < 3 && ownData(source, "_collection"); depth++) source = ownData(source, "_collection");
      if (!source || typeof source !== "object") continue;
      for (const key of Object.keys(source).slice(0, 2e4)) {
        const raw = ownData(source, key), definitionId = ownData(raw, "definitionId");
        if (id6(definitionId) && id6(ownData(raw, "id")) && ownData(raw, "type") === "player" && ownData(raw, "concept") === false) result.push({ definitionId });
      }
    }
    return [...new Map(result.map((row) => [row.definitionId, row])).values()];
  }
  function createFc27GalleryProgressReader(root, { gmGetValue, gmSetValue, diagnosticLog: diagnosticLog2, now = () => Date.now(), ttlMs = 3e5 } = {}) {
    const states2 = /* @__PURE__ */ new Map(), inFlight = /* @__PURE__ */ new Map(), listeners = /* @__PURE__ */ new Set(), rawByItem = /* @__PURE__ */ new WeakMap(), nativePending = /* @__PURE__ */ new Set();
    let tail = Promise.resolve(), running = null, disposed = false, factoryHook = null;
    const record = (entry) => {
      try {
        Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", source: "ea", ...entry })).catch(() => {
        });
      } catch {
      }
    };
    const scope2 = () => contextKey(readFc27Context(root), "gallery-view");
    const notify = () => {
      for (const listener of listeners) try {
        listener();
      } catch {
      }
    };
    const stateFor = (context) => {
      const key = contextKey(context, "gallery-collection");
      if (!states2.has(key)) states2.set(key, {
        key,
        context,
        rows: /* @__PURE__ */ new Map(),
        firstOwnerHistory: [],
        reading: null,
        writing: Promise.resolve(),
        fetchedAt: 0,
        syncedAt: null,
        fullSyncAt: null,
        coveredDefinitionIds: /* @__PURE__ */ new Set(),
        setSyncedAt: {},
        sessionSynced: false,
        retryAt: 0,
        timer: null,
        clubSnapshot: null,
        clubSnapshotAt: 0,
        heldSnapshot: null,
        displayEntities: /* @__PURE__ */ new Map()
      });
      return states2.get(key);
    };
    const assert = (context) => {
      if (disposed || !same14(context, readFc27Context(root))) fail18("FC27_GALLERY_CONTEXT_CHANGED");
    };
    const merge = (state, rows) => {
      let changed = false;
      for (const row of rows) {
        const previous = state.rows.get(row.definitionId);
        const owners = [previous?.collectedOwners, row.collectedOwners].filter((value) => id6(value));
        const next = {
          ...previous,
          ...row,
          isCollected: previous?.isCollected === true || row.isCollected === true ? true : row.isCollected,
          ...owners.length ? { collectedOwners: Math.min(...owners) } : {},
          cardData: row.cardData ?? previous?.cardData
        };
        if (!same14(previous, next)) {
          state.rows.set(row.definitionId, next);
          changed = true;
        }
      }
      return changed;
    };
    const restore = (state) => state.reading ??= (async () => {
      let saved;
      try {
        saved = await gmGetValue?.(state.key, null);
      } catch {
      }
      assert(state.context);
      if (saved?.schema !== 3 || !same14(saved.context, state.context) || !Array.isArray(saved.concepts) || saved.concepts.length > 1e5 || !Number.isSafeInteger(saved.fetchedAt) || saved.fetchedAt > now()) return;
      try {
        const rows = sanitizeRows(saved.concepts, new Set(saved.concepts.map((row) => row.definitionId)));
        for (let i = 0; i < rows.length; i++) {
          if (id6(saved.concepts[i].collectedOwners)) rows[i].collectedOwners = saved.concepts[i].collectedOwners;
          const readAt = saved.concepts[i].readAt ?? saved.fetchedAt;
          if (Number.isSafeInteger(readAt) && readAt >= 0 && readAt <= now()) rows[i].readAt = readAt;
        }
        const current2 = [...state.rows.values()];
        state.rows.clear();
        merge(state, rows);
        merge(state, current2);
        state.fetchedAt = Math.max(state.fetchedAt, saved.fetchedAt);
        state.syncedAt = Number.isSafeInteger(saved.syncedAt) && saved.syncedAt <= now() ? saved.syncedAt : null;
        state.fullSyncAt = Number.isSafeInteger(saved.fullSyncAt) && saved.fullSyncAt <= now() ? saved.fullSyncAt : null;
        if (Array.isArray(saved.coveredDefinitionIds) && saved.coveredDefinitionIds.length <= 1e5) {
          state.coveredDefinitionIds = new Set(saved.coveredDefinitionIds.filter(id6));
        }
        state.setSyncedAt = saved.setSyncedAt && typeof saved.setSyncedAt === "object" ? { ...saved.setSyncedAt } : {};
        state.firstOwnerHistory = normalizeGalleryFirstOwnerHistory(saved.firstOwnerHistory);
      } catch {
      }
    })();
    const persist = (state, updateHistory = null) => {
      state.writing = state.writing.then(async () => {
        const history = updateHistory ? updateHistory(state.firstOwnerHistory) : state.firstOwnerHistory;
        const value = {
          schema: 3,
          context: state.context,
          concepts: [...state.rows.values()],
          fetchedAt: state.fetchedAt,
          syncedAt: state.syncedAt,
          fullSyncAt: state.fullSyncAt,
          coveredDefinitionIds: [...state.coveredDefinitionIds].slice(0, 1e5),
          setSyncedAt: { ...state.setSyncedAt },
          firstOwnerHistory: normalizeGalleryFirstOwnerHistory(history)
        };
        try {
          if (typeof gmSetValue !== "function") return false;
          await gmSetValue(state.key, value);
          if (updateHistory) state.firstOwnerHistory = history;
          return true;
        } catch {
          return false;
        }
      });
      return state.writing;
    };
    const ownerCount = (item2) => {
      const auction = item2.getAuctionData();
      return !item2.concept && !(auction.isValid() && !auction.tradeOwner) && item2.owners > 0 ? item2.owners : null;
    };
    const observeItem = (item2, raw, context) => {
      if (!item2) return;
      if (raw?.gradingScore != null) item2.gradingScore = raw.gradingScore;
      if (raw?.isCollected != null) item2.isCollected = raw.isCollected;
      rawByItem.set(item2, raw);
      if (!item2.isPlayer() || !item2.isCollected || !context) return;
      assert(context);
      if ([...nativePending].some((pending2) => !same14(context, pending2.context))) return;
      const definitionId = item2.definitionId;
      if (!id6(definitionId)) return;
      const state = stateFor(context), owners = ownerCount(item2);
      const changed = merge(state, [{
        definitionId,
        isCollected: true,
        gradingScore: Number.isFinite(item2.gradingScore) ? item2.gradingScore : null,
        cardData: nativeCardData(raw),
        ...id6(owners) ? { collectedOwners: owners } : {}
      }]);
      state.clubSnapshot = null;
      state.heldSnapshot = null;
      if (!changed) return;
      state.fetchedAt = now();
      if (state.timer === null) state.timer = setTimeout(() => {
        state.timer = null;
        void restore(state).then(() => persist(state)).then(notify).catch(() => {
        });
      }, 250);
    };
    const install = () => {
      if (disposed) return false;
      const prototype = root.UTItemEntityFactory?.prototype;
      if (!prototype || typeof prototype.createItem !== "function") return false;
      if (factoryHook?.prototype === prototype) return true;
      const original = prototype.createItem;
      const wrapped = observeFc27ItemFactory(original, (item2, raw) => {
        let context = null;
        try {
          context = running?.context ?? readFc27Context(root);
        } catch {
        }
        observeItem(item2, raw, context);
      });
      prototype.createItem = wrapped;
      factoryHook = { prototype, original, wrapped };
      return true;
    };
    const validatePool = (pool, context) => {
      if (pool?.source !== "futgg" || pool.season !== context.season || typeof pool.complete !== "boolean" || !id6(pool.setId) || !Array.isArray(pool.items) || pool.items.length > 1e5 || pool.items.some((row) => !id6(row.eaId)) || new Set(pool.items.map((row) => row.eaId)).size !== pool.items.length || pool.complete === false && (pool.candidateOnly !== true || !id6(pool.requiredCards) || !id6(pool.poolSize) || pool.poolSize <= pool.items.length || pool.items.length < pool.requiredCards || pool.items.length > GALLERY_TOP_CANDIDATE_LIMIT || pool.candidateLimit !== pool.items.length) || pool.complete && pool.candidateOnly === true) fail18("FC27_GALLERY_POOL_UNAVAILABLE");
    };
    const projectState = (pool, state, extra = {}) => {
      assert(state.context);
      const allowed = new Set(pool.items.map((row) => row.eaId)), concepts = [...allowed].map((id7) => state.rows.get(id7)).filter(Boolean);
      if (!state.clubSnapshot || now() - state.clubSnapshotAt >= 5e3) {
        state.clubSnapshot = readClubSnapshot(root);
        state.heldSnapshot = readHeldSnapshot(root);
        state.clubSnapshotAt = now();
      }
      const clubItems = state.clubSnapshot.filter((row) => allowed.has(row.definitionId));
      const heldItems = (state.heldSnapshot ?? []).filter((row) => allowed.has(row.definitionId));
      const collectionHistory = [...state.rows.values(), ...state.firstOwnerHistory];
      return {
        status: "observed",
        scope: contextKey(state.context, "gallery-view"),
        fetchedAt: state.fetchedAt,
        pool,
        runtimeCards: new Map(concepts.filter((row) => row.cardData || state.displayEntities.has(row.definitionId)).map((row) => [row.definitionId, state.displayEntities.get(row.definitionId) ?? row.cardData])),
        progress: mergeGalleryAccountProgress(pool, { conceptItems: concepts, clubItems, heldItems, collectionHistory }),
        ...extra
      };
    };
    const project3 = async (pool) => {
      try {
        const context = readFc27Context(root);
        validatePool(pool, context);
        const state = stateFor(context);
        await restore(state);
        return projectState(pool, state, { cached: true });
      } catch (error2) {
        return { status: "blocked", reason: safeReason7(error2) };
      }
    };
    const nativePage = (criteria, context) => new Promise((resolve, reject) => {
      let observable, done = false;
      const observer = {};
      const pending2 = { context };
      nativePending.add(pending2);
      const finish = (error2, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error2?.message !== "FC27_GALLERY_CONCEPT_TIMEOUT") {
          try {
            observable?.unobserve(observer);
          } catch {
          }
        }
        error2 ? reject(error2) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error("FC27_GALLERY_CONCEPT_TIMEOUT")), 16e3);
      try {
        assert(context);
        record({ event: "concept-request", phase: "native-service", status: "started", batchSize: criteria.defId.length });
        observable = root.services.Item.searchConceptItems(criteria);
        observable.observe(observer, (_sender, reply) => {
          nativePending.delete(pending2);
          if (done) {
            try {
              observable.unobserve(observer);
            } catch {
            }
            return;
          }
          try {
            assert(context);
            finish(null, reply);
          } catch (error2) {
            finish(error2);
          }
        });
      } catch {
        nativePending.delete(pending2);
        finish(new Error("FC27_GALLERY_CONCEPT_REQUEST_FAILED"));
      }
    });
    const syncState = () => {
      try {
        const state = stateFor(readFc27Context(root));
        return {
          synced: state.sessionSynced,
          syncedAt: state.syncedAt,
          setSyncedAt: { ...state.setSyncedAt },
          busy: !!running,
          needsRefresh: now() - (state.fullSyncAt ?? 0) >= ttlMs && now() >= state.retryAt && [...state.rows.values()].some((row) => row.isCollected !== true)
        };
      } catch {
        return { synced: false, syncedAt: null, busy: !!running };
      }
    };
    const needsRead = (state, definitionId, missingOnly = false) => {
      const row = state.rows.get(definitionId);
      return !row || !missingOnly && row.isCollected !== true && now() - (row.readAt ?? 0) >= ttlMs;
    };
    const sync = (pool = null, { onProgress = null, definitionIds = null, force = false, incremental = false, missingOnly = false } = {}) => {
      let context;
      try {
        context = readFc27Context(root);
        if (pool) validatePool(pool, context);
        if (definitionIds !== null && (pool !== null || !Array.isArray(definitionIds) || !definitionIds.length || definitionIds.length > 1e3 || definitionIds.some((value) => !id6(value)) || new Set(definitionIds).size !== definitionIds.length)) fail18("FC27_GALLERY_CONCEPT_IDS_UNAVAILABLE");
      } catch (error2) {
        return Promise.resolve({ status: "blocked", reason: safeReason7(error2) });
      }
      const state = stateFor(context), key = `${state.key}:${definitionIds?.join(",") ?? pool?.setId ?? "all"}`;
      if (inFlight.has(key)) return inFlight.get(key);
      const run = async () => {
        const operation = { context, stopped: false };
        running = operation;
        const progress = (value) => {
          try {
            onProgress?.(value);
          } catch {
          }
        };
        try {
          await restore(state);
          assert(context);
          const allIds = definitionIds ?? (pool ? pool.items.map((row) => row.eaId) : root.repositories.Item.getStaticData().map((row) => row.id));
          if (!Array.isArray(allIds) || !allIds.length || allIds.length > 1e5 || allIds.some((value) => !id6(value))) fail18("FC27_GALLERY_CONCEPT_IDS_UNAVAILABLE");
          const fullSync = !pool && definitionIds === null;
          let ids = fullSync && !force ? allIds.filter((value) => !state.coveredDefinitionIds.has(value)) : pool && incremental && !force ? allIds.filter((value) => needsRead(state, value, missingOnly)) : allIds;
          let rechecking = false;
          if (fullSync && !force && !ids.length && now() - (state.fullSyncAt ?? 0) >= ttlMs) {
            ids = [...state.rows.values()].filter((row) => needsRead(state, row.definitionId)).sort((a, b) => (a.readAt ?? 0) - (b.readAt ?? 0) || a.definitionId - b.definitionId).slice(0, 1e3).map((row) => row.definitionId);
            rechecking = ids.length > 0;
          }
          if (pool && !ids.length) return projectState(pool, state, { cached: true });
          if (fullSync && !ids.length) {
            state.sessionSynced = true;
            record({ event: "sync-plan", phase: "incremental", status: "success", count: 0, cached: true });
            return { status: "observed", cached: true, scope: scope2(), covered: state.coveredDefinitionIds.size };
          }
          if (definitionIds === null && now() < state.retryAt) fail18("FC27_GALLERY_PROGRESS_BACKOFF");
          if (!install() || typeof root.UTSearchCriteriaDTO !== "function" || typeof root.services?.Item?.searchConceptItems !== "function" || root.GAME_NAME !== "fc27") fail18("FC27_GALLERY_CONCEPT_RUNTIME_UNVERIFIED");
          record({ event: "sync-plan", phase: force ? "full" : rechecking ? "recheck" : "incremental", status: "started", count: ids.length, cached: state.rows.size > 0 });
          const incoming = [], seen = /* @__PURE__ */ new Set(), groups = Math.ceil(ids.length / 1e3);
          let familyEvidence = false;
          let pages = 0;
          for (let start = 0; start < ids.length; start += 1e3) {
            const batch = ids.slice(start, start + 1e3), allowed = new Set(batch);
            const criteria = new root.UTSearchCriteriaDTO();
            criteria.type = root.SearchType.PLAYER;
            criteria.category = root.SearchCategory.ANY;
            criteria.defId = batch;
            criteria.count = 250;
            criteria.offset = 0;
            let ended = false;
            const batchRows = [];
            while (!ended) {
              assert(context);
              if (operation.stopped) return { status: "stopped", scope: scope2() };
              progress({
                phase: "ea",
                index: Math.floor(start / 1e3) + 1,
                total: groups,
                completed: Math.floor(start / 1e3),
                pages,
                count: incoming.length
              });
              const reply = await nativePage(criteria, context);
              record({ event: "concept-response", status: "received", httpStatus: reply?.status });
              if (reply?.success !== true || reply.status !== 200) fail18(Number.isInteger(reply?.status) && reply.status >= 100 && reply.status <= 599 ? `FC27_GALLERY_HTTP_${reply.status}` : "FC27_GALLERY_CONCEPT_RESPONSE_UNVERIFIED");
              const data = reply.response ?? reply.data;
              if (!Array.isArray(data?.items) || data.items.length > 250) fail18("FC27_GALLERY_CONCEPT_PAYLOAD_UNVERIFIED");
              const exactProjection = pool || definitionIds !== null || rechecking;
              const pageAllowed = exactProjection ? allowed : new Set(data.items.map((item2) => item2.definitionId));
              const accepts = pool || rechecking ? (value) => [...allowed].some((requested) => sameDatabaseId(requested, value)) : (value) => pageAllowed.has(value);
              const responseIds = data.items.map((item2) => item2?.definitionId).filter(id6);
              record({
                event: "concept-response",
                status: "validated",
                requestedCount: allowed.size,
                responseCount: responseIds.length,
                expandedCount: responseIds.filter((value) => !allowed.has(value)).length,
                foreignCount: responseIds.filter((value) => !accepts(value)).length,
                offset: criteria.offset,
                recheck: rechecking
              });
              const nativeItems = new Map(data.items.map((item2) => [item2?.definitionId, item2]));
              const acceptedItems = data.items.filter((item2) => id6(item2?.definitionId) && accepts(item2.definitionId));
              if (acceptedItems.length) familyEvidence = true;
              const payloadItems = exactProjection && acceptedItems.length ? acceptedItems : data.items;
              const rows = sanitizeRows(
                payloadItems.map((item2) => ({
                  definitionId: item2.definitionId,
                  isCollected: item2.isCollected,
                  gradingScore: item2.gradingScore,
                  cardData: nativeCardData(rawByItem.get(item2) ?? item2)
                })),
                pageAllowed,
                accepts,
                exactProjection && (pool || rechecking) ? 250 : pageAllowed.size
              );
              const retainedRows = exactProjection ? rows.filter((row) => allowed.has(row.definitionId)) : rows;
              record({
                event: "concept-response",
                status: "retained",
                requestedCount: allowed.size,
                responseCount: rows.length,
                retainedCount: retainedRows.length,
                expandedCount: rows.length - retainedRows.length,
                offset: criteria.offset,
                recheck: rechecking
              });
              for (const row of retainedRows) {
                if (seen.has(row.definitionId)) fail18("FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT");
                row.readAt = now();
                seen.add(row.definitionId);
                incoming.push(row);
                batchRows.push(row);
                const Entity = root.UTItemEntity;
                const native = nativeItems.get(row.definitionId);
                if (typeof Entity === "function" && native instanceof Entity) {
                  state.displayEntities.delete(row.definitionId);
                  state.displayEntities.set(row.definitionId, native);
                }
              }
              ended = !data.items.length || ("endOfList" in data ? data.endOfList === true : data.retrievedAll === true);
              criteria.offset += data.items.length;
              pages++;
              progress({
                phase: "ea",
                index: Math.floor(start / 1e3) + 1,
                total: groups,
                completed: Math.floor(start / 1e3) + (ended ? 1 : 0),
                pages,
                count: incoming.length
              });
              await new Promise((resolve) => setTimeout(resolve, 1e3));
            }
            if (fullSync && !rechecking) {
              merge(state, batchRows);
              state.fetchedAt = now();
              for (const value of batch) state.coveredDefinitionIds.add(value);
              await persist(state);
              assert(context);
            }
          }
          assert(context);
          if (operation.stopped) return { status: "stopped", scope: scope2() };
          if ((pool || definitionIds !== null || rechecking) && incoming.length < ids.length && familyEvidence) {
            const observed = new Set(incoming.map((row) => row.definitionId));
            for (const definitionId of ids) {
              if (observed.has(definitionId)) continue;
              incoming.push({ definitionId, isCollected: null, gradingScore: null, readAt: now(), familyOnly: true });
            }
            record({
              event: "concept-response",
              status: "family-only",
              requestedCount: ids.length,
              retainedCount: incoming.length,
              unknownCount: incoming.filter((row) => row.familyOnly === true).length
            });
          }
          if ((definitionIds !== null || rechecking) && incoming.length !== ids.length) fail18("FC27_GALLERY_CONCEPT_INCOMPLETE");
          if (pool && incoming.length < ids.length && ids.every((id7) => state.rows.has(id7))) fail18("FC27_GALLERY_CONCEPT_INCOMPLETE");
          merge(state, incoming);
          state.fetchedAt = now();
          if (fullSync && !rechecking) for (const value of ids) state.coveredDefinitionIds.add(value);
          if (pool) state.setSyncedAt[pool.setId] = now();
          else if (definitionIds === null) {
            state.syncedAt = now();
            state.fullSyncAt = state.syncedAt;
            state.sessionSynced = true;
          }
          await persist(state);
          assert(context);
          notify();
          record({ event: "progress-read", phase: "native-service", status: "success", count: incoming.length });
          return pool ? projectState(pool, state, { cached: false }) : {
            status: "observed",
            scope: scope2(),
            count: incoming.length,
            fetchedAt: state.fetchedAt,
            ...definitionIds !== null ? { rows: incoming } : {}
          };
        } catch (error2) {
          const reason = safeReason7(error2);
          try {
            assert(context);
          } catch {
            return { status: "blocked", reason: "FC27_GALLERY_CONTEXT_CHANGED" };
          }
          if (reason === "FC27_GALLERY_SYNC_STOPPED") return { status: "stopped", scope: scope2() };
          if (reason !== "FC27_GALLERY_PROGRESS_BACKOFF") state.retryAt = now() + ttlMs;
          record({ event: "progress-read", phase: "request", status: "failed", reason, retryAt: state.retryAt });
          return pool && pool.items.some((row) => state.rows.has(row.eaId)) ? projectState(pool, state, { cached: true, stale: true, reason }) : { status: "blocked", reason, scope: scope2() };
        } finally {
          if (running === operation) running = null;
        }
      };
      const task = tail.then(run).finally(() => inFlight.delete(key));
      tail = task.catch(() => {
      });
      inFlight.set(key, task);
      return task;
    };
    const load = async (pool, { force = false, onProgress = null, missingOnly = false } = {}) => {
      let context;
      try {
        context = readFc27Context(root);
        validatePool(pool, context);
      } catch (error2) {
        return { status: "blocked", reason: safeReason7(error2) };
      }
      const state = stateFor(context);
      try {
        await restore(state);
        assert(context);
        if (!pool.items.every((row) => state.rows.has(row.eaId)) && typeof gmGetValue === "function") {
          try {
            const saved = await gmGetValue(contextKey(context, `gallery-progress:${pool.source}:${pool.setId}`), null);
            assert(context);
            if ([1, 2].includes(saved?.schema) && same14(saved.context, context) && saved.revision === pool.revision && Number.isSafeInteger(saved.fetchedAt) && saved.fetchedAt >= 0 && saved.fetchedAt <= now()) {
              merge(state, sanitizeRows(saved.concepts, new Set(pool.items.map((row) => row.eaId))).map((row) => ({ ...row, readAt: saved.fetchedAt })));
              state.fetchedAt = Math.max(state.fetchedAt, saved.fetchedAt);
              await persist(state);
            }
          } catch {
          }
          assert(context);
        }
        if (!force && pool.items.every((row) => !needsRead(state, row.eaId, missingOnly))) return projectState(pool, state, { cached: true });
        return sync(pool, { onProgress, force, incremental: !force, missingOnly });
      } catch (error2) {
        return { status: "blocked", reason: safeReason7(error2) };
      }
    };
    install();
    const updateFirstOwner = async (definitionId, firstOwned) => {
      const context = readFc27Context(root), state = stateFor(context);
      await restore(state);
      assert(context);
      if (!id6(Number(definitionId)) || firstOwned !== null && typeof firstOwned !== "boolean") fail18("FC27_GALLERY_FO_INPUT_INVALID");
      const saved = await persist(state, (history) => firstOwned === null ? removeGalleryFirstOwnerHistory(history, Number(definitionId)) : toggleGalleryFirstOwnerHistory(history, Number(definitionId), firstOwned, now()));
      if (!saved) fail18("FC27_GALLERY_FO_SAVE_FAILED");
      assert(context);
      notify();
      return { status: "observed", definitionId: Number(definitionId), firstOwned };
    };
    return Object.freeze({
      load,
      project: project3,
      sync,
      syncState,
      scope: scope2,
      install,
      updateFirstOwner,
      readFirstOwnerHistory: async () => {
        const state = stateFor(readFc27Context(root));
        await restore(state);
        return normalizeGalleryFirstOwnerHistory(state.firstOwnerHistory);
      },
      readVersions: (definitionIds) => sync(null, { definitionIds }),
      stop: () => {
        if (running) running.stopped = true;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => {
        disposed = true;
        if (running) running.stopped = true;
        for (const state of states2.values()) if (state.timer !== null) clearTimeout(state.timer);
        if (factoryHook && factoryHook.prototype.createItem === factoryHook.wrapped) factoryHook.prototype.createItem = factoryHook.original;
        for (const state of states2.values()) {
          state.displayEntities.clear();
          state.clubSnapshot = null;
          state.heldSnapshot = null;
        }
        listeners.clear();
      }
    });
  }

  // src/adapters/browser/fc27-gallery-sync.js
  function createFc27GallerySync({ provider, reader, diagnosticLog: diagnosticLog2, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    const pools = /* @__PURE__ */ new Map();
    let task = null, mappedScope = null, progressState = null;
    const remember = (pool) => {
      if (pool) pools.set(`${pool.source}:${pool.setId}`, pool);
    };
    const peekDetails = async (source) => {
      const cached = await provider.peek?.();
      if (cached?.source === source) for (const category of cached.catalog.categories) for (const set of category.sets) {
        const result = await provider.peekPool?.({ source, setId: set.id });
        if (result?.pool) remember(result.pool);
      }
      const details = [];
      for (const pool of pools.values()) if (pool.source === source) {
        details.push(await reader.project(pool));
        if (details.length % 8 === 0) await wait(0);
      }
      return details;
    };
    const sync = ({ source, setId = null, force = false, onProgress = null } = {}) => {
      if (task) {
        if (task.setId === setId) return task.promise;
        if (setId !== null && task.setId === null) {
          task.stopped = true;
          reader.stop();
          return task.promise.then(() => sync({ source, setId, force, onProgress }));
        } else return task.promise;
      }
      const operation = { setId, stopped: false, scope: null, startedAt: now() };
      const record = (fields4) => {
        try {
          Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", event: "sync-run", ...fields4 })).catch(() => {
          });
        } catch {
        }
      };
      const report = (progress) => {
        if (operation.stopped) return;
        progressState = { ...progress, setId };
        if (operation.phase !== progress.phase) {
          operation.phase = progress.phase;
          record({ phase: progress.phase, status: "started", durationMs: now() - operation.startedAt });
        }
        try {
          onProgress?.(progressState);
        } catch {
        }
      };
      let promise;
      promise = (async () => {
        const scope2 = reader.scope();
        operation.scope = scope2;
        const current2 = () => !operation.stopped && scope2 === reader.scope();
        report({ phase: "catalog", index: 0, total: 1, completed: 0 });
        const catalog = await provider.load();
        if (!current2()) return { status: "stopped", scope: scope2 };
        if (source !== "futgg" || catalog.source !== source || !catalog.catalog) return { status: "blocked", reason: "FC27_GALLERY_POOL_UNAVAILABLE", scope: scope2 };
        const sets2 = catalog.catalog.categories.flatMap((category) => category.sets).filter((set) => setId === null || set.id === setId);
        if (!sets2.length) return { status: "blocked", reason: "FC27_GALLERY_POOL_UNAVAILABLE", scope: scope2 };
        let currentPool = null;
        if (setId !== null) {
          const result = await provider.loadPool({ source, setId });
          if (!current2()) return { status: "stopped", scope: scope2 };
          if (result.status !== "observed" || result.stale || !result.pool) return { ...result, scope: scope2 };
          currentPool = result.pool;
          remember(currentPool);
        }
        const native = await reader.sync(currentPool, { onProgress: report, force });
        if (!current2()) return { status: "stopped", scope: scope2 };
        if (native.status !== "observed" || native.stale) return native;
        const failures = [], updates = [];
        for (const [index, set] of sets2.entries()) {
          if (!current2()) return { status: "stopped", scope: scope2 };
          report({ phase: "pools", index: index + 1, total: sets2.length, completed: index });
          const result = currentPool ? { status: "observed", cached: true, pool: currentPool } : await provider.loadPool({ source, setId: set.id });
          if (!current2()) return { status: "stopped", scope: scope2 };
          if (result.pool) {
            remember(result.pool);
            const detail = !currentPool && typeof reader.load === "function" ? await reader.load(result.pool, { missingOnly: true, onProgress: report }) : await reader.project(result.pool);
            updates.push(detail);
            if (detail.status !== "observed" || detail.stale) {
              failures.push({ setId: set.id, reason: detail.reason });
              report({ phase: "pools", index: index + 1, total: sets2.length, completed: index + 1, details: updates.splice(0) });
              break;
            }
          }
          if (!current2()) return { status: "stopped", scope: scope2 };
          if (updates.length >= 8 || index === sets2.length - 1) {
            report({
              phase: "pools",
              index: index + 1,
              total: sets2.length,
              completed: index + 1,
              details: updates.splice(0)
            });
          }
          if (result.status !== "observed" || result.stale) {
            failures.push({ setId: set.id, reason: result.reason });
            if (/429|BACKOFF|TIMEOUT|NETWORK/.test(`${result.reason ?? ""} ${result.error ?? ""}`)) break;
          }
          if (setId === null) await wait(0);
        }
        if (updates.length) report({ phase: "pools", index: sets2.length, total: sets2.length, details: updates.splice(0) });
        if (setId === null && !failures.length) mappedScope = scope2;
        return { status: failures.length ? "partial" : "observed", scope: scope2, details: await peekDetails(source), failures };
      })().catch((error2) => ({ status: "blocked", reason: /^FC27_[A-Z0-9_]+$/.test(error2?.message) ? error2.message : "FC27_GALLERY_PROGRESS_UNAVAILABLE" })).then((result) => {
        record({ phase: operation.phase ?? "catalog", status: result.status, durationMs: now() - operation.startedAt, count: result.details?.length ?? 0, reason: result.reason });
        return result;
      }).finally(() => {
        if (task?.promise === promise) task = null;
      });
      operation.promise = promise;
      task = operation;
      return promise;
    };
    const state = () => {
      const state2 = reader.syncState();
      try {
        return {
          ...state2,
          busy: !!task || !!state2.busy,
          synced: state2.synced && mappedScope === reader.scope(),
          progress: task && task.scope === reader.scope() ? progressState : null
        };
      } catch {
        return { ...state2, busy: !!task, synced: false, progress: progressState };
      }
    };
    return Object.freeze({
      sync,
      remember,
      peekDetails,
      state,
      subscribe: reader.subscribe,
      prioritize: (setId) => {
        if (task?.setId === null && setId !== null) {
          task.stopped = true;
          reader.stop();
          return task.promise.then(() => true);
        }
        return Promise.resolve(false);
      },
      stop: () => {
        if (task) task.stopped = true;
        reader.stop();
      }
    });
  }

  // src/gallery/listing-candidates.js
  var same15 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var blocked10 = (reason) => ({ status: "blocked", reason, entries: [] });
  var pendingStates = /* @__PURE__ */ new Set(["buy-pending", "bought", "move-pending", "move-rejected"]);
  function projectGalleryListingReceipts({
    purchase,
    scope: scope2,
    context,
    expectedOperationId,
    expectedBinding,
    pendingMarker = null
  } = {}) {
    try {
      if (traditionalJournalScope(context) !== scope2) return blocked10("FC27_GALLERY_LISTING_SCOPE_CHANGED");
      validateGalleryPurchaseRecord(purchase, scope2, context);
      if (!expectedOperationId || purchase.operationId !== expectedOperationId || !expectedBinding || purchase.binding !== expectedBinding) return blocked10("FC27_GALLERY_LISTING_PURCHASE_CHANGED");
      if (pendingMarker !== null || purchase.entries.some((entry) => pendingStates.has(entry.state))) {
        return blocked10("FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED");
      }
      if (purchase.collection?.status !== "confirmed") return blocked10("FC27_GALLERY_COLLECTION_UNCONFIRMED");
      const acquired = purchase.entries.filter((entry) => entry.state === "club");
      if (new Set(acquired.map((entry) => entry.itemId)).size !== acquired.length || new Set(acquired.map((entry) => entry.tradeId)).size !== acquired.length) {
        return blocked10("FC27_GALLERY_LISTING_RECEIPT_CONFLICT");
      }
      return {
        status: "observed",
        scope: scope2,
        context: structuredClone(context),
        operationId: purchase.operationId,
        binding: purchase.binding,
        entries: acquired.map((entry) => ({
          itemId: entry.itemId,
          definitionId: entry.definitionId,
          tradeId: entry.tradeId,
          purchasePrice: entry.price
        })),
        skipped: purchase.entries.filter((entry) => entry.state !== "club").map((entry) => ({
          definitionId: entry.definitionId,
          reason: entry.state === "collected" ? "already-collected-not-purchased" : "not-purchased"
        })),
        executionEnabled: false
      };
    } catch {
      return blocked10("FC27_GALLERY_LISTING_PURCHASE_UNCONFIRMED");
    }
  }
  async function readGalleryListingSource({
    scope: scope2,
    context,
    expectedOperationId,
    expectedBinding,
    get,
    exclusive,
    assertCurrent
  } = {}) {
    try {
      const result = await exclusive(scope2, async () => {
        assertCurrent();
        const key = galleryPurchaseKey(scope2), pendingKey = galleryPurchasePendingKey(scope2);
        const purchase = structuredClone(await get(key, null)), marker = structuredClone(await get(pendingKey, null));
        assertCurrent();
        const source = projectGalleryListingReceipts({ purchase, scope: scope2, context, expectedOperationId, expectedBinding, pendingMarker: marker });
        if (source.status !== "observed") return source;
        const current2 = await get(key, null), pending2 = await get(pendingKey, null);
        assertCurrent();
        if (!same15(purchase, current2) || !same15(marker, pending2)) return blocked10("FC27_GALLERY_LISTING_PURCHASE_CHANGED");
        return source;
      });
      return result ?? blocked10("FC27_GALLERY_PURCHASE_BUSY");
    } catch (error2) {
      return blocked10(/^FC27_[A-Z0-9_]+$/.test(error2?.message ?? "") ? error2.message : "FC27_GALLERY_LISTING_SOURCE_UNAVAILABLE");
    }
  }

  // src/adapters/browser/fc27-gallery-purchase.js
  function createFc27GalleryPurchase({
    root,
    gmGetValue,
    gmSetValue,
    gmRequest,
    reader,
    liveEnabled,
    readSettings = async () => ({ status: "observed", queriesNumber: 5, quoteCeiling: null })
  }) {
    let busy = false, stopped = false;
    const create = ({ onProgress, isCurrent = () => true } = {}) => {
      const context = readFc27Context(root), scope2 = traditionalJournalScope(context);
      const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager: root.navigator.locks });
      const account = () => {
        if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root)) || !isCurrent()) throw new Error("FC27_GALLERY_CONTEXT_CHANGED");
      };
      const referencePrice = createFsuReferencePrice({
        season: context.season,
        platform: context.platform,
        get: gmGetValue,
        set: gmSetValue,
        request: createFc27FutbinHttp(gmRequest)
      });
      const buyer = createGalleryPurchaseSession({
        scope: scope2,
        context,
        get: gmGetValue,
        set: gmSetValue,
        exclusive: persistence.exclusive,
        assertCurrent: account,
        onProgress,
        shouldStop: () => stopped,
        checkOtherTransactions: async () => {
          const other = await persistence.journal.read(scope2);
          if (other && !isTerminalTraditionalJournal(other)) throw new Error("FC27_RECOVERY_REQUIRED");
          if (await gmGetValue(puzzleBuyPendingKey(scope2), null) !== null) throw new Error("FC27_BUY_RECOVERY_REQUIRED");
        },
        operationId: () => root.crypto.randomUUID(),
        createAdapter: async (record) => {
          const settings = await readSettings();
          account();
          if (settings?.status !== "observed" || !Number.isSafeInteger(settings.queriesNumber) || settings.queriesNumber < 1 || !isPuzzleQuoteCeiling(settings.quoteCeiling)) throw new Error("FC27_PUZZLE_POLICY_INVALID");
          record.quoteCeiling = settings.quoteCeiling;
          const fresh = await reader.readVersions(record.entries.map((entry) => entry.definitionId));
          account();
          if (fresh.status !== "observed" || fresh.stale) throw new Error(fresh.reason ?? "FC27_GALLERY_COLLECTION_UNCONFIRMED");
          const rows = new Map(fresh.rows.map((row) => [row.definitionId, row]));
          const players = new Map(fresh.rows.filter((row) => row.cardData).map((row) => [row.definitionId, {
            _rating: row.cardData.rating,
            nationId: row.cardData.nation,
            teamId: row.cardData.teamId,
            leagueId: row.cardData.leagueId,
            preferredPosition: row.cardData.preferredPosition
          }]));
          if (record.entries.some((entry) => entry.state === "waiting" && rows.get(entry.definitionId)?.isCollected !== true && !players.has(entry.definitionId))) {
            throw new Error("FC27_BUY_REFERENCE_PRICE_UNAVAILABLE");
          }
          const adapter = await createFc27PuzzleBuyAdapter(root, {
            assertTarget: account,
            referencePrice,
            attempts: settings.queriesNumber,
            canWrite: () => liveEnabled === true && persistence.lock.hasExclusiveAccess(scope2),
            verifyCurrent: account,
            playerDetails: players,
            collectionState: (definitionId) => rows.get(definitionId)?.isCollected,
            confirmCollection: async (ids) => {
              if (!ids.length) return { status: "confirmed", confirmed: 0 };
              const result = await reader.readVersions(ids);
              account();
              const confirmed = result.rows?.filter((row) => row.isCollected === true).map((row) => row.definitionId) ?? [];
              return {
                status: result.status === "observed" && confirmed.length === ids.length ? "confirmed" : "pending",
                confirmed: confirmed.length,
                total: ids.length,
                reason: result.reason ?? null
              };
            }
          });
          return Object.freeze({ ...adapter, find: (definitionId) => adapter.find(definitionId, settings.quoteCeiling ?? Infinity) });
        }
      });
      return buyer;
    };
    const purchase = async (input) => {
      if (input?.approved !== true || typeof input.isCurrent !== "function") return { status: "blocked", reason: "FC27_GALLERY_PURCHASE_APPROVAL_REQUIRED" };
      if (liveEnabled !== true) return { status: "blocked", reason: "FC27_GALLERY_PURCHASE_DISABLED" };
      if (busy) return { status: "blocked", reason: "FC27_GALLERY_PURCHASE_BUSY" };
      busy = true;
      stopped = false;
      try {
        return await create(input).execute(input);
      } catch (error2) {
        return { status: "blocked", reason: /^FC27_[A-Z0-9_]+$/.test(error2?.message ?? "") ? error2.message : "FC27_GALLERY_PURCHASE_UNCONFIRMED" };
      } finally {
        busy = false;
      }
    };
    purchase.inspect = async () => {
      try {
        return await create().inspect();
      } catch {
        return { status: "blocked", reason: "FC27_GALLERY_CONTEXT_CHANGED" };
      }
    };
    purchase.stop = () => {
      stopped = true;
    };
    purchase.listingSource = async ({ expectedOperationId, expectedBinding, isCurrent = () => true } = {}) => {
      if (busy) return { status: "blocked", reason: "FC27_GALLERY_PURCHASE_BUSY", entries: [] };
      try {
        const context = readFc27Context(root), scope2 = traditionalJournalScope(context);
        const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager: root.navigator.locks });
        return await readGalleryListingSource({
          scope: scope2,
          context,
          expectedOperationId,
          expectedBinding,
          get: gmGetValue,
          exclusive: persistence.exclusive,
          assertCurrent: () => {
            if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root)) || !isCurrent()) throw Error("FC27_GALLERY_CONTEXT_CHANGED");
          }
        });
      } catch {
        return { status: "blocked", reason: "FC27_GALLERY_CONTEXT_CHANGED", entries: [] };
      }
    };
    return Object.freeze(purchase);
  }

  // src/adapters/ea/fc27-gallery-card.js
  var at7 = (root, path) => path.split(".").reduce((value, key) => value?.[key], root);
  var own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : void 0;
  var validId11 = (value) => Number.isSafeInteger(value) && value > 0;
  function cloneCardData(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const clone3 = (value, depth = 0) => {
      if (depth > 5) return null;
      if (Array.isArray(value)) return value.slice(0, 128).map((item2) => item2 && typeof item2 === "object" ? clone3(item2, depth + 1) : item2);
      if (value && typeof value === "object") {
        const copy = {};
        for (const [key, item2] of Object.entries(value).slice(0, 256)) copy[key] = item2 && typeof item2 === "object" ? clone3(item2, depth + 1) : item2;
        return copy;
      }
      return value;
    };
    return clone3(raw);
  }
  function sourceDefinitionId(source) {
    return own(source, "resourceId") ?? own(source, "definitionId");
  }
  function isNativeEntity(root, source) {
    const Entity = root?.UTItemEntity;
    return typeof Entity === "function" && source instanceof Entity;
  }
  function validEntity(entity, source, native) {
    const definitionId = sourceDefinitionId(source);
    const player = typeof entity?.isPlayer === "function" && entity.isPlayer();
    return entity && validId11(entity.definitionId) && validId11(definitionId) && entity.definitionId === definitionId && player && entity.concept === true && (native || source?.dream === true) && (own(source, "resourceId") == null || own(source, "resourceId") === definitionId) && (own(source, "definitionId") == null || own(source, "definitionId") === definitionId);
  }
  function createFc27GalleryNativeRenderer(root, { document = root?.document, diagnosticLog: diagnosticLog2 } = {}) {
    const reported = /* @__PURE__ */ new Set();
    const record = (phase, reason, status = "failed") => {
      const key = `${phase}:${reason ?? status}`;
      if (reported.has(key)) return;
      reported.add(key);
      try {
        Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", event: "card-render", source: "ea", phase, status, ...reason ? { reason } : {} })).catch(() => {
        });
      } catch {
      }
    };
    const render = ({ parent, raw, label = "", slot = "", onUnavailable = () => {
    } } = {}) => {
      const viewFactory = at7(root, "UTItemViewFactory"), createLargeItem = viewFactory?.createLargeItem;
      const native = isNativeEntity(root, raw);
      const phase = native ? "native-entity" : "cached-dto";
      if (!document || !parent || !raw || !native && (raw.itemType !== "player" || raw.dream !== true) || typeof root?.UTItemEntity !== "function" || typeof createLargeItem !== "function") {
        record(phase, "FC27_GALLERY_CARD_INPUT_UNAVAILABLE");
        return null;
      }
      let view, wrapper, timer, disposed = false, unavailableReported = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        try {
          view?.dealloc?.();
        } catch {
        }
        wrapper?.remove();
      };
      try {
        let entity = raw;
        if (!native) {
          const createItem = at7(root, "factories.Item.createItem");
          if (typeof createItem !== "function") {
            record(phase, "FC27_GALLERY_CARD_FACTORY_UNAVAILABLE");
            return null;
          }
          entity = createItem.call(root.factories.Item, cloneCardData(raw));
        }
        if (!validEntity(entity, raw, native)) {
          record(phase, "FC27_GALLERY_CARD_ENTITY_UNVERIFIED");
          return null;
        }
        const display = Object.assign(new root.UTItemEntity(), entity);
        display.concept = false;
        view = createLargeItem.call(viewFactory, display);
        if (!view || typeof view.init !== "function" || typeof view.render !== "function" || typeof view.getRootElement !== "function") {
          record(phase, "FC27_GALLERY_CARD_VIEW_UNAVAILABLE");
          dispose();
          return null;
        }
        view.init();
        view.renderRestrictions = true;
        const complete = view.renderComplete;
        const unavailable = (reason = "FC27_GALLERY_CARD_ARTWORK_TIMEOUT") => {
          if (disposed) return;
          record(phase, reason);
          dispose();
          if (!unavailableReported) {
            unavailableReported = true;
            onUnavailable();
          }
        };
        const loaded = view.onLoadComplete;
        view.onLoadComplete = function(...args) {
          if (!disposed) loaded?.apply(this, args);
        };
        view.renderComplete = function(...args) {
          if (disposed) return;
          complete?.apply(this, args);
          const main = this.assetsLoaded?.get?.(root.ItemAssetType?.MAIN ?? "main");
          const shell = this.assetsLoaded?.get?.(root.ItemAssetType?.SHELL ?? "shell");
          if (main === false || shell === false) return;
          if (main !== true || shell !== true) return;
          clearTimeout(timer);
          record(phase, null, "success");
        };
        const rootElement = view.getRootElement();
        if (!rootElement || rootElement.nodeType !== 1) {
          record(phase, "FC27_GALLERY_CARD_VIEW_UNAVAILABLE");
          dispose();
          return null;
        }
        wrapper = document.createElement("div");
        wrapper.className = "gallery-native-card";
        if (slot) wrapper.slot = String(slot);
        wrapper.style.cssText = "display:block;position:relative;pointer-events:none";
        wrapper.setAttribute("role", "img");
        wrapper.setAttribute("aria-label", label);
        wrapper.append(rootElement);
        parent.append(wrapper);
        wrapper.__fcatDealloc = dispose;
        timer = setTimeout(unavailable, 15e3);
        view.render(display, false);
        if (disposed) return null;
        return wrapper;
      } catch {
        record(phase, "FC27_GALLERY_CARD_RENDER_FAILED");
        dispose();
        return null;
      }
    };
    return Object.freeze({ render });
  }

  // src/gallery/plans.js
  var GALLERY_PLAN_SCHEMA = 1;
  var sourceOf = (value) => value === "futgg" || value === "fodder" ? value : null;
  var scopeOf2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value) ? value : null;
  var setOf = (value) => typeof value === "string" && value.length > 0 && value.length <= 330 && /^(?:futgg:[1-9]\d{0,15}|fodder:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/.test(value) ? value : null;
  var clone2 = (value) => {
    try {
      return structuredClone(value);
    } catch {
      return null;
    }
  };
  function normalizeRecord(value, scope2, source, setId) {
    if (!value || value.schema !== GALLERY_PLAN_SCHEMA || value.scope !== scope2 || value.source !== source || value.setId !== setId || typeof value.binding !== "string" || value.binding.length < 1 || value.binding.length > 5e5 || !Number.isSafeInteger(value.savedAt) || value.savedAt < 0 || value.savedAt > Date.now() + 6e4) return null;
    const plan = value.plan == null ? null : clone2(value.plan), overview = value.overview == null ? null : clone2(value.overview);
    if (plan === null && overview === null || plan !== null && (typeof plan !== "object" || Array.isArray(plan)) || overview !== null && (typeof overview !== "object" || Array.isArray(overview))) return null;
    const overviewBinding = value.overviewBinding ?? value.binding;
    if (typeof overviewBinding !== "string" || !overviewBinding.length || overviewBinding.length > 5e5) return null;
    return {
      schema: GALLERY_PLAN_SCHEMA,
      scope: scope2,
      source,
      setId,
      binding: value.binding,
      overviewBinding,
      plan,
      overview,
      savedAt: value.savedAt
    };
  }
  function galleryPlanKey(scope2, source, setId) {
    const validScope3 = scopeOf2(scope2), validSource = sourceOf(source), validSet = setOf(setId);
    if (!validScope3 || !validSource || !validSet) throw new Error("FC27_GALLERY_PLAN_SCOPE_INVALID");
    return `fcat-fc27-gallery-plan:${JSON.stringify([validScope3, validSource, validSet])}`;
  }
  function createGalleryPlanStore({ get, set, now = () => Date.now() } = {}) {
    let tail = Promise.resolve();
    const load = async (scope2, source, setId) => {
      try {
        await tail;
        const value = await get(galleryPlanKey(scope2, source, setId), null);
        if (value == null) return { status: "absent" };
        const record = normalizeRecord(value, scope2, source, setId);
        return record ? { status: "observed", record } : { status: "blocked", reason: "FC27_GALLERY_PLAN_CACHE_INVALID" };
      } catch {
        return { status: "blocked", reason: "FC27_GALLERY_PLAN_CACHE_READ_FAILED" };
      }
    };
    const save = (scope2, source, setId, value) => {
      let record, key;
      try {
        key = galleryPlanKey(scope2, source, setId);
        record = normalizeRecord({
          schema: GALLERY_PLAN_SCHEMA,
          scope: scope2,
          source,
          setId,
          binding: value?.binding,
          overviewBinding: value?.overviewBinding,
          plan: value?.plan,
          overview: value?.overview ?? null,
          savedAt: now()
        }, scope2, source, setId);
        if (!record) throw new Error();
      } catch {
        return Promise.resolve({ status: "blocked", reason: "FC27_GALLERY_PLAN_CACHE_INVALID" });
      }
      const task = tail.then(async () => {
        try {
          await set(key, record);
          return { status: "observed", record };
        } catch {
          return { status: "blocked", reason: "FC27_GALLERY_PLAN_CACHE_WRITE_FAILED" };
        }
      });
      tail = task.catch(() => {
      });
      return task;
    };
    const clear = (scope2, source, setId) => {
      let key;
      try {
        key = galleryPlanKey(scope2, source, setId);
      } catch {
        return Promise.resolve({ status: "blocked", reason: "FC27_GALLERY_PLAN_SCOPE_INVALID" });
      }
      const task = tail.then(async () => {
        try {
          await set(key, null);
          return { status: "observed" };
        } catch {
          return { status: "blocked", reason: "FC27_GALLERY_PLAN_CACHE_WRITE_FAILED" };
        }
      });
      tail = task.catch(() => {
      });
      return task;
    };
    return Object.freeze({ load, save, clear });
  }

  // src/gallery/market-comparison.js
  function createGalleryMarketComparison({
    createTransport,
    scope: scope2,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ttlMs = 3e4,
    diagnosticLog: diagnosticLog2 = null
  } = {}) {
    const cache = /* @__PURE__ */ new Map(), pending2 = /* @__PURE__ */ new Map();
    let tail = Promise.resolve(), lastRequestAt = null, cooldownUntil = 0, identity5 = null;
    const blocked11 = (reason) => ({ status: "blocked", reason, executable: false });
    const inspectScope = () => {
      try {
        return scope2();
      } catch {
        return null;
      }
    };
    const diag = (input) => {
      try {
        return Promise.resolve(diagnosticLog2?.record?.({ area: "gallery", ...input })).catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    };
    const changedScope = (phase) => {
      void diag({ event: "market-compare", phase, status: "blocked", reason: "FC27_GALLERY_COMPARE_SCOPE_CHANGED" });
      return blocked11("FC27_GALLERY_COMPARE_SCOPE_CHANGED");
    };
    return Object.freeze({
      compare: (definitionId) => {
        const account = inspectScope();
        if (!account || !Number.isSafeInteger(definitionId) || definitionId < 1) {
          void diag({ event: "market-compare", phase: "input", status: "blocked", reason: "FC27_GALLERY_COMPARE_INPUT_INVALID" });
          return Promise.resolve(blocked11("FC27_GALLERY_COMPARE_INPUT_INVALID"));
        }
        if (identity5 !== account) {
          cache.clear();
          identity5 = account;
          cooldownUntil = 0;
        }
        const key = `${account}:${definitionId}`, stored = cache.get(key);
        if (stored && stored.expiresAt > now()) {
          void diag({
            event: "market-compare",
            phase: "cache",
            status: stored.result.status === "observed" ? "success" : "blocked",
            cached: true,
            reason: stored.result.reason
          });
          return Promise.resolve({ ...stored.result, cached: true });
        }
        if (pending2.has(key)) return pending2.get(key);
        const task = tail.catch(() => {
        }).then(async () => {
          if (inspectScope() !== account) return changedScope("preflight");
          if (cooldownUntil > now()) {
            void diag({ event: "market-compare", phase: "preflight", status: "blocked", reason: "FC27_GALLERY_COMPARE_COOLDOWN", retryAt: cooldownUntil });
            return { ...blocked11("FC27_GALLERY_COMPARE_COOLDOWN"), retryAt: cooldownUntil };
          }
          if (lastRequestAt !== null) await wait(Math.max(0, 800 - (now() - lastRequestAt)));
          if (inspectScope() !== account) return changedScope("preflight");
          try {
            void diag({ event: "market-compare", phase: "request", status: "started" });
            const transport = await createTransport({ maxRequests: 1, quotesOnly: true });
            if (inspectScope() !== account) return changedScope("request");
            lastRequestAt = now();
            const result = await transport.readQuotePage({ definitionId, start: 0, count: 20, maxBuy: null });
            if (inspectScope() !== account) return changedScope("response");
            if (result?.status !== "observed" || result.definitionId !== definitionId || result.executable !== false) {
              void diag({ event: "market-compare", phase: "response", status: "blocked", reason: "FC27_GALLERY_COMPARE_RESPONSE_UNVERIFIED" });
              return blocked11("FC27_GALLERY_COMPARE_RESPONSE_UNVERIFIED");
            }
            cache.set(key, { result, expiresAt: now() + ttlMs });
            while (cache.size > 100) cache.delete(cache.keys().next().value);
            void diag({ event: "market-compare", phase: "response", status: "success" });
            return { ...result, cached: false };
          } catch (error2) {
            if (inspectScope() !== account) return changedScope("response");
            const reason = /^FC27_(?:MARKET_[A-Z0-9_]+|CONTEXT_UNAVAILABLE)$/.test(error2?.message ?? "") ? error2.message : "FC27_GALLERY_COMPARE_FAILED";
            const result = blocked11(reason);
            cache.set(key, { result, expiresAt: now() + ttlMs });
            if (/HTTP_429$/.test(reason)) cooldownUntil = now() + ttlMs;
            void diag({ event: "market-compare", phase: "response", status: "blocked", reason });
            return result;
          }
        }).finally(() => pending2.delete(key));
        pending2.set(key, task);
        tail = task;
        return task;
      }
    });
  }

  // src/gallery/plan-replay.js
  var numeric = [
    "eaId",
    "playerEaId",
    "overall",
    "gradingScore",
    "galleryScore",
    "nationEaId",
    "clubEaId",
    "leagueEaId",
    "rarityEaId",
    "weakFoot",
    "skillMoves"
  ];
  var flags = ["collected", "held", "inClub", "firstOwned", "holographic"];
  var integer12 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
  var gradeName = (value) => typeof value === "string" && /^[A-S][+-]?$/.test(value);
  function createGalleryPlanReplay(input) {
    try {
      const joint = Array.isArray(input?.targets), targets = joint ? input.targets : [input];
      if (!targets.length || targets.length > 4 || targets.reduce((n, target) => n + target.progress.rows.length, 0) > 512) return null;
      const clean = targets.map((target) => {
        const { set, catalog, progress, prices = {}, targetGrade } = target;
        if (!/^futgg:[1-9]\d{0,8}$/.test(set.id) || !integer12(set.requiredCards) || set.requiredCards < 1 || !Array.isArray(set.grades) || set.grades.length > 10 || !(gradeName(targetGrade) || integer12(targetGrade)) || compileGalleryScoringRules(catalog).status !== "ready") throw Error("invalid");
        const tags = catalog.tags.map((tag) => {
          const rule = tag.rules[0];
          if (rule.values.length > 256 || rule.values.some((value) => !/^[A-Za-z0-9_-]{1,24}$/.test(String(value))) || tag.tiers.length > 256) throw Error("invalid");
          return {
            id: tag.id,
            name: `Rule ${tag.id}`,
            bonusType: tag.bonusType,
            thresholdType: tag.thresholdType,
            rules: [{ attribute: rule.attribute, type: rule.type, target: rule.target, values: rule.values.map(String) }],
            tiers: tag.tiers.map((tier) => ({ minItems: tier.minItems, bonus: tier.bonus }))
          };
        });
        const rows = progress.rows.map((row) => {
          const clean2 = {};
          for (const key of numeric) if (row[key] == null || integer12(row[key])) clean2[key] = row[key] ?? null;
          else throw Error("invalid");
          for (const key of flags) if (row[key] == null || typeof row[key] === "boolean") clean2[key] = row[key] ?? null;
          else throw Error("invalid");
          if (row.positions != null) {
            if (!Array.isArray(row.positions) || row.positions.length > 32 || row.positions.some((value) => !/^[A-Z0-9]{1,5}$/.test(String(value)))) throw Error("invalid");
            clean2.positions = row.positions.map(String);
          }
          return clean2;
        });
        const quotes = {};
        for (const row of rows) if (integer12(prices[row.eaId]) && prices[row.eaId] > 0) quotes[row.eaId] = prices[row.eaId];
        return { set: { id: set.id, requiredCards: set.requiredCards, grades: set.grades.map((grade) => {
          if (!gradeName(grade.name) || !integer12(grade.threshold)) throw Error("invalid");
          return { name: grade.name, threshold: grade.threshold };
        }) }, catalog: { source: "futgg", tags }, progress: {
          season: "27",
          setId: Number(set.id.slice(6)),
          complete: progress.complete !== false,
          candidateOnly: progress.candidateOnly === true,
          poolComplete: progress.poolComplete !== false,
          rows
        }, prices: quotes, targetGrade };
      });
      if (joint && input.budget != null && !integer12(input.budget)) return null;
      return {
        schema: 1,
        mode: joint ? "joint" : "grade",
        input: joint ? { targets: clean, budget: input.budget ?? null } : clean[0]
      };
    } catch {
      return null;
    }
  }

  // src/diagnostics/fcat-diagnostic-log.js
  var DEFAULT_MAX_ENTRIES = 300;
  var MAX_STRING_LENGTH = 160;
  var STRING_FIELDS = Object.freeze(["area", "event", "source", "phase", "transportPhase", "status", "reason", "route", "mismatch"]);
  var NUMBER_FIELDS = Object.freeze([
    "httpStatus",
    "batchSize",
    "count",
    "spent",
    "retryAt",
    "durationMs",
    "setId",
    "challengeId",
    "requests",
    "catalogAttempts",
    "quoteAttempts",
    "safeCandidates",
    "requestedCount",
    "responseCount",
    "retainedCount",
    "expandedCount",
    "foreignCount",
    "offset",
    "evaluations",
    "targetScore",
    "currentScore",
    "requiredSlots",
    "quotedCount",
    "eaScoreCount",
    "catalogScoreCount",
    "cheapestPrice",
    "cheapestScore",
    "bestPrice",
    "bestScore",
    "searchDepth",
    "candidateLimit",
    "beamWidth",
    "maxEvaluations"
  ]);
  var BOOLEAN_FIELDS = Object.freeze(["cached", "stale", "recheck", "searchComplete", "scopeTruncated", "beamTruncated", "budgetExhausted", "timeExhausted"]);
  var boundedString = (value, max = MAX_STRING_LENGTH) => {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(value)) return null;
    return value.slice(0, max);
  };
  function sanitizeEntry(input, now) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const at8 = now();
    if (!Number.isSafeInteger(at8) || at8 < 0) return null;
    const entry = { at: at8 };
    if (["service.bid", "service.move"].includes(input.method)) entry.method = input.method;
    if (typeof input.observedHash === "string" && /^[a-f0-9]{64}$/.test(input.observedHash)) entry.observedHash = input.observedHash;
    for (const key of STRING_FIELDS) {
      const value = key === "reason" ? typeof input.reason === "string" && /^(?:HTTP [1-5]\d{2}|FC(?:AT|27)_[A-Z0-9_]{1,140}|SAFE_MATERIAL_SHORTAGE|request-failed)$/.test(input.reason) ? input.reason : null : boundedString(input[key]);
      if (value !== null) entry[key] = value;
    }
    for (const key of NUMBER_FIELDS) {
      const value = input[key];
      if (Number.isSafeInteger(value) && value >= 0) entry[key] = value;
    }
    for (const key of BOOLEAN_FIELDS) {
      if (typeof input[key] === "boolean") entry[key] = input[key];
    }
    if (typeof input.version === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.version)) entry.version = input.version;
    if (!entry.area || !entry.event) return null;
    return Object.freeze(entry);
  }
  function validSavedEntry(value) {
    return sanitizeEntry(value, () => value?.at);
  }
  function createFcatDiagnosticLog({
    gmGetValue,
    gmSetValue,
    key = "fcat-fc27-diagnostic-log-v1",
    version = null,
    now = () => Date.now(),
    maxEntries = DEFAULT_MAX_ENTRIES
  } = {}) {
    if (typeof gmGetValue !== "function" || typeof gmSetValue !== "function" || typeof key !== "string" || !key || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 2e3) {
      throw new TypeError("FCAT_DIAGNOSTIC_LOG_INVALID");
    }
    let entries2 = [];
    let planning = [];
    let loaded = false;
    let loading = null;
    let writing = Promise.resolve();
    const load = () => loading ??= (async () => {
      if (loaded) return;
      try {
        const saved = await gmGetValue(key, null);
        if (saved?.schema === 1 && Array.isArray(saved.entries)) {
          entries2 = saved.entries.slice(-maxEntries).map(validSavedEntry).filter(Boolean);
          planning = (Array.isArray(saved.planning) ? saved.planning : []).slice(-4).map((row) => {
            const event = validSavedEntry(row.event), replay = createGalleryPlanReplay(row.replay?.input);
            return event && replay ? { event, replay } : null;
          }).filter(Boolean);
        }
      } catch {
      }
      loaded = true;
    })().finally(() => {
      loading = null;
    });
    const persist = () => {
      const payload = {
        schema: 1,
        product: "FC Automation Tool",
        season: "27",
        version: version ?? null,
        entries: entries2.map((entry) => ({ ...entry })),
        planning: structuredClone(planning)
      };
      return Promise.resolve().then(() => gmSetValue(key, payload)).catch(() => void 0);
    };
    const record = (input) => {
      let entry, replay;
      try {
        entry = sanitizeEntry({ ...input, version }, now);
        if (input.area === "gallery" && ["grade-plan", "joint-plan"].includes(input.event)) replay = createGalleryPlanReplay(input.replayInput);
      } catch {
        return Promise.resolve(false);
      }
      if (!entry) return Promise.resolve(false);
      writing = writing.then(async () => {
        await load();
        entries2 = [...entries2, entry].slice(-maxEntries);
        if (replay) planning = [...planning, { event: entry, replay }].slice(-4);
        await persist();
      }).catch(() => void 0);
      return writing.then(() => true);
    };
    const snapshot = async () => {
      await writing;
      await load();
      return entries2.map((entry) => ({ ...entry }));
    };
    const exportPayload = async () => {
      const exportedEntries = await snapshot();
      return {
        schema: 1,
        product: "FC Automation Tool",
        season: "27",
        version: version ?? null,
        exportedAt: now(),
        redaction: "Bounded events plus four Gallery planning replays (public version IDs, scoring attributes, ownership flags and quotes). URLs, credentials, account identifiers and raw card objects are excluded.",
        entries: exportedEntries,
        planning: structuredClone(planning)
      };
    };
    return Object.freeze({ record, snapshot, exportPayload, count: () => entries2.length, key });
  }

  // src/adapters/browser/user-effects.js
  function createUserEffectsAdapter(runtime = globalThis, documentObject = runtime?.document || globalThis.document) {
    async function copyText(text5) {
      const value = String(text5 || "");
      try {
        await runtime?.navigator?.clipboard?.writeText?.(value);
        if (typeof runtime?.navigator?.clipboard?.writeText === "function") return true;
      } catch {
      }
      if (!documentObject?.createElement || !documentObject?.body?.appendChild) {
        throw new Error("Clipboard fallback is unavailable");
      }
      const textarea = documentObject.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      documentObject.body.appendChild(textarea);
      textarea.select?.();
      const copied = documentObject.execCommand?.("copy") !== false;
      textarea.remove?.();
      if (!copied) throw new Error("Clipboard copy failed");
      return true;
    }
    function downloadText(text5, filename) {
      const BlobConstructor = runtime?.Blob || globalThis.Blob;
      const urlApi = runtime?.URL || globalThis.URL;
      if (!BlobConstructor || !urlApi?.createObjectURL || !documentObject?.createElement || !documentObject?.body?.appendChild) {
        throw new Error("Download is unavailable");
      }
      const blob = new BlobConstructor([String(text5 || "")], { type: "text/plain;charset=utf-8" });
      const url = urlApi.createObjectURL(blob);
      const anchor = documentObject.createElement("a");
      anchor.href = url;
      anchor.download = String(filename || "download.txt");
      documentObject.body.appendChild(anchor);
      try {
        anchor.click?.();
      } finally {
        anchor.remove?.();
        urlApi.revokeObjectURL?.(url);
      }
      return true;
    }
    function confirm(message) {
      try {
        return runtime?.confirm?.(String(message || "")) === true;
      } catch {
        return false;
      }
    }
    return Object.freeze({ copyText, downloadText, confirm });
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
  var FC27_GALLERY_PROXY_KEY = "fcat-fc27-gallery-futgg-proxy-v1";
  var galleryProxy = "";
  try {
    galleryProxy = normalizeFc27GalleryProxy(GM_getValue(FC27_GALLERY_PROXY_KEY, "") || "");
  } catch {
    galleryProxy = "";
  }
  var readGalleryProxy = () => galleryProxy;
  var diagnosticLog = createFcatDiagnosticLog({ gmGetValue: GM_getValue, gmSetValue: GM_setValue, version: "27.0.10" });
  var userEffects = createUserEffectsAdapter(unsafeWindow, unsafeWindow.document);
  var galleryAssets = Object.freeze({
    reward: (type) => {
      try {
        const token = unsafeWindow.services?.EventToken?.repository?._definitions?.find((row) => String(row.currencyName).toLowerCase() === String(type).toLowerCase());
        return token ? unsafeWindow.AssetLocationUtils?.getEventTokenIconUri(
          token.assetId,
          unsafeWindow.EventTokenIconVariant?.RENDERED
        ) || "" : "";
      } catch {
        return "";
      }
    },
    filter: (kind, id7) => {
      try {
        const value = Number(id7), util = unsafeWindow.AssetLocationUtils;
        const type = util?.FILTER?.[String(kind).toUpperCase()];
        return Number.isSafeInteger(value) && value > 0 && type ? util.getFilterImage(type, value) : "";
      } catch {
        return "";
      }
    },
    club: (id7) => {
      try {
        const u = unsafeWindow.AssetLocationUtils;
        return u?.getFilterImage(u.FILTER.CLUB, Number(id7)) || "";
      } catch {
        return "";
      }
    },
    league: (id7) => {
      try {
        const u = unsafeWindow.AssetLocationUtils;
        return u?.getFilterImage(u.FILTER.LEAGUE, Number(id7)) || "";
      } catch {
        return "";
      }
    },
    nation: (id7) => {
      try {
        const u = unsafeWindow.AssetLocationUtils;
        return u?.getFilterImage(u.FILTER.NATION, Number(id7)) || "";
      } catch {
        return "";
      }
    },
    category: (slug2, name = "") => {
      const key = `${String(slug2 ?? "")} ${String(name ?? "")}`.toLocaleLowerCase();
      const rarityCategory = key.includes("rarit");
      const ids = key.includes("england") || key.includes("premier") || key.includes("wsl") ? [13, 2216] : key.includes("spain") || key.includes("laliga") || key.includes("liga-f") || key.includes("la-liga") ? [53, 2222] : key.includes("germany") || key.includes("bundesliga") ? [19, 2221] : key.includes("france") || key.includes("ligue") || key.includes("arkema") ? [16, 2218] : key.includes("italy") || key.includes("serie-a") || key.includes("serie a") ? [31] : key.includes("leagues") || key === "league" ? [13, 53, 19, 2221, 16, 31] : rarityCategory ? [1, 3, 4, 5, 6] : [];
      return ids.map((id7) => rarityCategory ? galleryAssets.filter("RARITY", id7) : galleryAssets.league(id7)).filter(Boolean);
    },
    set: (name) => {
      try {
        const raw = unsafeWindow.repositories?.TeamConfig?.getTeams?.() ?? [];
        const teams = Array.isArray(raw) ? raw : raw && typeof raw[Symbol.iterator] === "function" ? [...raw] : Object.values(raw);
        const normalize2 = (value) => String(value ?? "").toLocaleLowerCase().replace(/[.'’_-]+/g, " ").replace(/\s+(women|wfc|fc)$/i, "").replace(/\s+/g, " ").trim();
        const needle = normalize2(name);
        const rows = teams.map((team) => ({ team, value: normalize2(team?.name ?? team?.sortName ?? team?.label) })).filter((row) => row.value && row.value === needle);
        const ids = rows.map(({ team }) => Number(team?.id ?? team?.teamId ?? team?.eaId)).filter((value) => Number.isSafeInteger(value) && value > 0).slice(0, 3);
        return [...new Set(ids)].map((id7) => galleryAssets.club(id7)).filter(Boolean);
      } catch {
        return [];
      }
    }
  });
  var galleryPrices = (id7) => readCachedGalleryPrice(unsafeWindow, id7);
  var setGalleryProxy = async (value) => {
    const normalized = normalizeFc27GalleryProxy(value);
    await GM_setValue(FC27_GALLERY_PROXY_KEY, normalized);
    galleryProxy = normalized;
    return { status: "observed", proxy: normalized };
  };
  var galleryCatalog = createFc27GalleryCatalogProvider({
    http: createFc27GalleryTransport(GM_xmlhttpRequest, { getProxy: readGalleryProxy, diagnosticLog }),
    gmGetValue: GM_getValue,
    gmSetValue: GM_setValue,
    diagnosticLog
  });
  var galleryProgress = createFc27GalleryProgressReader(unsafeWindow, { gmGetValue: GM_getValue, gmSetValue: GM_setValue, diagnosticLog });
  var gallerySync = createFc27GallerySync({ provider: galleryCatalog, reader: galleryProgress, diagnosticLog });
  var galleryComparison = createGalleryMarketComparison({
    scope: galleryProgress.scope,
    createTransport: (options) => createFc27MarketReadTransport(unsafeWindow, options),
    diagnosticLog
  });
  var galleryPurchase = createFc27GalleryPurchase({
    root: unsafeWindow,
    gmGetValue: GM_getValue,
    gmSetValue: GM_setValue,
    gmRequest: GM_xmlhttpRequest,
    reader: galleryProgress,
    liveEnabled: dependencies.liveEnabled,
    readSettings: () => current().inspectPuzzlePolicy()
  });
  if (!galleryProgress.install()) {
    const factoryReady = unsafeWindow.setInterval(() => {
      if (galleryProgress.install()) unsafeWindow.clearInterval(factoryReady);
    }, 1e3);
  }
  var galleryNativeRenderer = createFc27GalleryNativeRenderer(unsafeWindow, { document: unsafeWindow.document, diagnosticLog });
  var session;
  var current = () => session ??= createFc27AcceptanceSession({ ...dependencies, diagnosticLog });
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
    title: `FC Automation Tool ${"27.0.10"}`,
    version: "27.0.10",
    liveEnabled: dependencies.liveEnabled,
    galleryCatalog,
    galleryProxy: readGalleryProxy,
    setGalleryProxy,
    galleryAccountScope: galleryProgress.scope,
    gallerySync,
    galleryAssets,
    galleryNativeRenderer,
    galleryDiagnosticLog: diagnosticLog,
    galleryFirstOwnerHistory: (definitionId, firstOwned) => galleryProgress.updateFirstOwner(definitionId, firstOwned),
    purchaseGallery: galleryPurchase,
    gradePlanner: planGalleryGrade,
    galleryPrices,
    galleryMarketCompare: galleryComparison.compare,
    galleryPriceLoader: (ids) => {
      const context = readFc27Context(unsafeWindow);
      const platform = /^pc:/i.test(context.platform) ? "pc" : "console";
      return galleryCatalog.loadPriceSnapshot(ids, { platform });
    },
    galleryTargetStore: createGalleryTargetStore({ get: GM_getValue, set: GM_setValue }),
    galleryPlanStore: createGalleryPlanStore({ get: GM_getValue, set: GM_setValue }),
    exportDiagnostics: async () => {
      const payload = await diagnosticLog.exportPayload();
      const stamp = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, "-");
      const filename = `FCAutomationTool-FC27-diagnostics-${stamp}.json`;
      userEffects.downloadText(JSON.stringify(payload, null, 2), filename);
      return { count: payload.entries.length, filename };
    },
    gallerySetLoader: async ({ source, setId, force = false, onProgress = null }) => {
      const pool = await galleryCatalog.loadPool({ source, setId, force });
      if (pool.status !== "observed" || !pool.pool) return pool;
      gallerySync.remember(pool.pool);
      const progress = await galleryProgress.load(pool.pool, { force, onProgress });
      let prices = Object.freeze({});
      let priceError = null;
      let priceSnapshot = null;
      let platform = null;
      try {
        const context = readFc27Context(unsafeWindow);
        platform = /^pc:/i.test(context.platform) ? "pc" : "console";
        priceSnapshot = await galleryCatalog.loadPriceSnapshot(pool.pool.items.map((item2) => item2.eaId), { platform });
        prices = priceSnapshot.prices;
      } catch (error2) {
        priceError = /^FC27_[A-Z_]+$/.test(error2?.message) || /^HTTP \d{3}$/.test(error2?.message) ? error2.message : "FC27_GALLERY_PRICE_UNAVAILABLE";
      }
      if (platform) priceError ??= galleryCatalog.priceError?.(pool.pool.items.map((item2) => item2.eaId), { platform }) ?? null;
      return {
        ...progress,
        progress: progress.progress ?? mergeGalleryAccountProgress(pool.pool),
        prices,
        priceSnapshot,
        priceError,
        poolStale: pool.stale === true
      };
    },
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
