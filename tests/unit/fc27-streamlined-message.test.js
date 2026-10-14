import { expect, it } from 'vitest';
import { streamlinedExecutionMessage, streamlinedRouteSummary, streamlinedMarketMessage,
  streamlinedInventoryPreview, streamlinedExecutionProgress, streamlinedExecutionClock } from '../../src/adapters/browser/fc27-streamlined-panel.js';

it('explains which protection input failed instead of only showing the aggregate error code', () => {
  const reason = 'FC27_STREAMLINED_PROTECTION_UNVERIFIED';
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-lock-list' })).toContain('FSU 锁卡名单');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-slot-list', count: 11, requiredSlots: 23 })).toContain('11 / 23');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-cache', cached: false })).toContain('原生主阵容缓存');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'secret-payload', itemId: 123456 })).not.toContain('secret-payload');
});

it('shows verified purchase/contribution counters and the current search without inventing success', () => {
  const text = streamlinedExecutionProgress({ phase: 'search', batchNumber: 2, purchased: 3, purchaseTarget: 40,
    spent: 3300, budget: 44000, contributed: 1, submittedScore: 830, targetScore: 34000,
    playerName: 'Fixture player', rating: 84, maxBuy: 1100, attempt: 1, attemptLimit: 3 });
  expect(text).toContain('搜索限价内挂牌');
  expect(text).toContain('Fixture player · 84 OVR · 上限 1,100 金币 · 尝试 1 / 3');
  expect(text).toContain('已购 3 / 40 张');
  expect(text).toContain('已确认 830 / 34,000 分');
  expect(text).not.toContain('达标');
  expect(streamlinedExecutionProgress({ phase: 'preflight' })).toContain('未知');
  expect(streamlinedExecutionProgress({ phase: 'checking-state' })).toContain('核对库存与剩余容量');
  expect(streamlinedExecutionProgress({ phase: 'materialize', stage: 'club-readback', completed: 1, materialTotal: 2 }))
    .toContain('核对 Club 回读');
});

it('counts elapsed/waiting time without claiming that a timer confirms a transaction', () => {
  expect(streamlinedExecutionClock({ phase: 'partial-ready', waitMs: 12000 }, 22000, 2300))
    .toBe('本次耗时 22 秒 · 当前步骤等待 2 秒 · 预计收批等待剩余 10 秒');
  expect(streamlinedExecutionClock({ phase: 'partial-ready', waitMs: 12000 }, 60000, 20000))
    .toContain('剩余 0 秒');
  expect(streamlinedExecutionClock({ phase: 'search' }, 5000, 3000, false)).toBe('本次耗时 5 秒');
  expect(streamlinedExecutionClock({}, NaN, -3000)).toContain('0 秒');
});

it('lists each physical stock copy, binds market previews to the frozen route and preserves the plan', () => {
  const stock = { source: 'inventory', id: 11, definitionId: 101, name: 'Owned fixture', pile: 'club', points: 830 };
  const second = { ...stock, id: 12, pile: 'storage' }, market = { source: 'market', definitionId: 101, id: null };
  const plan = { items: [stock, second, market], batches: [[stock], [second, market]], route: { groups: [{ source: 'market' }] } };
  const before = structuredClone(plan);
  expect(streamlinedInventoryPreview(plan, [])).toEqual([{ ...stock, consumed: false }, { ...second, consumed: false }]);
  expect(streamlinedInventoryPreview(plan, [], { consumedIds: [11] }).map(item => item.consumed)).toEqual([true, false]);
  expect(plan).toEqual(before);
});

it('updates inventory-only previews with selected batches and shows confirmed consumption separately', () => {
  const first = { source: 'inventory', id: 1, definitionId: 101 }, second = { ...first, id: 2, definitionId: 102 };
  const plan = { items: [first, second], batches: [[first], [second]] };
  expect(streamlinedInventoryPreview(plan, [1])).toEqual([{ ...second, consumed: false }]);
  expect(streamlinedInventoryPreview(plan, [])).toEqual([]);
  expect(streamlinedInventoryPreview(plan, [1], { batches: [{ state: 'confirmed' }, { state: 'waiting' }] }))
    .toEqual([{ ...first, consumed: true }, { ...second, consumed: false }]);
});

it('distinguishes FUTBIN quote expiration from a FUT.GG candidate catalog connection failure', () => {
  const message = streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_STREAMLINED_QUOTES_EXPIRED' });
  expect(message).toContain('FUTBIN');
  expect(message).toContain('到期');
  expect(message).toContain('重新生成');
  expect(message).not.toContain('FUT.GG');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_BUY_REFERENCE_TIMEOUT' })).toContain('FUTBIN');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_STREAMLINED_CATALOG_HTTP_403' })).toContain('目录连接（FUT.GG）');
});

it('explains old material moves and read-only recovery without requiring the old SBC page', () => {
  const text = streamlinedExecutionMessage('FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED', {
    kind: 'streamlined-materialization', setId: 99, challengeId: 199, pendingCount: 2 });
  expect(text).toContain('Set 99 / Challenge 199');
  expect(text).toContain('2 张');
  expect(text).toContain('核对并恢复');
  expect(text).toContain('不会重复移动、购买或贡献');
});

it('summarizes a route without expanding its per-card groups', () => {
  const text = streamlinedRouteSummary({
    purchaseCost: 1500, materialValue: 800, score: 100, count: 10, inventoryCount: 4, marketCount: 6, minBatches: 1,
    groups: [
      { source: 'inventory', quantity: 4, items: [{ points: 10, rating: 82, name: 'Owned' }] },
      { source: 'market', quantity: 6, items: [{ points: 15, rating: 83, price: 250, purchaseMaxBuy: 300 }] },
    ],
  });
  expect(text).toContain('1,500');
  expect(text).toContain('总价值 2,300');
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

it('shows unknown inventory value explicitly instead of calling the purchase estimate total value', () => {
  const text = streamlinedRouteSummary({ purchaseCost: 200, materialValue: null, score: 100, count: 2,
    inventoryCount: 1, marketCount: 1, minBatches: 1, groups: [] });
  expect(text).toContain('总价值 未知');
  expect(text).toContain('待购 200');
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
