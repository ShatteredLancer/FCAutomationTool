import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS, isFc27ClubCompatibleHash } from './fc27-club-read.js';

const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const fail = reason => { throw new Error(reason); };
export async function verifyFc27Methods(root, definitions, compatibleHashes = {}) {
  const methods = new Map();
  for (const [path, expected] of definitions) {
    // The transaction transport never materializes entities. Gallery/FSU and
    // Enhancer are allowed to decorate this pure factory; Club/Market readers
    // enforce its exact output identity separately. Keep all request, auth,
    // save and submit methods strict here.
    if (path === 'UTItemEntityFactory.prototype.createItem') continue;
    const fn = at(root, path);
    if (typeof fn !== 'function') {
      const error = new Error('FC27_TRANSACTION_METHOD_UNREVIEWED');
      error.methodPath = path; error.observedHash = null;
      throw error;
    }
    const source = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
    if (source.length > 20000) {
      const error = new Error('FC27_TRANSACTION_METHOD_UNREVIEWED');
      error.methodPath = path; error.observedHash = 'oversized';
      throw error;
    }
    const digest = await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(source));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const scopedHashes = ownData(compatibleHashes, path);
    const compatible = Array.isArray(scopedHashes) ? scopedHashes.includes(hash) : hash === scopedHashes;
    if (hash !== expected && !isFc27ClubCompatibleHash(path, hash) && !compatible) {
      const error = new Error('FC27_TRANSACTION_METHOD_UNREVIEWED');
      error.methodPath = path; error.observedHash = hash; error.expectedHash = expected;
      throw error;
    }
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
  async function request(action, target = {}, beforeDispatch = null) {
    if (busy || stopped) return fail('FC27_TRANSACTION_TRANSPORT_BLOCKED');
    const id = target.challengeId;
    const mutation = action === 'save' || action === 'save-concept' || action === 'save-purchase' || action === 'submit';
    if (!['unassigned', 'packs', 'save', 'save-concept', 'save-purchase', 'submit'].includes(action)
        || mutation && (!Number.isSafeInteger(id) || id <= 0 || canWrite() !== true)) return fail('FC27_LIVE_DISABLED');
    if (action === 'save' || action === 'save-concept' || action === 'save-purchase') {
      // Only explicitly declared, provider-verified simple bricks may be empty
      // on the pitch. Existing traditional callers still require eleven players.
      const declaredBricks = target.simpleBrickIndices === undefined ? [] : target.simpleBrickIndices;
      const empty = action === 'save-purchase' ? target.emptySlotIndices : [];
      if (!Array.isArray(declaredBricks) || !Array.isArray(empty)
          || new Set(declaredBricks).size !== declaredBricks.length
          || declaredBricks.some(index => !Number.isInteger(index) || index < 0 || index >= 11)
          || new Set(empty).size !== empty.length || empty.some(index => !Number.isInteger(index) || index < 0 || index >= 11)) return fail('FC27_SAVE_INPUT_UNVERIFIED');
      const bricks = action === 'save-purchase' ? [...new Set([...declaredBricks, ...empty])] : declaredBricks;
      const concepts = action === 'save-concept' || action === 'save-purchase' ? target.conceptSlots : [];
      if (!Array.isArray(concepts) || action === 'save-concept' && !concepts.length
          || concepts.some(ref => !Number.isInteger(ref?.slot) || ref.slot < 0 || ref.slot >= 11
            || !Number.isSafeInteger(ref.definitionId) || ref.definitionId <= 0)
          || new Set(concepts.map(ref => ref.slot)).size !== concepts.length
          || new Set(concepts.map(ref => ref.definitionId)).size !== concepts.length) return fail('FC27_SAVE_INPUT_UNVERIFIED');
      if (!Array.isArray(bricks) || bricks.length >= 11 || new Set(bricks).size !== bricks.length
          || bricks.some(index => !Number.isInteger(index) || index < 0 || index >= 11)
          || !Array.isArray(target.players) || target.players.length < 11 || target.players.length > 32
          || new Set(target.players.slice(0, 11).filter((_, index) => !bricks.includes(index))
            .map(player => `${player?.itemData?.dream}:${player?.itemData?.id}`)).size !== 11 - bricks.length
          || target.players.some((player, index) => player?.index !== index
            || !Number.isSafeInteger(player?.itemData?.id)
            || (index < 11 && !bricks.includes(index) ? player.itemData.id < 1 : ![0, -1].includes(player.itemData.id))
            || player.itemData.dream !== concepts.some(ref => ref.slot === index)
            || concepts.some(ref => ref.slot === index && (bricks.includes(index) || player.itemData.id !== ref.definitionId)))
          || concepts.some(ref => !target.players[ref.slot]?.itemData?.dream)) return fail('FC27_SAVE_INPUT_UNVERIFIED');
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
        : action === 'packs' ? 'store/purchaseGroup/all' : `sbs/challenge/${id}${['save', 'save-concept', 'save-purchase'].includes(action) ? '/squad' : ''}`}`;
      req.setPath(endpoint);
      const url = new URL(ownData(req, 'url'));
      if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint
          || url.search || url.hash || url.username || url.password) return fail('FC27_TRANSACTION_ENDPOINT_UNVERIFIED');
      if (['save', 'save-concept', 'save-purchase'].includes(action)) req.setRequestBody({ players: target.players.map(player => ({ index: player.index,
        itemData: { id: player.itemData.id, dream: action !== 'save' ? player.itemData.dream === true : false } })) });
      // This DAO argument is always false. Never inherit the account's skip setting.
      if (action === 'submit') { url.searchParams.set('skipUserSquadValidation', 'false'); req.url = url.href; }
      // All network/body/layout preflight has finished. A Puzzle caller now
      // persists its write-ahead record, before this request can be sent.
      if (beforeDispatch !== null) {
        if (!['save', 'save-concept', 'save-purchase'].includes(action) || typeof beforeDispatch !== 'function') return fail('FC27_SAVE_INPUT_UNVERIFIED');
        await beforeDispatch();
        assert();
      }
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
