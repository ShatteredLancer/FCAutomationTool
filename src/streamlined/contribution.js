import { integer, fail, deepFreeze, same } from './contract.js';

// Durable projection only; never persist a raw DTO or account/objective data.
export function projectStreamlinedReceipt(receipt, { challengeId, setId, previousScore, itemIds, maxScore }) {
  if (receipt?.schema !== 1 || receipt.status !== 'accepted' || receipt.challengeId !== challengeId
      || receipt.setId !== setId || !same(receipt.itemIds, itemIds)
      || !integer(receipt.submittedScore, previousScore + 1, maxScore)
      || receipt.code !== null && !integer(receipt.code, 100, 599)
      || typeof receipt.transportWarning !== 'boolean' || typeof receipt.challengeCompleted !== 'boolean'
      || !integer(receipt.challengeAwardCount, 0, 100) || !integer(receipt.setAwardCount, 0, 100)
      || receipt.challengeCompleted !== (receipt.challengeAwardCount > 0 || receipt.setAwardCount > 0)
      || receipt.previousTimesCompleted !== undefined && !integer(receipt.previousTimesCompleted)
      || typeof receipt.objectiveUpdatesPresent !== 'boolean' || receipt.rewardConfirmed !== false) fail('RECEIPT_INVALID');
  return deepFreeze({ schema: 1, status: 'accepted', code: receipt.code, transportWarning: receipt.transportWarning,
    setId, challengeId, itemIds: [...itemIds], submittedScore: receipt.submittedScore,
    ...(receipt.previousTimesCompleted !== undefined ? { previousTimesCompleted: receipt.previousTimesCompleted } : {}),
    challengeCompleted: receipt.challengeCompleted, challengeAwardCount: receipt.challengeAwardCount,
    setAwardCount: receipt.setAwardCount, objectiveUpdatesPresent: receipt.objectiveUpdatesPresent, rewardConfirmed: false });
}

// The raw DAO response does NOT contain challengeCompleted/setCompleted.
// EA derives challenge completion from non-empty granted awards, then mutates
// repeat progress in _updateSbcProgress. Keep the receipt score independent of
// the subsequently reset model. No reward is claimed by this projection.
export function normalizeStreamlinedContributionReply(reply = {}, expected = {}) {
  if (!integer(expected.challengeId, 1) || !integer(expected.setId, 1)
      || !integer(expected.previousScore, 0, 1e9) || !Array.isArray(expected.itemIds)
      || !expected.itemIds.length || new Set(expected.itemIds).size !== expected.itemIds.length
      || expected.itemIds.some(id => !integer(id, 1))) fail('CONTRIBUTION_INPUT_INVALID');
  const response = reply?.response, code = integer(reply?.status, 100, 599) ? reply.status : null;
  // Native _applyOneClickSubmission uses ?? [] for each award list. A partial
  // contribution observed on 2026-10-07 advanced 0 -> 20 without award arrays.
  // Only nullish values get this default; malformed non-null data stays unknown.
  const challengeAwards = response?.grantedChallengeAwards ?? [], setAwards = response?.grantedSetAwards ?? [];
  const unknown = reason => deepFreeze({ status: 'unknown', reason, code });
  const conflict = Array.isArray(response?.squads) && response.squads.length > 0;
  const hasProgress = integer(response?.submittedScore, expected.previousScore + 1, 1e9);
  // A contradictory error with commit evidence must not become retryable.
  if (reply?.success === false || conflict) {
    if (hasProgress) return unknown('EA_CONTRIBUTION_RESPONSE_CONFLICT');
    if (reply?.success === false && [400, 401, 403, 404, 409, 429].includes(code) || conflict && code === 200) {
      return deepFreeze({ status: 'rejected', reason: conflict ? 'EA_SQUAD_CONFLICT' : 'EA_CONTRIBUTION_REJECTED', code });
    }
    return unknown('EA_CONTRIBUTION_RESPONSE_UNVERIFIED');
  }
  if (reply?.success !== true || response?.challengeId !== expected.challengeId || response?.setId !== expected.setId
      || !hasProgress || response.squads !== undefined || !Array.isArray(challengeAwards)
      || !Array.isArray(setAwards)
      || [challengeAwards, setAwards].some(rows => rows.length > 100
        || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
    return unknown('EA_CONTRIBUTION_RESPONSE_UNVERIFIED');
  }
  return deepFreeze({ schema: 1, status: 'accepted', code, transportWarning: code !== 200,
    setId: expected.setId, challengeId: expected.challengeId, itemIds: [...expected.itemIds],
    submittedScore: response.submittedScore,
    ...(integer(expected.previousTimesCompleted) ? { previousTimesCompleted: expected.previousTimesCompleted } : {}),
    challengeCompleted: challengeAwards.length > 0 || setAwards.length > 0,
    challengeAwardCount: challengeAwards.length, setAwardCount: setAwards.length,
    // Raw dynamicObjectivesUpdates and transformed objectiveUpdates stay out of
    // the Journal. Presence is observational, not proof of reward delivery.
    objectiveUpdatesPresent: response.dynamicObjectivesUpdates != null || response.objectiveUpdates != null,
    rewardConfirmed: false });
}
