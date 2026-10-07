import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge } from './fc27-streamlined-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { createFc27StreamlinedCache } from './fc27-streamlined-cache.js';
import { integer, same, fail } from '../../streamlined/contract.js';

export const FC27_STREAMLINED_PAGE_METHODS = Object.freeze([
  ['methods.hub', '81e6a860e8929e73fc8cc62db59442b9b45eb8aae900562ac808bd362cc83e80'],
  ['methods.notify', '626035e884aceedbca0ba6ddf853134ffeecaba9414b92a6d7a41a78474063f2'],
]);
const setFields = ['totalSubmittedScore', 'challengesCompletedCount', 'timesCompleted'];

// Copy authoritative progress into existing native entities, rather than replay
// _applyOneClickSubmission (which creates rewards and increments counters again).
// Completed cycles require a fresh hub read without claimCompensationRewards.
export async function createFc27StreamlinedPageMaintenance(root, { now = () => Date.now(),
  createCache = createFc27StreamlinedCache } = {}) {
  const context = readFc27Context(root), page = locateFc27StreamlinedPage(root);
  if (!page) fail('PAGE_UNAVAILABLE');
  const dao = root.services?.SBC?.sbcDAO;
  const methods = { hub: dao?.getHub, notify: root.EAObservable?.prototype?.notify };
  const checked = await verifyFc27Methods({ methods, crypto: root.crypto }, FC27_STREAMLINED_PAGE_METHODS);
  const cache = await createCache(root, { now });
  const assert = () => {
    checked(); cache.assert();
    if (!same(readFc27Context(root), context) || locateFc27StreamlinedPage(root)?.controller !== page.controller
        || root.services?.SBC?.sbcDAO !== dao || dao.getHub !== methods.hub
        || page.challenge.onDataChange?.notify !== methods.notify) fail('PAGE_CHANGED');
  };
  const writable = (object, keys) => {
    if (keys.some(key => Object.getOwnPropertyDescriptor(object, key)?.writable !== true)) fail('PAGE_FIELDS_UNVERIFIED');
  };
  const hub = () => new Promise((resolve, reject) => {
    let observer, done = false; const owner = {};
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { observer?.unobserve(owner); } catch { /* own observer only */ }
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Error('FC27_STREAMLINED_SET_READ_TIMEOUT')), 15000);
    try {
      assert(); observer = methods.hub.call(dao); // no compensation/reward claim option
      observer.observe(owner, (_sender, reply) => {
        try {
          assert();
          if (ownData(reply, 'success') !== true || ownData(reply, 'status') !== 200) fail('SET_READ_FAILED');
          const container = ownData(ownData(reply, 'response'), 'sets');
          const collection = ownData(container, '_collection') ?? container;
          if (!collection || typeof collection !== 'object' || Object.keys(collection).length > 1000) fail('SET_READ_UNVERIFIED');
          const matches = Object.keys(collection).map(key => ownData(collection, key)).filter(row => ownData(row, 'id') === page.setId);
          if (matches.length !== 1) fail('SET_READ_UNVERIFIED');
          const set = matches[0];
          if (setFields.some(key => !integer(ownData(set, key)))
              || ['repeats', 'repeatabilityMode', 'endTime'].some(key => ownData(set, key) !== ownData(page.set, key))) fail('SET_CHANGED');
          finish(null, Object.fromEntries(setFields.map(key => [key, set[key]])));
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
  const prepare = refs => {
    assert(); cache.prepare(refs);
    writable(page.challenge, ['submittedScore', 'status', 'timesCompleted']);
    writable(page.set, setFields);
    if (setFields.some(key => !integer(ownData(page.set, key))) || !integer(ownData(page.challenge, 'timesCompleted'))) fail('PAGE_FIELDS_UNVERIFIED');
  };
  return Object.freeze({ prepare, dirty: cache.dirty,
    async apply(record, batch, evidence) {
      prepare(batch.refs);
      const current = projectFc27StreamlinedChallenge(page, context), fresh = evidence?.challenge;
      if (!fresh || !same(fresh.context, context) || !integer(evidence.timesCompleted)
          || !same(current, { ...fresh, status: current.status, submittedScore: current.submittedScore, remainingScore: current.remainingScore })
          || !same({ ...record.plan.challenge, status: fresh.status, submittedScore: fresh.submittedScore,
            remainingScore: fresh.remainingScore }, fresh)) fail('PAGE_PROGRESS_UNVERIFIED');
      const completed = batch.receipt?.challengeCompleted === true;
      if (evidence.cycleResetConfirmed === true && (!completed || fresh.submittedScore !== 0
          || batch.receipt.submittedScore < record.plan.challenge.targetScore
          || !integer(batch.receipt.previousTimesCompleted)
          || evidence.timesCompleted !== batch.receipt.previousTimesCompleted + 1)) fail('PAGE_PROGRESS_UNVERIFIED');
      let set;
      if (completed) {
        set = await hub();
        // A changed cycle after reconciliation must never be hidden by a hub read.
        if (set.totalSubmittedScore < fresh.submittedScore) fail('PAGE_PROGRESS_UNVERIFIED');
      } else {
        if (current.submittedScore !== (batch.startingScore ?? record.submittedScore)
            && current.submittedScore !== fresh.submittedScore) fail('PAGE_PROGRESS_CHANGED');
        const total = page.set.totalSubmittedScore + fresh.submittedScore - current.submittedScore;
        if (!integer(total) || total < fresh.submittedScore || evidence.timesCompleted !== page.challenge.timesCompleted) fail('PAGE_PROGRESS_UNVERIFIED');
        set = { totalSubmittedScore: total };
      }
      assert();
      // apply rechecks fresh evidence before any eviction. All page assignments
      // below target writable data fields and are idempotent if notification or
      // the subsequent GM checkpoint fails.
      cache.apply(record, batch, evidence);
      Object.assign(page.set, set);
      Object.assign(page.challenge, { submittedScore: fresh.submittedScore, status: fresh.status, timesCompleted: evidence.timesCompleted });
      methods.notify.call(page.challenge.onDataChange, { submittedScore: fresh.submittedScore,
        status: fresh.status, timesCompleted: evidence.timesCompleted });
      return true;
    },
  });
}
