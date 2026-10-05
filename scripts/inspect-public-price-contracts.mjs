// Anonymous public-price contract check. No EA browser, account or trade APIs.
// Report contains selected public fields only; signed URLs are never printed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const proxy = process.argv.find(arg => arg.startsWith('--proxy='))?.slice(8);
async function json(url, body) {
  const args = ['--silent', '--show-error', '--max-time', '25', '--fail-with-body'];
  if (proxy) args.push('--proxy', proxy);
  if (body) args.push('--header', 'Content-Type: application/json', '--data-raw', JSON.stringify(body));
  args.push(url);
  try { return JSON.parse((await exec('curl.exe', args, { maxBuffer: 2_000_000 })).stdout); }
  catch { throw Error('PUBLIC_PRICE_PROBE_REQUEST_FAILED'); }
}
const select = (row, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const results = [];
for (const platform of ['PC', 'PS']) {
  try {
    const base = 'https://www.futbin.org/futbin/api/27/';
    const filtered = await json(`${base}getFilteredPlayers?platform=${platform}&nation=95&league=2221&rating=80-80&club=116308&sort=rating&position=RM&order=desc&page=1`);
    const row = filtered.data?.find(row => row.resource_id === 71494);
    if (!Number.isSafeInteger(row?.ID)) throw Error('PUBLIC_PRICE_ID_MISSING');
    const minimal = await json(`${base}fetchPlayerInformationMinimal?ID=${row.ID}&platform=${platform}`);
    results.push({ source: 'futbin', platform, filtered: select(row, ['ID','resource_id','pc_LCPrice','ps_LCPrice','LCPrice','price']),
      minimalKeys: Object.keys(minimal.data ?? {}),
      minimal: Object.values(minimal.data ?? {}).map(row => select(row, ['ID','Player_Resource','pc_LCPrice','ps_LCPrice','LCPrice','price'])),
      timeFields: Object.keys(row).filter(key => /time|date|updated/i.test(key)) });
  } catch (error) { results.push({ source: 'futbin', platform, error: error.message }); }
}
for (const platform of ['pc', 'ps5']) {
  try {
    const relative = `/api/fut/player-prices/27/?ids=71494,73562&platform=${platform}`;
    const signed = await json('https://www.fut.gg/api/fut/price-access/sign/', { url: relative });
    if (!signed.data?.url?.startsWith('/api/fut/player-prices/27/')) throw Error('PUBLIC_PRICE_SIGN_INVALID');
    const result = await json(new URL(signed.data.url, 'https://www.fut.gg').href);
    results.push({ source: 'futgg', platform, topKeys: Object.keys(result),
      rows: result.data?.map(row => ({ keys: Object.keys(row), values: select(row, ['eaId','price','priceUpdatedAt','platform']) })) });
  } catch (error) { results.push({ source: 'futgg', platform, error: error.message }); }
}
console.log(JSON.stringify({ inspectedAt: new Date().toISOString(), results }, null, 2));
if (results.some(row => row.error)) process.exitCode = 1;
