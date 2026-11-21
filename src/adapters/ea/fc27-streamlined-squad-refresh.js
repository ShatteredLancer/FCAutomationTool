import { observeFc27TrafficResult } from './fc27-market-traffic-runtime.js';

// EA's squad list response identifies the active squad and sets its active
// flag. Loading a squad by ID alone does not establish which one is active.
export async function refreshFc27StreamlinedSquad(root, check) {
  const service = root.services.Squad;
  const repository = root.repositories.Squad;
  let phase = 'protection-squad-list';
  const unavailable = () => Object.assign(Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED'), { evidence: { phase } });
  const read = request => {
    const observable = request();
    if (typeof observable?.observe !== 'function') throw unavailable();
    return observeFc27TrafficResult(observable);
  };
  try {
    check();
    // Expire only the list timestamp. resetSquadsCache() also drops all rosters.
    repository.setSquadListCacheTimestamp(0, 0);
    const list = await read(() => service.requestSquadList());
    check();
    const id = list?.data?.activeSquadId;
    if (list?.success !== true || list.status !== 200 || !Number.isSafeInteger(id) || id < 0
        || service.activeSquad !== id || !Array.isArray(list.data.squads)) throw unavailable();
    const active = list.data.squads.filter(squad => squad?._isActive === true);
    if (active.length !== 1 || active[0]._id !== id) throw unavailable();
    phase = 'protection-squad-detail';
    const detail = await read(() => service.requestSquadById(id));
    check();
    if (detail?.success !== true || ![200, 304].includes(detail.status) || service.activeSquad !== id
        || detail.data?.squad !== active[0] || active[0]._isActive !== true) throw unavailable();
  } catch {
    check();
    throw unavailable();
  }
}
