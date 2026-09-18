import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectFc27ChallengeCatalog } from '../../src/adapters/ea/fc27-challenge-catalog.js';

const reviewedHash = '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693';
const observation = JSON.parse(readFileSync(new URL('../fixtures/fc27-low-inventory-acceptance-observation.json', import.meta.url), 'utf8'));
function fixture() {
  const sku = 'synthetic-27-pc';
  const club = { sku, year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: sku, clubs: { _collection: { [sku]: club } } };
  const user = { id: 901, selectedPersona: 902, _personas: { _collection: { 902: persona } } };
  const challenge = { id: 12, setId: 4, name: 'Synthetic challenge', status: 'NOT_STARTED',
    type: 'NORMAL', eligibilityOperation: 'AND', eligibilityRequirements: [
      { count: 11, scope: 0, kvPairs: { _collection: { 28: [64] } } },
    ], awards: [{ type: 'pack', value: 509, count: 1, tradable: false }] };
  const reply = { success: true, status: 200, response: { challenges: [challenge] } };
  const observable = { observe: vi.fn((owner, callback) => callback(null, reply)), unobserve: vi.fn() };
  const get = vi.fn(() => observable);
  const forbidden = vi.fn(() => { throw new Error('no account writes'); });
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    SBCEligibilityKey: { PLAYER_MAX_OVR: 28 },
    crypto: { subtle: { digest: vi.fn(async () => Uint8Array.from(Buffer.from(reviewedHash, 'hex')).buffer) } },
    services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } },
      SBC: { repository: { sets: { _collection: { 4: { id: 4, name: 'Synthetic set', challenges: [] } } } },
        sbcDAO: { getChallengesForSet: get, loadChallenge: forbidden, saveChallenge: forbidden, submitChallenge: forbidden } } } };
  return { root, get, forbidden, reply, challenge, observable };
}
afterEach(() => vi.useRealTimers());

it('reads one exact known set through reviewed GET without initializing or modifying a challenge', async () => {
  const { root, get, forbidden, observable } = fixture();
  const result = await inspectFc27ChallengeCatalog(root, { setId: 4 });
  expect(result).toMatchObject({ status: 'observed', liveExecutionEnabled: false, setId: 4, challenges: [
    { id: 12, status: 'NOT_STARTED', type: 'NORMAL', requirements: [
      { count: 11, scope: 0, pairs: [{ key: 28, values: [64] }] },
    ], rewards: [{ type: 'pack', value: 509, count: 1, tradable: false }] },
  ] });
  expect(get).toHaveBeenCalledExactlyOnceWith(4);
  expect(forbidden).not.toHaveBeenCalled();
  expect(observable.unobserve).toHaveBeenCalledOnce();
  expect(root.services.SBC.repository.sets._collection[4].challenges).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/901|902|synthetic-27|accountScope/);
});

it('rejects missing context, unknown or ambiguous set, and unreviewed method before requests', async () => {
  for (const mutate of [
    x => { x.root.APP_YEAR_SHORT = 26; },
    x => { x.root.services.SBC.repository.sets._collection = {}; },
    x => { x.root.services.SBC.repository.sets._collection.other = x.root.services.SBC.repository.sets._collection[4]; },
    x => { x.root.crypto.subtle.digest.mockResolvedValue(new Uint8Array(32).buffer); },
  ]) {
    const value = fixture(); mutate(value);
    expect((await inspectFc27ChallengeCatalog(value.root, { setId: 4 })).status).toBe('blocked');
    expect(value.get).not.toHaveBeenCalled();
  }
});

it('preserves the EA -1 count sentinel for whole-squad quality requirements', async () => {
  const { root, challenge } = fixture();
  challenge.eligibilityRequirements = [{ count: -1, scope: 2, kvPairs: { _collection: { 3: [1] } } }];
  expect((await inspectFc27ChallengeCatalog(root, { setId: 4 })).challenges[0].requirements[0].count).toBe(-1);
});

it('keeps cached set awards separate from freshly read empty challenge awards', async () => {
  const { root, challenge, get, forbidden } = fixture();
  challenge.awards = [];
  const set = root.services.SBC.repository.sets._collection[4];
  set.awards = [{ type: 'pack', value: 509, count: 1, tradable: false, privateField: 'not-for-export' }];
  const result = await inspectFc27ChallengeCatalog(root, { setId: 4 });
  expect(result).toMatchObject({ status: 'observed', rewardIdentityVerified: false,
    challengeRewardsSource: 'catalog-response', setRewards: { source: 'cached-set', fresh: false,
      rewards: [{ type: 'pack', value: 509, count: 1, tradable: false }] },
    challenges: [{ rewards: [] }], liveExecutionEnabled: false });
  expect(JSON.stringify(result)).not.toContain('not-for-export');
  expect(get).toHaveBeenCalledExactlyOnceWith(4);
  expect(forbidden).not.toHaveBeenCalled();
});

it('distinguishes unavailable set awards from an observed empty collection without invoking getters', async () => {
  for (const shape of ['missing', 'getter', 'oversized', 'empty', 'unknown-fields']) {
    const { root, forbidden } = fixture();
    const set = root.services.SBC.repository.sets._collection[4];
    if (shape === 'getter') Object.defineProperty(set, 'awards', { get: forbidden });
    if (shape === 'oversized') set.awards = Array(7).fill({});
    if (shape === 'empty') set.awards = [];
    if (shape === 'unknown-fields') set.awards = [{}];
    const result = await inspectFc27ChallengeCatalog(root, { setId: 4 });
    expect(result.status).toBe('observed');
    expect(result.rewardIdentityVerified).toBe(false);
    expect(result.setRewards).toEqual({ source: 'cached-set', fresh: false,
      rewards: shape === 'empty' ? [] : shape === 'unknown-fields'
        ? [{ type: null, value: null, count: null, tradable: null }] : null });
    expect(forbidden).not.toHaveBeenCalled();
  }
});

it('rejects cached reward identity changes across method verification or the catalog GET', async () => {
  for (const phase of ['digest', 'response']) {
    const { root, get, reply, observable } = fixture();
    const set = root.services.SBC.repository.sets._collection[4];
    set.awards = [{ type: 'pack', value: 509, count: 1, tradable: false }];
    const change = () => { set.awards[0].value = 1022; };
    if (phase === 'digest') root.crypto.subtle.digest.mockImplementation(async () => {
      change(); return Uint8Array.from(Buffer.from(reviewedHash, 'hex')).buffer;
    });
    else observable.observe.mockImplementation((owner, callback) => { change(); callback(null, reply); });
    expect((await inspectFc27ChallengeCatalog(root, { setId: 4 })).reason).toBe('FC27_CATALOG_CONTEXT_CHANGED');
    expect(get).toHaveBeenCalledTimes(phase === 'digest' ? 0 : 1);
  }
});

it.each(observation.catalogs)('replays the observed reward layers for $setName using a synthetic account', async observed => {
  const { root, challenge, forbidden } = fixture();
  root.services.SBC.repository.sets._collection = { [observed.setId]: {
    id: observed.setId, name: observed.setName, awards: observed.setRewards.rewards,
  } };
  Object.assign(challenge, observed.challenge, { setId: observed.setId, awards: observed.challenge.rewards,
    eligibilityRequirements: observed.challenge.requirements.map(rule => ({ count: rule.count, scope: rule.scope,
      kvPairs: { _collection: Object.fromEntries(rule.pairs.map(pair => [pair.key, pair.values])) },
    })) });
  const result = await inspectFc27ChallengeCatalog(root, { setId: observed.setId });
  expect(result).toMatchObject({ status: 'observed', setId: observed.setId, setRewards: observed.setRewards,
    challenges: [observed.challenge], challengeRewardsSource: 'catalog-response', rewardIdentityVerified: false,
    liveExecutionEnabled: false });
  expect(forbidden).not.toHaveBeenCalled();
});

it.each([0, 401, 429, 500])('does not retry transport/status %s or expose response data', async status => {
  const { root, reply, get } = fixture();
  Object.assign(reply, { success: false, status, error: 'private-response' });
  const result = await inspectFc27ChallengeCatalog(root, { setId: 4 });
  expect(result).toMatchObject({ status: 'blocked', httpStatus: status, reason: 'FC27_CATALOG_READ_UNCONFIRMED' });
  expect(JSON.stringify(result)).not.toContain('private-response');
  expect(get).toHaveBeenCalledOnce();
});

it('rejects mismatched/duplicate challenges and oversized or hidden requirement collections', async () => {
  for (const mutate of [
    x => { x.challenge.setId = 5; },
    x => { x.reply.response.challenges.push(x.challenge); },
    x => { x.challenge.eligibilityRequirements = Array(17).fill({}); },
    x => { Object.defineProperty(x.challenge, 'eligibilityRequirements', { get: x.forbidden }); },
  ]) {
    const value = fixture(); mutate(value);
    expect((await inspectFc27ChallengeCatalog(value.root, { setId: 4 })).reason).toBe('FC27_CATALOG_SHAPE_UNVERIFIED');
    expect(value.forbidden).not.toHaveBeenCalled();
  }
});

it('blocks identity drift during source verification and after response', async () => {
  for (const phase of ['digest', 'response']) {
    const value = fixture();
    const change = () => { value.root.services.User.currentUserId = 999; };
    if (phase === 'digest') value.root.crypto.subtle.digest.mockImplementation(async () => {
      change(); return Uint8Array.from(Buffer.from(reviewedHash, 'hex')).buffer;
    });
    else value.observable.observe.mockImplementation((owner, callback) => { change(); callback(null, value.reply); });
    expect((await inspectFc27ChallengeCatalog(value.root, { setId: 4 })).reason).toBe('FC27_CATALOG_CONTEXT_CHANGED');
    expect(value.get).toHaveBeenCalledTimes(phase === 'digest' ? 0 : 1);
  }
});

it('times out and removes its observer without retrying', async () => {
  vi.useFakeTimers();
  const value = fixture();
  value.observable.observe.mockImplementation(() => {});
  const pending = inspectFc27ChallengeCatalog(value.root, { setId: 4 });
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).reason).toBe('FC27_CATALOG_READ_TIMEOUT');
  expect(value.get).toHaveBeenCalledOnce();
  expect(value.observable.unobserve).toHaveBeenCalledOnce();
});
