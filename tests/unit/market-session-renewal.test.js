import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { FC27_MARKET_SESSION_METHODS, renewFc27MarketSession } from '../../src/adapters/ea/fc27-market-session-renewal.js';
import publicMethods from '../fixtures/fc27-market-session-public-methods.json';

function fixture() {
  const { root } = executionRuntime(), calls = [], pending = [], cleanups = [];
  const control = { auth: { success: true, status: 200, response: { environment: 1 } }, hold: null };
  const observable = kind => {
    const value = { observe(owner, callback) {
      const fire = dto => callback(value, dto ?? (kind === 'auth' ? control.auth : { success: false, status: 503 }));
      pending.push({ kind, fire, value });
      if (control.hold !== kind) fire();
    }, unobserve() { cleanups.push(kind); } }; return value;
  };
  class Auth {
    authenticate() { calls.push('auth'); return observable('auth'); }
    authUTAS() { throw Error('native stub must not be called'); }
    getUtasSession() { throw Error('credentials must not be inspected'); }
    requestTelemetry() { calls.push('telemetry'); return observable('telemetry'); }
  }
  const auth = new Auth(); root.FCAuthenticationService = Auth; root.AuthEnvironment = { UTAS: 1 };
  root.services.Item = { itemDao: { authDelegate: auth } };
  const hashes = new Map(FC27_MARKET_SESSION_METHODS.map(([path, hash]) => [String(Auth.prototype[path.split('.').at(-1)]), hash]));
  root.crypto = { subtle: { digest: async (_algorithm, bytes) => Buffer.from(hashes.get(new TextDecoder().decode(bytes)) ?? '00'.repeat(32), 'hex') } };
  const beforeDispatch = vi.fn(), onPhase = vi.fn();
  return { root, auth, control, calls, pending, cleanups, hashes, beforeDispatch, onPhase,
    run: () => renewFc27MarketSession(root, { beforeDispatch, onPhase }) };
}

it('pins the independently captured public methods and native UTAS enum', () => {
  expect(publicMethods.utasEnvironment).toBe(1);
  for (const [path, hash] of FC27_MARKET_SESSION_METHODS) {
    expect(createHash('sha256').update(publicMethods.methods[path].source).digest('hex')).toBe(hash);
  }
});
it('renews once, follows native telemetry completion even when disabled, and exports no credentials', async () => {
  const f = fixture(); await f.run();
  expect(f.calls).toEqual(['auth', 'telemetry']); expect(f.cleanups).toEqual(f.calls);
  expect(f.onPhase.mock.calls.map(([row]) => row.status)).toEqual(['started','completed','started','completed']);
  expect(JSON.stringify(f.onPhase.mock.calls)).not.toMatch(/response|token|currency/i);
});
it('uses the captured native authenticate dispatch without replacing native auth behavior', async () => {
  const f = fixture(); const raw = publicMethods.methods['FCAuthenticationService.prototype.authenticate'].decoded;
  const context = { _0x370cf4: null, _0x35f563: { MAX_FAILED_AUTH_ATTEMPTS: 3 },
    EAObservable: class {}, EAHttpResponseDTO: class {}, AuthEnvironment: { UTAS: 1, FCAS: 2 },
    services: { Module: { set: vi.fn() } } };
  const native = vm.runInNewContext(`(${raw})`, context);
  const original = f.root.FCAuthenticationService.prototype.authenticate;
  f.root.FCAuthenticationService.prototype.authenticate = native;
  f.hashes.set(String(native), f.hashes.get(String(original)));
  const delegate = f.root.FCAuthenticationService.prototype;
  const authUTAS = function () { return original.call(this); };
  f.hashes.set(String(authUTAS), FC27_MARKET_SESSION_METHODS.find(([path]) => path.endsWith('.authUTAS'))[1]);
  delegate.authUTAS = authUTAS; f.auth.failedUtasAuthAttempts = 0;
  await f.run(); expect(f.calls).toEqual(['auth','telemetry']);
});
it.each([401,403,429])('stops on native authentication failure %s without telemetry', async status => {
  const f = fixture(); f.control.auth = { success: false, status, response: { environment: 1 } };
  await expect(f.run()).rejects.toMatchObject({ code: status }); expect(f.calls).toEqual(['auth']);
});
it('preserves authentication business restriction codes, including missing response', async () => {
  const f = fixture(); f.control.auth = { success: false, status: 403, error: { code: 459 } };
  await expect(f.run()).rejects.toMatchObject({ code: 459 }); expect(f.calls).toEqual(['auth']);
});
it.each(['auth','telemetry'])('times out %s and ignores late callbacks', async kind => {
  vi.useFakeTimers();
  try {
    const f = fixture(); f.control.hold = kind;
    const result = f.run(); const rejected = expect(result).rejects.toThrow('RENEWAL_TIMEOUT');
    await vi.advanceTimersByTimeAsync(16001); await rejected;
    const calls = [...f.calls]; f.pending.find(row => row.kind === kind).fire();
    await vi.runAllTimersAsync(); expect(f.calls).toEqual(calls); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it.each(['stop','account','runtime'])('cancels pending renewal on %s change without subsequent requests', async change => {
  vi.useFakeTimers();
  try {
    const f = fixture(); f.control.hold = 'auth';
    const result = f.run(); const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    if (change === 'stop') f.beforeDispatch.mockImplementation(() => { throw Error('stopped'); });
    if (change === 'account') f.root.services.User.currentUserId++;
    if (change === 'runtime') f.auth.authenticate = () => { throw Error('changed'); };
    await vi.advanceTimersByTimeAsync(101); await rejected;
    f.pending[0].fire(); await vi.runAllTimersAsync();
    expect(f.calls).toEqual(['auth']); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('rejects an unreviewed auth method before making requests', async () => {
  const f = fixture(); f.hashes.clear(); await expect(f.run()).rejects.toThrow('UNREVIEWED'); expect(f.calls).toEqual([]);
});
it('isolates diagnostic exceptions and ignores notifications for a different auth environment', async () => {
  const f = fixture(); f.control.hold = 'auth'; f.onPhase.mockImplementation(() => { throw Error('log failed'); });
  const result = f.run();
  await vi.waitFor(() => expect(f.pending).toHaveLength(1));
  f.pending[0].fire({ success: true, response: { environment: 2 } }); expect(f.calls).toEqual(['auth']);
  f.pending[0].fire(); await result; expect(f.calls).toEqual(['auth','telemetry']);
});
