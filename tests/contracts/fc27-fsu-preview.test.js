import { expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { buildFsuPreview } from '../../scripts/build-fc27-fsu-preview.mjs';
import { installFc27Fsu } from '../../FSU_mod/src/fc27-bootstrap.js';

it('builds with FSU storage identity and no legacy runtime, third-party requires or release URLs', async () => {
  const result = await buildFsuPreview();
  expect(result.source).toContain('// @name         \u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668');
  expect(result.source).toContain('// @namespace    https://futcd.com/');
  expect(result.source).toContain('// @updateURL    none');
  expect(result.releaseEligible).toBe(false);
  expect(result.inputs).toHaveLength(19);
  expect(result.source).not.toMatch(/function futweb|lock_26|player-prices\/26|enhancer-api|@require|services\.Item\.move|submitChallenge|saveSquad/);
  const get = vi.fn();
  vm.runInNewContext(result.source, { unsafeWindow: { APP_YEAR_SHORT: 26 }, GM_getValue: get });
  expect(get).not.toHaveBeenCalled();
});
it('installs an unready read-only bridge before login without requiring legacy page classes', () => {
  const root = { APP_YEAR_SHORT: 27 };
  const get = vi.fn((_key, fallback) => fallback);
  const set = vi.fn();
  const mount = vi.fn(() => vi.fn());
  const remove = installFc27Fsu({ root, document: { getElementById: () => null }, get, set, mount });
  expect(root.FSULocalRunnerBridge.describe().status).toBe('not-ready');
  expect(root.FSULocalRunnerBridge.setValue).toBeUndefined();
  expect(root.FSULocalRunnerBridge.savePolicy).toBeUndefined();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(set).not.toHaveBeenCalled();
  remove();
  expect(root.FSULocalRunnerBridge).toBeUndefined();
});
it('isolates installation diagnostics from readiness and page mutation authority', () => {
  const root = { APP_YEAR_SHORT: 27 };
  const diagnostic = { schema: 1, gmWriteRead: true, previousLoad: true };
  const args = { root, document: { getElementById: () => null }, get: (_key, fallback) => fallback, set: vi.fn(), mount: () => () => {} };
  const remove = installFc27Fsu({ ...args, inspectInstallation: () => diagnostic });
  expect(root.FSULocalRunnerBridge.describe()).toMatchObject({ status: 'not-ready', installation: diagnostic });
  expect(root.FSULocalRunnerBridge.checkInstallation).toBeUndefined();
  expect(args.set).not.toHaveBeenCalled();
  remove();
  expect(() => installFc27Fsu({ ...args, inspectInstallation: () => { throw new Error('diagnostic failure'); } })).not.toThrow();
  expect(root.FSULocalRunnerBridge.describe().installation).toBeNull();
});
it('rejects existing FSU and cleans up its bridge when optional UI mounting fails', () => {
  const args = { root: { APP_YEAR_SHORT: 27, info: {} }, document: { getElementById: () => null }, get: () => null, set: () => {} };
  expect(() => installFc27Fsu(args)).toThrow('LEGACY');
  delete args.root.info;
  expect(() => installFc27Fsu({ ...args, mount: () => { throw new Error('UI failure'); } })).toThrow('UI failure');
  expect(args.root.FSULocalRunnerBridge).toBeUndefined();
});
