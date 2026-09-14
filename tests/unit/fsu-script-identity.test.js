import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fsuSource = readFileSync(
  new URL('../../FSU_mod/銆怓SU銆慐AFC FUT WEB 澧炲己鍣?26.09_mod.user.js', import.meta.url),
  'utf8',
);

function metadataValue(key) {
  return fsuSource.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1]?.trim() || '';
}

describe('FSU maintained userscript identity', () => {
  it('retains the upstream Tampermonkey identity and GM storage scope', () => {
    expect(metadataValue('name')).toBe('銆怓SU銆慐AFC FUT WEB 澧炲己鍣?);
    expect(metadataValue('namespace')).toBe('https://futcd.com/');
  });

  it('uses the maintained GitHub release endpoints without changing identity', () => {
    expect(metadataValue('downloadURL')).toBe(
      'https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FSU-Local.user.js',
    );
    expect(metadataValue('updateURL')).toBe(
      'https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FSU-Local.meta.js',
    );
  });
});

