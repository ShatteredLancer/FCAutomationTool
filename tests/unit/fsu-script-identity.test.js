import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../FSU_mod/fsu-mod.config.json', import.meta.url), 'utf8'));
const fsuSource = readFileSync(new URL(`../../FSU_mod/${config.modifiedFile}`, import.meta.url), 'utf8');
function metadataValue(key) {
  return fsuSource.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1]?.trim() || '';
}
describe('FSU maintained userscript identity', () => {
  it('retains upstream identity and GM storage scope', () => {
    expect(metadataValue('name')).toBe('\u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668');
    expect(metadataValue('namespace')).toBe('https://futcd.com/');
  });
  it('uses maintained repository endpoints', () => {
    expect(metadataValue('downloadURL')).toBe('https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FSU-Local.user.js');
    expect(metadataValue('updateURL')).toBe('https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FSU-Local.meta.js');
  });
});
