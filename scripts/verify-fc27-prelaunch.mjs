import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const script of ['scripts/check-fc26-baseline.mjs', 'scripts/build-fc27-preview.mjs', 'scripts/build-fc27-fsu-core.mjs',
  'scripts/build-fc27-fsu-preview.mjs']) {
  execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
}
execFileSync(process.execPath, ['node_modules/eslint/bin/eslint.js', 'FSU_mod/src'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'tests/unit/fc27-prelaunch-contract.test.js', 'tests/unit/fc27-preferences.test.js',
  'tests/unit/fc27-browser-inspection.test.js', 'tests/unit/fc27-browser-options.test.js', 'tests/unit/fc27-release-channel.test.js',
  'tests/unit/fc27-runtime-observation.test.js', 'tests/unit/fc27-browser-automatic.test.js',
  'tests/unit/fc27-browser-navigation.test.js',
  'tests/unit/fc27-traditional-preview.test.js',
  'tests/unit/fc27-browser-agent.test.js',
  'tests/unit/fc27-in-progress-read.test.js',
  'tests/unit/fc27-native-provider.test.js',
  'tests/unit/fc27-club-inventory.test.js', 'tests/unit/fc27-club-read.test.js',
  'tests/unit/fc27-fsu-settings.test.js', 'tests/unit/fc27-fsu-preparation.test.js', 'tests/unit/fc27-fsu-prices.test.js',
  'tests/unit/fc27-fsu-installation.test.js',
  'tests/unit/fc27-fsu-setup.test.js',
  'tests/unit/fc27-traditional-read.test.js', 'tests/unit/fsu-upstream.test.js', 'tests/contracts/fc27-fsu-preview.test.js',
  'tests/contracts/fc27-fsu-core.test.js', 'tests/contracts/fc27-preview.test.js'], { cwd: root, stdio: 'inherit' });
if (process.argv.includes('--browser')) {
  execFileSync(process.execPath, ['scripts/browser-inspection/run.mjs', '--self-test'], { cwd: root, stdio: 'inherit' });
}
