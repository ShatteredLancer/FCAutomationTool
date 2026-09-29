import { readFc27Context } from './fc27-local-read.js';
import { createFc27TransactionTransport, verifyFc27Methods } from './fc27-transaction-transport.js';
import { readFc27PuzzlePageSlots, synchronizeFc27PurchasedPuzzleSquad } from './fc27-puzzle-page.js';
import { projectFc27PuzzleLayout } from './fc27-puzzle-layout.js';
import { puzzleBuyMatchesSlots, puzzleBuySlotRefs } from '../../fc27/puzzle-buy-slots.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const refs = squad => squad?._players?.slice(0, 11).map((slot, index) => [0, -1].includes(slot._item.id) ? null
  : { slot: index, id: slot._item.id, definitionId: slot._item.definitionId, concept: slot._item.concept });
const planRefs = slots => slots.filter(Boolean).map(slot => slot.concept
  ? { slot: slot.slot, kind: 'concept', definitionId: slot.definitionId, catalogRef: `fc27:${slot.definitionId}` }
  : { slot: slot.slot, kind: 'owned', definitionId: slot.definitionId, id: slot.id, pile: 'club' });

// Purchasing changes ownership of already selected versions, not SBC selection
// or submission. This provider deliberately has no FSU readiness/cache dependency.
export async function createFc27PurchaseSquad(root, { canWrite, assertTarget }) {
  const context = readFc27Context(root), dao = root.services.SBC.sbcDAO;
  const runtime = await verifyFc27Methods(root, [['UTSquadBuildingChallengeDAO.prototype.loadChallenge',
    '04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e']]);
  const transport = await createFc27TransactionTransport(root, { canWrite });
  const assert = () => {
    runtime(); assertTarget();
    if (!same(context, readFc27Context(root)) || dao !== root.services.SBC.sbcDAO
        || dao.loadChallenge !== root.UTSquadBuildingChallengeDAO.prototype.loadChallenge) throw Error('FC27_BUY_CONTEXT_CHANGED');
  };
  const load = async record => {
    assert();
    const squad = await new Promise((resolve, reject) => {
      const owner = {}; let observable; let done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer);
        try { observable?.unobserve(owner); } catch { /* Only our observer. */ }
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(Error('FC27_BUY_SAVE_UNCONFIRMED')), 16000);
      try { observable = dao.loadChallenge(record.target.challengeId, true);
        observable.observe(owner, (_sender, reply) => {
          if (reply?.success && reply.status === 200 && reply.response?.squad) finish(null, reply.response.squad);
          else finish(Error('FC27_BUY_SAVE_UNCONFIRMED'));
        });
      } catch { finish(Error('FC27_BUY_SAVE_UNCONFIRMED')); }
    });
    assert();
    const layout = projectFc27PuzzleLayout(root, squad, record.target);
    if (!same(layout.formation, record.base.challenge.formation)
        || !same(layout.simpleBrickIndices, record.base.challenge.brickIndices) || layout.customBrickIndices.length) throw Error('FC27_BUY_SQUAD_CHANGED');
    return squad;
  };
  const sync = async (record, squad) => {
    const local = readFc27PuzzlePageSlots(root, record.target);
    if (!puzzleBuyMatchesSlots(record, local)) throw Error('FC27_BUY_SQUAD_CHANGED');
    await synchronizeFc27PurchasedPuzzleSquad(root, record.target, squad,
      planRefs(puzzleBuySlotRefs(record.base, record.entries)), planRefs(local), () => {
        assert();
        if (!puzzleBuyMatchesSlots(record, readFc27PuzzlePageSlots(root, record.target))) throw Error('FC27_BUY_SQUAD_CHANGED');
      });
  };
  return {
    async verifySquad(record) {
      if (!puzzleBuyMatchesSlots(record, refs(await load(record)))) throw Error('FC27_BUY_SQUAD_CHANGED');
    },
    async save(record, beforeDispatch) {
      let squad = await load(record);
      const expected = puzzleBuySlotRefs(record.base, record.entries);
      if (!same(refs(squad), expected)) {
        if (!puzzleBuyMatchesSlots(record, refs(squad))) throw Error('FC27_BUY_SQUAD_CHANGED');
        const players = squad._players.map((slot, index) => ({ index, itemData: {
          id: expected[index]?.id ?? slot._item.id, dream: expected[index]?.concept ?? false,
        } }));
        const result = await transport.request('save-purchase', { challengeId: record.target.challengeId, players,
          simpleBrickIndices: record.base.challenge.brickIndices,
          emptySlotIndices: expected.flatMap((slot, index) => slot === null ? [index] : []),
          conceptSlots: expected.filter(slot => slot?.concept).map(({ slot, definitionId }) => ({ slot, definitionId })) }, async () => {
          assert(); if (!puzzleBuyMatchesSlots(record, readFc27PuzzlePageSlots(root, record.target))) throw Error('FC27_BUY_SQUAD_CHANGED');
          await beforeDispatch();
        });
        if (result?.success !== true || result.status !== 200) throw Error('FC27_BUY_SAVE_UNCONFIRMED');
        squad = await load(record);
      }
      if (!same(refs(squad), expected)) throw Error('FC27_BUY_SAVE_UNCONFIRMED');
      await sync(record, squad);
    },
    async recoverSave(record) {
      const squad = await load(record);
      if (!same(refs(squad), puzzleBuySlotRefs(record.base, record.entries))) throw Error('FC27_BUY_SAVE_UNCONFIRMED');
      await sync(record, squad);
    },
    cancel: () => transport.cancel(),
  };
}
