import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS } from './fc27-club-read.js';

const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const fail = reason => { throw new Error(reason); };
export async function verifyFc27Methods(root, definitions) {
  const methods = new Map();
  for (const [path, expected] of definitions) {
    const fn = at(root, path);
    if (typeof fn !== 'function') return fail('FC27_TRANSACTION_METHOD_UNREVIEWED');
    const source = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
    if (source.length > 20000) return fail('FC27_TRANSACTION_METHOD_UNREVIEWED');
    const digest = await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) return fail('FC27_TRANSACTION_METHOD_UNREVIEWED');
    methods.set(path, fn);
  }
  return () => {
    for (const [path, fn] of methods) if (at(root, path) !== fn) return fail('FC27_TRANSACTION_RUNTIME_CHANGED');
  };
}

// Same endpoints and body as the reviewed DAO, using our own request to disable
// queue retries. No Service submit (which implicitly saves again), cookies or tokens.
export async function createFc27TransactionTransport(root, { canWrite = () => false } = {}) {
  const context = readFc27Context(root);
  const runtime = await verifyFc27Methods(root, FC27_CLUB_READ_METHODS);
  const Request = ownData(root, 'UTHttpRequest');
  const auth = at(root, 'services.SBC.sbcDAO.authDelegate');
  const game = ownData(root, 'GAME_NAME');
  if (!auth || typeof game !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(game)) return fail('FC27_TRANSACTION_RUNTIME_CHANGED');
  let active = null;
  let stopped = false;
  let busy = false;
  let last = -Infinity;
  const assert = () => {
    runtime();
    if (stopped || JSON.stringify(context) !== JSON.stringify(readFc27Context(root))
        || at(root, 'services.SBC.sbcDAO.authDelegate') !== auth) return fail('FC27_TRANSACTION_CONTEXT_CHANGED');
  };
  async function request(action, target = {}) {
    if (busy || stopped) return fail('FC27_TRANSACTION_TRANSPORT_BLOCKED');
    const id = target.challengeId;
    const mutation = action === 'save' || action === 'submit';
    if (!['unassigned', 'packs', 'save', 'submit'].includes(action)
        || mutation && (!Number.isSafeInteger(id) || id <= 0 || canWrite() !== true)) return fail('FC27_LIVE_DISABLED');
    if (action === 'save' && (!Array.isArray(target.players) || target.players.length < 11 || target.players.length > 32
        || new Set(target.players.map(player => player.index)).size !== target.players.length
        || new Set(target.players.slice(0, 11).map(player => player.itemData?.id)).size !== 11
        || target.players.some((player, index) => player.index !== index
          || !Number.isSafeInteger(player.itemData?.id) || (index < 11 ? player.itemData.id < 1 : ![0, -1].includes(player.itemData.id))
          || player.itemData.dream !== false))) {
      return fail('FC27_SAVE_INPUT_UNVERIFIED');
    }
    busy = true;
    try {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - last))));
      assert();
      if (mutation && canWrite() !== true) return fail('FC27_LIVE_DISABLED');
      const req = new Request(auth);
      if (req.send !== at(root, 'UTHttpRequest.prototype.send')
          || req.setPath !== at(root, 'UTHttpRequest.prototype.setPath')
          || req.setRequestBody !== at(root, 'EAHttpRequest.prototype.setRequestBody')
          || req.abort !== at(root, 'EAHttpRequest.prototype.abort')) return fail('FC27_TRANSACTION_RUNTIME_CHANGED');
      req.doRetry = false; req.doReauth = false; req.timeout = 10000;
      req.requestType = mutation ? 'PUT' : 'GET';
      const endpoint = `/ut/game/${game}/${action === 'unassigned' ? 'purchased/items'
        : action === 'packs' ? 'store/purchaseGroup/all' : `sbs/challenge/${id}${action === 'save' ? '/squad' : ''}`}`;
      req.setPath(endpoint);
      const url = new URL(ownData(req, 'url'));
      if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint
          || url.search || url.hash || url.username || url.password) return fail('FC27_TRANSACTION_ENDPOINT_UNVERIFIED');
      if (action === 'save') req.setRequestBody({ players: target.players.map(player => ({ index: player.index,
        itemData: { id: player.itemData.id, dream: false } })) });
      // This DAO argument is always false. Never inherit the account's skip setting.
      if (action === 'submit') { url.searchParams.set('skipUserSquadValidation', 'false'); req.url = url.href; }
      last = Date.now();
      return await new Promise((resolve, reject) => {
        const owner = {}; let done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true; clearTimeout(timer); active = null;
          try { req.unobserve(owner); } catch { /* Only detach our observer. */ }
          if (error) reject(error); else resolve(value);
        };
        active = () => {
          stopped = true; finish(new Error('FC27_TRANSACTION_REQUEST_UNCONFIRMED'));
          try { req.abort(); } catch { /* Abort is not evidence of non-commit. */ }
        };
        const timer = setTimeout(() => active?.(), 11000);
        try {
          req.observe(owner, (sender, reply) => {
            if (done) return;
            try {
              assert();
              if (sender !== req) return fail('FC27_TRANSACTION_RESPONSE_OWNER');
              finish(null, reply);
            } catch { stopped = true; finish(new Error('FC27_TRANSACTION_REQUEST_UNCONFIRMED')); }
          });
          assert();
          if (mutation && canWrite() !== true) return fail('FC27_LIVE_DISABLED');
          req.send();
        } catch { stopped = true; finish(new Error('FC27_TRANSACTION_REQUEST_UNCONFIRMED')); }
      });
    } finally { busy = false; }
  }
  return Object.freeze({ request, assert, cancel() { stopped = true; active?.(); } });
}
