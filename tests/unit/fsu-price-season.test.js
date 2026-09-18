import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url),
  'utf8',
);

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`FSU price source section is missing: ${startMarker}`);
  return source.slice(start, end);
}

describe('FSU price provider season binding', () => {
  it('uses the current EA season for price requests instead of a fixed FC26 path', () => {
    const prices = section('events.getPriceForUrl = async', 'events.externalRequest =');
    expect(prices).toContain('getPriceSeason()');
    expect(prices).toContain('player-prices/${season}/');
    expect(prices).not.toContain('player-prices/26/');
  });

  it('uses the same season binding for the login-time provider probe', () => {
    const login = section('UTLoginView.prototype._generate', '//24.15 底层界面展示');
    expect(login).toContain('getPriceSeason()');
    expect(login).toContain('player-prices/${season}/');
    expect(login).not.toContain('player-prices/26/');
  });
});
