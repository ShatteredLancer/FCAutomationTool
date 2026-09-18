import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFc27Production } from './build-fc27-production.mjs';
import { assertReadonlyRelease } from './fc27-release-policy.mjs';

export const FC27_RELEASE_ASSETS = Object.freeze([
  'FCAutomationTool.user.js', 'FCAutomationTool.meta.js', 'FCAutomationTool.manifest.json',
  'FSU-Local.user.js', 'FSU-Local.meta.js', 'FSU-Local.manifest.json', 'SHA256SUMS',
]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function packageFc27Release() {
  const artifact = await buildFc27Production();
  assertReadonlyRelease({ manifest: artifact.manifest,
    approval: JSON.parse(await readFile(path.join(root, 'scripts/fc27-readonly-release.json'), 'utf8')),
    evidence: JSON.parse(await readFile(path.join(root, 'tests/fixtures/fc27-production-installation-observation.json'), 'utf8')),
    fsu: JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod-manifest.json'), 'utf8')) });
  const dist = path.join(root, 'dist');
  if (await readFile(path.join(dist, artifact.userFile), 'utf8') !== artifact.script
      || await readFile(path.join(dist, 'FCAutomationTool.meta.js'), 'utf8') !== `${artifact.metadata}\n`
      || JSON.stringify(JSON.parse(await readFile(path.join(dist, 'FCAutomationTool.manifest.json'), 'utf8'))) !== JSON.stringify(artifact.manifest)) {
    throw new Error('FC27 release assets are stale; run npm run build');
  }
  const fsuConfig = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
  const fsuSource = await readFile(path.join(root, 'FSU_mod', fsuConfig.modifiedFile));
  if (!fsuSource.equals(await readFile(path.join(dist, 'FSU-Local.user.js')))) throw new Error('FSU release asset is stale');
  const fsuMetadata = fsuSource.toString('utf8').match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)/)?.[1];
  if (await readFile(path.join(dist, 'FSU-Local.meta.js'), 'utf8') !== `${fsuMetadata}\n`) throw new Error('FSU metadata is stale');
  await copyFile(path.join(root, 'FSU_mod/fsu-mod-manifest.json'), path.join(dist, 'FSU-Local.manifest.json'));
  const checksums = [];
  for (const name of FC27_RELEASE_ASSETS.filter(name => name !== 'SHA256SUMS')) {
    const bytes = await readFile(path.join(dist, name));
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(path.join(dist, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  const manifest = { schema: 1, version: artifact.version, releaseScope: 'read-only', liveExecutionEnabled: false,
    releaseEligible: true, assets: FC27_RELEASE_ASSETS };
  await writeFile(path.join(dist, 'fc27-release-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await packageFc27Release()));
