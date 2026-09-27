import { ownData } from '../../fc27/prelaunch-contract.js';
import { projectFc27CatalogChallenge } from './fc27-challenge-catalog.js';
import { projectFc27PuzzleLayout } from './fc27-puzzle-layout.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';

// Reviewed native local-only update and asynchronous observer notification.
// update preserves the squad object held by the pitch/summary controllers.
export const FC27_PUZZLE_SYNC_METHODS = Object.freeze([
  ['UTSquadEntity.prototype.update', '6d9e923d3ab48e5a8bcd3def4ac8505bb649ccc7c5e14725cfc42b11b08f161b'],
  ['EAObservable.prototype.notify', '1e483385deb8aa65cce0dfa60efb7344d85a8caa8dff9e443a1c6ae9bab8559c'],
]);

// Read the active native squad controller, never infer a target from catalog order.
function locate(root) {
  try {
    // EAViewController.currentController is the active child. The presented
    // controller is a modal and is normally null on the native SBC page.
    let controller = root.getAppMain().getRootViewController();
    for (let depth = 0; depth < 3; depth++) controller = ownData(controller, 'currentController');
    if (typeof root.UTSBCSquadSplitViewController !== 'function'
        || !(controller instanceof root.UTSBCSquadSplitViewController)) return null;
    const setId = ownData(ownData(controller, '_set'), 'id');
    const challengeId = ownData(controller, '_challengeId');
    if (![setId, challengeId].every(value => Number.isSafeInteger(value) && value > 0)) return null;
    const navigation = ownData(controller, '_challengeDetailsController');
    const detail = ownData(navigation, 'currentController');
    if (typeof root.UTSBCSquadDetailPanelViewController !== 'function'
        || !(detail instanceof root.UTSBCSquadDetailPanelViewController)
        || ownData(ownData(detail, '_set'), 'id') !== setId
        || ownData(ownData(detail, '_challenge'), 'id') !== challengeId
        || ownData(ownData(detail, '_challenge'), 'setId') !== setId) return null;
    const anchor = detail?.getView?.()?._btnExchange?.getRootElement?.();
    if (!anchor?.isConnected || anchor.ownerDocument !== root.document) return null;
    return { setId, challengeId, anchor, challenge: ownData(detail, '_challenge') };
  } catch { return null; }
}

export function readFc27PuzzlePage(root) {
  const target = locate(root);
  return target ? { setId: target.setId, challengeId: target.challengeId, anchor: target.anchor } : null;
}

// Current native editor already holds these rules. Projection is local only;
// never call a DAO to rediscover the Challenge displayed beside the button.
export function readFc27PuzzlePageChallenge(root, { setId, challengeId }) {
  try {
    const target = locate(root);
    if (!target || target.setId !== setId || target.challengeId !== challengeId) return null;
    return projectFc27CatalogChallenge(target.challenge, setId);
  } catch { return null; }
}

export function readFc27PuzzlePageSnapshot(root, { setId, challengeId }) {
  try {
    const target = locate(root);
    if (!target || target.setId !== setId || target.challengeId !== challengeId) return null;
    return { challenge: projectFc27CatalogChallenge(target.challenge, setId),
      layout: projectFc27PuzzleLayout(root, ownData(target.challenge, 'squad'), { setId, challengeId }) };
  } catch { return null; }
}

// Used after save even if the user has navigated away. The native editor owns
// the current Challenge; stored historical catalog status is never substituted.
export function readFc27CurrentPuzzleChallenge(root, { setId, challengeId }) {
  const entity = currentChallengeEntity(root, { setId, challengeId });
  try { return entity ? projectFc27CatalogChallenge(entity, setId) : null; }
  catch { return null; }
}

function currentChallengeEntity(root, { setId, challengeId }) {
  const page = locate(root);
  if (page?.setId === setId && page.challengeId === challengeId) return page.challenge;
  try {
    const values = value => {
      const raw = ownData(value, '_collection') ?? value;
      if (!raw || typeof raw !== 'object' || Object.getOwnPropertyNames(raw).length > 501) return [];
      return Object.getOwnPropertyNames(raw).filter(key => key !== 'length').map(key => ownData(raw, key));
    };
    const service = ownData(ownData(root, 'services'), 'SBC');
    const sets = values(ownData(ownData(service, 'repository'), 'sets')).filter(set => ownData(set, 'id') === setId);
    if (sets.length !== 1) return null;
    const matches = values(ownData(sets[0], 'challenges')).filter(challenge => ownData(challenge, 'id') === challengeId);
    return matches.length === 1 ? matches[0] : null;
  } catch { return null; }
}

// Called only after the exact server readback has passed transaction validation.
// Never load, save, submit, navigate, or replace a different local arrangement.
export async function synchronizeFc27PuzzleSquad(root, target, savedSquad, refs, assertContext = () => {}) {
  const fail = () => { throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED'); };
  const runtime = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS);
  assertContext();
  const challenge = currentChallengeEntity(root, target);
  if (!challenge || ownData(challenge, 'status') !== 'IN_PROGRESS') return fail();
  const local = ownData(challenge, 'squad');
  const layout = projectFc27PuzzleLayout(root, local, target);
  const savedLayout = projectFc27PuzzleLayout(root, savedSquad, target);
  if (JSON.stringify({ ...layout, squadEmpty: false }) !== JSON.stringify({ ...savedLayout, squadEmpty: false })
      || layout.customBrickIndices.length || !Array.isArray(refs) || refs.length !== layout.requiredPlayerCount
      || new Set(refs.map(ref => ref.slot)).size !== refs.length
      || new Set(refs.map(ref => ref.id)).size !== refs.length
      || new Set(refs.map(ref => ref.definitionId)).size !== refs.length) return fail();
  const matches = squad => refs.every(ref => {
    const item = ownData(ownData(squad, '_players')?.[ref.slot], '_item');
    return ownData(item, 'id') === ref.id && ownData(item, 'definitionId') === ref.definitionId;
  });
  if (!matches(savedSquad) || !layout.squadEmpty && !matches(local)) return fail();
  if (local.update !== root.UTSquadEntity.prototype.update
      || challenge.onDataChange?.notify !== root.EAObservable.prototype.notify) return fail();
  runtime();
  if (currentChallengeEntity(root, target) !== challenge) return fail();
  local.update(savedSquad);
  if (ownData(challenge, 'squad') !== local || !matches(local)) return fail();
  challenge.onDataChange.notify({ squad: local });
  // EAObservable queues rendering. Let its already queued observers run before
  // announcing completion; this does not poll or add a server request.
  await new Promise(resolve => setTimeout(resolve, 0));
  assertContext();
  if (!matches(local)) return fail();
  return { status: 'synchronized', selectedCount: refs.length };
}
