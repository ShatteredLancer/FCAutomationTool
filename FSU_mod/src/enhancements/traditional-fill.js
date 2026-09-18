import { contextKey } from '../../../src/fc27/prelaunch-contract.js';
import { previewTraditionalSquad } from '../../../src/fc27/traditional-preview.js';

export function normalizeClubForPreview({ context, snapshot, locks, protectedItemIds }) {
  if (snapshot?.kind !== 'fresh-club-inspection' || snapshot.complete !== true || snapshot.status !== 'provisional'
      || contextKey(snapshot.context, 'scope') !== contextKey(context, 'scope')
      || !Array.isArray(locks?.itemIds) || !Array.isArray(locks?.definitionIds)
      || !Array.isArray(protectedItemIds)) throw new Error('FSU_PREVIEW_INVENTORY_UNVERIFIED');
  return { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', items: snapshot.items.map(item => ({
    ...item, locked: locks.itemIds.includes(item.id) || locks.definitionIds.includes(item.definitionId),
    // Caller-owned explicit protection is independent of EA safety flags and opt-in locks.
    protected: protectedItemIds.includes(item.id),
  })) };
}

// Preparation is deliberately read-only. Installing this module grants no save/submit authority.
export async function prepareTraditionalPreview({ readContext, bridge, getSnapshot, readChallenge }) {
  try {
    const context = readContext();
    const policy = bridge.getPolicy();
    const locks = bridge.getLocks();
    if (!policy || !locks) throw new Error('FSU_POLICY_REVIEW_REQUIRED');
    const signature = JSON.stringify({ context, policy, locks });
    await bridge.refreshClub();
    const challenge = await readChallenge();
    const snapshot = getSnapshot();
    const inventory = normalizeClubForPreview({ context, snapshot, locks, protectedItemIds: [] });
    if (policy.protectActiveSquad && inventory.items.some(item => typeof item.activeSquad !== 'boolean')) {
      throw new Error('FSU_ACTIVE_SQUAD_UNVERIFIED');
    }
    const result = previewTraditionalSquad({ context, challenge, inventory, policy: { ...policy, schema: 1, context, reviewed: true } });
    if (result.status !== 'preview') return result;
    const selected = result.selected.map(ref => snapshot.items.find(item => item.id === ref.id && item.definitionId === ref.definitionId));
    await bridge.validateClubPlayers(selected);
    if (JSON.stringify({ context: readContext(), policy: bridge.getPolicy(), locks: bridge.getLocks() }) !== signature) {
      throw new Error('FSU_PREVIEW_CONTEXT_CHANGED');
    }
    if (JSON.stringify(await readChallenge()) !== JSON.stringify(challenge)) throw new Error('FSU_PREVIEW_CHALLENGE_CHANGED');
    return { ...result, exactValidation: true };
  } catch (error) {
    return { status: 'blocked', reason: /^(FSU|FC27)_[A-Z_]+$/.test(error?.message) ? error.message : 'FSU_PREVIEW_UNAVAILABLE',
      liveExecutionEnabled: false, selected: [] };
  }
}
