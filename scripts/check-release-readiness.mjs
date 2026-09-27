import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildFc27Production } from './build-fc27-production.mjs';
import { assertRelease } from './fc27-release-policy.mjs';

if (process.argv.slice(2).some(value => value !== '--packaging')) throw new Error('Unknown readiness option');
execFileSync(process.execPath, ['scripts/check-dist.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/check-fsu-patch.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-fsu-release-assets.mjs', '--check'], { stdio: 'inherit' });
const artifact = await buildFc27Production();
const fsu = JSON.parse(await readFile(new URL('../FSU_mod/fsu-mod-manifest.json', import.meta.url), 'utf8'));
const fsuConfig = JSON.parse(await readFile(new URL('../FSU_mod/fsu-mod.config.json', import.meta.url), 'utf8'));
assertRelease({ manifest: artifact.manifest, fsu, fsuConfig });
console.log(`FC27 ${artifact.version} release assets verified; Live: ${artifact.manifest.liveExecutionEnabled}. Runtime acceptance is reported separately.`);
