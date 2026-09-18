import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFc27Preview() {
  const entry = path.join(root, 'src/fc27/userscript-entry.js');
  const source = await readFile(entry, 'utf8');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0].replace('__DLR_VERSION__', version);
  const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true,
    target: 'chrome120', format: 'iife', legalComments: 'none' });
  const inputs = Object.keys(result.metafile.inputs).map(name => path.relative(root, path.resolve(name)).replaceAll('\\', '/')).sort();
  const allowed = new Set(['src/fc27/userscript-entry.js', 'src/fc27/runtime.js',
    'src/fc27/prelaunch-contract.js', 'src/adapters/browser/fc27-inspection.js',
    'src/fc27/runner-panel.js', 'src/adapters/browser/fc27-runner-panel.js',
    'src/adapters/ea/fc27-fsu-read.js', 'src/adapters/ea/fc27-local-read.js',
    'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-traditional-read.js',
    'src/adapters/ea/fc27-sbc-read.js', 'src/adapters/ea/fc27-challenge-catalog.js',
    'src/fc27/traditional-preview.js', 'src/domain/player-rarity.js']);
  if (inputs.some(input => !allowed.has(input))) throw new Error('Unreviewed FC27 preview dependency');
  const script = `${metadata}\n\n${result.outputFiles[0].text}`;
  return { script, metadata, manifest: { schema: 1, product: 'FC Automation Tool Preview', version,
    targetSeason: '27', releaseEligible: false, liveExecutionEnabled: false,
    bytes: Buffer.byteLength(script), inputs } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildFc27Preview();
  const dir = path.join(root, 'dist/fc27-preview');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'FCAutomationToolPreview.user.js'), result.script);
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(JSON.stringify(result.manifest));
}
