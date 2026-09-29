import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { readFsuStyleAuctionPrices } from '../../src/fc27/fsu-auction-search.js';

const source = readFileSync(new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url), 'utf8');
const start = source.indexOf('events.readAuctionPrices = async');
const end = source.indexOf('events.searchTransferMarket =', start);
const card = (id, price) => ({ id, _auction: { buyNowPrice: price }, getAuctionData: () => ({ tradeId: id, buyNowPrice: price }) });
async function run(original, pages, initial = 200, attempts = 5) {
  const trace = []; let index = 0;
  const search = async price => { trace.push(['search', price]); return pages[index++] ?? { success: true, data: { items: [] } }; };
  const above = price => price + 50, below = price => price - 50;
  const wait = async (min, max) => { trace.push(['wait', min, max]); };
  const onResults = () => { trace.push(['pin']); }, onSearchFailure = () => { trace.push(['failed']); };
  let result;
  if (original) {
    const sandbox = { info: { set: { queries_number: attempts }, futbinId: { 10: 100 } },
      _: { has: (value, key) => Object.hasOwn(value, key) }, futbinId: { getPrice: async () => {} },
      UTSearchCriteriaDTO: class {}, UTBucketedItemSearchViewModel: class {
        defaultSearchCriteria = {}; updateSearchCriteria(criteria) { this.searchCriteria = { ...criteria }; }
      }, SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' }, ItemSearchFeature: { MARKET: 1 },
      services: { Item: { clearTransferMarketCache() {} } },
      UTCurrencyInputControl: { getIncrementAboveVal: above, getIncrementBelowVal: below },
      events: { changeLoadingText() {}, getCachePrice: () => ({ num: initial }),
        searchTransferMarket: criteria => search(criteria.maxBuy), sendPinEvents: onResults, notice: onSearchFailure, wait } };
    vm.runInNewContext(source.slice(start, end), sandbox);
    result = await sandbox.events.readAuctionPrices({ definitionId: 10 }, false);
  } else result = await readFsuStyleAuctionPrices({ search, above, below, initial, attempts, wait, onResults, onSearchFailure });
  return { trace, ids: result.map(item => item.id) };
}
it.each([
  ['empty then partial', [{ success: true, data: { items: [] } }, { success: true, data: { items: [card(1, 250)] } }]],
  ['full then failed', [{ success: true, data: { items: Array.from({ length: 21 }, (_, i) => card(i, 200)) } }, { success: false, status: 403 }]],
  ['duplicate auction', [{ success: true, data: { items: Array.from({ length: 21 }, (_, i) => card(i, 200)) } }, { success: true, data: { items: [card(0, 150)] } }]],
  ['explicit rejection', [{ success: false, status: 401, error: { code: 461 } }]],
])('matches unmodified FSU search trace: %s', async (_name, pages) => {
  expect(await run(false, pages)).toEqual(await run(true, pages));
});
it('uses the same configured attempt count and never starts from the account balance', async () => {
  const pages = Array.from({ length: 9 }, () => ({ success: true, data: { items: [] } }));
  expect(await run(false, pages, 200, 7)).toEqual(await run(true, pages, 200, 7));
});
