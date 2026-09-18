import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const MAX_BYTES = 5 * 1024 * 1024;
const digest = text => createHash('sha256').update(text).digest('hex');
function metadata(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) throw new Error('UPSTREAM_SIZE_INVALID');
  const block = source.replace(/^\uFEFF/, '').match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==/m)?.[1];
  if (!block || !source.replace(/^\uFEFF/, '').startsWith('// ==UserScript==')) throw new Error('UPSTREAM_NOT_USERSCRIPT');
  const values = {};
  for (const key of ['name', 'namespace', 'license', 'version']) {
    const matches = [...block.matchAll(new RegExp(`^//\\s*@${key}\\s+([^\\r\\n]+)`, 'gm'))];
    if (matches.length !== 1) throw new Error('UPSTREAM_METADATA_INVALID');
    values[key] = matches[0][1].trim();
  }
  if (values.name !== '\u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668'
      || values.namespace !== 'https://futcd.com/' || values.license !== 'MIT'
      || !/^\d{2}\.\d{1,3}(?:\.\d{1,4})?$/.test(values.version)) throw new Error('UPSTREAM_IDENTITY_INVALID');
  return values;
}

export function inspectUpstreamSource(candidate, origin) {
  const next = metadata(candidate);
  const previous = metadata(origin);
  const sha256 = digest(candidate);
  return { schema: 1, version: next.version, baseVersion: previous.version, sha256, baseSha256: digest(origin),
    changed: sha256 !== digest(origin), versionChanged: next.version !== previous.version,
    reviewRequired: sha256 !== digest(origin), automaticInstall: false };
}

export async function downloadUpstream(url, request = fetch) {
  const allowed = new Set(['update.greasyfork.org', 'update.cn-greasyfork.org']);
  const deadline = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !allowed.has(target.hostname) || target.username || target.password) {
      throw new Error('UPSTREAM_URL_INVALID');
    }
    const response = await request(target, { redirect: 'manual', signal: deadline, headers: { Accept: 'text/javascript,text/plain' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (!response.headers.get('location')) throw new Error('UPSTREAM_REDIRECT_INVALID');
      url = new URL(response.headers.get('location'), target).href;
      continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`UPSTREAM_HTTP_${response.status}`); }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('UPSTREAM_SIZE_INVALID');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('UPSTREAM_REDIRECT_LIMIT');
}

export async function checkUpstream({ root, candidatePath } = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
  const origin = await readFile(path.join(root, 'FSU_mod', config.originFile), 'utf8');
  const candidate = candidatePath ? await readFile(candidatePath, 'utf8') : await downloadUpstream(config.upstreamSource);
  const report = inspectUpstreamSource(candidate, origin);
  const directory = path.join(root, 'artifacts/fsu-upstream', `${report.version}-${report.sha256.slice(0, 12)}`);
  const temp = await mkdtemp(path.join(tmpdir(), 'fcat-upstream-check-'));
  try {
    // Never execute the candidate. A clean text patch is only a review hint, not compatibility evidence.
    await writeFile(path.join(temp, config.patchTargetPath), candidate);
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--check', '--whitespace=nowarn',
      path.join(root, 'FSU_mod', config.patchFile)], { cwd: temp, encoding: 'utf8', timeout: 20000 });
    if (result.error || ![0, 1].includes(result.status)) throw new Error('UPSTREAM_PATCH_CHECK_FAILED');
    report.legacyPatch = result.status === 0 ? 'clean-text-application' : 'conflicts';
    report.fc27Modules = 'independent-review-required';
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'candidate.user.js'), candidate);
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    // mkdtemp creates and owns this exact directory; no repository paths are removed.
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--candidate')) throw new Error('Use --candidate <local-file> or no arguments');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try { console.log(JSON.stringify(await checkUpstream({ root, candidatePath: args[1] }), null, 2)); }
  catch (error) {
    console.error(/^UPSTREAM_[A-Z_0-9]+$/.test(error.message) ? error.message : 'UPSTREAM_CHECK_UNAVAILABLE');
    process.exitCode = 1;
  }
}
