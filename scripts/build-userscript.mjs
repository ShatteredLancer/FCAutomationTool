import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src', 'userscript-entry.js');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outputPaths = [
  path.join(root, 'FCAutomationTool.user.js'),
  path.join(root, 'dist', 'FCAutomationTool.user.js'),
];
const source = (await readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, '');
const metadataMatch = source.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*/);

if (!metadataMatch) throw new Error('Userscript metadata block not found');

const sourceMetadata = metadataMatch[1];
const body = source.slice(metadataMatch[0].length);
const version = String(packageInfo.version || '').trim();

if (!version) throw new Error('package.json version not found');
if (!/^\/\/ @version\s+__DLR_VERSION__$/m.test(sourceMetadata)) {
  throw new Error('Source userscript @version must use the __DLR_VERSION__ build token');
}
const metadata = sourceMetadata.replace(
  /^\/\/ @version\s+__DLR_VERSION__$/m,
  `// @version      ${version}`,
);

const result = await build({
  stdin: {
    contents: body,
    resolveDir: path.dirname(sourcePath),
    sourcefile: 'userscript-entry.js',
    loader: 'js',
  },
  bundle: true,
  target: 'chrome120',
  format: 'iife',
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  write: false,
});

const output = `${metadata}\n\n${result.outputFiles[0].text}`;
for (const outputPath of outputPaths) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
}
await writeFile(path.join(root, 'dist', 'FCAutomationTool.meta.js'), `${metadata}\n`, 'utf8');
console.log(`Built FCAutomationTool.user.js and dist/FCAutomationTool.user.js v${version}`);
console.log('Built dist/FCAutomationTool.meta.js');
