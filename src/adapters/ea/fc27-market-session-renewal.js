import { readFc27Context } from './fc27-local-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { ownData } from '../../fc27/prelaunch-contract.js';

// Public EA sources captured without login on 2026-11-17. Match the native
// _handleFail -> authenticate -> _handleReauth -> telemetry sequence, but let
// the caller create one NEW read, rather than enabling native request retries.
export const FC27_MARKET_SESSION_METHODS = Object.freeze([
  ['FCAuthenticationService.prototype.authenticate', 'b0b331aecf5ca99a657cf27862bc77fbef57083d998e9b290de768fbab41bc91'],
  ['FCAuthenticationService.prototype.authUTAS', 'cde9e7d4f0fe913433e329598a88e40de14b0df6292c6fdaa6e7f30070dee952'],
  ['FCAuthenticationService.prototype.getUtasSession', 'f6deec4ac3c788fa610e37721841db45f640fb46e4a04836103eae907c97414f'],
  ['FCAuthenticationService.prototype.requestTelemetry', 'c66d89d9248cd05ca0db8b24e4eb131c01de623550b8529057180ccbf247d860'],
]);
const fail = (reason, code = 401) => Object.assign(Error(`MARKET_SESSION_${reason}`), { code });

// Used only by the running task's locked maintenance turn after a plain 401.
// No token getter/storage access, global callback replacement or trade replay.
export async function renewFc27MarketSession(root, { beforeDispatch, onPhase = () => {} }) {
  if (typeof beforeDispatch !== 'function') throw fail('GUARD_REQUIRED');
  beforeDispatch();
  const context = JSON.stringify(readFc27Context(root));
  const auth = root.services?.Item?.itemDao?.authDelegate;
  const proto = root.FCAuthenticationService?.prototype;
  const runtime = await verifyFc27Methods(root, FC27_MARKET_SESSION_METHODS);
  const assert = () => {
    beforeDispatch(); runtime();
    if (context !== JSON.stringify(readFc27Context(root)) || !auth
      || root.services?.Item?.itemDao?.authDelegate !== auth || root.AuthEnvironment?.UTAS !== 1
      || FC27_MARKET_SESSION_METHODS.some(([path]) => auth[path.split('.').at(-1)] !== proto[path.split('.').at(-1)]))
      throw fail('CONTEXT_CHANGED');
  };
  assert();
  const report = (transportPhase, status, code) => {
    try { Promise.resolve(onPhase({ transportPhase, status, ...(Number.isSafeInteger(code) ? { errorCode: code } : {}) })).catch(() => {}); }
    catch { /* Diagnostic failures cannot initiate or prevent renewal. */ }
  };
  // One deadline covers auth and telemetry. The EA-owned shared auth operation
  // cannot safely be aborted; unsubscribe ONLY our observer on stop/timeout.
  // A late auth completion must never launch telemetry, a read or a trade.
  const deadline = Date.now() + 16000;
  const observe = (phase, operation, authentication) => new Promise((resolve, reject) => {
    const observer = {}; let observable; let done = false;
    const finish = (error) => {
      if (done) return; done = true; clearTimeout(timer); clearInterval(poll);
      try { observable?.unobserve(observer); } catch { /* Only our observer. */ }
      report(phase, error ? 'blocked' : 'completed', error?.code);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(fail('RENEWAL_TIMEOUT')), Math.max(0, deadline - Date.now()));
    const poll = setInterval(() => { try { assert(); } catch (error) { finish(error); } }, 100);
    try {
      assert(); if (Date.now() >= deadline) throw fail('RENEWAL_TIMEOUT');
      report(phase, 'started');
      assert();
      observable = operation();
      if (typeof observable?.observe !== 'function' || typeof observable?.unobserve !== 'function') throw fail('RENEWAL_UNVERIFIED');
      observable.observe(observer, (sender, dto) => {
        if (done) return;
        try {
          assert(); if (Date.now() >= deadline) throw fail('RENEWAL_TIMEOUT');
          if (sender !== observable) throw fail('RENEWAL_UNVERIFIED');
          // Match native ignoring unrelated shared authentication notifications.
          const response = ownData(dto, 'response');
          if (authentication && response && typeof response === 'object' && ownData(response, 'environment') !== 1) return;
          if (authentication && ownData(dto, 'success') !== true) {
            const status = ownData(dto, 'status'), code = ownData(ownData(dto, 'error'), 'code');
            throw fail('RENEWAL_FAILED', [403, 427, 429, 512, 521, 426, 459].includes(code) ? code
              : Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 401);
          }
          if (authentication && ownData(response, 'environment') !== 1) throw fail('RENEWAL_UNVERIFIED');
          // EA continues after telemetry completion even when telemetry is disabled.
          finish();
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
  await observe('session-renew-auth', () => auth.authenticate(1), true);
  assert();
  await observe('session-renew-telemetry', () => auth.requestTelemetry(), false);
  assert();
}
