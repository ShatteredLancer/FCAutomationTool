import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildFc27Production } from './build-fc27-production.mjs';
import { assertReadonlyRelease } from './fc27-release-policy.mjs';

if (process.argv.slice(2).some(value => value !== '--packaging')) throw new Error('Unknown readiness option');
execFileSync(process.execPath, ['scripts/check-dist.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/check-fsu-patch.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-fsu-release-assets.mjs', '--check'], { stdio: 'inherit' });
const artifact = await buildFc27Production();
const evidence = JSON.parse(await readFile(new URL('../tests/fixtures/fc27-production-installation-observation.json', import.meta.url), 'utf8'));
const approval = JSON.parse(await readFile(new URL('./fc27-readonly-release.json', import.meta.url), 'utf8'));
const fsu = JSON.parse(await readFile(new URL('../FSU_mod/fsu-mod-manifest.json', import.meta.url), 'utf8'));
assertReadonlyRelease({ manifest: artifact.manifest, evidence, approval, fsu });
console.log('FC27 27.0.0 read-only release approved; Live execution remains disabled and business acceptance remains pending.');
