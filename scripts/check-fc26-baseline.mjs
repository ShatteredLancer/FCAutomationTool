import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectBaselineVersion } from './fc26-baseline-version.mjs';
import { assertFsuMaintenanceBoundary } from './fsu-maintenance-boundary.mjs';
import { buildFc26Regression } from './build-fc26-regression.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revision = '43f64c2da9ddb5210034c7afe16a77ddc25231b0';
const archivedVersion = JSON.parse(execFileSync('git', ['show', `${revision}:package.json`], { cwd: root, encoding: 'utf8' })).version;
const regression = await buildFc26Regression();
const currentVersion = regression.version;
const fsuConfig = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
const readArchived = name => execFileSync('git', ['show', `${revision}:${name}`], { cwd: root, maxBuffer: 10_000_000 });
const archivedFsuConfig = JSON.parse(readArchived('FSU_mod/fsu-mod.config.json'));
const fsuMaintenance = assertFsuMaintenanceBoundary({ archivedConfig: archivedFsuConfig, currentConfig: fsuConfig,
  archivedOrigin: readArchived(`FSU_mod/${archivedFsuConfig.originFile}`),
  currentOrigin: await readFile(path.join(root, 'FSU_mod', archivedFsuConfig.originFile)),
  archivedSource: readArchived(`FSU_mod/${archivedFsuConfig.modifiedFile}`).toString('utf8'),
  currentSource: await readFile(path.join(root, 'FSU_mod', archivedFsuConfig.modifiedFile), 'utf8') });
const paths = ['DailyLoopRunner.user.js', 'FSU_mod/fsu-mod.config.json',
  `FSU_mod/${archivedFsuConfig.modifiedFile}`, `FSU_mod/${archivedFsuConfig.originFile}`];
const assets = [];
for (const name of paths) {
  const baseline = execFileSync('git', ['show', `${revision}:${name}`], { cwd: root, maxBuffer: 10_000_000 });
  const current = name === 'DailyLoopRunner.user.js' ? Buffer.from(regression.script) : null;
  // Git and Windows working trees may use different line endings.
  const normalize = buffer => buffer.toString('utf8').replaceAll('\r\n', '\n');
  let expected = name === 'DailyLoopRunner.user.js'
    ? projectBaselineVersion(normalize(baseline), archivedVersion, currentVersion)
    : normalize(baseline);
  expected = expected.replaceAll('ShatteredLancer/DailyLoopRunner', 'ShatteredLancer/FCAutomationTool');
  if (name === 'DailyLoopRunner.user.js') {
    for (const suffix of ['user.js', 'meta.js', 'loops.json']) {
      expected = expected.replaceAll(`DailyLoopRunner.${suffix}`, `FCAutomationTool.${suffix}`);
    }
    expected = expected.replaceAll('DailyLoopRunnerHotReload.user.js', 'FCAutomationToolHotReload.user.js');
  }
  if (current && expected.trimEnd() !== normalize(current).trimEnd()) throw new Error(`FC26 frozen input changed: ${name}`);
  assets.push({ path: name, bytes: baseline.length, gitBlobSha256: createHash('sha256').update(baseline).digest('hex') });
}
// Maintained FSU must still match its config, metadata, hashes and exact origin + patch replay.
execFileSync(process.execPath, ['scripts/check-fsu-patch.mjs'], { cwd: root, stdio: 'inherit' });
console.log(JSON.stringify({ revision, assets, fsuMaintenance }, null, 2));
