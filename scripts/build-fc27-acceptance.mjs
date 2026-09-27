import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { assertFc27BrowserInputs } from './fc27-build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFc27Acceptance() {
  const entry = path.join(root, 'src/fc27/acceptance-entry.js');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const source = await readFile(entry, 'utf8');
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0].replace('__DLR_VERSION__', version);
  const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true,
    target: 'chrome120', format: 'iife', legalComments: 'none' });
  const inputs = Object.keys(result.metafile.inputs).map(file => path.relative(root, path.resolve(file)).replaceAll('\\', '/')).sort();
  assertFc27BrowserInputs(inputs);
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
