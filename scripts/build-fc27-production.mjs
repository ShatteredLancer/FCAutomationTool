import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { FC27_TRANSACTION_INPUTS } from './build-fc27-acceptance.mjs';
import { isApprovedReadonlyArtifact } from './fc27-release-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFc27Production() {
  const entry = path.join(root, 'src/fc27/production-entry.js');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (!/^27\.\d+\.\d+$/.test(version)) throw new Error('FC27 production requires a stable 27.x.y version');
  const source = (await readFile(entry, 'utf8')).replaceAll('\r\n', '\n');
  const match = source.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*/);
  if (!match || !source.includes('liveEnabled: false')) throw new Error('FC27 live acceptance is still pending');
  const metadata = match[1].replace('__DLR_VERSION__', version);
  const result = await build({ stdin: { contents: source.slice(match[0].length), resolveDir: path.dirname(entry),
    sourcefile: 'production-entry.js' }, bundle: true, write: false, metafile: true, target: 'chrome120',
    format: 'iife', legalComments: 'none', define: { __FCAT_VERSION__: JSON.stringify(version) } });
  const inputs = Object.keys(result.metafile.inputs).map(file => path.relative(root, path.resolve(file)).replaceAll('\\', '/')).sort();
  const allowed = new Set([...FC27_TRANSACTION_INPUTS, 'src/fc27/production-entry.js']);
  if (inputs.some(file => !allowed.has(file))) throw new Error('Unreviewed FC27 production dependency');
  const script = `${metadata}\n\n${result.outputFiles[0].text}`;
  const manifest = { schema: 1, name: 'FC Automation Tool', namespace: 'https://github.com/ShatteredLancer/FCAutomationTool',
    version, targetSeason: '27', releaseScope: 'read-only', liveExecutionEnabled: false, releaseEligible: false,
    pending: ['FC27_LIVE_ACCEPTANCE_PENDING'], inputs, bytes: Buffer.byteLength(script),
    sha256: createHash('sha256').update(script).digest('hex') };
  const approval = JSON.parse(await readFile(path.join(root, 'scripts/fc27-readonly-release.json'), 'utf8'));
  manifest.releaseEligible = isApprovedReadonlyArtifact(manifest, approval);
  return { script, metadata, version, manifest, userFile: 'FCAutomationTool.user.js' };
}
