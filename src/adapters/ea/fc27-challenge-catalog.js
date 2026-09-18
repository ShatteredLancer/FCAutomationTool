import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';

const reviewedHash = '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693';
const id = value => Number.isSafeInteger(value) && value > 0 && value < 1e9;
const text = value => typeof value === 'string' && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : null;
const number = value => Number.isSafeInteger(value) && value >= 0 && value < 1e9 ? value : null;
const fail = reason => { throw new Error(reason); };
const stop = (reason, extra = {}) => ({ status: 'blocked', reason, liveExecutionEnabled: false, ...extra });

function values(input, limit) {
  const raw = ownData(input, '_collection') ?? input;
  if (!raw || typeof raw !== 'object') return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
  const keys = Object.getOwnPropertyNames(raw).filter(key => key !== 'length');
  if (keys.length > limit) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
  return keys.map(key => ownData(raw, key));
}
function method(object, key) {
  for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return descriptor.value;
  }
  return undefined;
}
function projectRewards(awards) {
  return values(awards, 6).map(reward => ({ type: text(ownData(reward, 'type')),
    value: number(ownData(reward, 'value')), count: number(ownData(reward, 'count')),
    tradable: typeof ownData(reward, 'tradable') === 'boolean' ? ownData(reward, 'tradable') : null }));
}
function cachedSetRewards(set) {
  let rewards = null;
  try { rewards = projectRewards(ownData(set, 'awards')); } catch { /* Unknown is not an empty award list. */ }
  return { source: 'cached-set', fresh: false, rewards };
}
export function projectFc27CatalogChallenge(challenge, setId) {
  const challengeId = ownData(challenge, 'id');
  if (!id(challengeId) || ownData(challenge, 'setId') !== setId) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
  const requirements = values(ownData(challenge, 'eligibilityRequirements'), 16).map(rule => {
    const pairs = ownData(ownData(rule, 'kvPairs'), '_collection');
    if (!pairs || typeof pairs !== 'object' || Object.keys(pairs).length > 8) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
    return { count: ownData(rule, 'count') === -1 ? -1 : number(ownData(rule, 'count')), scope: number(ownData(rule, 'scope')),
      pairs: Object.keys(pairs).map(key => {
        if (!/^\d{1,6}$/.test(key)) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
        const raw = ownData(pairs, key);
        if (!Array.isArray(raw) || raw.length > 32) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
        return { key: Number(key), values: Array.from({ length: raw.length }, (_, index) => number(ownData(raw, String(index)))) };
      }) };
  });
  const rewards = projectRewards(ownData(challenge, 'awards'));
  return { id: challengeId, setId, name: text(ownData(challenge, 'name')), status: text(ownData(challenge, 'status')),
    type: text(ownData(challenge, 'type')) ?? number(ownData(challenge, 'type')),
    eligibilityOperation: text(ownData(challenge, 'eligibilityOperation')), requirements, rewards };
}

// One reviewed GET only. Never call loadChallenge, populate the repository or enter the editor.
export async function inspectFc27ChallengeCatalog(root, { setId } = {}) {
  try {
    if (!id(setId)) return stop('FC27_CATALOG_SET_UNVERIFIED');
    const context = JSON.stringify(readFc27Context(root));
    const service = ownData(ownData(root, 'services'), 'SBC');
    const findSet = () => values(ownData(ownData(service, 'repository'), 'sets'), 500)
      .filter(set => ownData(set, 'id') === setId);
    const sets = findSet();
    if (sets.length !== 1) return stop('FC27_CATALOG_SET_UNVERIFIED');
    const setRewards = cachedSetRewards(sets[0]);
    const dao = ownData(service, 'sbcDAO');
    const read = method(dao, 'getChallengesForSet');
    if (typeof read !== 'function' || !root.crypto?.subtle) return stop('FC27_CATALOG_DAO_UNREVIEWED');
    const source = Function.prototype.toString.call(read);
    if (source.length > 4096) return stop('FC27_CATALOG_DAO_UNREVIEWED');
    const hash = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source))),
      value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== reviewedHash) return stop('FC27_CATALOG_DAO_UNREVIEWED');
    const unchanged = () => {
      try {
        const current = findSet();
        return JSON.stringify(readFc27Context(root)) === context
          && ownData(ownData(root, 'services'), 'SBC') === service && ownData(service, 'sbcDAO') === dao
          && method(dao, 'getChallengesForSet') === read && current.length === 1 && current[0] === sets[0]
          && JSON.stringify(cachedSetRewards(current[0])) === JSON.stringify(setRewards);
      } catch { return false; }
    };
    if (!unchanged()) return stop('FC27_CATALOG_CONTEXT_CHANGED');
    return await new Promise(resolve => {
      let observable;
      let finished = false;
      const owner = {};
      const finish = result => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { observable?.unobserve(owner); } catch { /* Only this request's observer is removed. */ }
        resolve(result);
      };
      const timer = setTimeout(() => finish(stop('FC27_CATALOG_READ_TIMEOUT')), 15000);
      try {
        observable = read.call(dao, setId);
        observable.observe(owner, (_sender, reply) => {
          if (finished) return;
          if (!unchanged()) return finish(stop('FC27_CATALOG_CONTEXT_CHANGED'));
          const httpStatus = number(ownData(reply, 'status'));
          if (ownData(reply, 'success') !== true || httpStatus !== 200) {
            return finish(stop('FC27_CATALOG_READ_UNCONFIRMED', { httpStatus }));
          }
          try {
            const challenges = values(ownData(ownData(reply, 'response'), 'challenges'), 50)
              .map(challenge => projectFc27CatalogChallenge(challenge, setId));
            if (new Set(challenges.map(challenge => challenge.id)).size !== challenges.length) return fail('FC27_CATALOG_SHAPE_UNVERIFIED');
            finish({ status: 'observed', reason: 'FC27_CHALLENGE_CATALOG_READ', liveExecutionEnabled: false,
              setId, setName: text(ownData(sets[0], 'name')), setRewards,
              challengeRewardsSource: 'catalog-response', rewardIdentityVerified: false, challenges });
          } catch { finish(stop('FC27_CATALOG_SHAPE_UNVERIFIED')); }
        });
      } catch { finish(stop('FC27_CATALOG_READ_UNCONFIRMED')); }
    });
  } catch (error) {
    return stop(/^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_CATALOG_UNAVAILABLE');
  }
}
