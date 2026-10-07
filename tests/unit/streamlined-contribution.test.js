import { expect, it } from 'vitest';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import partial from '../fixtures/streamlined-native-partial-contribution.json';

const expected = { challengeId: 85, setId: 48, previousScore: 0, itemIds: [11, 12] };
const response = overrides => ({ success: true, status: 200, response: {
  challengeId: 85, setId: 48, submittedScore: 6750, grantedChallengeAwards: [], grantedSetAwards: [],
  ...overrides } });

it('accepts the complete native response contract', () => {
  expect(normalizeStreamlinedContributionReply(response(), expected)).toMatchObject({ status: 'accepted', submittedScore: 6750 });
});
it('rejects explicit EA errors and conflicts without treating them as success', () => {
  for (const reply of [{ success: false, status: 409, response: {} }, { success: false, status: 429, response: {} },
    response({ submittedScore: undefined, squads: [{ squad: 'ACTIVE_SQUAD', playerList: [11] }] })]) {
    expect(normalizeStreamlinedContributionReply(reply, expected).status).toBe('rejected');
  }
});
it('keeps unknown for missing identity/progress, malformed awards or squad conflict shapes', () => {
  for (const patch of [{ challengeId: 84 }, { submittedScore: 0 }, { grantedSetAwards: {} }, { squads: [] }]) {
    expect(normalizeStreamlinedContributionReply(response(patch), expected).status).toBe('unknown');
  }
});
it('accepts absent/null rewards on a real partial contribution just as native EA does', () => {
  for (const fields of [{}, { grantedChallengeAwards: null, grantedSetAwards: null },
    { grantedChallengeAwards: [], grantedSetAwards: null }]) {
    expect(normalizeStreamlinedContributionReply({ ...partial.reply, response: { ...partial.reply.response, ...fields } }, partial.expected))
      .toMatchObject({ status: 'accepted', submittedScore: 20, challengeCompleted: false,
        challengeAwardCount: 0, setAwardCount: 0, rewardConfirmed: false });
  }
});
it('derives completion from awards just like EA, without mistaking a reset model score for the receipt', () => {
  expect(normalizeStreamlinedContributionReply(response(), expected)).toMatchObject({ challengeCompleted: false });
  expect(normalizeStreamlinedContributionReply(response({ grantedSetAwards: [{ type: 'pack', value: 1 }] }), expected))
    .toMatchObject({ challengeCompleted: true, setAwardCount: 1, submittedScore: 6750, rewardConfirmed: false });
});
it('retains complete commit evidence with a transport warning but never retries contradictory results', () => {
  expect(normalizeStreamlinedContributionReply({ ...response(), status: 500 }, expected))
    .toMatchObject({ status: 'accepted', transportWarning: true });
  expect(normalizeStreamlinedContributionReply({ ...response(), success: false, status: 409 }, expected).status).toBe('unknown');
  expect(normalizeStreamlinedContributionReply({ success: false, status: 500 }, expected).status).toBe('unknown');
});

it('binds a verified pre-dispatch completion counter without inferring it from the response', () => {
  const reply = normalizeStreamlinedContributionReply(response(), { ...expected, previousTimesCompleted: 3 });
  expect(reply.previousTimesCompleted).toBe(3);
  expect(normalizeStreamlinedContributionReply(response(), expected).previousTimesCompleted).toBeUndefined();
});
