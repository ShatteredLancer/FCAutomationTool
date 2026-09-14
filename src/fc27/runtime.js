import { createRunnerBridgeDescriptor, createSeasonContext, ownData } from './prelaunch-contract.js';

export function inspectPrelaunchRuntime({ context, bridge } = {}) {
  let verified;
  try { verified = createSeasonContext(context); } catch {
    return Object.freeze({ status: 'not-ready', reason: 'CONTEXT_UNAVAILABLE', liveExecutionEnabled: false });
  }
  if (verified.season !== '27') return Object.freeze({ status: 'blocked', reason: 'UNSUPPORTED_SEASON', liveExecutionEnabled: false });
  let descriptor;
  try {
    const describe = ownData(bridge, 'describe');
    if (typeof describe !== 'function') throw new Error('Missing bridge descriptor');
    const raw = describe.call(bridge);
    if (ownData(raw, 'bridgeSchema') !== 1) throw new Error('Unknown bridge schema');
    descriptor = createRunnerBridgeDescriptor(raw);
  } catch {
    return Object.freeze({ status: 'not-ready', reason: 'FSU_BRIDGE_UNAVAILABLE', liveExecutionEnabled: false });
  }
  const sameScope = ['season', 'accountScope', 'platform'].every(key => descriptor[key] === verified[key]);
  return Object.freeze({
    status: sameScope ? 'not-ready' : 'blocked',
    reason: !sameScope ? 'FSU_SCOPE_MISMATCH' : descriptor.status !== 'ready'
      ? 'FSU_BRIDGE_NOT_READY' : 'FC27_RUNTIME_CONTRACT_UNVERIFIED',
    liveExecutionEnabled: false,
  });
}
