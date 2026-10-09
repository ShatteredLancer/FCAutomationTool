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
    const splitTypeMatches = typeof root.UTSBCSquadSplitViewController === 'function'
      && controller instanceof root.UTSBCSquadSplitViewController;
    // Enhancer may proxy the native controller across a wrapper object. Keep
    // the same stable EA fields and reject arbitrary page nodes.
    const splitShapeMatches = controller && typeof controller === 'object'
      && ownData(controller, '_set') && Number.isSafeInteger(ownData(controller, '_challengeId'))
      && ownData(controller, '_challengeDetailsController')
      && typeof controller.getView === 'function';
    if (!splitTypeMatches && !splitShapeMatches) return null;
    const setId = ownData(ownData(controller, '_set'), 'id');
    const challengeId = ownData(controller, '_challengeId');
    if (![setId, challengeId].every(value => Number.isSafeInteger(value) && value > 0)) return null;
    const navigation = ownData(controller, '_challengeDetailsController');
    const detail = ownData(navigation, 'currentController');
    const detailTypeMatches = typeof root.UTSBCSquadDetailPanelViewController === 'function'
      && detail instanceof root.UTSBCSquadDetailPanelViewController;
    const detailShapeMatches = detail && typeof detail === 'object'
      && typeof detail.getView === 'function' && ownData(detail, '_challenge');
    if (!detailTypeMatches && !detailShapeMatches) return null;
    if (ownData(ownData(detail, '_set'), 'id') !== setId
        || ownData(ownData(detail, '_challenge'), 'id') !== challengeId
        || ownData(ownData(detail, '_challenge'), 'setId') !== setId) return null;
    const anchor = detail?.getView?.()?._btnExchange?.getRootElement?.();
    if (!anchor?.isConnected || anchor.ownerDocument !== root.document) return null;
    return { setId, challengeId, anchor, challenge: ownData(detail, '_challenge'),
      purchaseAnchor: detail?.getView?.()?._challengeDetails?.getRootElement?.() ?? null };
  } catch { return null; }
}

export function readFc27PuzzlePage(root) {
  const target = locate(root);
  return target ? { setId: target.setId, challengeId: target.challengeId, anchor: target.anchor,
    ...(target.purchaseAnchor ? { purchaseAnchor: target.purchaseAnchor } : {}) } : null;
}

// FSU's purchase button reads getPlayers(), including the work area. Buying
// does not use the solver's eleven-player/formation/brick validation contract.
export function readFc27PurchasePage(root, target) {
  const page = locate(root);
  if (!page || page.setId !== target.setId || page.challengeId !== target.challengeId) return null;
  const squad = page.challenge.squad;
  const players = squad.getPlayers();
  return { squad, items: players.map(slot => slot.item ?? slot._item),
    slots: players.map((slot, index) => {
      const item = slot.item ?? slot._item;
      return !item || [0, -1].includes(item.id) ? null
        : { slot: index, id: item.id, definitionId: item.definitionId, concept: item.concept };
    }) };
}

export function readFc27PurchasePageSlots(root, target, record = null) {
  const slots = readFc27PurchasePage(root, target)?.slots ?? null;
  return slots && record?.base?.kind !== 'native-concept-purchase' && record?.base?.slots
    ? slots.slice(0, record.base.slots.length) : slots;
}

// Transient native entities for the purchase adapter only; never persisted.
export function readFc27PuzzlePageItems(root, target) {
  const page = locate(root);
  if (!page || page.setId !== target.setId || page.challengeId !== target.challengeId) return null;
  return ownData(ownData(page.challenge, 'squad'), '_players')?.slice(0, 11).map(slot => ownData(slot, '_item')) ?? null;
}

export function readFc27PuzzlePageSlots(root, target) {
  const page = locate(root);
  if (!page || page.setId !== target.setId || page.challengeId !== target.challengeId) return null;
  const slots = ownData(ownData(page.challenge, 'squad'), '_players');
  if (!Array.isArray(slots) || slots.length < 11) return null;
  return slots.slice(0, 11).map((slot, index) => {
    const item = ownData(slot, '_item'); const id = ownData(item, 'id');
    return [0, -1].includes(id) ? null : { slot: index, id, definitionId: ownData(item, 'definitionId'), concept: ownData(item, 'concept') };
  });
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
  if (!Array.isArray(refs) || refs.some(ref => ref?.kind === 'concept' || ref?.concept === true)) throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
  return synchronize(root, target, savedSquad, refs, assertContext, false);
}

export async function synchronizeFc27PuzzleConceptSquad(root, target, savedSquad, refs, assertContext = () => {}) {
  if (!Array.isArray(refs) || !refs.some(ref => ref.kind === 'concept')
      || refs.some(ref => !['owned', 'concept'].includes(ref.kind)
        || ref.kind === 'concept' && (ref.id !== undefined || ref.catalogRef !== `fc27:${ref.definitionId}`))) {
    throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
  }
  return synchronize(root, target, savedSquad, refs, assertContext, true);
}

export function synchronizeFc27PurchasedPuzzleSquad(root, target, savedSquad, refs, previousRefs, assertContext) {
  if (!Array.isArray(previousRefs) || previousRefs.length !== refs.length
      || refs.some(ref => !previousRefs.some(old => old.slot === ref.slot && old.definitionId === ref.definitionId
        && (old.kind === 'concept' || ref.kind === 'owned' && old.id === ref.id)))) {
    throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
  }
  return synchronize(root, target, savedSquad, refs, assertContext, refs.some(ref => ref.kind === 'concept'), previousRefs);
}

async function synchronize(root, target, savedSquad, refs, assertContext, concepts, previousRefs = null) {
  const fail = () => { throw new Error('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED'); };
  const runtime = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS);
  assertContext();
  const challenge = currentChallengeEntity(root, target);
  if (!challenge || ownData(challenge, 'status') !== 'IN_PROGRESS') return fail();
  const local = ownData(challenge, 'squad');
  const layout = projectFc27PuzzleLayout(root, local, target);
  const savedLayout = projectFc27PuzzleLayout(root, savedSquad, target);
  if (JSON.stringify({ ...layout, squadEmpty: false }) !== JSON.stringify({ ...savedLayout, squadEmpty: false })
      || layout.customBrickIndices.length || !Array.isArray(refs)
      || (previousRefs === null ? refs.length !== layout.requiredPlayerCount : refs.length > layout.requiredPlayerCount)
      || new Set(refs.map(ref => ref.slot)).size !== refs.length
      || new Set(refs.map(ref => ref.kind === 'concept' ? `concept:${ref.definitionId}` : `owned:${ref.id}`)).size !== refs.length
      || new Set(refs.map(ref => ref.definitionId)).size !== refs.length) return fail();
  const matches = squad => refs.every(ref => {
    const item = ownData(ownData(squad, '_players')?.[ref.slot], '_item');
    return ownData(item, 'id') === (ref.kind === 'concept' ? ref.definitionId : ref.id)
      && ownData(item, 'definitionId') === ref.definitionId
      && ownData(item, 'concept') === (concepts && ref.kind === 'concept');
  });
  const previousMatches = () => previousRefs !== null && previousRefs.every(ref => {
    const item = ownData(ownData(local, '_players')?.[ref.slot], '_item');
    return ownData(item, 'id') === (ref.kind === 'concept' ? ref.definitionId : ref.id)
      && ownData(item, 'definitionId') === ref.definitionId && ownData(item, 'concept') === (ref.kind === 'concept');
  });
  if (!matches(savedSquad) || !layout.squadEmpty && !matches(local) && !previousMatches()) return fail();
  if (local.update !== root.UTSquadEntity.prototype.update
      || challenge.onDataChange?.notify !== root.EAObservable.prototype.notify) return fail();
  runtime();
  if (currentChallengeEntity(root, target) !== challenge) return fail();
  // EA's update() refuses to copy player slots while the manager is a null
  // entity. SBC squads commonly have no manager, so use the reviewed native
  // setPlayers() path in that case; it updates existing slot objects and
  // emits the normal local observer event without another network call.
  local.update(savedSquad);
  if (!matches(local) && (layout.squadEmpty || previousMatches())) {
    // FSU wraps setPlayers with its own history side effect. Its retained
    // original must match the native function exactly before we call it.
    const retained = ownData(ownData(ownData(root, 'call'), 'squad'), 'setPlayers');
    const path = retained === undefined ? 'UTSquadEntity.prototype.setPlayers' : 'call.squad.setPlayers';
    const checkPlayers = await verifyFc27Methods(root, [[path, '36369f3b5fec8c43f00f5078b5d5223b2d3fce1eaf9c47e9bd8355e6a3b53669']]);
    assertContext(); runtime(); checkPlayers();
    if (currentChallengeEntity(root, target) !== challenge || ownData(challenge, 'squad') !== local
        || !projectFc27PuzzleLayout(root, local, target).squadEmpty && !previousMatches() || !matches(savedSquad)) return fail();
    const players = ownData(savedSquad, '_players').map((slot, index) => refs.some(ref => ref.slot === index) ? ownData(slot, '_item') : null);
    const setPlayers = retained ?? ownData(ownData(ownData(root, 'UTSquadEntity'), 'prototype'), 'setPlayers');
    setPlayers.call(local, players);
  }
  if (ownData(challenge, 'squad') !== local || !matches(local)) return fail();
  challenge.onDataChange.notify({ squad: local });
  // EAObservable queues rendering. Let its already queued observers run before
  // announcing completion; this does not poll or add a server request.
  await new Promise(resolve => setTimeout(resolve, 0));
  assertContext();
  if (!matches(local)) return fail();
  return { status: 'synchronized', selectedCount: refs.length };
}
