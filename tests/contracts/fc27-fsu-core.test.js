import { describe, expect, it, vi } from 'vitest';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import vm from 'node:vm';
import { buildFsuCore } from '../../scripts/build-fc27-fsu-core.mjs';
import { createRunnerSupportCore, installRunnerSupportBridge, readLegacyPolicyReview } from '../../FSU_mod/src/runner-support/core.js';

const scope = { season: '27', accountScope: 'a', platform: 'pc' };
const policy = { schema: 1, reviewed: true, policy: { onlyUntradeable: true, excludeEvolution: true,
  protectFsuLockedPlayers: true, protectActiveSquad: false, maxRating: 85,
  storageFirst: true, goldRange: [75, 85], excludedLeagueIds: [] } };
const refs = [{ id: 123, definitionId: 456, safetyFingerprint: 'safe-v1' }];
function fixture() {
  let context = scope;
  const values = new Map([[contextKey(scope, 'fsu-policy'), JSON.stringify(policy)]]);
  const storage = { get: vi.fn(key => values.get(key)) };
  const inventory = { describe: vi.fn(() => ({ context, status: 'provisional' })),
    refreshClub: vi.fn(async () => ({ context, status: 'refreshed' })),
    validateClubPlayers: vi.fn(async () => ({ context, status: 'validated', items: refs })) };
  const core = createRunnerSupportCore({ readContext: () => context, storage, inventory });
  return { core, storage, inventory, values, setContext: value => { context = value; } };
}

describe('offline FSU Runner-support core', () => {
  it('initializes without any legacy EA Controller/UI and fails closed without providers', async () => {
    const core = createRunnerSupportCore({ readContext: () => scope, storage: { get: () => null } });
    expect(core.describe().status).toBe('not-ready');
    await expect(core.refreshClub()).rejects.toThrow('FSU_NOT_READY');
    expect(Object.keys(core)).not.toEqual(expect.arrayContaining(['submit', 'open', 'move', 'getValue']));
  });
  it('keeps provisional state and validates exact IDs and safety fingerprints', async () => {
    const { core, inventory } = fixture();
    expect(core.describe().status).toBe('ready');
    expect(core.getClubState().status).toBe('provisional');
    expect((await core.validateClubPlayers(refs)).status).toBe('validated');
    inventory.validateClubPlayers.mockResolvedValueOnce({ context: scope, status: 'validated', items: [{ ...refs[0], id: 999 }] });
    await expect(core.validateClubPlayers(refs)).rejects.toThrow('MISSING');
    inventory.validateClubPlayers.mockResolvedValueOnce({ context: scope, status: 'validated', items: [{ ...refs[0], safetyFingerprint: 'changed' }] });
    await expect(core.validateClubPlayers(refs)).rejects.toThrow('CHANGED');
  });
  it('does not read legacy lock_26 and refuses corrupt/unchecked policies', async () => {
    const { core, storage, values } = fixture();
    values.set('lock_26', JSON.stringify([999]));
    expect(core.getLocks().itemIds).toEqual([]);
    values.set(contextKey(scope, 'fsu-locks'), JSON.stringify({ schema: 1, ids: [123] }));
    expect(core.getLocks().itemIds).toEqual([123]);
    expect(storage.get.mock.calls.flat()).not.toContain('lock_26');
    values.set(contextKey(scope, 'fsu-locks'), JSON.stringify({ schema: 1, ids: ['bad'] }));
    expect(core.describe().status).toBe('not-ready');
    values.delete(contextKey(scope, 'fsu-locks'));
    values.set(contextKey(scope, 'fsu-policy'), JSON.stringify({ ...policy, reviewed: false }));
    await expect(core.refreshClub()).rejects.toThrow('NOT_READY');
  });
  it('checks context again after asynchronous work and rejects overlapping reads', async () => {
    const { core, inventory, setContext } = fixture();
    let resolve;
    inventory.validateClubPlayers.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = core.validateClubPlayers(refs);
    await Promise.resolve();
    await expect(core.refreshClub()).rejects.toThrow('FSU_BUSY');
    setContext({ ...scope, accountScope: 'b' });
    resolve({ context: scope, status: 'validated', items: refs });
    await expect(pending).rejects.toThrow('FSU_SCOPE_CHANGED');
  });
  it('installs idempotently and uninstalls only its own bridge', () => {
    const root = {};
    const { core } = fixture();
    const remove = installRunnerSupportBridge(root, core);
    installRunnerSupportBridge(root, core);
    expect(() => installRunnerSupportBridge(root, {})).toThrow('OWNED');
    Object.defineProperty(root, 'FSULocalRunnerBridge', { value: 'replacement' });
    remove();
    expect(root.FSULocalRunnerBridge).toBe('replacement');
  });
  it('only reads serialized legacy settings for manual review', () => {
    const get = vi.fn(key => key === 'build' ? JSON.stringify({ onlyUntradeable: true, goldRange: [75, 85] }) : '{}');
    expect(readLegacyPolicyReview({ get }).status).toBe('review-required');
    expect(get.mock.calls.flat()).toEqual(['build', 'set']);
  });
  it('builds independently without evaluating old FSU enhancement code', async () => {
    const result = await buildFsuCore();
    expect(result.inputs).toHaveLength(4);
    const sandbox = {};
    vm.runInNewContext(result.source, sandbox);
    const core = sandbox.FSURunnerSupportCore.createRunnerSupportCore({ readContext: () => scope, storage: { get: () => null } });
    expect(core.describe().status).toBe('not-ready');
    expect(result.source).not.toMatch(/\.prototype\s*=|\/fc26\/|GM_xmlhttpRequest/);
  });
  it('rejects failed refresh and stale provider scope', async () => {
    const { core, inventory } = fixture();
    inventory.refreshClub.mockResolvedValueOnce({ context: scope, status: 'failed' });
    await expect(core.refreshClub()).rejects.toThrow('UNCONFIRMED');
    inventory.describe.mockReturnValue({ context: { ...scope, accountScope: 'other' }, status: 'ready' });
    expect(core.getClubState().status).toBe('not-ready');
    expect(core.describe().status).toBe('not-ready');
  });
  it('keeps the read lock after timeout until the original provider settles', async () => {
    vi.useFakeTimers();
    try {
      const { inventory, storage } = fixture();
      let resolve;
      inventory.validateClubPlayers.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      const core = createRunnerSupportCore({ readContext: () => scope, inventory, storage, timeoutMs: 10 });
      const pending = core.validateClubPlayers(refs);
      const rejected = expect(pending).rejects.toThrow('TIMEOUT');
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      await expect(core.refreshClub()).rejects.toThrow('BUSY');
      resolve({ context: scope, status: 'validated', items: refs });
      await Promise.resolve();
      await Promise.resolve();
      expect(core.describe().status).toBe('ready');
    } finally { vi.useRealTimers(); }
  });
});
