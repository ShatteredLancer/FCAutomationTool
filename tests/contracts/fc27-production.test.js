import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildFc27Production } from '../../scripts/build-fc27-production.mjs';

it('builds the current production version without historical feature or byte ceilings', async () => {
  const artifact = await buildFc27Production();
  expect(artifact.version).toMatch(/^27\.\d+\.\d+$/);
  expect(artifact.manifest).toMatchObject({ targetSeason: '27', releaseScope: 'fc27', liveExecutionEnabled: true, releaseEligible: true });
  expect(artifact.manifest).not.toHaveProperty('pending');
  expect(artifact.metadata).toContain('// @name         FC Automation Tool\n');
  expect(artifact.metadata).toContain('// @namespace    https://github.com/ShatteredLancer/FCAutomationTool\n');
  expect(artifact.metadata).toContain('// @grant        GM_listValues\n');
  expect(artifact.manifest.inputs).toContain('src/adapters/browser/fc27-gallery-cache-migration.js');
  expect(artifact.metadata).toContain('/releases/latest/download/FCAutomationTool.meta.js');
  expect(artifact.metadata).toContain('/releases/latest/download/FCAutomationTool.user.js');
  expect(artifact.script).toContain('liveEnabled: true');
  expect(artifact.script).not.toContain('__FCAT_LIVE_ENABLED__');
  expect(artifact.script).not.toMatch(/__FCLoopRunner/);
  expect(artifact.manifest.inputs).toContain('src/fc27/production-entry.js');
  expect(artifact.manifest.inputs).not.toContain('src/userscript-entry.js');
  // Size is a reported metric, not a fixed ceiling inherited from the 27.0.0
  // read-only feature set. Dependency isolation above guards accidental imports.
  expect(artifact.manifest.bytes).toBe(Buffer.byteLength(artifact.script));
  expect(artifact.manifest.bytes).toBeGreaterThan(0);
  const packageInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url)));
  expect(packageInfo.name).toBe('fc-automation-tool');
  expect(lock.name).toBe(packageInfo.name);
  expect(lock.packages[''].name).toBe(packageInfo.name);
  expect(lock.version).toBe(artifact.version);
  expect(lock.packages[''].version).toBe(artifact.version);
  expect(artifact.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
});
