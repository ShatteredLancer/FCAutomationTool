import { contextKey, createSeasonContext } from './prelaunch-contract.js';

const keys = ['schema', 'scope', 'operationId', 'setId', 'challengeId', 'itemRefs', 'reward',
  'rewardBaselineCount', 'phase', 'updatedAt', 'submitted'];
const outcomes = Object.freeze({ 'save-pending': false, saved: false, 'submit-pending': null,
  submitted: true, completed: true, rejected: false, abandoned: false });
const transitions = Object.freeze({ 'save-pending': ['saved'], saved: ['submit-pending'],
  'submit-pending': ['submitted', 'rejected'], submitted: ['completed'] });
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = reason => { throw new Error(reason); };

export function traditionalJournalScope(input) {
  try {
    const context = createSeasonContext(input);
    if (context.season !== '27') return fail('FC27_JOURNAL_SCOPE_UNVERIFIED');
    return contextKey(context, 'traditional-sbc-journal');
  } catch { return fail('FC27_JOURNAL_SCOPE_UNVERIFIED'); }
}

function fields(input, names) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Reflect.ownKeys(input).length !== names.length) return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
    return [name, descriptor.value];
  }));
}

// Reject malformed data without truncating it into a plausible terminal record.
export function normalizeTraditionalJournal(scope, input) {
  const schema = Object.getOwnPropertyDescriptor(input ?? {}, 'schema')?.value;
  const value = fields(input, schema === 2 ? [...keys, 'setTimesCompleted'] : keys);
  if (![1, 2].includes(value.schema) || value.schema === 2 && !nonnegative(value.setTimesCompleted)
      || typeof scope !== 'string' || value.scope !== scope
      || typeof value.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.operationId)
      || !positive(value.setId) || !positive(value.challengeId) || !nonnegative(value.updatedAt)
      || typeof value.phase !== 'string' || !Object.hasOwn(outcomes, value.phase) || outcomes[value.phase] !== value.submitted
      || !nonnegative(value.rewardBaselineCount) || !Array.isArray(value.itemRefs)
      || value.itemRefs.length < 1 || value.itemRefs.length > 11
      || Reflect.ownKeys(value.itemRefs).length !== value.itemRefs.length + 1) return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
  value.itemRefs = Array.from({ length: value.itemRefs.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value.itemRefs, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
    const ref = fields(descriptor.value, ['id', 'definitionId', 'pile']);
    if (!positive(ref.id) || !positive(ref.definitionId) || ref.pile !== 'club') return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
    return ref;
  });
  if (new Set(value.itemRefs.map(ref => ref.id)).size !== value.itemRefs.length
      || new Set(value.itemRefs.map(ref => ref.definitionId)).size !== value.itemRefs.length) return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
  value.reward = fields(value.reward, ['scope', 'type', 'value', 'count', 'tradable']);
  const reward = value.reward;
  if (!['set', 'challenge'].includes(reward.scope) || reward.type !== 'pack' || !positive(reward.value)
      || !positive(reward.count) || reward.count > 10 || typeof reward.tradable !== 'boolean') return fail('FC27_JOURNAL_RECORD_UNVERIFIED');
  return value;
}

export function isTerminalTraditionalJournal(record) {
  return ['completed', 'rejected', 'abandoned'].includes(record.phase);
}

export function assessTraditionalRecovery(scope, input, evidence, now = Date.now()) {
  const record = normalizeTraditionalJournal(scope, input);
  if (isTerminalTraditionalJournal(record)) return 'terminal';
  if (record.schema !== 2 || evidence?.fresh !== true || traditionalJournalScope(evidence.context) !== scope
      || !nonnegative(evidence.observedAt) || now < evidence.observedAt || now - evidence.observedAt > 15000
      || evidence.setId !== record.setId || evidence.challengeId !== record.challengeId
      || evidence.packId !== record.reward.value || evidence.unassignedClear !== true
      || !Array.isArray(evidence.present)) return 'unresolved';
  const sorted = values => [...values].sort((a, b) => a.id - b.id);
  if (['save-pending', 'saved'].includes(record.phase) && same(sorted(evidence.present), sorted(record.itemRefs))
      && evidence.setTimesCompleted === record.setTimesCompleted && evidence.packCount === record.rewardBaselineCount) return 'abandoned';
  if (['submit-pending', 'submitted'].includes(record.phase) && evidence.present.length === 0
      && evidence.setTimesCompleted === record.setTimesCompleted + 1
      && evidence.packCount === record.rewardBaselineCount + record.reward.count) return 'completed';
  return 'unresolved';
}

function canAdvance(previous, next) {
  if (!previous) return next.phase === 'save-pending';
  if (next.updatedAt < previous.updatedAt) return false;
  if (isTerminalTraditionalJournal(previous)) {
    return next.operationId !== previous.operationId && next.phase === 'save-pending';
  }
  return transitions[previous.phase]?.includes(next.phase) === true
    && [...keys, 'setTimesCompleted'].filter(key => !['phase', 'updatedAt', 'submitted'].includes(key)).every(key => same(previous[key], next[key]));
}

// Accept the injected GM APIs directly: the legacy storage wrapper masks read failures.
export function createTraditionalJournal({ context, gmGetValue, gmSetValue, hasExclusiveAccess, now = Date.now } = {}) {
  const expectedScope = traditionalJournalScope(context);
  if (typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function') return fail('FC27_JOURNAL_STORAGE_UNAVAILABLE');
  if (typeof hasExclusiveAccess !== 'function') return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  const guard = scope => {
    if (scope !== expectedScope) return fail('FC27_JOURNAL_SCOPE_UNVERIFIED');
    if (hasExclusiveAccess(scope) !== true) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  };
  async function read(scope) {
    guard(scope);
    let raw;
    try { raw = await gmGetValue(expectedScope, null); }
    catch { return fail('FC27_JOURNAL_READ_UNCONFIRMED'); }
    guard(scope);
    if (raw === null) return null;
    try { return normalizeTraditionalJournal(expectedScope, raw); }
    catch { return fail('FC27_RECOVERY_REQUIRED'); }
  }
  async function write(scope, value) {
    guard(scope);
    const next = normalizeTraditionalJournal(expectedScope, value);
    const previous = await read(scope);
    if (!canAdvance(previous, next)) return fail('FC27_JOURNAL_TRANSITION_UNVERIFIED');
    guard(scope);
    try {
      await gmSetValue(expectedScope, globalThis.structuredClone(next));
      if (!same(await read(scope), next)) return fail('FC27_JOURNAL_UNCONFIRMED');
    } catch { return fail('FC27_JOURNAL_UNCONFIRMED'); }
  }
  async function resolve(scope, expected, evidence, approval) {
    guard(scope);
    const previous = await read(scope);
    if (!same(previous, expected) || approval?.approved !== true || approval.operationId !== previous?.operationId) {
      return fail('FC27_RECOVERY_APPROVAL_INVALID');
    }
    const outcome = assessTraditionalRecovery(scope, previous, evidence, now());
    if (!['completed', 'abandoned'].includes(outcome) || approval.outcome !== outcome) return fail('FC27_RECOVERY_REQUIRED');
    const next = normalizeTraditionalJournal(scope, { ...previous, phase: outcome, submitted: outcome === 'completed', updatedAt: now() });
    if (next.updatedAt < previous.updatedAt) return fail('FC27_RECOVERY_REQUIRED');
    guard(scope);
    try {
      await gmSetValue(expectedScope, globalThis.structuredClone(next));
      if (!same(await read(scope), next)) return fail('FC27_JOURNAL_UNCONFIRMED');
    } catch { return fail('FC27_JOURNAL_UNCONFIRMED'); }
    return { status: 'resolved', outcome, submitted: next.submitted };
  }
  return Object.freeze({ read, write, resolve });
}
