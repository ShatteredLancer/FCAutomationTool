import { it, expect } from 'vitest';
import { marketTaskReport } from '../../src/trading/market-task-report.js';
it('reports actual sold receipts, keeps unknown cost unknown and isolates other tasks', () => {
  const state = { intents: [{ taskId: 't', kind: 'buy', phase: 'confirmed' }, { taskId: 't', kind: 'list', phase: 'confirmed' }],
    holdings: [{ taskId: 't', phase: 'listed', cost: 600, salePrice: null }, { taskId: 'other', phase: 'sold', cost: 1, salePrice: 10000 }] };
  expect(marketTaskReport(state, 't')).toMatchObject({ purchased: 1, listed: 1, sold: 0, heldCost: 600, realizedProfit: 0, netRevenue: 0 });
  Object.assign(state.holdings[0], { phase: 'sold', salePrice: 700 });
  expect(marketTaskReport(state, 't')).toMatchObject({ sold: 1, heldCost: 0, realizedProfit: 65, netRevenue: 665 });
  state.holdings[0].cost = null;
  expect(marketTaskReport(state, 't')).toMatchObject({ realizedProfit: null, unknownSoldCosts: 1, netRevenue: 665 });
});
