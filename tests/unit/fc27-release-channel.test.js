import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { releaseChannel } from '../../scripts/release-channel.mjs';

describe('release channel isolation', () => {
  it('serializes publication across tags and passes explicit channel decisions to gh', async () => {
    const workflow = await readFile(new URL('../../.github/workflows/release-assets.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('group: release-publication');
    expect(workflow).toContain('node scripts/release-channel.mjs');
    expect(workflow).toContain('node scripts/check-release-readiness.mjs');
    const readiness = await readFile(new URL('../../scripts/check-release-readiness.mjs', import.meta.url), 'utf8');
    expect(readiness).toContain("throw new Error('RENAME_RELEASE_NOT_APPROVED:");
    const preview = await readFile(new URL('../../.github/workflows/fc27-preview.yml', import.meta.url), 'utf8');
    expect(preview).toContain('fetch-depth: 0');
    expect(preview).toContain('branches: [main]');
    expect(preview).toContain('node scripts/verify-fc27-prelaunch.mjs');
    expect(preview).toContain('contents: read');
    expect(workflow).toContain('"--latest=$env:MAKE_LATEST"');
    expect(workflow).toContain('"--prerelease=$env:IS_PRERELEASE"');
  });
  it.each(['alpha', 'beta', 'rc'])('never makes %s latest', label => {
    expect(releaseChannel(`0.8.65-${label}.1`, 'v0.8.64')).toEqual({ prerelease: true, latest: false });
  });
  it('does not let old-season maintenance displace a new-season latest', () => {
    expect(releaseChannel('0.8.65', 'v27.0.0').latest).toBe(false);
    expect(releaseChannel('0.8.65', 'v0.8.64').latest).toBe(true);
    expect(releaseChannel('0.8.64', 'v0.8.64').latest).toBe(false);
  });
  it.each(['27.0.0', '27.0.0-alpha.1', '28.0.0', 'garbage', '0.8.1-unknown'])('blocks unapproved release %s', version => {
    expect(() => releaseChannel(version)).toThrow();
  });
});
