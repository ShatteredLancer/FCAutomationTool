import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Historical input, not a second version source for the active FC27 product.
export const FC26_REGRESSION_REVISION = '0affb0b';
export async function buildFc26Regression() {
  const packageText = execFileSync('git', ['show', `${FC26_REGRESSION_REVISION}:package.json`], { cwd: root, encoding: 'utf8' });
  const packageInfo = JSON.parse(packageText);
  const source = await readFile(path.join(root, 'src/userscript-entry.js'), 'utf8');
  const match = source.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\s*/);
  if (!match) throw new Error('FC26 regression metadata missing');
  const result = await build({ stdin: { contents: source.slice(match[0].length), resolveDir: path.join(root, 'src'),
    sourcefile: 'userscript-entry.js', loader: 'js' }, bundle: true, write: false,
    target: 'chrome120', format: 'iife', legalComments: 'none', sourcemap: false, minify: false,
    plugins: [{ name: 'frozen-fc26-package', setup(builder) {
      builder.onLoad({ filter: /package\.json$/ }, args => path.resolve(args.path) === path.join(root, 'package.json')
        ? { contents: packageText, loader: 'json' } : undefined);
    } }] });
  return { version: packageInfo.version, script: `${match[1].replace('__DLR_VERSION__', packageInfo.version)}\n\n${result.outputFiles[0].text}` };
}
