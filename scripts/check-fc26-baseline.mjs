import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectBaselineVersion } from './fc26-baseline-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revision = '43f64c2da9ddb5210034c7afe16a77ddc25231b0';
const archivedVersion = JSON.parse(execFileSync('git', ['show', `${revision}:package.json`], { cwd: root, encoding: 'utf8' })).version;
const currentVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const fsuConfig = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
const paths = ['DailyLoopRunner.user.js', 'FSU_mod/fsu-mod.config.json', `FSU_mod/${fsuConfig.modifiedFile}`];
const assets = [];
for (const name of paths) {
  const baseline = execFileSync('git', ['show', `${revision}:${name}`], { cwd: root, maxBuffer: 10_000_000 });
  const current = await readFile(path.join(root, name === 'DailyLoopRunner.user.js' ? 'FCAutomationTool.user.js' : name));
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
  if (expected.trimEnd() !== normalize(current).trimEnd()) throw new Error(`FC26 frozen input changed: ${name}`);
  assets.push({ path: name, bytes: baseline.length, gitBlobSha256: createHash('sha256').update(baseline).digest('hex') });
}
console.log(JSON.stringify({ revision, assets }, null, 2));
