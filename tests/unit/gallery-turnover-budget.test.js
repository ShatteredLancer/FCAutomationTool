import { expect, it } from 'vitest';
import { forecastGalleryTurnover } from '../../src/gallery/turnover-budget.js';
const item = (eaId, price, resalePrice = price) => ({ eaId, price, resalePrice });

it('funds cumulative 110k purchases with 80k revolving capital, not a 110k cash cap', () => {
  const result = forecastGalleryTurnover({ capital: 80000, steps: [
    { setId: 'club-a', items: [item(1, 60000)] }, { setId: 'club-b', items: [item(2, 50000)] },
  ] });
  expect(result).toMatchObject({ status: 'estimated', feasible: true, totalPurchase: 110000,
    requiredCapital: 60000, expectedTax: 5500, expectedNetLoss: 5500, expectedRemaining: 74500 });
  expect(result.steps.map(step => step.expectedClosingBalance)).toEqual([77000, 74500]);
});

it('splits a club into exact-card cycles, confirming collection before forecast resale', () => {
  const result = forecastGalleryTurnover({ capital: 50000,
    steps: [{ setId: 'club-a', items: [item(1, 40000), item(2, 30000)] }] });
  expect(result).toMatchObject({ status: 'estimated', feasible: true, totalPurchase: 70000, requiredCapital: 40000 });
  expect(result.steps[0].cycles).toHaveLength(2);
  expect(result.steps[0].cycles.every(row => row.requiresCollectionConfirmation && row.requiresSaleReceipt)).toBe(true);
  expect(result.actualSaleIncome).toBeNull();
});

it('identifies an individually unaffordable card and accumulated tax erosion', () => {
  expect(forecastGalleryTurnover({ capital: 80000, steps: [{ setId: 'a', items: [item(1, 85000)] }] }))
    .toMatchObject({ feasible: false, requiredCapital: 85000, capitalShortfall: 5000 });
  const eroded = forecastGalleryTurnover({ capital: 80000, optimizeOrder: false,
    steps: [{ setId: 'a', items: [item(1, 60000)] }, { setId: 'b', items: [item(2, 79000)] }] });
  expect(eroded).toMatchObject({ feasible: false, requiredCapital: 82000, capitalShortfall: 2000 });
  expect(eroded.firstFundingGap).toMatchObject({ setId: 'b', eaId: 2, shortfall: 2000 });
});

it('looks ahead at order rather than spending away capital needed by a later expensive card', () => {
  const result = forecastGalleryTurnover({ capital: 80000,
    steps: [{ setId: 'cheap', items: [item(1, 60000)] }, { setId: 'expensive', items: [item(2, 79000)] }] });
  expect(result).toMatchObject({ feasible: true, requiredCapital: 79000 });
  expect(result.steps.map(step => step.setId)).toEqual(['expensive', 'cheap']);
});

it('buys a shared exact version only once even after it has been sold', () => {
  const result = forecastGalleryTurnover({ capital: 50000, steps: [
    { setId: 'club', items: [item(1, 40000)] }, { setId: 'league', items: [item(1, 40000), item(2, 30000)] },
  ] });
  expect(result).toMatchObject({ totalPurchase: 70000, expectedNetLoss: 3500, uniqueCards: 2, sharedCards: 1 });
  expect(result.steps.flatMap(step => step.cycles).map(row => row.eaId).sort()).toEqual([1, 2]);
});

it('keeps an unspecified capital unknown while reporting the required capital and sale assumptions', () => {
  const result = forecastGalleryTurnover({ steps: [{ setId: 'a', items: [item(1, 10000, 9000)] }] });
  expect(result).toMatchObject({ status: 'estimated', feasible: null, capital: null, requiredCapital: 10000,
    expectedTax: 450, expectedNetLoss: 1450, expectedRemaining: null, actualSaleIncome: null,
    saleBasis: 'forecast-not-receipts' });
});

it('does not replace unknown prices with zero or accept conflicting exact-version costs', () => {
  expect(forecastGalleryTurnover({ steps: [{ setId: 'a', items: [item(1, null)] }] }))
    .toMatchObject({ status: 'partial', reason: 'price-unknown', feasible: null, requiredCapital: null });
  expect(forecastGalleryTurnover({ steps: [{ setId: 'a', items: [item(1, 1000)] }, { setId: 'b', items: [item(1, 2000)] }] }))
    .toMatchObject({ status: 'unavailable', reason: 'version-price-conflict' });
});

it('validates parameters, handles no purchases, and never changes the input', () => {
  expect(forecastGalleryTurnover({ capital: -1, steps: [] })).toMatchObject({ status: 'unavailable' });
  expect(forecastGalleryTurnover({ taxBps: 10001, steps: [] })).toMatchObject({ status: 'unavailable' });
  expect(forecastGalleryTurnover({ capital: 100, steps: [] })).toMatchObject({ feasible: true, requiredCapital: 0, expectedRemaining: 100 });
  const input = { capital: 50000, steps: [{ setId: 'a', items: [item(1, 10000), item(2, 20000)] }] };
  const before = JSON.stringify(input); forecastGalleryTurnover(input); expect(JSON.stringify(input)).toBe(before);
});
