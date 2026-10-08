import { expect, it } from 'vitest';
import { streamlinedExecutionMessage, streamlinedRouteSummary } from '../../src/adapters/browser/fc27-streamlined-panel.js';

it('summarizes a route without expanding its per-card groups', () => {
  const text = streamlinedRouteSummary({
    purchaseCost: 1500, score: 100, count: 10, inventoryCount: 4, marketCount: 6, minBatches: 1,
    groups: [
      { source: 'inventory', quantity: 4, items: [{ points: 10, rating: 82, name: 'Owned' }] },
      { source: 'market', quantity: 6, items: [{ points: 15, rating: 83, price: 250, purchaseMaxBuy: 300 }] },
    ],
  });
  expect(text).toContain('1,500');
  expect(text).toContain('上限 1,800');
  expect(text).toContain('100 积分');
  expect(text).toContain('10 张');
  expect(text).toContain('库存 4 / 待购 6');
  expect(text).not.toContain('Owned');
  expect(text).not.toContain('82');
  expect(text).not.toContain('83');
});

it('reports no purchase cap for an inventory-only route', () => {
  expect(streamlinedRouteSummary({
    purchaseCost: 0, score: 40, count: 2, inventoryCount: 2, marketCount: 0, minBatches: 1,
    groups: [{ source: 'inventory', quantity: 2, items: [{ points: 20, rating: 75 }] }],
  })).toContain('上限 0');
});

it('distinguishes unresolved purchases from missing contribution capability', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 19, challengeId: 43, phase: 'save-pending' });
  expect(message).toContain('Set 19 / Challenge 43');
  expect(message).toContain('阵容替换保存尚未核对');
  expect(message).toContain('对应 SBC');
  expect(message).not.toContain('接口');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED')).toContain('未启用贡献接口');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_RECONCILIATION_REQUIRED')).toContain('不要重复投入');
  expect(streamlinedExecutionMessage(null)).not.toContain('接口');
});

it('shows bounded purchase-state counts without claiming local counts prove settlement', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 21, challengeId: 48, phase: 'ready',
    states: { waiting: 2, club: 3, 'buy-pending': 1 }, applied: 2 });
  expect(message).toContain('未购买 2');
  expect(message).toContain('成交待核对 1');
  expect(message).toContain('已入库 3');
  expect(message).toContain('已确认替换 2');
  expect(message).toContain('请先回对应 SBC');
});
