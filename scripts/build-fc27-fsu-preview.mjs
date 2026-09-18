import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildFsuPreview() {
  const config = JSON.parse(await readFile(path.join(root, 'FSU_mod/fc27-preview.config.json'), 'utf8'));
  const base = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
  if (config.schema !== 1 || !Number.isSafeInteger(config.revision) || config.revision < 1
      || config.releaseEligible !== false || config.userFile !== 'FSU-FC27-Preview.user.js') throw new Error('Invalid FSU preview configuration');
  const version = `${base.localVersion}.27.${config.revision}`;
  const result = await build({ absWorkingDir: root, entryPoints: ['FSU_mod/src/fc27-userscript-entry.js'],
    bundle: true, write: false, metafile: true, target: 'chrome120', format: 'iife', legalComments: 'none',
    define: { __FSU_PREVIEW_VERSION__: JSON.stringify(version) } });
  const allowed = new Set([
    'FSU_mod/src/fc27-userscript-entry.js', 'FSU_mod/src/fc27-bootstrap.js', 'FSU_mod/src/fc27-panel.js',
    'FSU_mod/src/installation.js',
    'FSU_mod/src/runner-support/core.js', 'FSU_mod/src/runner-support/settings.js',
    'FSU_mod/src/runner-support/native-provider.js', 'FSU_mod/src/runner-support/club-inventory.js',
    'FSU_mod/src/enhancements/prices.js', 'FSU_mod/src/enhancements/traditional-fill.js',
    'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-club-read.js',
    'src/adapters/ea/fc27-sbc-read.js', 'src/adapters/ea/fc27-traditional-read.js',
    'src/config/fsu-compat.js', 'src/config/runtime.js', 'src/domain/player-rarity.js',
    'src/fc27/prelaunch-contract.js', 'src/fc27/traditional-preview.js',
  ]);
  const inputs = Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/')).sort();
  if (inputs.some(name => !allowed.has(name))) throw new Error('Unreviewed FSU preview dependency');
  const metadata = `// ==UserScript==
// @name         \u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668
// @namespace    https://futcd.com/
// @version      ${version}
// @description  Local FC27 read-only preview: scoped policy, Club, traditional squad preview and prices. No save or submit.
// @author       Futcd_kcka (FSU upstream); ShatteredLancer (independent FC27 support)
// @homepageURL  https://github.com/ShatteredLancer/FCAutomationTool/tree/main/FSU_mod
// @supportURL   https://github.com/ShatteredLancer/FCAutomationTool/issues
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.easports.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      www.fut.gg
// @license      MIT
// @run-at       document-end
// @updateURL    none
// @downloadURL  none
// ==/UserScript==
`;
  const source = `${metadata}\n${result.outputFiles[0].text}`;
  return { source, userFile: config.userFile, version, inputs,
    sha256: createHash('sha256').update(source).digest('hex'), releaseEligible: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { source, ...manifest } = await buildFsuPreview();
  const out = path.join(root, 'dist/fc27-preview');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, manifest.userFile), source);
  await writeFile(path.join(out, 'fsu-preview-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ...manifest, bytes: Buffer.byteLength(source) }));
}
