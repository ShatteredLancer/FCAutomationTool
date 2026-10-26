import { GALLERY_MARKET_TAX_BPS } from './net-cost.js';

const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const validPrice = value => integer(value, 15000000) && value > 0;
const fail = (reason, extra = {}) => ({ status: 'unavailable', reason, feasible: null, ...extra });
const totals = cycles => {
  let loss = 0, required = 0;
  for (const cycle of cycles) {
    required = Math.max(required, loss + cycle.price);
    loss += cycle.price - cycle.expectedSaleNet;
  }
  return { requiredCapital: Math.max(0, required), expectedNetLoss: loss };
};

// Detached forecast only; no sale receipt, balance mutation or spending permit.
// Each exact version is collected, then sold, before the next forecast buy.
// Real execution still needs independent collection AND sale confirmations.
export function forecastGalleryTurnover({ steps = [], capital = null, taxBps = GALLERY_MARKET_TAX_BPS,
  resaleDiscountBps = 0, optimizeOrder = true } = {}) {
  if (!Array.isArray(steps) || steps.length > 4096 || capital !== null && !integer(capital, 1000000000)
      || !integer(taxBps, 10000) || !integer(resaleDiscountBps, 10000) || typeof optimizeOrder !== 'boolean') return fail('input-invalid');
  const versions = new Map(), memberships = new Map(), prepared = [];
  for (const step of steps) {
    if (typeof step?.setId !== 'string' || !step.setId || !Array.isArray(step.items) || step.items.length > 2000) return fail('input-invalid');
    const seen = new Set(), cycles = [];
    for (const item of step.items) {
      if (!integer(item?.eaId) || !item.eaId || seen.has(item.eaId)) return fail('version-invalid');
      seen.add(item.eaId);
      if (item.price == null) return { ...fail('price-unknown'), status: 'partial', requiredCapital: null };
      if (!validPrice(item.price)) return fail('price-invalid');
      const resalePrice = Object.hasOwn(item, 'resalePrice') ? item.resalePrice
        : Math.floor(item.price * (10000 - resaleDiscountBps) / 10000);
      if (resalePrice == null) return { ...fail('resale-price-unknown'), status: 'partial', requiredCapital: null };
      if (!integer(resalePrice, 15000000)) return fail('price-invalid');
      const expectedSaleNet = Math.floor(resalePrice * (10000 - taxBps) / 10000);
      const cycle = { eaId: item.eaId, price: item.price, resalePrice, expectedSaleNet,
        expectedTax: resalePrice - expectedSaleNet, requiresCollectionConfirmation: true, requiresSaleReceipt: true };
      const previous = versions.get(item.eaId);
      if (previous && (previous.price !== cycle.price || previous.resalePrice !== cycle.resalePrice)) return fail('version-price-conflict');
      versions.set(item.eaId, cycle); cycles.push(cycle);
      memberships.set(item.eaId, (memberships.get(item.eaId) ?? 0) + 1);
    }
    // Returning the most coins first reduces funding pressure. This is an
    // ordering heuristic with shared versions, not a global optimality proof.
    if (optimizeOrder) cycles.sort((a, b) => b.expectedSaleNet - a.expectedSaleNet || a.eaId - b.eaId);
    prepared.push({ setId: step.setId, cycles, ...totals(cycles) });
  }
  if (optimizeOrder) prepared.sort((a, b) => (b.requiredCapital - b.expectedNetLoss)
    - (a.requiredCapital - a.expectedNetLoss) || a.setId.localeCompare(b.setId));
  const acquired = new Set(), resultSteps = [];
  let loss = 0, requiredCapital = 0, totalPurchase = 0, expectedSaleNet = 0, expectedTax = 0, firstFundingGap = null;
  for (const step of prepared) {
    const cycles = [], reusedIds = [];
    for (const source of step.cycles) {
      if (acquired.has(source.eaId)) { reusedIds.push(source.eaId); continue; }
      acquired.add(source.eaId);
      const expectedOpeningBalance = capital === null ? null : capital - loss;
      requiredCapital = Math.max(requiredCapital, loss + source.price);
      if (expectedOpeningBalance !== null && source.price > expectedOpeningBalance && !firstFundingGap) {
        firstFundingGap = { setId: step.setId, eaId: source.eaId, shortfall: source.price - expectedOpeningBalance };
      }
      totalPurchase += source.price; expectedSaleNet += source.expectedSaleNet; expectedTax += source.expectedTax;
      loss += source.price - source.expectedSaleNet;
      cycles.push({ ...source, expectedOpeningBalance, expectedClosingBalance: capital === null ? null : capital - loss });
    }
    resultSteps.push({ setId: step.setId, cycles, reusedIds, expectedClosingBalance: capital === null ? null : capital - loss });
  }
  requiredCapital = Math.max(0, requiredCapital);
  return { status: 'estimated', saleBasis: 'forecast-not-receipts', actualSaleIncome: null,
    capital, taxBps, resaleDiscountBps, totalPurchase, expectedSaleNet, expectedTax, expectedNetLoss: loss,
    requiredCapital, feasible: capital === null ? null : capital >= requiredCapital,
    capitalShortfall: capital === null ? null : Math.max(0, requiredCapital - capital),
    expectedRemaining: capital === null ? null : capital - loss, firstFundingGap,
    uniqueCards: acquired.size, sharedCards: [...memberships.values()].filter(count => count > 1).length,
    orderOptimal: false, steps: resultSteps };
}
