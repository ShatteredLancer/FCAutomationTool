import { ownData } from '../../fc27/prelaunch-contract.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS } from './fc27-club-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';

// Native DAO source inspected on 2026-10-07. The Service derives completion
// and may reset repeat progress; its mutated model is not a server receipt.
export const FC27_STREAMLINED_CONTRIBUTION_METHODS = Object.freeze([
  ['dao.submitPlayers', '2efe4777e8d6191db7d7058ce020b75fb4c524b3775d6dc24d860a662bb7c4a3'],
  ['dao.initiateOneClickChallenge', 'ebb8bd1901f0d47a2f2afdf8ecf832e7c1a3d3f78825d9d3bb84f8c9c713df9c'],
]);
const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
// Native DAO methods live on prototypes. Resolve only these reviewed methods
// without invoking accessors or broadening shared transaction verification.
const method = (dao, key) => {
  for (let value = dao, depth = 0; value && depth < 8; value = Object.getPrototypeOf(value), depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) return typeof descriptor.value === 'function' ? descriptor.value : undefined;
  }
  return undefined;
};

// The production owner must supply a fresh material /
// rule check and persist the exact pending batch before dispatch. Match native
// endpoint/body, but use our own request to prevent queued mutation retries,
// as required by the Streamlined transaction plan. No token/cookie access.
export async function createFc27StreamlinedContributionTransport(root, { canWrite = () => false,
  assertCurrent = () => {} } = {}) {
  const context = readFc27Context(root), dao = at(root, 'services.SBC.sbcDAO');
  const runtime = await verifyFc27Methods(root, FC27_CLUB_READ_METHODS);
  const methods = Object.fromEntries(FC27_STREAMLINED_CONTRIBUTION_METHODS.map(([path]) => {
    const key = path.split('.').at(-1); return [key, method(dao, key)];
  }));
  const native = await verifyFc27Methods({ dao: methods, crypto: root.crypto }, FC27_STREAMLINED_CONTRIBUTION_METHODS);
  const Request = ownData(root, 'UTHttpRequest'), auth = ownData(dao, 'authDelegate'), game = ownData(root, 'GAME_NAME');
  if (!auth || typeof game !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(game)) fail('RUNTIME_UNVERIFIED');
  let busy = false, stopped = false, last = -Infinity, cancelActive = null;
  const assert = () => {
    runtime(); native(); assertCurrent();
    if (Object.entries(methods).some(([key, fn]) => method(dao, key) !== fn)) fail('RUNTIME_UNVERIFIED');
    if (stopped || !same(readFc27Context(root), context) || at(root, 'services.SBC.sbcDAO') !== dao
        || ownData(dao, 'authDelegate') !== auth || ownData(root, 'GAME_NAME') !== game) fail('CONTEXT_CHANGED');
  };
  return Object.freeze({
    async request(action, target, beforeDispatch) {
      if (busy || stopped) fail('TRANSPORT_BLOCKED');
      if (!['initiate', 'contribute'].includes(action) || !integer(target?.challengeId, 1)
          || typeof beforeDispatch !== 'function' || canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
      const id = target.challengeId;
      // Copy only an actual array.  Do not invoke an arbitrary user supplied
      // `.slice()` before the input contract has been checked.
      const ids = action === 'contribute' && Array.isArray(target?.itemIds)
        ? [...target.itemIds] : null;
      if (action === 'contribute' && (!Array.isArray(ids) || !ids.length || ids.length > 1000
          || ids.some(value => !integer(value, 1)) || new Set(ids).size !== ids.length)) fail('CONTRIBUTION_INPUT_INVALID');
      busy = true;
      try {
        const wait = Math.max(0, 800 - (Date.now() - last));
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        assert();
        const req = new Request(auth);
        if (req.send !== at(root, 'UTHttpRequest.prototype.send') || req.setPath !== at(root, 'UTHttpRequest.prototype.setPath')
            || req.setRequestBody !== at(root, 'EAHttpRequest.prototype.setRequestBody')
            || req.abort !== at(root, 'EAHttpRequest.prototype.abort')) fail('RUNTIME_UNVERIFIED');
        req.doRetry = false; req.doReauth = false; req.timeout = 10000; req.requestType = 'POST';
        const endpoint = `/ut/game/${game}/sbs/challenge/${id}${action === 'contribute' ? '/item/submit' : ''}`;
        req.setPath(endpoint);
        const url = new URL(ownData(req, 'url'));
        if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint
            || url.search || url.hash || url.username || url.password) fail('ENDPOINT_UNVERIFIED');
        // Exactly the native One Click payload, unlike Traditional submit.
        // FSU/Active Squad protection is enforced by the caller before this.
        if (ids) req.setRequestBody({ playerItemIds: ids, skipUserSquadValidation: true });
        await beforeDispatch();
        assert(); if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
        last = Date.now();
        return await new Promise((resolve, reject) => {
          let done = false; const owner = {};
          const finish = (error, value) => {
            if (done) return; done = true; clearTimeout(timer); cancelActive = null;
            try { req.unobserve(owner); } catch { /* Only our observer. */ }
            if (error) reject(error); else resolve(value);
          };
          cancelActive = () => {
            stopped = true; finish(Error('FC27_STREAMLINED_CONTRIBUTION_UNCONFIRMED'));
            try { req.abort(); } catch { /* Abort does not prove non-commit. */ }
          };
          const timer = setTimeout(() => cancelActive?.(), 11000);
          try {
            req.observe(owner, (sender, reply) => {
              if (done) return;
              try { assert(); if (sender !== req) fail('RESPONSE_OWNER'); finish(null, reply); }
              catch { stopped = true; finish(Error('FC27_STREAMLINED_CONTRIBUTION_UNCONFIRMED')); }
            });
            assert(); if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
            req.send();
          } catch { stopped = true; finish(Error('FC27_STREAMLINED_CONTRIBUTION_UNCONFIRMED')); }
        });
      } finally { busy = false; }
    },
    assert,
    cancel() { stopped = true; cancelActive?.(); },
  });
}
