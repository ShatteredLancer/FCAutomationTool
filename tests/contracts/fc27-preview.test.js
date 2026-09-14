import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { buildFc27Preview } from '../../scripts/build-fc27-preview.mjs';
import { inspectPrelaunchRuntime } from '../../src/fc27/runtime.js';
import { inspectFc27Environment } from '../../src/adapters/browser/fc27-inspection.js';

describe('isolated FC27 preview', () => {
  it('bundles without legacy workflows or write APIs and runs without EA/FSU', async () => {
    const { script, manifest } = await buildFc27Preview();
    const info = vi.fn();
    vm.runInNewContext(script, { unsafeWindow: {}, console: { info } });
    expect(info.mock.calls[0][1].runtime.liveExecutionEnabled).toBe(false);
    expect(manifest.inputs).toHaveLength(4);
    expect(manifest.bytes).toBeLessThan(30_000);
    expect(script).not.toMatch(/@(?:updateURL|downloadURL|connect)|GM_setValue|\.submitChallenge\(/);
  });
  it('never enables Live even with a complete synthetic bridge', () => {
    const context = { season: '27', platform: 'pc', accountScope: 'a' };
    const describe = vi.fn(() => ({ ...context, bridgeSchema: 1, status: 'ready', capabilities: {
      policy: true, locks: true, club: true, targetedValidation: true,
    } }));
    expect(inspectPrelaunchRuntime({ context, bridge: { describe } })).toMatchObject({
      reason: 'FC27_RUNTIME_CONTRACT_UNVERIFIED', liveExecutionEnabled: false,
    });
    expect(inspectPrelaunchRuntime({ context: { ...context, accountScope: 'b' }, bridge: { describe } }).reason)
      .toBe('FSU_SCOPE_MISMATCH');
    expect(inspectPrelaunchRuntime({ context: { ...context, season: '26' }, bridge: { describe } }).reason)
      .toBe('UNSUPPORTED_SEASON');
  });
  it('does not execute EA getters or expose runtime data', () => {
    const getter = vi.fn(() => { throw new Error('unsafe'); });
    const root = { APP_YEAR_SHORT: 27, privateAccount: 'secret' };
    Object.defineProperty(root, 'services', { get: getter });
    expect(inspectFc27Environment(root, 'fixture').observed.services).toBe('accessor');
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(inspectFc27Environment(root))).not.toContain('secret');
  });
});
