import { expect, it } from 'vitest';
import { inspectUpstreamSource, downloadUpstream, checkUpstream } from '../../scripts/fsu-upstream.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = version => `// ==UserScript==\n// @name \u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668\n// @namespace https://futcd.com/\n// @version ${version}\n// @license MIT\n// ==/UserScript==\nthrow new Error('must never execute');\n`;
it('inspects metadata and hashes without evaluating downloaded code', () => {
  expect(inspectUpstreamSource(script('27.01'), script('26.09'))).toMatchObject({ version: '27.01', changed: true,
    versionChanged: true, reviewRequired: true });
  expect(inspectUpstreamSource(script('26.09'), script('26.09')).changed).toBe(false);
  expect(inspectUpstreamSource(script('26.09') + '\n// changed', script('26.09'))).toMatchObject({ changed: true, versionChanged: false });
});
it('rejects HTML, changed identity, duplicate metadata and incompatible license', () => {
  for (const text of ['<html>blocked</html>', script('27.01').replace('futcd.com', 'example.com'),
    script('27.01').replace('MIT', 'unknown'), script('27.01').replace('// @version', '// @version 99\n// @version')]) {
    expect(() => inspectUpstreamSource(text, script('26.09'))).toThrow();
  }
});

it('bounds downloads and refuses credential URLs and off-domain redirects', async () => {
  await expect(downloadUpstream('https://user:secret@update.greasyfork.org/x', () => {})).rejects.toThrow('URL');
  await expect(downloadUpstream('https://update.greasyfork.org/x', async () => new Response(null,
    { status: 302, headers: { location: 'https://example.com/payload' } }))).rejects.toThrow('URL');
  await expect(downloadUpstream('https://update.greasyfork.org/x', async () => new Response('x', { status: 403 }))).rejects.toThrow('HTTP_403');
  await expect(downloadUpstream('https://update.greasyfork.org/x', async () => new Response('x'.repeat(5 * 1024 * 1024 + 1)))).rejects.toThrow('SIZE');
});

it('writes only a candidate artifact and never applies even a clean patch to maintained inputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fsu-upstream-test-'));
  try {
    await mkdir(path.join(root, 'FSU_mod'));
    const config = { originFile: 'origin.js', patchFile: 'local.patch', patchTargetPath: 'FSU.user.js' };
    const origin = script('26.09');
    const candidatePath = path.join(root, 'candidate.js');
    await writeFile(candidatePath, script('27.01'));
    await writeFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), JSON.stringify(config));
    await writeFile(path.join(root, 'FSU_mod/origin.js'), origin);
    await writeFile(path.join(root, 'FSU_mod/local.patch'), 'diff --git a/FSU.user.js b/FSU.user.js\n--- a/FSU.user.js\n+++ b/FSU.user.js\n@@ -8 +8 @@\n-throw new Error(\'must never execute\');\n+// patched\n');
    const result = await checkUpstream({ root, candidatePath });
    expect(result).toMatchObject({ version: '27.01', reviewRequired: true, automaticInstall: false });
    expect(await readFile(path.join(root, 'FSU_mod/origin.js'), 'utf8')).toBe(origin);
    expect(await readFile(candidatePath, 'utf8')).toBe(script('27.01'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
