import { expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import observation from '../fixtures/fc27-notify-observation-2026-10-09.json';
import { FC27_PUZZLE_SYNC_METHODS } from '../../src/adapters/ea/fc27-puzzle-page.js';
import { FC27_STREAMLINED_PAGE_COMPATIBLE_HASHES } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';

const normalize = source => {
  const names = new Map();
  return source.replace(/(?:_0x|a0_0x)[0-9a-f]+/g, name => {
    if (!names.has(name)) names.set(name, `v${names.size}`);
    return names.get(name);
  });
};

it('accepts the real October 9 notify source only at its reviewed path', async () => {
  for (const row of [observation.baseline, observation.current]) {
    expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
    const notify = vm.runInNewContext(`(${row.source})`);
    const root = { EAObservable: { prototype: { notify } }, crypto: webcrypto };
    const check = await verifyFc27Methods(root, FC27_PUZZLE_SYNC_METHODS.slice(1));
    expect(() => check()).not.toThrow();
    if (row === observation.current) {
      const aliasCheck = await verifyFc27Methods({ methods: { notify }, crypto: webcrypto },
        [['methods.notify', FC27_STREAMLINED_PAGE_COMPATIBLE_HASHES['methods.notify'][0]]],
        FC27_STREAMLINED_PAGE_COMPATIBLE_HASHES);
      expect(() => aliasCheck()).not.toThrow();
    }
    root.EAObservable.prototype.notify = () => {};
    expect(() => check()).toThrow('FC27_TRANSACTION_RUNTIME_CHANGED');
    await expect(verifyFc27Methods({ service: { notify }, crypto: webcrypto }, [['service.notify', '0'.repeat(64)]]))
      .rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  }
});

it('retains identical asynchronous owner-first observer behavior after deobfuscation', () => {
  expect(normalize(observation.current.decoded)).toBe(normalize(observation.baseline.decoded));
  for (const row of [observation.baseline, observation.current]) {
    const tasks = []; const calls = []; const scope = {};
    const notify = vm.runInNewContext(`(${row.decoded})`, {
      _0x22dbd6: null, _0x5b6a53: null, setTimeout: (fn, delay) => tasks.push({ fn, delay }),
    });
    const owner = { _observers: [{ scope, cb(...args) { calls.push({ scope: this, args }); } }] };
    expect(notify.call(owner, { slots: [1] }, 2)).toBe(owner);
    expect(calls).toEqual([]); expect(tasks[0].delay).toBe(0);
    tasks[0].fn();
    expect(calls).toEqual([{ scope, args: [owner, { slots: [1] }, 2] }]);
  }
});
