import { vi } from 'vitest';
import { executionRuntime } from './fc27-execution-runtime.js';
import { readFc27StreamlinedInputs } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { FC27_STREAMLINED_PROGRESS_HASH } from '../../src/adapters/ea/fc27-streamlined-progress.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { FC27_STREAMLINED_PAGE_METHODS } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { FC27_STREAMLINED_CACHE_METHODS } from '../../src/adapters/ea/fc27-streamlined-cache.js';
import { addStorageRuntime } from './fc27-storage-runtime.js';

export function streamlinedRuntime({ targetScore = 200, mixedStorage = false } = {}) {
  const f = executionRuntime(), { root } = f;
  root.document = {};
  const anchor = { isConnected: true, ownerDocument: root.document };
  const challenge = { id: 61, setId: 31, name: 'Synthetic points', status: 'IN_PROGRESS',
    isOneClickChallenge: () => true, scoreRequirement: targetScore, submittedScore: 0, timesCompleted: 0,
    eligibilityOperation: 'AND', eligibilityRequirements: [
      { count: -1, scope: 0, kvPairs: { _collection: { 40: [45], 41: [1] } } },
    ] };
  const set = { id: 31, repeats: 1, repeatabilityMode: 'REFRESH', endTime: 0,
    totalSubmittedScore: 0, challengesCompletedCount: 0, timesCompleted: 0 };
  root.EAObservable = class { notify(value) { f.calls.push({ kind: 'notify', value }); } };
  challenge.onDataChange = new root.EAObservable();
  class Split { constructor() { this.workAreaController = {
    viewModel: { getChallenge: () => challenge, getSet: () => set, getSelectionLimit: () => 30 },
    getView: () => ({ getRootElement: () => anchor }),
  }; } }
  root.UTOneClickSBCWorkAreaSplitViewController = Split;
  const controller = new Split();
  root.getAppMain = () => ({ getRootViewController: () => ({ currentController: controller }) });
  root.UTEvolutionEligibilityVO = class { isValid = true; meetsRequirements = item => item._rating >= 45; };
  for (const item of Object.values(root.repositories.Item.club.items._collection)) item.sbsScore = 20;
  let storage;
  if (mixedStorage) {
    storage = addStorageRuntime(f, { payload: [{ id: 501, resourceId: 101, pile: 8 }] });
    root.repositories.Item.storage._collection[501] = { ...root.factories.Item.createItem(storage.payload[0]), sbsScore: 20 };
  }
  const input = readFc27StreamlinedInputs(root);
  const selected = mixedStorage ? [...input.inventory.slice(0, 4), input.inventory.find(item => item.id === 501)] : input.inventory.slice(0, 5);
  const result = { status: targetScore <= 100 ? 'ready' : 'partial', items: selected, batches: [selected], score: 100,
    progress: { target: targetScore, submitted: 0, added: 100, total: 100,
      remaining: Math.max(0, targetScore - 100), excess: Math.max(0, 100 - targetScore), reached: targetScore <= 100 },
    purchaseCost: 0, materialValue: null, searchComplete: true };
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy, result });
  const replies = { rows: [{ ...challenge, submittedScore: 100, timesCompleted: 0 }], set: { ...set }, status: 200, success: true, hold: false };
  const unobserve = vi.fn();
  class ProgressDAO {
    getHub(options) {
      f.calls.push({ kind: 'hub', options });
      return { observe(owner, callback) { callback(this, { success: true, status: 200, response: { sets: [replies.set] } }); }, unobserve };
    }
    getChallengesForSet(setId) {
      f.calls.push({ kind: 'progress', setId });
      return { observe(owner, callback) {
        replies.deliver = () => callback(this, { success: replies.success, status: replies.status,
          response: { challenges: replies.rows } });
        if (!replies.hold) replies.deliver();
      }, unobserve };
    }
  }
  root.services.Squad = { resetSquadsCache() { f.calls.push({ kind: 'resetSquads' }); } };
  root.services.SBC.removeItemsById = function(ids) { f.calls.push({ kind: 'removeSbcItems', ids }); };
  root.services.SBC._evictSubmittedItems = function(ids) {
    ids.forEach(id => {
      if (root.repositories.Item.storage?._collection[id]) delete root.repositories.Item.storage._collection[id];
      else root.repositories.Item.club.items.remove(id);
    });
    this.removeItemsById(ids); root.services.Squad.resetSquadsCache();
  };
  const functions = [root.services.SBC._evictSubmittedItems, root.services.SBC.removeItemsById,
    root.services.Squad.resetSquadsCache, root.events.markClubCacheDirty];
  const additionalHashes = new Map(functions.map((fn, i) => [String(fn).replace(/\r\n/g, '\n'), FC27_STREAMLINED_CACHE_METHODS[i][1]]));
  additionalHashes.set(String(ProgressDAO.prototype.getHub).replace(/\r\n/g, '\n'), FC27_STREAMLINED_PAGE_METHODS[0][1]);
  additionalHashes.set(String(root.EAObservable.prototype.notify).replace(/\r\n/g, '\n'), FC27_STREAMLINED_PAGE_METHODS[1][1]);
  const originalDigest = root.crypto.subtle.digest;
  root.crypto.subtle.digest = vi.fn(async (algorithm, bytes) =>
    new TextDecoder().decode(bytes) === String(ProgressDAO.prototype.getChallengesForSet)
      ? Uint8Array.from(Buffer.from(FC27_STREAMLINED_PROGRESS_HASH, 'hex')).buffer
      : additionalHashes.has(new TextDecoder().decode(bytes)) ? Uint8Array.from(Buffer.from(additionalHashes.get(new TextDecoder().decode(bytes)), 'hex')).buffer
        : originalDigest(algorithm, bytes));
  root.services.SBC.sbcDAO = new ProgressDAO();
  f.state.filterClubQueries = true; f.state.playerFacts = { sbsScore: 20 };
  return { ...f, challenge, set, controller, anchor, input, selected, plan, replies, unobserve, storage };
}

export async function pendingContribution(f) {
  const memory = new Map();
  const journal = createStreamlinedJournal({ now: () => 1000,
    get: key => structuredClone(memory.get(key)), set: (key, value) => memory.set(key, structuredClone(value)) });
  let record = await journal.begin(f.plan);
  record.batches[0].state = 'pending';
  record.batches[0].receipt = { schema: 1, status: 'accepted', code: 200, transportWarning: false,
    setId: 31, challengeId: 61, itemIds: f.selected.map(item => item.id), submittedScore: 100,
    challengeCompleted: false, challengeAwardCount: 0, setAwardCount: 0,
    objectiveUpdatesPresent: false, rewardConfirmed: false };
  record = await journal.write(f.input.context, record, record.revision);
  return { journal, record, batch: record.batches[0] };
}
