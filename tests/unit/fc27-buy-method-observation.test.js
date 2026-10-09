import { expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import observation from '../fixtures/fc27-buy-method-observation.json';
import october9 from '../fixtures/fc27-buy-method-observation-2026-10-09.json';
import { FC27_BUY_SERVICE_METHODS, FC27_BUY_COMPATIBLE_HASHES } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';

const normalize = source => {
  const names = new Map();
  return source.replace(/(?:_0x|a0_0x)[0-9a-f]+/g, name => {
    if (!names.has(name)) names.set(name, `v${names.size}`);
    return names.get(name);
  });
};

it.each(['baseline', 'current'])('verifies real captured %s method bodies without invoking them', async version => {
  const service = {};
  for (const row of observation.versions[version]) {
    expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
    // Compilation only. These bodies have no account, request or DAO bindings.
    service[row.path.split('.').at(-1)] = vm.runInNewContext(`(${row.source})`);
  }
  const assert = await verifyFc27Methods({ service, crypto: webcrypto },
    FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash]), FC27_BUY_COMPATIBLE_HASHES);
  expect(() => assert()).not.toThrow();
  service.bid = () => {};
  expect(() => assert()).toThrow('FC27_TRANSACTION_RUNTIME_CHANGED');
});

it('records only identifier/obfuscation changes in both reviewed decoded method bodies', () => {
  for (const current of observation.versions.current) {
    const baseline = observation.versions.baseline.find(row => row.path === current.path);
    expect(normalize(current.decoded)).toBe(normalize(baseline.decoded));
  }
});

it('verifies October 9 public method bodies without executing a purchase or move', async () => {
  const service = {};
  for (const row of october9.methods) {
    expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
    service[row.path.split('.').at(-1)] = vm.runInNewContext(`(${row.source})`);
  }
  const assert = await verifyFc27Methods({ service, crypto: webcrypto },
    FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash]), FC27_BUY_COMPATIBLE_HASHES);
  expect(() => assert()).not.toThrow();
  service.move = () => {};
  expect(() => assert()).toThrow('FC27_TRANSACTION_RUNTIME_CHANGED');
});

it('keeps the October 9 decoded transaction bodies identical to the October 3 review', () => {
  expect(october9.methods).toHaveLength(2);
  for (const row of october9.methods) {
    const previous = observation.versions.current.find(old => old.path === row.path);
    expect(normalize(row.decoded)).toBe(normalize(previous.decoded));
  }
});

it.each(['bid', 'move'])('rejects an unreviewed %s wrapper and does not grant compatibility to other paths', async name => {
  const service = Object.fromEntries(october9.methods.map(row =>
    [row.path.split('.').at(-1), vm.runInNewContext(`(${row.source})`)]));
  await expect(verifyFc27Methods({ other: service, crypto: webcrypto },
    [[`other.${name}`, '0'.repeat(64)]], FC27_BUY_COMPATIBLE_HASHES))
    .rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  service[name] = () => {};
  await expect(verifyFc27Methods({ service, crypto: webcrypto },
    FC27_BUY_SERVICE_METHODS.map(([method, hash]) => [`service.${method}`, hash]), FC27_BUY_COMPATIBLE_HASHES))
    .rejects.toMatchObject({ message: 'FC27_TRANSACTION_METHOD_UNREVIEWED', methodPath: `service.${name}` });
});
