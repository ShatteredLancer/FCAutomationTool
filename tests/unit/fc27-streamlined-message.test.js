import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { streamlinedExecutionMessage, streamlinedRouteSummary, streamlinedMarketMessage,
  streamlinedInventoryPreview, streamlinedExecutionProgress, streamlinedExecutionClock,
  streamlinedPurchaseBudgetPreview, streamlinedConfirmedContribution } from '../../src/adapters/browser/fc27-streamlined-panel.js';

it.each(['batch-cooldown', 'progress-backoff'])('shows %s as a bounded wait rather than a stopped run', phase => {
  const text = streamlinedExecutionProgress({ phase, waitMs: 6000, attempt: 1, attemptLimit: 3, submittedScore: 100, targetScore: 200 });
  expect(text).toContain(phase === 'batch-cooldown' ? '批次间冷却' : '退避后重试');
  expect(text).toContain('100 / 200');
  expect(text).not.toContain('未知 张');
  expect(streamlinedExecutionClock({ phase, waitMs: 6000 }, 10000, 2000, true)).toContain('读取等待剩余 4 秒');
});

it('explains a genuine completion-state conflict without telling the user to buy or contribute again', () => {
  const message = streamlinedExecutionMessage('FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED');
  expect(message).toContain('EA 已返回本批完成回执');
  expect(message).toContain('不要重新买卡或重复投入');
  expect(message).not.toBe('FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED');
});

it.each([20, 40])('separates confirmed score %s from unfinished local synchronization', score => {
  const result = { status: 'recovery-required', reason: 'FC27_STREAMLINED_SET_CHANGED',
    confirmation: { submittedScore: score, targetScore: 40, finalizationPending: true } };
  const value = streamlinedConfirmedContribution(result);
  expect(value).toMatchObject({ submittedScore: score, targetScore: 40 });
  expect(value.message).toContain(score === 40 ? 'SBC 已完成' : '本批贡献已确认');
  expect(value.message).toContain('仅本地界面同步未完成');
  expect(value.message).toContain('不会重复投入');
  expect(value.message).not.toContain('结果尚未确认');
  expect(streamlinedConfirmedContribution({ reason: result.reason })).toBe(null);
  expect(streamlinedConfirmedContribution({ confirmation: { ...result.confirmation, submittedScore: null } })).toBe(null);
});

it('restores the Points Solver interface copy to Chinese without translating settings keys or native player names', () => {
  const source = readFileSync(new URL('../../src/adapters/browser/fc27-streamlined-panel.js', import.meta.url), 'utf8');
  expect(source).toMatch(/[\u3400-\u9fff]/);
  expect(source).toContain('FCAT 积分解题');
  expect(source).toContain("toLocaleString('en-US')");
  expect(source).toContain('value="lowest-value"');
  expect(source).toContain('购卡总预算（金币）');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_NO_AFFORDABLE_CARDS'))
    .toBe('当前方案没有可执行的限价内候选，已暂停。已确认购入的材料保留。');
});

it('shows holdings pagination separately from contribution batch progress and explains a read-only pause', () => {
  const text = streamlinedExecutionProgress({ phase: 'checking-holdings', holdingsBatch: 2, holdingsBatchTotal: 3,
    offset: 250, batchNumber: 7 });
  expect(text).toContain('第 7 批 · 核对 Club 版本持有');
  expect(text).toContain('版本核对 2 / 3 组 · 第 2 页');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED')).toContain('可直接重试');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED')).toContain('未决交易仍须先核对');
});

it('proposes exactly 15% budget reserve over frozen card caps, without editing the plan or inventing a cap', () => {
  const plan = { route: { groups: [
    { source: 'inventory', quantity: 1, items: [{ id: 11, price: 1100 }] },
    { source: 'market', quantity: 38, items: [{ price: 1100, purchaseMaxBuy: 1100 }] },
  ] } };
  const before = structuredClone(plan);
  expect(streamlinedPurchaseBudgetPreview(plan)).toEqual({ base: 41800, reserve: 6270, budget: 48070 });
  expect(plan).toEqual(before);
  expect(streamlinedPurchaseBudgetPreview({ route: { groups: [] } })).toEqual({ base: 0, reserve: 0, budget: 0 });
  expect(streamlinedPurchaseBudgetPreview({ route: { groups: [
    { source: 'market', quantity: 1, items: [{ price: 101, purchaseMaxBuy: 151 }] },
  ] } })).toEqual({ base: 151, reserve: 23, budget: 174 });
  expect(() => streamlinedPurchaseBudgetPreview({ route: { groups: [
    { source: 'market', quantity: 1, items: [{}] },
  ] } })).toThrow('PURCHASE_BUDGET_UNVERIFIED');
});

it('explains which protection input failed instead of only showing the aggregate error code', () => {
  const reason = 'FC27_STREAMLINED_PROTECTION_UNVERIFIED';
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-lock-list' })).toContain('FSU 锁卡名单');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-slot-list', count: 11, requiredSlots: 23 })).toContain('11 / 23');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-cache', cached: false })).toContain('主阵容缓存');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'secret-payload', itemId: 123456 })).not.toContain('secret-payload');
});

it('explains an unverified native activation state without treating a zero identifier alone as proof', () => {
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_PROTECTION_UNVERIFIED', null,
    { phase: 'protection-active-state', mismatch: 'inactive' })).toContain('主阵容的启用状态尚未核验');
});

it('shows verified purchase/contribution counters and the current search without inventing success', () => {
  const text = streamlinedExecutionProgress({ phase: 'search', batchNumber: 2, purchased: 3, purchaseTarget: 40,
    spent: 3300, budget: 44000, contributed: 1, submittedScore: 830, targetScore: 34000,
    playerName: 'Fixture player', rating: 84, maxBuy: 1100, attempt: 1, attemptLimit: 3 });
  expect(text).toContain('搜索限价内挂牌');
  expect(text).toContain('Fixture player · 84 OVR · 上限 1,100 金币 · 尝试 1 / 3');
  expect(text).toContain('已购 3 / 40 张');
  expect(text).toContain('已确认 830 / 34,000 分');
  expect(text).not.toContain('目标已达成');
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
  expect(streamlinedExecutionClock({ phase: 'waiting-supply', waitMs: 15000 }, 30000, 4000)).toContain('供应重试等待剩余 11 秒');
  expect(streamlinedExecutionProgress({ phase: 'waiting-supply', attempt: 1, attemptLimit: 2 })).toContain('供应重试 1 / 2');
  expect(streamlinedExecutionProgress({ phase: 'partial-ready', waitMs: 0 })).toContain('立即贡献');
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
  expect(message).toContain('重新生成方案');
  expect(message).not.toContain('FUT.GG');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_BUY_REFERENCE_TIMEOUT' })).toContain('FUTBIN');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_STREAMLINED_CATALOG_HTTP_403' })).toContain('候选目录连接（FUT.GG）');
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
  expect(text).toContain('100 分');
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
  expect(message).not.toContain('interface');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED')).toContain('未启用贡献接口');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_RECONCILIATION_REQUIRED')).toContain('不要重复投入');
  expect(streamlinedExecutionMessage(null)).not.toContain('interface');
});

it('shows bounded purchase-state counts without claiming local counts prove settlement', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 21, challengeId: 48, phase: 'ready',
    states: { waiting: 2, club: 3, 'buy-pending': 1 }, applied: 2 });
  expect(message).toContain('未购买 2');
  expect(message).toContain('成交待核对 1');
  expect(message).toContain('已入库 3');
  expect(message).toContain('已确认替换 2');
  expect(message).toContain('回对应 SBC');
});
