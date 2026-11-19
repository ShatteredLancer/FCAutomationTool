import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import observed from '../fixtures/fc27-build-11502-method-digests.json';
import { FC27_CLUB_READ_METHODS, isFc27ClubCompatibleHash } from '../../src/adapters/ea/fc27-club-read.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';
import { FC27_STREAMLINED_PAGE_METHODS, FC27_STREAMLINED_PAGE_COMPATIBLE_HASHES } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { FC27_BUY_SERVICE_METHODS, FC27_BUY_COMPATIBLE_HASHES } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { FC27_STREAMLINED_STORAGE_COMPATIBLE_HASHES, FC27_STREAMLINED_STORAGE_HASH,
  FC27_STREAMLINED_STORAGE_QUERY_HASH } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';

// Wiring/scope test only. Real source hashes and decoded behavior were compared
// separately against the public asset without calling native I/O functions.
const scopes = [
  ...FC27_CLUB_READ_METHODS.filter(([path]) => Object.hasOwn(observed.methods, path)).map(definition => [definition, undefined]),
  [FC27_STREAMLINED_PAGE_METHODS[1], FC27_STREAMLINED_PAGE_COMPATIBLE_HASHES],
  ...FC27_BUY_SERVICE_METHODS.map(([path, hash]) => [[`service.${path}`, hash], FC27_BUY_COMPATIBLE_HASHES]),
  [['methods.search', FC27_STREAMLINED_STORAGE_HASH], FC27_STREAMLINED_STORAGE_COMPATIBLE_HASHES],
  [['methods.query', FC27_STREAMLINED_STORAGE_QUERY_HASH], FC27_STREAMLINED_STORAGE_COMPATIBLE_HASHES],
];

it('registers every measured build 11502 digest only at the relevant method path', async () => {
  expect(scopes.map(([[path]]) => path).sort()).toEqual(Object.keys(observed.methods).sort());
  expect(isFc27ClubCompatibleHash('EAObservable.prototype.notify', observed.methods['methods.notify'])).toBe(true);
  for (const [[path, expected], allow] of scopes) {
    const pieces = path.split('.');
    const fn = function nativeMethodFixture() { throw Error('Fixture must not execute'); };
    const stub = Function.prototype.toString.call(fn);
    const root = { crypto: { subtle: { digest(algorithm, source) {
      return new TextDecoder().decode(source) === stub ? Promise.resolve(Buffer.from(observed.methods[path], 'hex')) : webcrypto.subtle.digest(algorithm, source);
    } } }, unrelated: { method: fn } };
    const field = pieces.pop();
    const owner = pieces.reduce((node, key) => node[key] ??= {}, root);
    owner[field] = fn;
    const guard = await verifyFc27Methods(root, [[path, expected]], allow);
    expect(() => guard()).not.toThrow();
    await expect(verifyFc27Methods(root, [['unrelated.method', expected]], allow)).rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
    owner[field] = () => {};
    expect(() => guard()).toThrow('FC27_TRANSACTION_RUNTIME_CHANGED');
    await expect(verifyFc27Methods(root, [[path, expected]], allow)).rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  }
});
