import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge } from './fc27-streamlined-read.js';
import { integer, same, fail } from '../../streamlined/contract.js';

export const FC27_STREAMLINED_PROGRESS_HASH = '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693';
const transientReadStatuses = new Set([0, 408, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
// Observed on this reviewed GET, followed by successful read-only recovery.
// This is not a global interpretation of EA codes or permission to retry writes.
const observedReadStatuses = new Set([426, 512]);
const retryableRead = code => transientReadStatuses.has(code) || observedReadStatuses.has(code);
const method = (object, key) => {
  for (let depth = 0; object && depth < 8; depth++, object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return descriptor.value;
  }
  return undefined;
};

// The reviewed DAO GET creates local Challenge entities. Unlike Service reads,
// it neither installs them into the repository nor initiates the Challenge.
// Set repeat/expiry and selection-limit metadata remain explicitly page-sourced.
export function createFc27StreamlinedProgressReader(root, { now = () => Date.now(), requirePage = true, onDiagnostic = () => {} } = {}) {
  let busy = false;
  return Object.freeze({ async read(expected, { onProgress = () => {}, stopped = () => false } = {}) {
    if (busy) fail('BUSY');
    busy = true;
    try {
      const page = locateFc27StreamlinedPage(root), context = readFc27Context(root);
      if (!same(context, expected?.context) || requirePage && (!page || page.setId !== expected.setId || page.challengeId !== expected.id)) fail('CONTEXT_CHANGED');
      // Recovery can outlive the work area: completed/cooling-down sets are no
      // longer openable. Only the frozen metadata is reused for this read; the
      // DAO still supplies the exact challenge, native rules, score and status.
      const projection = requirePage ? page : { set: { id: expected.setId, repeats: expected.repeats,
        repeatabilityMode: expected.repeatabilityMode, endTime: expected.endTime },
      vm: { getSelectionLimit: () => expected.selectionLimit } };
      const dao = root.services?.SBC?.sbcDAO, read = method(dao, 'getChallengesForSet');
      if (typeof read !== 'function') fail('PROGRESS_READ_UNVERIFIED');
      const bytes = new globalThis.TextEncoder().encode(Function.prototype.toString.call(read));
      const hash = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== FC27_STREAMLINED_PROGRESS_HASH) fail('PROGRESS_READ_UNVERIFIED');
      const assert = () => {
        if (stopped()) fail('CANCELLED');
        const current = locateFc27StreamlinedPage(root);
        if (requirePage && (!current || current.controller !== page.controller || current.setId !== expected.setId || current.challengeId !== expected.id)
            || !same(readFc27Context(root), context) || root.services?.SBC?.sbcDAO !== dao
            || method(dao, 'getChallengesForSet') !== read) fail('CONTEXT_CHANGED');
      };
      assert();
      return await new Promise((resolve, reject) => {
        let owner, observable, retryTimer, done = false, attempts = 0;
        const release = () => {
          const current = observable, currentOwner = owner; observable = null; owner = null;
          try { current?.unobserve(currentOwner); } catch { /* Only this reader's observer. */ }
        };
        const readError = (code, status, nativeCode) => Object.assign(Error(`FC27_STREAMLINED_${code}`), {
          ...(integer(status, 0, 599) ? { httpStatus: status } : {}), attempt: attempts, attemptLimit: 3,
          ...(integer(nativeCode, 0, 1e9) ? { localReason: `FC27_NATIVE_ERROR_${nativeCode}` } : {}),
        });
        const finish = (error, value) => {
          if (done) return; done = true; clearTimeout(timer); clearTimeout(retryTimer); clearInterval(stopTimer); release();
          if (error) reject(error); else resolve(value);
        };
        // One shared deadline, not a fresh 15 seconds for each retry. Only
        // explicit transient/observed read failures retry; never auth, rate limits,
        // malformed metadata, missing identities, or any contribution request.
        const timer = setTimeout(() => finish(readError('PROGRESS_READ_TIMEOUT')), 15000);
        const stopTimer = setInterval(() => { try { assert(); } catch (error) { finish(error); } }, 100);
        const request = () => {
          if (done) return;
          const attempt = ++attempts; let settled = false;
          try {
            assert(); owner = {};
            observable = read.call(dao, expected.setId);
            observable.observe(owner, (_sender, reply) => {
              if (done || settled || attempt !== attempts) return;
              settled = true;
              try {
                assert();
                const status = ownData(reply, 'status'), nativeCode = ownData(ownData(reply, 'error'), 'code');
                if (ownData(reply, 'success') !== true || status !== 200) {
                  if (attempts < 3 && retryableRead(status) && (nativeCode == null || retryableRead(nativeCode))) {
                    const waitMs = (observedReadStatuses.has(status) || observedReadStatuses.has(nativeCode) ? 3000 : 1500) * attempts;
                    const row = { phase: 'progress-backoff', status: 'waiting', httpStatus: status, attempt: attempts, attemptLimit: 3, waitMs,
                      ...(integer(nativeCode, 0, 1e9) ? { localReason: `FC27_NATIVE_ERROR_${nativeCode}` } : {}) };
                    release();
                    try { onProgress(row); } catch { /* Display only. */ }
                    try { Promise.resolve(onDiagnostic(row)).catch(() => {}); } catch { /* Diagnostic only. */ }
                    retryTimer = setTimeout(request, waitMs); return;
                  }
                  finish(readError('PROGRESS_READ_FAILED', status, nativeCode)); return;
                }
                const value = ownData(ownData(reply, 'response'), 'challenges');
                const raw = ownData(value, '_collection') ?? value;
                if (!raw || typeof raw !== 'object') fail('PROGRESS_READ_UNVERIFIED');
                const keys = Object.getOwnPropertyNames(raw).filter(key => key !== 'length');
                if (keys.length > 100) fail('PROGRESS_READ_UNVERIFIED');
                const rows = keys.map(key => ownData(raw, key));
                if (rows.some(row => !integer(ownData(row, 'id'), 1) || ownData(row, 'setId') !== expected.setId)
                    || new Set(rows.map(row => row.id)).size !== rows.length) fail('PROGRESS_READ_UNVERIFIED');
                const selected = rows.find(row => row.id === expected.id);
                if (!selected) fail('PROGRESS_READ_UNVERIFIED');
                const timesCompleted = ownData(selected, 'timesCompleted');
                if (timesCompleted != null && !integer(timesCompleted)) fail('PROGRESS_COUNT_UNVERIFIED');
                const challenge = projectFc27StreamlinedChallenge({ ...projection, challenge: selected }, context);
                finish(null, { fresh: true, observedAt: now(), challenge,
                  timesCompleted: timesCompleted ?? null, attempts,
                  freshFields: ['status', 'targetScore', 'submittedScore', 'eligibility', 'eligibilityOperation'],
                  setMetadataFresh: false, rewardConfirmed: false });
              } catch (error) { finish(error); }
            });
          } catch (error) { finish(error); }
        };
        request();
      });
    } finally { busy = false; }
  } });
}
