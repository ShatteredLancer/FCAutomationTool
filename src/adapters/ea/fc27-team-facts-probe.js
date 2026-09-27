// Development-only descriptor inventory. Presence/hash is not permission to
// execute a method. No EA function, constructor, accessor or service is called.
const PATHS = [
  'factories.Squad', 'factories.Item', 'repositories.Squad',
  'UTSquadEntity.prototype', 'UTSquadSlotEntity.prototype',
  'UTSBCChallengeEntity.prototype', 'UTSBCEligibilityDTO.prototype',
  'UTSquadChemCalculatorUtils.prototype', 'UTSquadParameterChemistryVO.prototype',
  'UTSquadChemistryVO.prototype', 'UTChemistryService.prototype',
];
const METHOD_CHECKS = {
  'factories.Squad': ['createSBCSquad'],
  'factories.Item': ['createItem'],
};

function data(value, key) {
  try {
    const descriptor = value == null ? null : Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

export async function probeFc27TeamFactsRuntime(root = globalThis) {
  const report = { status: 'unverified', reason: 'FC27_EA_TEAM_FACTS_UNVERIFIED',
    liveExecutionEnabled: false, executable: false, invoked: false, targets: [],
    limitations: ['DESCRIPTORS_ONLY', 'NO_DIFFERENTIAL_PERFORMED', 'NO_EXECUTION_AUTHORIZATION'] };
  if (![27, '27'].includes(data(root, 'APP_YEAR_SHORT'))) return { ...report, reason: 'FC27_WEB_APP_REQUIRED' };
  const pending = [];
  for (const path of PATHS) {
    let value = root;
    for (const key of path.split('.')) value = data(value, key);
    const target = { path, present: value != null, truncated: false, methods: [] };
    report.targets.push(target);
    if (value == null) continue;
    try {
      for (const name of METHOD_CHECKS[path] ?? []) {
        let owner = value; let found = null;
        for (let depth = 0; owner && depth < 5; depth++, owner = Object.getPrototypeOf(owner)) {
          const descriptor = Object.getOwnPropertyDescriptor(owner, name);
          if (descriptor) { found = descriptor; break; }
        }
        if (!found || !Object.hasOwn(found, 'value') || typeof found.value !== 'function') continue;
        const entry = { name, kind: 'function', arity: data(found.value, 'length'), sha256: null };
        target.methods.push(entry); pending.push({ fn: found.value, entry });
      }
      const keys = Object.getOwnPropertyNames(value);
      if (keys.length > 256) { target.truncated = true; continue; }
      for (const key of keys) {
        if (key === 'constructor' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(descriptor, 'value')) target.methods.push({ name: key, kind: 'accessor', arity: null, sha256: null });
        else if (typeof descriptor.value === 'function') {
          const arity = data(descriptor.value, 'length');
          const entry = { name: key, kind: 'function', arity: Number.isSafeInteger(arity) && arity >= 0 && arity <= 100 ? arity : null, sha256: null };
          target.methods.push(entry); pending.push({ fn: descriptor.value, entry });
        }
      }
    } catch { target.truncated = true; }
  }
  for (const { fn, entry } of pending) {
    try {
      const source = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
      if (source.length > 65536 || !globalThis.crypto?.subtle || !globalThis.TextEncoder) continue;
      const bytes = await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source));
      entry.sha256 = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { /* Unknown hash remains unapproved. */ }
  }
  return report;
}
