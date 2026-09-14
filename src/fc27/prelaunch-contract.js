export const BRIDGE_CAPABILITIES = Object.freeze(['policy', 'locks', 'club', 'targetedValidation']);

// Read own data descriptors only; inspection must never execute model getters.
export function ownData(object, key) {
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
}

function identity(value, field) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 160
      || /[\u0000-\u001f]/.test(value) || /^(default|unknown|null|undefined)$/i.test(value)) {
    throw new TypeError(`${field} is required and must be explicit`);
  }
  return value;
}

export function createSeasonContext(input = {}) {
  const schema = ownData(input, 'schema');
  if (schema !== undefined && schema !== 1) throw new TypeError('Unsupported context schema');
  const season = identity(ownData(input, 'season'), 'season');
  if (!/^\d{2}$/.test(season)) throw new TypeError('season must be a two-digit season');
  return Object.freeze({ schema: 1, season,
    accountScope: identity(ownData(input, 'accountScope'), 'accountScope'),
    platform: identity(ownData(input, 'platform'), 'platform'),
  });
}

export function contextKey(input, name, schema = 1) {
  const context = createSeasonContext(input);
  if (!Number.isSafeInteger(schema) || schema < 1) throw new TypeError('invalid schema');
  return `fcat:${JSON.stringify([schema, context.season, context.accountScope, context.platform, identity(name, 'name')])}`;
}

export function createRunnerBridgeDescriptor(input = {}) {
  const context = createSeasonContext(input);
  const status = ownData(input, 'status') ?? 'not-ready';
  if (!['not-ready', 'loading', 'ready', 'blocked'].includes(status)) throw new TypeError('invalid bridge status');
  const capabilities = {};
  for (const key of BRIDGE_CAPABILITIES) {
    const value = ownData(ownData(input, 'capabilities'), key) ?? false;
    if (typeof value !== 'boolean') throw new TypeError('capability must be boolean');
    capabilities[key] = value;
  }
  if (status === 'ready' && !BRIDGE_CAPABILITIES.every(key => capabilities[key])) {
    throw new TypeError('ready requires all bridge capabilities');
  }
  return Object.freeze({ bridgeSchema: 1, ...context, status, capabilities: Object.freeze(capabilities) });
}

export const OBSERVED_ROOTS = Object.freeze([
  'APP_YEAR_SHORT', 'repositories', 'services', 'UTItemEntity', 'UTSBCService',
  'UTSBCChallengeEntity', 'FSULocalRunnerBridge', 'info',
]);

export function projectInspectionReport(input = {}) {
  const season = ownData(input, 'season');
  const pageKind = ownData(input, 'pageKind');
  const observed = ownData(input, 'observed');
  return {
    schema: 1,
    season: typeof season === 'string' && /^\d{2}$/.test(season) ? season : null,
    pageKind: ['web-app', 'fixture'].includes(pageKind) ? pageKind : 'unsupported',
    observed: Object.fromEntries(OBSERVED_ROOTS.map(key => {
      const state = ownData(observed, key);
      return [key, ['absent', 'data', 'accessor'].includes(state) ? state : 'unknown'];
    })),
    liveExecutionEnabled: false,
    reason: 'FC27_RUNTIME_CONTRACT_UNVERIFIED',
  };
}
