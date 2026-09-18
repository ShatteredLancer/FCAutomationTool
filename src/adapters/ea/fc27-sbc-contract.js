import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { projectFc27CatalogChallenge } from './fc27-challenge-catalog.js';
import { inspectInProgressSquad } from './fc27-sbc-read.js';
import { normalizeFc27TraditionalChallenge } from './fc27-traditional-read.js';

// Public compiled_2.js reviewed on 2026-09-18. Write methods are inspected, never invoked here.
const hashes = Object.freeze({
  getSets: '17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c',
  getChallengesForSet: '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693',
  saveChallenge: '5273c0f32805c49e91ca26e924a442048dcc5bc763d979c34c0919793a02d851',
  submitChallenge: '38539de9ad8d2aad8e429029f2cfc87539dc91ef662c0a892dcec5c67220afef',
});
const fail = reason => { throw new Error(reason); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
function method(object, key) {
  for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return descriptor.value;
  }
}
function values(input, limit) {
  const raw = ownData(input, '_collection') ?? input;
  if (!raw || typeof raw !== 'object') return fail('FC27_CONTRACT_SHAPE_UNVERIFIED');
  const keys = Object.getOwnPropertyNames(raw).filter(key => key !== 'length');
  if (keys.length > limit) return fail('FC27_CONTRACT_SHAPE_UNVERIFIED');
  return keys.map(key => ownData(raw, key));
}
function rewards(input, scope) {
  return values(input, 6).map(reward => {
    const result = Object.fromEntries(['type', 'value', 'count', 'tradable'].map(key => [key, ownData(reward, key)]));
    if (result.type !== 'pack' || !integer(result.value) || result.value <= 0
        || !integer(result.count) || result.count < 1 || result.count > 10 || typeof result.tradable !== 'boolean') {
      return fail('FC27_CONTRACT_REWARD_UNSUPPORTED');
    }
    return { scope, ...result };
  });
}

export async function readFc27SbcContract(root, { setId } = {}) {
  try {
    if (!integer(setId) || setId <= 0 || setId >= 1e9) return fail('FC27_CONTRACT_TARGET_UNVERIFIED');
    const context = readFc27Context(root);
    const service = ownData(ownData(root, 'services'), 'SBC');
    const dao = ownData(service, 'sbcDAO');
    const functions = Object.fromEntries(Object.keys(hashes).map(key => [key, method(dao, key)]));
    const methods = {};
    for (const [key, fn] of Object.entries(functions)) {
      methods[key] = false;
      if (typeof fn !== 'function' || !root.crypto?.subtle) continue;
      const source = Function.prototype.toString.call(fn);
      if (source.length > 4096) continue;
      const digest = await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source));
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      methods[key] = hash === hashes[key];
    }
    if (!methods.getSets || !methods.getChallengesForSet) return fail('FC27_CONTRACT_READ_METHOD_UNREVIEWED');
    const unchanged = () => {
      try {
        if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)
          || ownData(ownData(root, 'services'), 'SBC') !== service || ownData(service, 'sbcDAO') !== dao
          || Object.keys(functions).some(key => method(dao, key) !== functions[key])) return fail('FC27_CONTRACT_CONTEXT_CHANGED');
      } catch { return fail('FC27_CONTRACT_CONTEXT_CHANGED'); }
    };
    let lastRequestAt = -Infinity;
    const pace = async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - lastRequestAt))));
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
          try { observable?.unobserve(owner); } catch { /* Remove only our observer. */ }
          if (error) reject(error); else resolve(response);
        };
        const timer = setTimeout(() => finish(new Error('FC27_CONTRACT_READ_TIMEOUT')), 15000);
        try {
          observable = functions[name].apply(dao, args);
          observable.observe(owner, (_sender, reply) => {
            if (finished) return;
            try {
              unchanged();
              if (ownData(reply, 'success') !== true || ownData(reply, 'status') !== 200) return fail('FC27_CONTRACT_READ_UNCONFIRMED');
              finish(null, ownData(reply, 'response'));
            } catch (error) { finish(error); }
          });
        } catch { finish(new Error('FC27_CONTRACT_READ_UNCONFIRMED')); }
      });
    };
    unchanged();
    const setReply = await read('getSets', []);
    const sets = values(ownData(setReply, 'sets'), 500).filter(set => ownData(set, 'id') === setId);
    if (sets.length !== 1) return fail('FC27_CONTRACT_TARGET_UNVERIFIED');
    const set = Object.fromEntries(['id', 'name', 'challengesCount', 'challengesCompletedCount', 'timesCompleted',
      'repeats', 'repeatabilityMode', 'startTime', 'endTime'].map(key => [key, ownData(sets[0], key)]));
    if (set.challengesCount !== 1 || set.challengesCompletedCount !== 0) return fail('FC27_CONTRACT_SINGLE_CHALLENGE_REQUIRED');
    if (typeof set.name !== 'string' || set.name.length > 160 || /[\u0000-\u001f]/.test(set.name)
        || ['timesCompleted', 'repeats', 'startTime', 'endTime'].some(key => !integer(set[key]))
        || typeof set.repeatabilityMode !== 'string' || !/^[A-Z_]{1,32}$/.test(set.repeatabilityMode)) {
      return fail('FC27_CONTRACT_SHAPE_UNVERIFIED');
    }
    const awardList = rewards(ownData(sets[0], 'awards'), 'set');
    const challengeReply = await read('getChallengesForSet', [setId]);
    const challenges = values(ownData(challengeReply, 'challenges'), 50);
    if (challenges.length !== 1) return fail('FC27_CONTRACT_SINGLE_CHALLENGE_REQUIRED');
    const observed = projectFc27CatalogChallenge(challenges[0], setId);
    if (observed.status !== 'IN_PROGRESS') return fail('FC27_CONTRACT_IN_PROGRESS_REQUIRED');
    awardList.push(...rewards(ownData(challenges[0], 'awards'), 'challenge'));
    if (awardList.length !== 1) return fail('FC27_CONTRACT_SINGLE_PACK_REQUIRED');
    await pace();
    const layout = await inspectInProgressSquad({ setId, challengeId: observed.id }, root, observed);
    unchanged();
    if (layout.status !== 'observed') return layout;
    const challenge = normalizeFc27TraditionalChallenge({ context, setId, challenge: challenges[0], layout,
      keys: ownData(root, 'SBCEligibilityKey'), scopes: ownData(root, 'SBCEligibilityScope'), qualities: ownData(root, 'SBCEligibilityQualityType') });
    return { status: 'observed', reason: 'FC27_FRESH_SBC_CONTRACT_READ', liveExecutionEnabled: false,
      methods, writeContractVerified: false,
      contract: { schema: 1, source: 'fresh-dao', context, observedAt: Date.now(), set, challenge, rewards: awardList } };
  } catch (error) {
    return { status: 'blocked', liveExecutionEnabled: false,
      reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_CONTRACT_UNAVAILABLE' };
  }
}

export async function inspectFc27SbcContract(root, options) {
  const result = await readFc27SbcContract(root, options);
  if (!result.contract) return result;
  const { context: _context, challenge, ...contract } = result.contract;
  const { context: _challengeContext, ...publicChallenge } = challenge;
  return { ...result, contract: { ...contract, challenge: publicChallenge } };
}
