import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectInProgressSquad } from '../../src/adapters/ea/fc27-sbc-read.js';

const reviewedHash = '04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e';
function fixture() {
  const squad = { simpleBrickIndices: [0, 1, 2, 3, 4, 5, 6, 9, 10], customBrickIndices: [] };
  const challenge = { id: 2, setId: 1, status: 'IN_PROGRESS' };
  const dao = { loadChallenge: vi.fn(() => ({ observe: (_owner, callback) => {
    callback({ unobserve: vi.fn() }, { success: true, status: 200, response: { squad } });
  } })) };
  const root = { APP_YEAR_SHORT: 27, UTSquadEntity: { FIELD_PLAYERS: 11 },
    SBCChallengeStatus: { IN_PROGRESS: 'IN_PROGRESS' },
    services: { SBC: { sbcDAO: dao, repository: { sets: { _collection: {
      1: { id: 1, challenges: [challenge] },
    } } } } },
    crypto: { subtle: { digest: vi.fn(async () => Uint8Array.from(Buffer.from(reviewedHash, 'hex')).buffer) } } };
  root.services.User = { currentUserId: 9, repository: { _collection: { 9: {
    id: 9, selectedPersona: 8, _personas: { _collection: { 8: {
      id: 8, _sku: 'test-27', clubs: { _collection: { 'test-27': { sku: 'test-27', year: 2027, platform: 'PSN' } } },
    } } },
  } } } };
  return { root, dao, squad, challenge };
}

it('only forces the reviewed GET branch for the exact in-progress challenge, without changing its squad', async () => {
  const { root, dao, challenge } = fixture();
  const result = await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root);
  expect(dao.loadChallenge).toHaveBeenCalledExactlyOnceWith(2, true);
  expect(result).toMatchObject({ status: 'observed', reason: 'IN_PROGRESS_SQUAD_READ', liveExecutionEnabled: false,
    setId: 1, challengeId: 2, slotCount: 11, requiredPlayerCount: 2,
    simpleBrickIndices: [0, 1, 2, 3, 4, 5, 6, 9, 10], customBrickIndices: [] });
  expect(challenge.squad).toBeUndefined();
});

it.each(['NOT_STARTED', 'COMPLETED', undefined])('never initializes or reopens status %s', async status => {
  const { root, dao, challenge } = fixture();
  challenge.status = status;
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).status).toBe('blocked');
  expect(dao.loadChallenge).not.toHaveBeenCalled();
});

it('rejects changed method source and missing crypto before calling the DAO', async () => {
  const { root, dao } = fixture();
  root.crypto.subtle.digest.mockResolvedValue(new Uint8Array(32).buffer);
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).reason).toBe('DAO_IMPLEMENTATION_UNREVIEWED');
  delete root.crypto;
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).status).toBe('blocked');
  expect(dao.loadChallenge).not.toHaveBeenCalled();
});

it('rechecks challenge identity after the asynchronous source check', async () => {
  const { root, dao, challenge } = fixture();
  root.crypto.subtle.digest.mockImplementation(async () => {
    challenge.status = 'NOT_STARTED';
    return Uint8Array.from(Buffer.from(reviewedHash, 'hex')).buffer;
  });
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).reason).toBe('CHALLENGE_CHANGED');
  expect(dao.loadChallenge).not.toHaveBeenCalled();
});

it('refuses ambiguous identities, another season and unknown brick layouts', async () => {
  const { root, dao, squad, challenge } = fixture();
  root.services.SBC.repository.sets._collection[1].challenges.push({ ...challenge });
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).status).toBe('blocked');
  expect(dao.loadChallenge).not.toHaveBeenCalled();
  root.services.SBC.repository.sets._collection[1].challenges.pop();
  root.APP_YEAR_SHORT = 26;
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).status).toBe('blocked');
  root.APP_YEAR_SHORT = 27;
  squad.customBrickIndices = [0];
  expect((await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).reason).toBe('SLOT_LAYOUT_UNVERIFIED');
});

it('rejects transport errors without leaking the response or retrying', async () => {
  const { root, dao } = fixture();
  dao.loadChallenge.mockReturnValue({ observe: (_owner, callback) => callback({ unobserve() {} },
    { success: false, status: 500, response: { privateAccount: 'secret' } }) });
  const result = await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root);
  expect(result.reason).toBe('SQUAD_READ_UNCONFIRMED');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(dao.loadChallenge).toHaveBeenCalledTimes(1);
});

it('bounds waiting, removes the observer, and does not retry a timeout', async () => {
  vi.useFakeTimers();
  try {
    const { root, dao } = fixture();
    const unobserve = vi.fn();
    dao.loadChallenge.mockReturnValue({ observe() {}, unobserve });
    const pending = inspectInProgressSquad({ setId: 1, challengeId: 2 }, root);
    await vi.runAllTimersAsync();
    expect((await pending).reason).toBe('SQUAD_READ_TIMEOUT');
    expect(unobserve).toHaveBeenCalledTimes(1);
    expect(dao.loadChallenge).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('rejects a selected account change during a pending read', async () => {
  const { root, dao } = fixture();
  let respond;
  dao.loadChallenge.mockReturnValue({ observe: (_owner, callback) => { respond = callback; }, unobserve() {} });
  const pending = inspectInProgressSquad({ setId: 1, challengeId: 2 }, root);
  await Promise.resolve();
  root.services.User.currentUserId = 10;
  respond(null, { success: true, status: 200 });
  expect((await pending).reason).toBe('CHALLENGE_CHANGED');
});

it('replays the actual A Brace brick layout from the reviewed GET response', async () => {
  const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-in-progress-squad.json', import.meta.url), 'utf8'));
  const { root, squad } = fixture();
  squad.simpleBrickIndices = observed.simpleBrickIndices;
  squad.customBrickIndices = observed.customBrickIndices;
  expect(await inspectInProgressSquad({ setId: 1, challengeId: 2 }, root)).toMatchObject({
    status: 'observed', slotCount: 11, requiredPlayerCount: 2, simpleBrickIndices: observed.simpleBrickIndices,
  });
});
