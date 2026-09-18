import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFsuCore() {
  const result = await build({ entryPoints: [path.join(root, 'FSU_mod/src/runner-support/index.js')],
    bundle: true, write: false, metafile: true, target: 'chrome120', format: 'iife',
    globalName: 'FSURunnerSupportCore', legalComments: 'none' });
  const inputs = Object.keys(result.metafile.inputs).map(name => path.relative(root, path.resolve(name)).replaceAll('\\', '/')).sort();
  const allowed = new Set(['FSU_mod/src/runner-support/index.js', 'FSU_mod/src/runner-support/core.js',
    'FSU_mod/src/runner-support/native-provider.js', 'src/adapters/ea/fc27-local-read.js', 'src/fc27/prelaunch-contract.js',
    'FSU_mod/src/runner-support/club-inventory.js', 'src/adapters/ea/fc27-club-read.js',
    'src/config/fsu-compat.js', 'src/config/runtime.js', 'src/domain/player-rarity.js']);
  if (inputs.some(name => !allowed.has(name))) throw new Error('Unreviewed FSU core dependency');
  return { source: result.outputFiles[0].text, inputs };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildFsuCore();
  const dir = path.join(root, 'dist/fc27-preview');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'FSURunnerSupportCore.js'), result.source);
  console.log(JSON.stringify({ bytes: Buffer.byteLength(result.source), inputs: result.inputs, releaseEligible: false }));
}
