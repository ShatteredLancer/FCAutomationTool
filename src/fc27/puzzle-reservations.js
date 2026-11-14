export const puzzleReservationKey = scope => `fcat-fc27-puzzle-reservations:${scope}`;
const validReservationId = value => Number.isSafeInteger(value) && value > 0;
const reservationTarget = value => Number.isSafeInteger(value) && value > 0;
export const readPuzzleReservations = async (get, scope) => {
  const value = await get(puzzleReservationKey(scope), null);
  if (value === null) return { schema: 1, targets: [] };
  if (!value || value.schema !== 1 || !Array.isArray(value.targets) || value.targets.length > 100) {
    throw new Error('FC27_PUZZLE_RESERVATION_UNVERIFIED');
  }
  const targets = value.targets.map(entry => {
    if (!reservationTarget(entry?.setId) || !reservationTarget(entry?.challengeId)
        || !Array.isArray(entry.itemRefs) || entry.itemRefs.length > 11
        || entry.itemRefs.some(ref => !validReservationId(ref?.id) || !validReservationId(ref?.definitionId))) {
      throw new Error('FC27_PUZZLE_RESERVATION_UNVERIFIED');
    }
    return { setId: entry.setId, challengeId: entry.challengeId,
      itemRefs: entry.itemRefs.map(ref => ({ id: ref.id, definitionId: ref.definitionId })) };
  });
  return { schema: 1, targets };
};
