import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FC27_TRANSACTION_INPUTS = Object.freeze([
    'src/adapters/browser/fc27-acceptance-panel.js', 'src/adapters/browser/fc27-acceptance-session.js',
    'src/adapters/browser/fc27-transaction-persistence.js', 'src/adapters/ea/fc27-challenge-catalog.js',
    'src/adapters/ea/fc27-club-read.js', 'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-fsu-read.js',
    'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-sbc-contract.js', 'src/adapters/ea/fc27-sbc-read.js',
    'src/adapters/ea/fc27-traditional-provider.js', 'src/adapters/ea/fc27-traditional-read.js',
    'src/adapters/ea/fc27-transaction-transport.js', 'src/domain/contracts.js', 'src/domain/player-rarity.js',
    'src/fc27/prelaunch-contract.js', 'src/fc27/traditional-journal.js',
    'src/fc27/traditional-lock.js', 'src/fc27/traditional-preview.js', 'src/fc27/traditional-transaction.js',
    'src/sbc/submit-attempt.js',
]);
export async function buildFc27Acceptance() {
  const entry = path.join(root, 'src/fc27/acceptance-entry.js');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const source = await readFile(entry, 'utf8');
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0].replace('__DLR_VERSION__', version);
  const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true,
    target: 'chrome120', format: 'iife', legalComments: 'none' });
  const inputs = Object.keys(result.metafile.inputs).map(file => path.relative(root, path.resolve(file)).replaceAll('\\', '/')).sort();
  const allowed = new Set([...FC27_TRANSACTION_INPUTS, 'src/fc27/acceptance-entry.js']);
  if (inputs.some(file => !allowed.has(file))) throw new Error('Unreviewed acceptance dependency');
  if (!source.includes('liveEnabled: false')) throw new Error('Acceptance installation must keep Live disabled');
  const script = `${metadata}\n\n${result.outputFiles[0].text}`;
  return { script, version, userFile: 'FCAutomationToolAcceptance.user.js', manifest: {
    schema: 1, version, releaseEligible: false, liveExecutionEnabled: false, inputs, bytes: Buffer.byteLength(script) } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildFc27Acceptance(); const dir = path.join(root, 'dist/fc27-acceptance');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, result.userFile), result.script);
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(JSON.stringify(result.manifest));
}
