import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFc27Production } from './build-fc27-production.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (await readFile(path.join(root, 'src/fc27/production-entry.js'), 'utf8')).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const rootBuild = await readFile(path.join(root, 'FCAutomationTool.user.js'), 'utf8');
const built = await readFile(path.join(root, 'dist', 'FCAutomationTool.user.js'), 'utf8');
const meta = await readFile(path.join(root, 'dist', 'FCAutomationTool.meta.js'), 'utf8');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const metadataPattern = /^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)/;
const sourceMetadata = source.match(metadataPattern)?.[1];
const builtMetadata = built.match(metadataPattern)?.[1];

if (!sourceMetadata || !builtMetadata) throw new Error('Userscript metadata block missing from source or dist');
const packageVersion = String(packageInfo.version || '').trim();
if (!/^27\.\d+\.\d+$/.test(packageVersion) || packageInfo.name !== 'fc-automation-tool'
    || packageLock.name !== packageInfo.name || packageLock.packages?.['']?.name !== packageInfo.name) {
  throw new Error('FC27 package identity mismatch');
}
const expectedMetadata = sourceMetadata.replace(
  /^\/\/ @version\s+__DLR_VERSION__$/m,
  `// @version      ${packageVersion}`,
);
if (expectedMetadata !== builtMetadata) throw new Error('dist userscript metadata differs from the versioned source template');
if (rootBuild !== built) throw new Error('root compatibility userscript differs from dist output');
if (meta !== `${builtMetadata}\n`) throw new Error('dist userscript meta file differs from the full userscript metadata');

const builtVersion = builtMetadata.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
if (!builtVersion || builtVersion !== packageVersion) throw new Error('dist userscript version differs from package.json');
if (packageLock.version !== packageVersion || packageLock.packages?.['']?.version !== packageVersion) {
  throw new Error('package-lock.json root version differs from package.json');
}

function metadataValue(key) {
  return builtMetadata.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1]?.trim() || '';
}

const expectedFields = {
  name: 'FC Automation Tool',
  namespace: 'https://github.com/ShatteredLancer/FCAutomationTool',
  homepageURL: 'https://github.com/ShatteredLancer/FCAutomationTool',
  supportURL: 'https://github.com/ShatteredLancer/FCAutomationTool/issues',
  updateURL: 'https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.meta.js',
  downloadURL: 'https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.user.js',
  license: 'MIT',
};
for (const [key, expected] of Object.entries(expectedFields)) {
  if (metadataValue(key) !== expected) throw new Error(`userscript metadata @${key} is not production-ready`);
}
if (/^\/\/ @connect\s/m.test(builtMetadata)) throw new Error('FC27 preparation must not grant external network access');
const expected = await buildFc27Production();
if (built !== expected.script) throw new Error('FC27 production output is stale or includes unreviewed modules');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/FCAutomationTool.manifest.json'), 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) throw new Error('FC27 production manifest is stale');

console.log(`Verified root/dist userscript equality, metadata, and version ${builtVersion}`);
