import { afterEach, expect, it, vi } from 'vitest';
import { readFc27SbcContract, inspectFc27SbcContract } from '../../src/adapters/ea/fc27-sbc-contract.js';
import { inspectInProgressSquad } from '../../src/adapters/ea/fc27-sbc-read.js';

vi.mock('../../src/adapters/ea/fc27-sbc-read.js', () => ({ inspectInProgressSquad: vi.fn() }));
const hashes = {
  getSets: '17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c',
  getChallengesForSet: '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693',
  saveChallenge: '5273c0f32805c49e91ca26e924a442048dcc5bc763d979c34c0919793a02d851',
  submitChallenge: '38539de9ad8d2aad8e429029f2cfc87539dc91ef662c0a892dcec5c67220afef',
};
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const club = { sku: 'test-27', year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 901, selectedPersona: 902, _personas: { _collection: { 902: persona } } };
  const set = { id: 4, name: 'Synthetic upgrade', challengesCount: 1, challengesCompletedCount: 0,
    timesCompleted: 0, repeats: 0, repeatabilityMode: 'UNLIMITED', startTime: 0, endTime: 0,
    awards: [{ type: 'pack', value: 509, count: 1, tradable: false }] };
  const challenge = { id: 16, setId: 4, name: set.name, status: 'IN_PROGRESS', type: 'OPEN_CHALLENGE',
    eligibilityOperation: 'AND', eligibilityRequirements: [{ count: -1, scope: 2, kvPairs: { _collection: { 3: [1] } } }], awards: [] };
  const replies = {
    getSets: { success: true, status: 200, response: { sets: [set] } },
    getChallengesForSet: { success: true, status: 200, response: { challenges: [challenge] } },
  };
  const forbidden = vi.fn(() => { throw new Error('private write failure'); });
  const observables = Object.fromEntries(Object.keys(replies).map(name => [name, {
    observe: vi.fn((owner, cb) => cb(null, replies[name])), unobserve: vi.fn(),
  }]));
  const dao = { getSets: vi.fn(() => observables.getSets),
    getChallengesForSet: vi.fn(() => observables.getChallengesForSet), saveChallenge: forbidden, submitChallenge: forbidden };
  let index = 0;
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    crypto: { subtle: { digest: vi.fn(async () => Uint8Array.from(Buffer.from(Object.values(hashes)[index++], 'hex')).buffer) } },
    services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } },
      SBC: { sbcDAO: dao, repository: { sets: { _collection: { 4: { id: 4, awards: [] } } } } } },
    SBCEligibilityKey: { PLAYER_MIN_OVR: 26, PLAYER_MAX_OVR: 28, PLAYER_QUALITY: 3 },
    SBCEligibilityScope: { GREATER: 0, EXACT: 2 }, SBCEligibilityQualityType: { BRONZE: 1, SILVER: 2, GOLD: 3 },
  };
  inspectInProgressSquad.mockResolvedValue({ status: 'observed', setId: 4, challengeId: 16, slotCount: 11,
    simpleBrickIndices: [], customBrickIndices: [], requiredPlayerCount: 11 });
  return { root, set, challenge, dao, forbidden, replies, observables };
}
async function read(value, inspect = false) {
  const pending = (inspect ? inspectFc27SbcContract : readFc27SbcContract)(value.root, { setId: 4 });
  await vi.advanceTimersByTimeAsync(2000);
  return pending;
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('reads fresh set and challenge responses, not cached awards, and only GETs an in-progress squad', async () => {
  const value = fixture();
  const cached = JSON.stringify(value.root.services.SBC.repository);
  const result = await read(value);
  expect(result).toMatchObject({ status: 'observed', liveExecutionEnabled: false, contract: {
    schema: 1, source: 'fresh-dao', context: { season: '27' },
    set: { id: 4, challengesCount: 1 }, challenge: { id: 16, setId: 4, mechanism: 'traditional' },
    rewards: [{ scope: 'set', type: 'pack', value: 509, count: 1, tradable: false }],
  }, methods: { saveChallenge: true, submitChallenge: true }, writeContractVerified: false });
  expect(value.dao.getSets).toHaveBeenCalledExactlyOnceWith();
  expect(value.dao.getChallengesForSet).toHaveBeenCalledExactlyOnceWith(4);
  expect(value.forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(value.root.services.SBC.repository)).toBe(cached);
});

it('exports bounded public diagnostics without account context', async () => {
  const result = await read(fixture(), true);
  expect(result.contract.context).toBeUndefined();
  expect(result.contract.challenge.context).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(/\b(?:901|902)\b|accountScope|test-27/);
});

it.each([304, 401, 429, 500])('stops on set HTTP %s without requesting challenges or retrying', async status => {
  const value = fixture(); value.replies.getSets.status = status;
  expect((await read(value)).reason).toBe('FC27_CONTRACT_READ_UNCONFIRMED');
  expect(value.dao.getChallengesForSet).not.toHaveBeenCalled();
  expect(value.dao.getSets).toHaveBeenCalledOnce();
});

it('blocks unreviewed read methods before any network operation', async () => {
  const value = fixture(); value.root.crypto.subtle.digest.mockResolvedValue(new Uint8Array(32).buffer);
  expect((await read(value)).reason).toBe('FC27_CONTRACT_READ_METHOD_UNREVIEWED');
  expect(value.dao.getSets).not.toHaveBeenCalled();
});

it('reports unreviewed write methods without executing them or claiming Live readiness', async () => {
  const value = fixture(); delete value.dao.submitChallenge;
  expect(await read(value)).toMatchObject({ status: 'observed', methods: { submitChallenge: false }, writeContractVerified: false });
  expect(value.forbidden).not.toHaveBeenCalled();
});

it.each(['missing', 'duplicate', 'multiple', 'not-started', 'unknown-award'])('rejects %s targets without an editor or mutation', async kind => {
  const value = fixture();
  if (kind === 'missing') value.replies.getSets.response.sets = [];
  if (kind === 'duplicate') value.replies.getSets.response.sets.push(value.set);
  if (kind === 'multiple') value.set.challengesCount = 2;
  if (kind === 'not-started') value.challenge.status = 'NOT_STARTED';
  if (kind === 'unknown-award') delete value.set.awards;
  expect((await read(value)).status).toBe('blocked');
  expect(value.forbidden).not.toHaveBeenCalled();
  expect(inspectInProgressSquad).not.toHaveBeenCalled();
});

it('rejects method/context changes across requests', async () => {
  const value = fixture();
  value.observables.getSets.observe.mockImplementation((owner, cb) => {
    value.root.services.User.currentUserId = 999; cb(null, value.replies.getSets);
  });
  expect((await read(value)).reason).toBe('FC27_CONTRACT_CONTEXT_CHANGED');
  expect(value.dao.getChallengesForSet).not.toHaveBeenCalled();
});

it('times out once and ignores late replies without touching another observer', async () => {
  const value = fixture(); let callback;
  value.observables.getSets.observe.mockImplementation((owner, cb) => { callback = cb; });
  const pending = readFc27SbcContract(value.root, { setId: 4 });
  await vi.advanceTimersByTimeAsync(16000);
  expect((await pending).reason).toBe('FC27_CONTRACT_READ_TIMEOUT');
  callback(null, value.replies.getSets);
  expect(value.observables.getSets.unobserve).toHaveBeenCalledOnce();
  expect(value.dao.getChallengesForSet).not.toHaveBeenCalled();
});
