import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
import { createFsuReferencePrice } from '../../src/fc27/fsu-reference-price.js';
import { createFc27FutbinHttp } from '../../src/adapters/browser/fc27-futbin-http.js';

const source = readFileSync(new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url), 'utf8');
const start = source.indexOf('futbinId.getId = async');
const body = source.slice(start, source.indexOf('//26.07 FG', start));
it.each(['pc', 'ps5'])('matches original FUTBIN URLs, cached ID routing and refreshed prices on %s', async platform => {
  const rows = [{ resource_id: 901, ID: 11, LCPrice: 200 },
    { Player_Resource: 901, pc_LCPrice: 250, ps_LCPrice: 300 }, { Player_Resource: 901, price: 350 }];
  const trace = []; let requestIndex = 0;
  const original = { info: { base: { year: '27', platform }, futbinId: {}, roster: { data: {} }, posIdToName: { 25: 'ST' } },
    _: { forEach: (list, fn) => list.forEach(fn) }, events: { externalRequest: async (method, url) => {
      trace.push({ method, url }); return JSON.stringify({ data: [rows[requestIndex++]] });
    } }, futbinId: { set: (def, id) => { original.info.futbinId[def] = id; } } };
  vm.runInNewContext(body, original);
  const player = { definitionId: 901, _rating: 70, nationId: 1, teamId: 2, leagueId: 3, preferredPosition: 25 };
  const expected = [];
  await original.futbinId.getId(player); expected.push(original.info.roster.data[901].n);
  for (let i = 0; i < 2; i++) { await original.futbinId.getPrice(901, 11); expected.push(original.info.roster.data[901].n); }
  const localTrace = []; const storage = new Map(); requestIndex = 0;
  const price = createFsuReferencePrice({ season: '27', platform,
    get: async (key, fallback) => storage.get(key) ?? fallback, set: async (key, value) => storage.set(key, value),
    request: async url => { localTrace.push({ method: 'GET', url }); return JSON.stringify({ data: [rows[requestIndex++]] }); } });
  const actual = [];
  for (let i = 0; i < 3; i++) actual.push(await price({ ...player, rating: player._rating }));
  expect(actual).toEqual(expected); expect(localTrace).toEqual(trace);
});
it('returns zero for a missing version and never a price belonging to another version', async () => {
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', get: async () => ({}), set: async () => {},
    request: async () => JSON.stringify({ data: [{ resource_id: 902, ID: 12, LCPrice: 500 }] }) });
  expect(await price({ definitionId: 901 })).toBe(0);
});
it.each([['PC:FFA27PCC', 'PC', 200], ['PSN:FFA27PS5', 'PS', 500]])
('maps the scoped native platform to the FSU price platform: %s', async (platform, expected, amount) => {
  const request = vi.fn(async () => JSON.stringify({ data: { player: { resource_id: 901, ID: 11, pc_LCPrice: 200, ps_LCPrice: 500 } } }));
  const price = createFsuReferencePrice({ season: '27', platform, request, get: async () => ({}), set: async () => {} });
  expect(await price({ definitionId: 901 })).toBe(amount);
  expect(new URL(request.mock.calls[0][0]).searchParams.get('platform')).toBe(expected);
});
it('does not fall back to a budget after a reference-price failure', async () => {
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', get: async () => ({}), set: async () => {},
    request: async () => { throw Error('FC27_BUY_REFERENCE_HTTP_403'); } });
  await expect(price({ definitionId: 901 })).rejects.toThrow('FC27_BUY_REFERENCE_HTTP_403');
});
it('retains the original roster price when a later successful response omits that version', async () => {
  const storage = new Map(); const request = vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ data: [{ resource_id: 901, ID: 11, LCPrice: 200 }] }))
    .mockResolvedValueOnce(JSON.stringify({ data: [] }));
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', request,
    get: async (key, fallback) => storage.get(key) ?? fallback, set: async (key, value) => storage.set(key, value) });
  expect(await price({ definitionId: 901 })).toBe(200);
  expect(await price({ definitionId: 901 })).toBe(200);
  expect(request).toHaveBeenCalledTimes(2);
});
it('uses an anonymous FUTBIN GET with no EA headers and accepts the original 200/201 responses', async () => {
  for (const status of [200, 201]) {
    const gm = vi.fn(options => options.onload({ status, responseText: 'public price' }));
    const url = 'https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?ID=11&platform=PC';
    expect(await createFc27FutbinHttp(gm)(url)).toBe('public price');
    expect(gm.mock.calls[0][0]).toMatchObject({ url, method: 'GET', anonymous: true, headers: { 'Content-Type': 'application/json' } });
    expect(Object.keys(gm.mock.calls[0][0]).sort()).toEqual(['anonymous', 'headers', 'method', 'onerror', 'onload', 'url']);
  }
});
it.each(['https://example.com/futbin/api/27/getFilteredPlayers', 'https://www.futbin.org/futbin/api/26/getFilteredPlayers',
  'https://www.futbin.org/account', 'https://secret@www.futbin.org/futbin/api/27/getFilteredPlayers'])
('refuses a URL outside the public price routes: %s', async url => {
  const gm = vi.fn(); await expect(createFc27FutbinHttp(gm)(url)).rejects.toThrow('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
  expect(gm).not.toHaveBeenCalled();
});
