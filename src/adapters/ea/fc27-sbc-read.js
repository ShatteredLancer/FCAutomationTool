// Self-contained for the isolated inspection browser. This is not a Live adapter.
export async function inspectInProgressSquad({ setId, challengeId } = {}, root = globalThis, observedChallenge = null) {
  const stop = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false });
  function data(value, key) {
    try {
      for (let depth = 0; value && depth < 5; depth++, value = Object.getPrototypeOf(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      }
    } catch { /* Do not execute accessors while locating the read target. */ }
    return undefined;
  }
  function values(value, limit) {
    for (let i = 0; i < 3 && data(value, '_collection') !== undefined; i++) value = data(value, '_collection');
    if (!value || typeof value !== 'object') return [];
    const keys = Object.getOwnPropertyNames(value).filter(key => key !== 'length');
    if (keys.length > limit) return [];
    return keys.map(key => data(value, key));
  }
  function find() {
    if (![27, '27'].includes(data(root, 'APP_YEAR_SHORT'))) return null;
    const userService = data(data(root, 'services'), 'User');
    const userId = data(userService, 'currentUserId');
    const user = data(data(data(userService, 'repository'), '_collection'), String(userId));
    const personaId = data(user, 'selectedPersona');
    const persona = data(data(data(user, '_personas'), '_collection'), String(personaId));
    const sku = data(persona, '_sku');
    const club = data(data(data(persona, 'clubs'), '_collection'), String(sku));
    if (!Number.isSafeInteger(userId) || userId <= 0 || data(user, 'id') !== userId
        || !Number.isSafeInteger(personaId) || personaId <= 0 || data(persona, 'id') !== personaId
        || typeof sku !== 'string' || !sku || data(club, 'sku') !== sku
        || data(club, 'year') !== 2027 || typeof data(club, 'platform') !== 'string') return null;
    const service = data(data(root, 'services'), 'SBC');
    const sets = values(data(data(service, 'repository'), 'sets'), 500).filter(set => data(set, 'id') === setId);
    if (sets.length !== 1) return null;
    // A fresh catalog GET may supply its detached challenge without modifying EA repositories.
    const challenges = (observedChallenge ? [observedChallenge] : values(data(sets[0], 'challenges'), 50))
      .filter(challenge => data(challenge, 'id') === challengeId);
    const challenge = challenges[0];
    if (challenges.length !== 1 || data(challenge, 'setId') !== setId
        || data(challenge, 'status') !== 'IN_PROGRESS'
        || data(data(root, 'SBCChallengeStatus'), 'IN_PROGRESS') !== 'IN_PROGRESS') return null;
    return { service, challenge, dao: data(service, 'sbcDAO'), user, persona, club,
      scope: JSON.stringify([userId, personaId, sku, data(club, 'platform')]) };
  }
  if (![setId, challengeId].every(id => Number.isSafeInteger(id) && id > 0 && id < 1e9)) return stop('INVALID_CHALLENGE_IDENTITY');
  try {
    const initial = find();
    if (!initial) return stop('IN_PROGRESS_CHALLENGE_UNCONFIRMED');
    const load = data(initial.dao, 'loadChallenge');
    if (typeof load !== 'function' || !root.crypto?.subtle) return stop('DAO_IMPLEMENTATION_UNREVIEWED');
    const source = Function.prototype.toString.call(load);
    if (source.length > 4096) return stop('DAO_IMPLEMENTATION_UNREVIEWED');
    const hash = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source))),
      value => value.toString(16).padStart(2, '0')).join('');
    // Reviewed public FC27 compiled_2.js, 2026-09-17. true selects GET /challenge/{id}/squad.
    if (hash !== '04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e') return stop('DAO_IMPLEMENTATION_UNREVIEWED');
    const unchanged = () => {
      const current = find();
      return current?.service === initial.service && current?.dao === initial.dao
        && current?.challenge === initial.challenge && data(initial.dao, 'loadChallenge') === load
        && current?.scope === initial.scope && current?.user === initial.user
        && current?.persona === initial.persona && current?.club === initial.club;
    };
    if (!unchanged()) return stop('CHALLENGE_CHANGED');
    return await new Promise(resolve => {
      let observable;
      let finished = false;
      const owner = {};
      const finish = result => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { observable?.unobserve(owner); } catch { /* Cleanup must not expose raw errors. */ }
        resolve(result);
      };
      const timer = setTimeout(() => finish(stop('SQUAD_READ_TIMEOUT')), 15000);
      try {
        observable = load.call(initial.dao, challengeId, true);
        observable.observe(owner, (_sender, response) => {
          if (finished) return;
          try {
            if (!unchanged()) return finish(stop('CHALLENGE_CHANGED'));
            if (data(response, 'success') !== true || data(response, 'status') !== 200) return finish(stop('SQUAD_READ_UNCONFIRMED'));
            const squad = data(data(response, 'response'), 'squad');
            const slots = data(data(root, 'UTSquadEntity'), 'FIELD_PLAYERS');
            const simple = data(squad, 'simpleBrickIndices');
            const custom = data(squad, 'customBrickIndices');
            if (slots !== 11 || !Array.isArray(simple) || !Array.isArray(custom)
                || simple.length > 11 || custom.length > 11) return finish(stop('SLOT_LAYOUT_UNVERIFIED'));
            const bricks = [...simple, ...custom];
            if (bricks.some(index => !Number.isInteger(index) || index < 0 || index >= slots)
                || new Set(bricks).size !== bricks.length || bricks.length >= slots) return finish(stop('SLOT_LAYOUT_UNVERIFIED'));
            finish({ status: 'observed', reason: 'IN_PROGRESS_SQUAD_READ', liveExecutionEnabled: false,
              setId, challengeId, slotCount: slots, simpleBrickIndices: [...simple], customBrickIndices: [...custom],
              requiredPlayerCount: slots - bricks.length });
          } catch { finish(stop('SQUAD_READ_UNCONFIRMED')); }
        });
      } catch { finish(stop('SQUAD_READ_UNCONFIRMED')); }
    });
  } catch { return stop('SQUAD_INSPECTION_UNAVAILABLE'); }
}
