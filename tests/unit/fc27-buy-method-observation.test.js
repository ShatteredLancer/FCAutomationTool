import { expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import observation from '../fixtures/fc27-buy-method-observation.json';
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
