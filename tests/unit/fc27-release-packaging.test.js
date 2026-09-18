import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FC27_RELEASE_ASSETS } from '../../scripts/package-fc27-release.mjs';
import { assertReadonlyRelease } from '../../scripts/fc27-release-policy.mjs';
import { buildFc27Production } from '../../scripts/build-fc27-production.mjs';

async function approvedInputs() {
  const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
  return { manifest: (await buildFc27Production()).manifest,
    approval: await read('../../scripts/fc27-readonly-release.json'),
    evidence: await read('../fixtures/fc27-production-installation-observation.json'),
    fsu: await read('../../FSU_mod/fsu-mod-manifest.json') };
}

it('uses an explicit FC27-only publication asset list without old workflows or preview scripts', async () => {
  expect(FC27_RELEASE_ASSETS).toEqual([
    'FCAutomationTool.user.js', 'FCAutomationTool.meta.js', 'FCAutomationTool.manifest.json',
    'FSU-Local.user.js', 'FSU-Local.meta.js', 'FSU-Local.manifest.json', 'SHA256SUMS',
  ]);
  const workflow = await readFile(new URL('../../.github/workflows/release-assets.yml', import.meta.url), 'utf8');
  expect(workflow).toContain('node scripts/package-fc27-release.mjs');
  expect(workflow).not.toMatch(/FCAutomationTool\.loops|build:profiles|profiles\.zip|DailyLoopRunner/);
  expect(workflow).toContain('FC Automation Tool v$env:RELEASE_VERSION');
});

it('permits only the explicitly approved read-only release without claiming Live acceptance', async () => {
  expect(assertReadonlyRelease(await approvedInputs())).toEqual({ scope: 'read-only', version: '27.0.0',
    liveExecutionEnabled: false, liveAcceptanceVerified: false });
});

it.each([
  ['Live enabled', input => { input.manifest.liveExecutionEnabled = true; }],
  ['future version', input => { input.manifest.version = '27.0.1'; }],
  ['changed script', input => { input.manifest.sha256 = 'a'.repeat(64); }],
  ['approval missing', input => { input.approval = null; }],
  ['approval revoked', input => { input.approval.approved = false; }],
  ['Live approval', input => { input.approval.scope = 'live'; }],
  ['unverified install', input => { input.evidence.installed = false; }],
  ['unverified update', input => { input.evidence.update.fullScriptRequests = 0; }],
  ['changed FSU', input => { input.fsu.modifiedSha256 = 'b'.repeat(64); }],
])('rejects %s without extending the release approval', async (name, change) => {
  const input = await approvedInputs(); change(input);
  expect(() => assertReadonlyRelease(input)).toThrow(/FC27_/);
});
