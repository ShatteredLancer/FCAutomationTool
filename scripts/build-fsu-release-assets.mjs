import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fsuDir = path.join(root, 'FSU_mod');
const config = JSON.parse(await readFile(path.join(fsuDir, 'fsu-mod.config.json'), 'utf8'));
const source = (await readFile(path.join(fsuDir, config.modifiedFile), 'utf8')).replace(/^\uFEFF/, '');
const metadata = source.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)/)?.[1];
if (!metadata) throw new Error('FSU Local userscript metadata block not found');

function metadataValue(key) {
  return metadata.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1]?.trim() || '';
}

const expected = {
  name: '【FSU】EAFC FUT WEB 增强器',
  namespace: 'https://futcd.com/',
  version: config.localVersion,
  homepageURL: 'https://github.com/ShatteredLancer/FCAutomationTool/tree/main/FSU_mod',
  supportURL: 'https://github.com/ShatteredLancer/FCAutomationTool/issues',
  downloadURL: `https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/${config.releaseUserFile}`,
  updateURL: `https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/${config.releaseMetaFile}`,
  license: config.upstreamLicense,
};
for (const [key, value] of Object.entries(expected)) {
  if (metadataValue(key) !== value) throw new Error(`FSU Local metadata @${key} does not match fsu-mod.config.json`);
}

const outputs = new Map([
  [path.join(root, 'dist', config.releaseUserFile), source],
  [path.join(root, 'dist', config.releaseMetaFile), `${metadata}\n`],
]);
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  for (const [outputPath, expectedText] of outputs) {
    const actual = await readFile(outputPath, 'utf8');
    if (actual !== expectedText) throw new Error(`${path.basename(outputPath)} is stale; run npm run build`);
  }
  console.log(`Verified FSU Local ${config.localVersion} release assets`);
} else {
  await mkdir(path.join(root, 'dist'), { recursive: true });
  for (const [outputPath, text] of outputs) await writeFile(outputPath, text, 'utf8');
  console.log(`Built ${config.releaseUserFile} and ${config.releaseMetaFile} v${config.localVersion}`);
}

