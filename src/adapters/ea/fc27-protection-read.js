import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { normalizeStreamlinedProtectionFailure } from '../../streamlined/protection.js';

const at = (root, path) => path.split('.').reduce((v, key) => ownData(v, key), root);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const verifiedActiveSquads = new WeakMap();
const protectionFail = (phase, details = {}) => {
  const error = Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
  error.evidence = normalizeStreamlinedProtectionFailure({ phase, ...details });
  throw error;
};
const ids = (value, max = 20000, phase = 'protection-lock-list') => {
  if (!Array.isArray(value) || value.length > max) protectionFail(phase,
    { mismatch: Array.isArray(value) ? 'length' : value === null ? 'null' : typeof value,
      count: Array.isArray(value) ? value.length : undefined });
  const numbers = Array.from({ length: value.length }, (_, index) => ownData(value, String(index)));
  const badIndex = numbers.findIndex(id => !integer(id));
  if (badIndex >= 0) protectionFail(phase, { count: value.length, offset: badIndex,
    unknownCount: numbers.filter(id => !integer(id)).length,
    mismatch: numbers[badIndex] === null ? 'null' : typeof numbers[badIndex] });
  return [...new Set(numbers.filter(id => id > 0))].sort((a, b) => a - b);
};

// FSU Local lock.save uses exact item IDs. The native active squad supplies
// all 23 slots, not just the starting XI. Never infer "unprotected" from an
// absent list. A native SBC cache eviction may reuse only a previously bound
// roster with the same account/squad and matching FSU roster, never a guess.
export function readFc27StreamlinedProtection(root) {
  const context = readFc27Context(root), lockedItemIds = ids(at(root, 'info.lock'));
  const activeSquadId = at(root, 'services.Squad.activeSquad');
  // EA accepts numeric squad IDs including 0. The service also initializes
  // this field to 0, so zero alone is not readiness: require the matching
  // native entity's active flag and the full roster below before binding it.
  if (!integer(activeSquadId)) protectionFail('protection-active-id', { mismatch: typeof activeSquadId === 'number'
    ? !Number.isFinite(activeSquadId) ? 'non-finite' : activeSquadId < 0 ? 'negative' : 'non-integer'
    : typeof activeSquadId });
  const userId = at(root, 'services.User.currentUserId');
  const personaId = at(root, `services.User.repository._collection.${userId}.selectedPersona`);
  const squad = at(root, `repositories.Squad.squads._collection.${personaId}._collection.${activeSquadId}`);
  const slots = ownData(squad, '_players'), total = ownData(ownData(root, 'UTSquadEntity'), 'TOTAL_PLAYERS');
  const fsuRoster = at(root, 'info.squad');
  let activeSquadItemIds;
  if (squad !== undefined) {
    if (ownData(squad, '_id') !== activeSquadId) protectionFail('protection-native-id', { mismatch: 'id-mismatch' });
    if (activeSquadId === 0 && ownData(squad, '_isActive') !== true) protectionFail('protection-active-state',
      { mismatch: ownData(squad, '_isActive') === false ? 'inactive' : typeof ownData(squad, '_isActive') });
    if (!integer(total, 11, 100)) protectionFail('protection-layout', { mismatch: typeof total });
    if (!Array.isArray(slots) || slots.length !== total) protectionFail('protection-slot-list',
      { mismatch: Array.isArray(slots) ? 'length' : 'non-array', count: Array.isArray(slots) ? slots.length : undefined, requiredSlots: total });
    activeSquadItemIds = ids(Array.from({ length: slots.length }, (_, index) =>
      ownData(ownData(ownData(slots, String(index)), '_item'), 'id')), 100, 'protection-slot-id');
    // Keep FSU's last known members protected too if the native cache has
    // just updated; a stale protection list may overprotect, never expose.
    const fsuIds = fsuRoster === undefined ? [] : ids(fsuRoster, 100, 'protection-fsu-roster');
    verifiedActiveSquads.set(root, { context, activeSquadId, activeSquadItemIds, fsuIds });
    activeSquadItemIds = [...new Set([...activeSquadItemIds, ...fsuIds])].sort((a, b) => a - b);
  } else {
    const previous = verifiedActiveSquads.get(root), fsuIds = ids(fsuRoster, 100, 'protection-fsu-roster');
    if (!previous || !same(previous.context, context) || previous.activeSquadId !== activeSquadId
        || !same(previous.fsuIds, fsuIds)) protectionFail('protection-cache', { cached: !!previous, mismatch: 'binding' });
    activeSquadItemIds = [...new Set([...previous.activeSquadItemIds, ...fsuIds])].sort((a, b) => a - b);
  }
  return { lockedItemIds, activeSquadId, activeSquadItemIds };
}
