import { createRunnerSupportCore } from './core.js';
import { readFc27CachedClub, readFc27Context } from '../../../src/adapters/ea/fc27-local-read.js';
import { createFc27ClubReadTransport } from '../../../src/adapters/ea/fc27-club-read.js';
import { createClubInspectionInventory } from './club-inventory.js';
import { ownData } from '../../../src/fc27/prelaunch-contract.js';

function createNativeClubInventory(root) {
  let transport;
  const getTransport = () => transport ??= createFc27ClubReadTransport(root);
  const inventory = createClubInspectionInventory({ readContext: () => readFc27Context(root),
    readCount: async () => (await getTransport()).readCount(),
    readPage: async query => (await getTransport()).readPage(query) });
  return { inventory, getRequestCount: async () => transport ? (await transport).getRequestCount() : 0 };
}

// GM_getValue must come from the FSU userscript sandbox, never page localStorage.
export function createNativeRunnerSupport({ root, gmGetValue }) {
  if (typeof gmGetValue !== 'function') throw new TypeError('FSU_GM_PROVIDER_REQUIRED');
  const readContext = () => readFc27Context(root);
  const storage = { get: key => {
    const value = gmGetValue(key, null);
    if (value !== null && typeof value !== 'string') throw new TypeError('FSU_SYNC_GM_VALUE_REQUIRED');
    return value;
  } };
  const { inventory } = createNativeClubInventory(root);
  const bridge = createRunnerSupportCore({ readContext, storage, inventory });
  return Object.freeze({ bridge, getFreshClub: () => inventory.getSnapshot(), readCachedClub: () => readFc27CachedClub(root),
    readFreshClub: async () => {
      await inventory.refreshClub();
      return inventory.getSnapshot();
    } });
}

// Explicit diagnostic command, separate from passive cache inspection. Revalidates
// at most two fresh refs in memory and exports no IDs, payloads or policy approvals.
export async function inspectFreshNativeClub(root) {
  let phase = 'refresh';
  try {
    const { inventory, getRequestCount } = createNativeClubInventory(root);
    await inventory.refreshClub();
    const snapshot = inventory.getSnapshot();
    const refs = snapshot.items.slice(0, 2);
    phase = 'targeted-validation';
    if (refs.length) await inventory.validateClubPlayers(refs);
    return { status: 'observed', reason: 'FRESH_CLUB_INSPECTED', inventoryStatus: snapshot.status,
      complete: true, players: snapshot.items.length, expectedPlayers: snapshot.expectedCount,
      targetedCount: refs.length, targetedValidationVerified: refs.length > 0,
      requests: await getRequestCount(),
      marketAverageKnown: snapshot.items.filter(item => item.marketAverage !== null).length,
      safety: { knownRatings: snapshot.items.filter(item => item.rating !== null).length,
        knownActiveTrade: snapshot.items.filter(item => item.activeTrade !== null).length,
        knownRarity: snapshot.items.filter(item => item.special !== null).length },
      gmPolicyVerified: false, liveExecutionEnabled: false };
  } catch (error) {
    const reason = /^FC27_CLUB_[A-Z_0-9]+$/.test(error?.message) ? error.message : 'FC27_CLUB_INSPECTION_FAILED';
    return { status: 'blocked', phase, reason, liveExecutionEnabled: false };
  }
}

// The browser-inspection tool receives only this projection, never refs or account IDs.
export function inspectNativeRunnerSupport(root) {
  try {
    const snapshot = readFc27CachedClub(root);
    const club = ownData(ownData(ownData(root, 'repositories'), 'Item'), 'club');
    const collection = ownData(ownData(club, 'items'), '_collection');
    const cached = collection && Object.keys(collection).map(key => ownData(collection, key)) || [];
    const players = cached.filter(item => ownData(item, 'type') === 'player');
    const average = item => ownData(item, '_marketAverage');
    const priceGetter = ownData(ownData(ownData(root, 'UTItemEntity'), 'prototype'), 'getMarketAverage');
    const enhancements = { marketAverageGetterReviewed: typeof priceGetter === 'function'
      && Function.prototype.toString.call(priceGetter) === 'function(){return this._marketAverage}',
      marketAverageKnown: players.filter(item => Number.isFinite(average(item))).length,
      marketAveragePositive: players.filter(item => Number.isSafeInteger(average(item)) && average(item) > 0).length };
    return { status: 'observed', contextMatched: true, season: snapshot.context.season,
      enhancements,
      inventoryStatus: snapshot.status, complete: snapshot.complete,
      cachedEntries: snapshot.cachedEntries, cachedPlayers: snapshot.items.length,
      safety: { knownRatings: snapshot.items.filter(item => item.rating !== null).length,
        knownRarity: snapshot.items.filter(item => item.special !== null).length,
        ordinaryClubPlayers: snapshot.items.filter(item => item.pile === 'club' && item.special === false
          && item.evolution === false && item.cosmetic === false && item.concept === false
          && item.academyEnrolled === false && item.limitedUse === false && item.loans === -1).length },
      gmPolicyVerified: false, targetedValidationVerified: false, liveExecutionEnabled: false };
  } catch {
    return { status: 'blocked', reason: 'NATIVE_PROVIDER_UNVERIFIED', liveExecutionEnabled: false };
  }
}
