// Local isolation is a user decision, never evidence of an EA outcome.
export const marketUnresolved = entry => ['pending', 'isolated'].includes(entry.phase);
export const marketIsolated = (state, taskId = null) => state.intents.filter(i => i.phase === 'isolated' && (taskId === null || i.taskId === taskId));
export const marketRecoveryBlocks = (state, command) => marketIsolated(state).some(i =>
  i.taskId === command.taskId || i.itemId === command.itemId
  || ['buy','bid'].includes(i.kind) && i.definitionId === command.definitionId);

export function validateMarketIsolation(entry) {
  const proof=entry.isolation;
  if (!proof || Object.keys(proof).some(k=>!['at','source','handledAt'].includes(k)) || proof.source!=='user'
    || !Number.isSafeInteger(proof.at) || proof.at<entry.at+60000
    || proof.handledAt!==undefined && (!Number.isSafeInteger(proof.handledAt)||proof.handledAt<proof.at)) throw Error('MARKET_RECOVERY_INVALID');
}

export function isolateMarketIntent(state, {requestId, at}) {
  const entry=state.intents.find(i=>i.id===requestId);
  if (!entry || entry.phase!=='pending') throw Error('MARKET_RECOVERY_CHANGED');
  const isolation={at,source:'user'};validateMarketIsolation({...entry,isolation});
  // Never change receipt, acknowledgement, amount, holdings or global stop.
  entry.phase='isolated';entry.isolation=isolation;
}

export function markMarketManuallyHandled(state, {requestId, at}) {
  const entry=state.intents.find(i=>i.id===requestId);
  if(!entry||entry.phase!=='isolated')throw Error('MARKET_RECOVERY_CHANGED');
  const isolation={...entry.isolation,handledAt:at};validateMarketIsolation({...entry,isolation});
  entry.isolation=isolation;
}
