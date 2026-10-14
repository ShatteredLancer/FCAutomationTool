import { ownData } from '../fc27/prelaunch-contract.js';

const phases = new Set(['protection-lock-list', 'protection-active-id', 'protection-native-id',
  'protection-layout', 'protection-slot-list', 'protection-slot-id', 'protection-fsu-roster', 'protection-cache']);
const mismatches = new Set(['undefined', 'null', 'boolean', 'number', 'string', 'object', 'function',
  'symbol', 'bigint', 'non-array', 'length', 'binding', 'id-mismatch', 'layout']);

// Diagnostic/display evidence only. No identities, raw objects or arbitrary
// strings can enter a planning result or the persisted diagnostic log here.
export function normalizeStreamlinedProtectionFailure(value) {
  const phase = ownData(value, 'phase');
  if (!phases.has(phase)) return null;
  const result = { phase };
  for (const key of ['count', 'requiredSlots', 'unknownCount', 'offset']) {
    const number = ownData(value, key);
    if (Number.isSafeInteger(number) && number >= 0 && number <= 20000) result[key] = number;
  }
  const mismatch = ownData(value, 'mismatch'), cached = ownData(value, 'cached');
  if (mismatches.has(mismatch)) result.mismatch = mismatch;
  if (typeof cached === 'boolean') result.cached = cached;
  return Object.freeze(result);
}
