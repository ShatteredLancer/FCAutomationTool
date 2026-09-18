import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildFc27Production } from '../../scripts/build-fc27-production.mjs';

it('builds a new single-SBC Live candidate without inheriting the read-only release approval', async () => {
  const artifact = await buildFc27Production();
  expect(artifact.version).toBe('27.0.1');
  expect(artifact.manifest).toMatchObject({ targetSeason: '27', releaseScope: 'single-traditional-sbc', liveExecutionEnabled: true, releaseEligible: false });
  expect(artifact.manifest.pending).toContain('FC27_LIVE_ACCEPTANCE_PENDING');
  expect(artifact.metadata).toContain('// @name         FC Automation Tool\n');
  expect(artifact.metadata).toContain('// @namespace    https://github.com/ShatteredLancer/FCAutomationTool\n');
  expect(artifact.metadata).toContain('/releases/latest/download/FCAutomationTool.meta.js');
  expect(artifact.metadata).toContain('/releases/latest/download/FCAutomationTool.user.js');
  expect(artifact.script).toContain('liveEnabled: true');
  expect(artifact.script).not.toContain('__FCAT_LIVE_ENABLED__');
  expect(artifact.script).not.toMatch(/GM_xmlhttpRequest|localStorage|__FCLoopRunner|runRollingUpgradeLoop|@connect/);
  expect(artifact.manifest.inputs).toContain('src/fc27/production-entry.js');
  expect(artifact.manifest.inputs.some(file => /src\/userscript-entry|src\/workflows|src\/trade|src\/config|FSU_mod/.test(file))).toBe(false);
  expect(artifact.manifest.bytes).toBeLessThan(150000);
  const packageInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url)));
  expect(packageInfo.name).toBe('fc-automation-tool');
  expect(lock.name).toBe(packageInfo.name);
  expect(lock.packages[''].name).toBe(packageInfo.name);
  expect(lock.version).toBe(artifact.version);
  expect(lock.packages[''].version).toBe(artifact.version);
  const evidence = JSON.parse(await readFile(new URL('../fixtures/fc27-production-installation-observation.json', import.meta.url)));
  const approval = JSON.parse(await readFile(new URL('../../scripts/fc27-readonly-release.json', import.meta.url)));
  expect(evidence).toMatchObject({ version: '27.0.0', sha256: approval.sha256,
    installed: true, exactInstallerSourceVerified: true, separateFromAcceptance: true,
    gmPreservedAfterUpdateAndBrowserRestart: true, installedSourceVerifiedAfterBrowserRestart: true,
    githubDeliveryVerified: false, liveEnabled: false, published: false });
  expect(evidence.sha256).not.toBe(artifact.manifest.sha256);
  expect(evidence.update).toMatchObject({ actualTampermonkeyUpdater: true, localTransportOnly: true,
    updated: true, finalSourceMatches: true, finalGithubMetadataRestored: true });
  const candidate = JSON.parse(await readFile(new URL('../fixtures/fc27-live-candidate-installation-observation.json', import.meta.url)));
  expect(candidate).toMatchObject({ version: artifact.version, sha256: artifact.manifest.sha256,
    liveExecutionEnabled: true, installed: true, exactInstalledSource: true,
    installedSourceVerifiedAfterBrowserRestart: true, gmPreservedAcrossVersionUpdate: true,
    eaMutationsPerformed: false, realBusinessAcceptanceVerified: false, published: false });
});
