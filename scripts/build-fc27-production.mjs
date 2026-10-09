import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertFc27BrowserInputs, assertFc27ProductionMetadata } from './fc27-build-policy.mjs';
import { wrapFc27Boot } from './fcat-boot-probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFc27Production() {
  const entry = path.join(root, 'src/fc27/production-entry.js');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (!/^27\.\d+\.\d+$/.test(version)) throw new Error('FC27 production requires a stable 27.x.y version');
  // User-authorized local single-SBC execution; publication still needs its own evidence.
  const liveExecutionEnabled = true;
  const source = (await readFile(entry, 'utf8')).replaceAll('\r\n', '\n');
  const match = source.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*/);
  if (!match || !source.includes('liveEnabled: __FCAT_LIVE_ENABLED__')) throw new Error('FC27 execution policy is not build-bound');
  const metadata = match[1].replace('__DLR_VERSION__', version);
  assertFc27ProductionMetadata(metadata);
  const result = await build({ stdin: { contents: source.slice(match[0].length), resolveDir: path.dirname(entry),
    sourcefile: 'production-entry.js' }, bundle: true, write: false, metafile: true, target: 'chrome120',
    format: 'iife', legalComments: 'inline', define: { __FCAT_VERSION__: JSON.stringify(version),
      __FCAT_LIVE_ENABLED__: JSON.stringify(liveExecutionEnabled) } });
  const inputs = Object.keys(result.metafile.inputs).map(file => path.relative(root, path.resolve(file)).replaceAll('\\', '/')).sort();
  assertFc27BrowserInputs(inputs);
  // Keep a tiny, dependency-free marker before the bundled application. This
  // is intentionally outside the ES module bundle: a module initialization
  // failure must still leave enough evidence to distinguish injection/match
  // problems from FCAT runtime failures in a user's normal browser profile.
  const script = `${metadata}\n\n${wrapFc27Boot(result.outputFiles[0].text, version)}\n`;
  const manifest = { schema: 1, name: 'FC Automation Tool', namespace: 'https://github.com/ShatteredLancer/FCAutomationTool',
    version, targetSeason: '27', releaseScope: 'fc27', liveExecutionEnabled, releaseEligible: true,
    inputs, bytes: Buffer.byteLength(script),
    sha256: createHash('sha256').update(script).digest('hex') };
  return { script, metadata, version, manifest, userFile: 'FCAutomationTool.user.js' };
}
