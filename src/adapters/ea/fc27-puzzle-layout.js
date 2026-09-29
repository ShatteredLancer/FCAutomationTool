import { ownData } from '../../fc27/prelaunch-contract.js';

// The same projection is used for the already loaded native editor and the
// save/readback responses. It does not invoke getters or change EA models.
export function projectFc27PuzzleLayout(root, squad, { setId, challengeId }) {
  const fail = () => { throw new Error('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED'); };
  const slots = ownData(squad, '_players');
  const simple = ownData(squad, 'simpleBrickIndices');
  const custom = ownData(squad, 'customBrickIndices');
  if (ownData(ownData(root, 'UTSquadEntity'), 'FIELD_PLAYERS') !== 11
      || !Array.isArray(slots) || slots.length < 11 || slots.length > 32
      || !Array.isArray(simple) || !Array.isArray(custom)) return fail();
  const bricks = [...simple, ...custom];
  if (bricks.length >= 11 || new Set(bricks).size !== bricks.length
      || bricks.some(index => !Number.isInteger(index) || index < 0 || index >= 11)) return fail();
  const ids = Array.from({ length: slots.length }, (_, index) => {
    const slot = ownData(slots, String(index));
    const id = ownData(ownData(slot, '_item'), 'id');
    if (ownData(slot, 'index') !== index || !Number.isSafeInteger(id) || id < -1
        || (index >= 11 || simple.includes(index)) && id > 0) return fail();
    return id;
  });
  const formation = ownData(squad, '_formation');
  const id = ownData(formation, 'id');
  const raw = ownData(formation, 'positions');
  if (!Number.isSafeInteger(id) || id <= 0 || !Array.isArray(raw) || raw.length !== 11) return fail();
  const positions = Array.from({ length: 11 }, (_, index) => ownData(ownData(raw, String(index)), 'typeId'));
  if (positions.some(value => !Number.isInteger(value) || value < 0 || value > 27)) return fail();
  return { status: 'observed', setId, challengeId, slotCount: 11,
    simpleBrickIndices: [...simple], customBrickIndices: [...custom], requiredPlayerCount: 11 - bricks.length,
    formation: { id, positions }, squadEmpty: ids.every(value => value === 0 || value === -1) };
}

export function assertFc27PuzzleLayout(plan, layout) {
  if (layout.setId !== plan.challenge.setId || layout.challengeId !== plan.challenge.id
      || layout.slotCount !== plan.challenge.slotCount || layout.customBrickIndices.length
      || JSON.stringify(layout.simpleBrickIndices) !== JSON.stringify(plan.challenge.brickIndices)
      || JSON.stringify(layout.formation) !== JSON.stringify(plan.challenge.formation)) {
    throw new Error('FC27_PUZZLE_FILL_LAYOUT_CHANGED');
  }
}

// A server squad can remain populated after the native editor was cleared
// locally. Keep an exact, serializable baseline so a subsequent solve may
// replace that squad only when EA has not changed it meanwhile.
export function projectFc27PuzzleSquadBaseline(root, squad, target) {
  projectFc27PuzzleLayout(root, squad, target);
  const slots = ownData(squad, '_players');
  return slots.map((slot, index) => {
    if (ownData(slot, 'index') !== index) throw new Error('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
    const item = ownData(slot, '_item');
    const id = ownData(item, 'id');
    if (!Number.isSafeInteger(id) || id < -1) throw new Error('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
    if (id <= 0) return null;
    const definitionId = ownData(item, 'definitionId');
    const concept = ownData(item, 'concept');
    if (!Number.isSafeInteger(definitionId) || definitionId <= 0 || typeof concept !== 'boolean'
        || concept && id !== definitionId) throw new Error('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
    return { id, definitionId, concept };
  });
}
