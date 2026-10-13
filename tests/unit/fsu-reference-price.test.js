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
it('rebuilds a stale season-scoped FUTBIN id after a 404', async () => {
  const storage = new Map([['fcat-futbin-ids:27', { 901: 11 }]]);
  const request = vi.fn()
    .mockRejectedValueOnce(Error('FC27_BUY_REFERENCE_HTTP_404'))
    .mockResolvedValueOnce(JSON.stringify({ data: [{ resource_id: 901, ID: 22, LCPrice: 240 }] }));
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', request,
    get: async (key, fallback) => storage.get(key) ?? fallback, set: async (key, value) => storage.set(key, structuredClone(value)) });
  expect(await price({ definitionId: 901, rating: 70, nationId: 1, teamId: 2, leagueId: 3, preferredPosition: 25 })).toBe(240);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    'https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?ID=11&platform=PC',
    'https://www.futbin.org/futbin/api/27/getFilteredPlayers?platform=PC&nation=1&league=3&rating=70-70&club=2&sort=rating&position=ST&order=desc&page=1',
  ]);
  expect(storage.get('fcat-futbin-ids:27')).toEqual({ 901: 22 });
});
it('rebuilds a stale FUTBIN id when a 200 response contains another version', async () => {
  const storage = new Map([['fcat-futbin-ids:27', { 901: 11 }]]);
  const request = vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ data: [{ Player_Resource: 902, LCPrice: 999 }] }))
    .mockResolvedValueOnce(JSON.stringify({ data: [{ resource_id: 901, ID: 22, LCPrice: 240 }] }));
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', request,
    get: async (key, fallback) => storage.get(key) ?? fallback, set: async (key, value) => storage.set(key, structuredClone(value)) });
  expect(await price({ definitionId: 901, rating: 70, nationId: 1, teamId: 2, leagueId: 3, preferredPosition: 25 })).toBe(240);
  expect(request).toHaveBeenCalledTimes(2);
  expect(storage.get('fcat-futbin-ids:27')).toEqual({ 901: 22 });
});
it('retains the original roster price when a later successful response omits that version', async () => {
  const storage = new Map(); const request = vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ data: [{ resource_id: 901, ID: 11, LCPrice: 200 }] }))
    .mockResolvedValueOnce(JSON.stringify({ data: [] }))
    .mockResolvedValueOnce(JSON.stringify({ data: [] }));
  const price = createFsuReferencePrice({ season: '27', platform: 'pc', request,
    get: async (key, fallback) => storage.get(key) ?? fallback, set: async (key, value) => storage.set(key, value) });
  expect(await price({ definitionId: 901 })).toBe(200);
  expect(await price({ definitionId: 901 })).toBe(200);
  expect(request).toHaveBeenCalledTimes(3);
});
it('matches FSU FUTBIN GET headers and accepts the original 200/201 responses', async () => {
  for (const status of [200, 201]) {
    const gm = vi.fn(options => options.onload({ status, responseText: 'public price' }));
    const url = 'https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?ID=11&platform=PC';
    expect(await createFc27FutbinHttp(gm, { userAgent: 'FCAT-Test-UA' })(url)).toBe('public price');
    expect(gm.mock.calls[0][0]).toMatchObject({ url, method: 'GET', headers: { 'Content-Type': 'application/json', 'User-Agent': 'FCAT-Test-UA' } });
    expect(gm.mock.calls[0][0].anonymous).toBeUndefined();
    expect(Object.keys(gm.mock.calls[0][0]).sort()).toEqual(['headers', 'method', 'onerror', 'onload', 'ontimeout', 'timeout', 'url']);
  }
});
it('ends timed-out public requests and refuses redirects without printing the URL', async () => {
  const url = 'https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?ID=11&platform=PC';
  await expect(createFc27FutbinHttp(options => { expect(options.timeout).toBe(15000); options.ontimeout(); })(url))
    .rejects.toThrow('FC27_BUY_REFERENCE_TIMEOUT');
  await expect(createFc27FutbinHttp(options => options.onload({ status: 200, finalUrl: 'https://example.com/private', responseText: '{}' }))(url))
    .rejects.toThrow('FC27_BUY_REFERENCE_REDIRECT');
});
it('records independent HTTP durations for out-of-order concurrent responses without URLs', async () => {
  const pending = [], events = []; let time = 1000;
  const request = createFc27FutbinHttp(options => pending.push(options), { now: () => time, onEvent: row => events.push(row) });
  const base = 'https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?platform=PC&ID=';
  const first = request(`${base}1`);
  time = 1100; const second = request(`${base}2`);
  time = 1300; pending[1].onload({ status: 200, responseText: '{}' });
  time = 1500; pending[0].onload({ status: 200, responseText: '{}' });
  await Promise.all([first, second]);
  expect(events.filter(row => row.status === 'received').map(row => row.durationMs)).toEqual([200, 500]);
  expect(events.every(row => !Object.hasOwn(row, 'url'))).toBe(true);
});
it.each(['https://example.com/futbin/api/27/getFilteredPlayers', 'https://www.futbin.org/futbin/api/26/getFilteredPlayers',
  'https://www.futbin.org/account', 'https://secret@www.futbin.org/futbin/api/27/getFilteredPlayers'])
('refuses a URL outside the public price routes: %s', async url => {
  const gm = vi.fn(); await expect(createFc27FutbinHttp(gm)(url)).rejects.toThrow('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
  expect(gm).not.toHaveBeenCalled();
});
