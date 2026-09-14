import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const script of ['scripts/check-fc26-baseline.mjs', 'scripts/build-fc27-preview.mjs', 'scripts/build-fc27-fsu-core.mjs']) {
  execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
}
execFileSync(process.execPath, ['node_modules/eslint/bin/eslint.js', 'FSU_mod/src'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'tests/unit/fc27-prelaunch-contract.test.js', 'tests/unit/fc27-preferences.test.js',
  'tests/unit/fc27-browser-inspection.test.js', 'tests/unit/fc27-release-channel.test.js',
  'tests/contracts/fc27-fsu-core.test.js', 'tests/contracts/fc27-preview.test.js'], { cwd: root, stdio: 'inherit' });
if (process.argv.includes('--browser')) {
  execFileSync(process.execPath, ['scripts/browser-inspection/run.mjs', '--self-test'], { cwd: root, stdio: 'inherit' });
}
