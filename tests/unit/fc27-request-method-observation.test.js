import { expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import observation from '../fixtures/fc27-request-method-observation-2026-10-09.json';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { FC27_CLUB_READ_METHODS, createFc27ClubReadTransport, isFc27ClubCompatibleHash } from '../../src/adapters/ea/fc27-club-read.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';

function capturedRuntime() {
  const { root } = executionRuntime();
  const original = root.EAHttpRequest.prototype;
  for (const [path, row] of Object.entries(observation.methods)) {
    expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
    const fn = vm.runInNewContext(`(${row.source})`); // Compile only, never call native request bodies.
    if (!path.includes('.')) root[path] = fn;
  }
  root.EAHttpRequest.prototype = Object.create(original);
  root.UTHttpRequest.prototype = Object.create(root.EAHttpRequest.prototype);
  for (const [path, row] of Object.entries(observation.methods)) if (path.includes('.')) {
    const parts = path.split('.'), key = parts.pop();
    parts.reduce((value, part) => value[part], root)[key] = vm.runInNewContext(`(${row.source})`);
  }
  root.crypto = webcrypto;
  return root;
}

it('accepts all seven real October 9 request sources with real SHA256 in Club and generic verification', async () => {
  const root = capturedRuntime();
  await expect(createFc27ClubReadTransport(root)).resolves.toBeTruthy();
  const assert = await verifyFc27Methods(root, FC27_CLUB_READ_METHODS.slice(0, 7));
  expect(() => assert()).not.toThrow();
  root.EAHttpRequest.prototype.abort = () => {};
  expect(() => assert()).toThrow('FC27_TRANSACTION_RUNTIME_CHANGED');
});

it.each(Object.entries(observation.methods))('scopes the current %s fingerprint to that exact path', (path, row) => {
  expect(isFc27ClubCompatibleHash(path, row.sha256)).toBe(true);
  expect(isFc27ClubCompatibleHash('service.bid', row.sha256)).toBe(false);
  expect(isFc27ClubCompatibleHash('service.move', row.sha256)).toBe(false);
  expect(isFc27ClubCompatibleHash(path, '0'.repeat(64))).toBe(false);
});

it('does not approve a request fingerprint as a bid or accept an unknown request wrapper', async () => {
  const root = capturedRuntime();
  await expect(verifyFc27Methods({ service: { bid: root.UTHttpRequest }, crypto: webcrypto },
    [['service.bid', '0'.repeat(64)]]))
    .rejects.toMatchObject({ message: 'FC27_TRANSACTION_METHOD_UNREVIEWED', methodPath: 'service.bid' });
  root.UTHttpRequest = () => {};
  await expect(createFc27ClubReadTransport(root)).rejects.toMatchObject({
    message: 'FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_0_CHANGED', methodPath: 'UTHttpRequest',
    observedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

it('replays the reviewed decoded request contract with a local XHR stub, no network or credentials', () => {
  const calls = [];
  class XHR {
    static UNSENT = 0; static DONE = 4;
    readyState = 0;
    open(...args) { calls.push(['open', ...args]); }
    setRequestHeader(...args) { calls.push(['header', ...args]); }
    send(...args) { calls.push(['send', ...args]); }
    abort() { calls.push(['abort']); }
  }
  const ctx = vm.createContext({ XMLHttpRequest: XHR, HttpContentType: { JSON: 'application/json' },
    HttpRequestMethod: { GET: 'GET', POST: 'POST', DELETE: 'DELETE' },
    EAConfigurationRepository: { KEY_REQUEST_TIMEOUT: 'timeout' },
    getAppMain: () => ({ getConfigRepository: () => ({ getConfigNumber: () => 15000 }) }),
    JSUtils: { isEmpty: value => !value }, DebugUtils: { Assert: () => { throw Error('invalid request'); } },
    a0_0x351b: () => {}, _0x37b64a: () => {}, _0x512d02: () => {}, _0x27f578: function Observable() {},
  });
  const compile = path => vm.runInContext(`(${observation.methods[path].decoded})`, ctx);
  const EA = compile('EAHttpRequest'); ctx._0x3bbc46 = EA;
  const UT = compile('UTHttpRequest'); Object.setPrototypeOf(UT.prototype, EA.prototype);
  for (const [path, row] of Object.entries(observation.methods)) if (path.includes('.')) {
    const [name, , method] = path.split('.'); (name === 'EAHttpRequest' ? EA : UT).prototype[method] = compile(path);
    expect(row.decoded).not.toMatch(/\[(?:_0x|a0_0x)[a-f0-9]+\(/);
  }
  Object.assign(EA.prototype, { _setDefaultHeaders() {}, onAbort() {}, onError() {}, onTimeout() {}, onLoadEnd() {} });
  const req = new UT({ getUtasSession: () => ({ url: 'https://utas.test.ea.com' }) });
  expect(req).toMatchObject({ doRetry: true, doReauth: true, requestType: 'GET', requestHeaders: [], timeout: 15000 });
  req.doRetry = false; req.doReauth = false; req.requestType = 'POST';
  req.setPath('/ut/game/fc27/club'); req.setRequestBody({ type: 'player', start: 0, count: 250, defId: '901' });
  expect(req.url).toBe('https://utas.test.ea.com/ut/game/fc27/club');
  expect(req.requestBody).toBe('{"count":250,"defId":"901","start":0,"type":"player"}');
  req.send(); req.abort();
  expect(calls).toEqual([['open', 'POST', req.url, true], ['send', req.requestBody], ['abort']]);
  expect(req).toMatchObject({ doRetry: false, doReauth: false });
});
