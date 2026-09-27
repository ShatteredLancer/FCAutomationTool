import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FC27_RELEASE_ASSETS } from '../../scripts/package-fc27-release.mjs';
import { assertRelease } from '../../scripts/fc27-release-policy.mjs';
import { buildFc27Production } from '../../scripts/build-fc27-production.mjs';

async function inputs() {
  const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
  return { manifest: (await buildFc27Production()).manifest,
    fsu: await read('../../FSU_mod/fsu-mod-manifest.json'),
    fsuConfig: await read('../../FSU_mod/fsu-mod.config.json') };
}

it('packages production assets through the normal immutable release workflow', async () => {
  expect(FC27_RELEASE_ASSETS).toEqual([
    'FCAutomationTool.user.js', 'FCAutomationTool.meta.js', 'FCAutomationTool.manifest.json',
    'FSU-Local.user.js', 'FSU-Local.meta.js', 'FSU-Local.manifest.json', 'SHA256SUMS',
  ]);
  const workflow = await readFile(new URL('../../.github/workflows/release-assets.yml', import.meta.url), 'utf8');
  expect(workflow).toContain('node scripts/package-fc27-release.mjs');
  expect(workflow).toContain('node scripts/browser-inspection/run.mjs --self-test');
  expect(workflow).toContain('already published and must remain immutable');
  expect(workflow).not.toMatch(/FCAutomationTool\.loops|build:profiles|profiles\.zip|DailyLoopRunner|\(Read-only\)/);
});

it('accepts the current production build without a manual hash approval or old installation fixture', async () => {
  const input = await inputs();
  expect(assertRelease(input)).toEqual({ scope: 'fc27', version: input.manifest.version, liveExecutionEnabled: true });
});

it('supports future FC27 versions and both execution modes without another hardcoded allowlist', async () => {
  const input = await inputs();
  input.manifest.version = '27.5.0'; input.manifest.liveExecutionEnabled = false;
  input.manifest.sha256 = 'a'.repeat(64);
  expect(assertRelease(input)).toEqual({ scope: 'fc27', version: '27.5.0', liveExecutionEnabled: false });
});

it.each([
  ['wrong season', input => { input.manifest.targetSeason = '26'; }],
  ['preview artifact', input => { input.manifest.releaseEligible = false; }],
  ['wrong identity', input => { input.manifest.name = 'FC Automation Tool Preview'; }],
  ['malformed version', input => { input.manifest.version = 'garbage'; }],
  ['malformed hash', input => { input.manifest.sha256 = 'a'; }],
  ['empty artifact', input => { input.manifest.bytes = 0; }],
  ['unknown execution mode', input => { delete input.manifest.liveExecutionEnabled; }],
  ['FSU version mismatch', input => { input.fsu.localVersion = '26.09.1'; }],
  ['FSU origin mismatch', input => { input.fsu.upstreamVersion = '26.00'; }],
  ['FSU missing hash', input => { delete input.fsu.modifiedSha256; }],
])('retains release integrity: %s', async (_name, change) => {
  const input = await inputs(); change(input);
  expect(() => assertRelease(input)).toThrow(/FC27_/);
});
