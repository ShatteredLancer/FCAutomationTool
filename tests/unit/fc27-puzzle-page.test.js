import { expect, it, vi } from 'vitest';
import { readFc27PuzzlePage, readFc27PuzzlePageSnapshot, readFc27CurrentPuzzleChallenge } from '../../src/adapters/ea/fc27-puzzle-page.js';

function fixture() {
  class Controller {}
  class Detail {}
  const document = {}; const anchor = { isConnected: true, ownerDocument: document };
  const challenge = { id: 43, setId: 19, status: 'IN_PROGRESS', eligibilityOperation: 'AND', awards: [],
    eligibilityRequirements: [{ count: -1, scope: 2, kvPairs: { _collection: { 3: [1] } } }],
    squad: { _formation: { id: 16, positions: Array.from({ length: 11 }, () => ({ typeId: 5 })) },
      simpleBrickIndices: [], customBrickIndices: [],
      _players: Array.from({ length: 23 }, (_, index) => ({ index, _item: { id: index % 2 ? -1 : 0 } })) } };
  const detail = Object.assign(new Detail(), { _set: { id: 19 }, _challenge: challenge,
    getView: () => ({ _btnExchange: { getRootElement: () => anchor } }) });
  const controller = Object.assign(new Controller(), { _set: { id: 19 }, _challengeId: 43,
    _challengeDetailsController: { currentController: detail, getView: () => ({}) } });
  const root = { document, UTSBCSquadSplitViewController: Controller, UTSBCSquadDetailPanelViewController: Detail,
    UTSquadEntity: { FIELD_PLAYERS: 11 },
    services: { SBC: { repository: { sets: { _collection: { 19: { id: 19, challenges: [challenge] } } } } } },
    getAppMain: () => ({ getRootViewController: () => ({
      // Normal navigation has no presented modal controller.
      getPresentedViewController: () => null,
      currentController: { currentController: { currentController: controller } },
    }) }) };
  return { root, controller, anchor, detail };
}
it('binds the current native challenge and its right-side exchange anchor', () => {
  const x = fixture(); expect(readFc27PuzzlePage(x.root)).toEqual({ setId: 19, challengeId: 43, anchor: x.anchor });
  x.controller._challengeId = 44; x.detail._challenge.id = 44;
  expect(readFc27PuzzlePage(x.root).challengeId).toBe(44);
});

it('reads rules and the native Challenge squad locally, including both EA empty item IDs', () => {
  const x = fixture();
  const request = vi.fn(() => { throw new Error('Unexpected request'); });
  x.root.services.SBC.sbcDAO = { getChallengesForSet: request, loadChallenge: request };
  const snapshot = readFc27PuzzlePageSnapshot(x.root, { setId: 19, challengeId: 43 });
  expect(snapshot).toMatchObject({ challenge: { id: 43, setId: 19, requirements: [
    { count: -1, scope: 2, pairs: [{ key: 3, values: [1] }] },
  ] }, layout: { squadEmpty: true, slotCount: 11, requiredPlayerCount: 11,
    formation: { id: 16, positions: Array(11).fill(5) } } });
  x.detail._challenge.squad._players[4]._item.id = 123;
  expect(readFc27PuzzlePageSnapshot(x.root, { setId: 19, challengeId: 43 }).layout.squadEmpty).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it.each(['target', 'slot', 'bench', 'formation', 'brick', 'sparse', 'accessor'])('rejects an unreadable native %s without executing getters', kind => {
  const x = fixture(); const squad = x.detail._challenge.squad; const getter = vi.fn();
  if (kind === 'target') x.detail._challenge.setId = 20;
  if (kind === 'slot') squad._players[0].index = 1;
  if (kind === 'bench') squad._players[11]._item.id = 123;
  if (kind === 'formation') squad._formation.positions[0].typeId = 99;
  if (kind === 'brick') squad.simpleBrickIndices = [0, 0];
  if (kind === 'sparse') delete squad._players[0];
  if (kind === 'accessor') Object.defineProperty(x.detail._challenge, 'squad', { get: getter });
  expect(readFc27PuzzlePageSnapshot(x.root, { setId: 19, challengeId: 43 })).toBeNull();
  expect(getter).not.toHaveBeenCalled();
});

it('continues readback from the exact local Challenge after navigation and rejects ambiguous copies', () => {
  const x = fixture(); x.anchor.isConnected = false;
  expect(readFc27PuzzlePageSnapshot(x.root, { setId: 19, challengeId: 43 })).toBeNull();
  expect(readFc27CurrentPuzzleChallenge(x.root, { setId: 19, challengeId: 43 })).toMatchObject({ id: 43, status: 'IN_PROGRESS' });
  x.detail._challenge.status = 'COMPLETED';
  expect(readFc27CurrentPuzzleChallenge(x.root, { setId: 19, challengeId: 43 }).status).toBe('COMPLETED');
  x.root.services.SBC.repository.sets._collection[19].challenges.push({ ...x.detail._challenge });
  expect(readFc27CurrentPuzzleChallenge(x.root, { setId: 19, challengeId: 43 })).toBeNull();
});
it.each(['detached', 'document', 'identity', 'controller', 'navigation', 'detail-target', 'detail-controller'])('rejects %s without guessing another challenge', kind => {
  const x = fixture();
  if (kind === 'detached') x.anchor.isConnected = false;
  if (kind === 'document') x.anchor.ownerDocument = {};
  if (kind === 'identity') delete x.controller._challengeId;
  if (kind === 'controller') x.root.UTSBCSquadSplitViewController = class Other {};
  if (kind === 'navigation') x.root.getAppMain = () => { throw new Error('navigation'); };
  if (kind === 'detail-target') x.detail._challenge.id = 44;
  if (kind === 'detail-controller') x.controller._challengeDetailsController.currentController = {};
  expect(readFc27PuzzlePage(x.root)).toBeNull();
});
