import { expect, it } from 'vitest';
import { formatFc27PuzzleNativeResult, formatFc27PuzzleProgress } from '../../src/adapters/browser/fc27-puzzle-native-button.js';

const leagueShortage = (rules, policy = { onlyUntradeable: true, excludedLeagueIds: [13, 31] }) => ({
  status: 'blocked', reason: 'FC27_PUZZLE_CONSTRAINT_SHORTAGE', policy, rules,
});

it('shows bounded cost progress with separate materials and cash without treating unknown prices as zero', () => {
  const text = formatFc27PuzzleProgress({ stage: 'procurement', phase: 'owned-value-search', elapsedMs: 12345,
    bestMaterialValue: 9400, bestEstimatedCost: 0 });
  expect(text).toContain('低价库存替换'); expect(text).toContain('12 秒');
  expect(text).toContain('9,400'); expect(text).toContain('待购 0');
  expect(formatFc27PuzzleProgress({ phase: 'owned-value-read', quoteCompleted: 12, quoteTotal: 50,
    bestMaterialValue: null })).toContain('报价 12 / 50');
  expect(formatFc27PuzzleProgress({ bestMaterialValue: null })).not.toContain('当前最佳');
});

it('explains an explicit required league blocked by the current FSU policy without requiring a market failure', () => {
  const text = formatFc27PuzzleNativeResult(leagueShortage([{ kind: 'from-leagues', ids: [13], count: 2, mode: 'min' }]));
  expect(text).toContain('仅不可交易');
  expect(text).toContain('排除联赛 ID：13、31');
  expect(text).toContain('至少 2 张');
  expect(text).toContain('与 FSU 排除联赛设置冲突');
  expect(text).not.toContain('增加搜索节点');
});

it.each([
  { kind: 'from-leagues', ids: [13, 10], count: 2, mode: 'min' },
  { kind: 'from-leagues', ids: [13], count: 2, mode: 'max' },
  { kind: 'from-leagues', ids: [13], count: 0, mode: 'exact' },
  { kind: 'from-clubs', ids: [13], count: 2, mode: 'min' },
  { kind: 'from-leagues', ids: [], count: 2, mode: 'min' },
])('does not infer a league policy conflict for %j', rule => {
  expect(formatFc27PuzzleNativeResult(leagueShortage([rule]))).not.toContain('与 FSU 排除联赛设置冲突');
});

it('detects a positive exact OR league requirement only when all allowed leagues are excluded', () => {
  const text = formatFc27PuzzleNativeResult(leagueShortage([{ kind: 'from-leagues', ids: [13, 31], count: 2, mode: 'exact' }]));
  expect(text).toContain('恰好 2 张');
  expect(text).toContain('与 FSU 排除联赛设置冲突');
});

it('does not invent missing restrictions or append shortage advice to a successful save', () => {
  const rules = [{ kind: 'from-leagues', ids: [13], count: 2, mode: 'min' }];
  for (const policy of [null, { onlyUntradeable: false, excludedLeagueIds: [] }]) {
    const text = formatFc27PuzzleNativeResult(leagueShortage(rules, policy));
    expect(text).not.toContain('当前 FSU');
    expect(text).not.toContain('与 FSU 排除联赛设置冲突');
  }
  expect(formatFc27PuzzleNativeResult({ ...leagueShortage(rules), status: 'filled', saved: true }))
    .toBe('阵容已保存，未提交 SBC。');
});

it('shows live bounded search progress and stage counters', () => {
  const text = formatFc27PuzzleProgress({ stage: 'planning', nodes: 12544, maxNodes: 50000,
    safeCandidates: 237, search: { combinationNodes: 9210, placementNodes: 2876, evaluations: 458, bounds: 0 } });
  expect(text).toContain('12,544 / 50,000');
  expect(text).toContain('候选 237 人');
  expect(text).toContain('组合 9,210');
  expect(text).toContain('评估 458');
});

it('keeps old string stage progress compatible', () => {
  expect(formatFc27PuzzleProgress('planning')).toContain('正在解题');
});

it('identifies a saved feasible cost plan that exhausted optimization without inventing this state when evidence is absent', () => {
  const result = { status: 'concept-filled', purchaseCount: 5, estimatedCost: 11700, materialValue: 14300, inventoryValue: 2600 };
  expect(formatFc27PuzzleNativeResult({ ...result, procurementSummary: { diagnostics: { optimizationBudgetExhausted: true } } }))
    .toContain('搜索预算已用尽');
  expect(formatFc27PuzzleNativeResult(result)).not.toContain('搜索预算已用尽');
});

it('distinguishes an internal planning contract error from insufficient materials', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'SAFE_MATERIAL_SHORTAGE',
    purchaseSuggestion: { status: 'blocked', reason: 'FC27_MARKET_POLICY_INVALID' } });
  expect(text).toContain('求解器规划参数不一致');
  expect(text).toContain('搜索未启动');
  expect(text).not.toContain('未找到补卡组合');
});

it('explains exhausted inventory and joint search without claiming no solution', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'FC27_PUZZLE_SEARCH_LIMIT',
    purchaseSuggestion: { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT' } });
  expect(text).toContain('搜索达到上限');
  expect(text).toContain('不能判定无解');
  expect(text).not.toContain('补卡：规划未完成');
});

it('shows the procurement failure alongside the inventory failure and bounded search evidence', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'FC27_PUZZLE_CONSTRAINT_SHORTAGE',
    policy: { maxRating: 82, materialComposition: [{ quality: 1, count: 11 }] },
    plan: { safeCandidates: 40, nodes: 1200 },
    purchaseSuggestion: { status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN',
      diagnostics: { stage: 'local-market-search', route: 'repair', catalogPages: 3, catalogCandidates: 48,
        usableCandidates: 20, localReason: 'FC27_PURCHASE_REPAIR_NO_PLAN', checks: 20000, nodes: null,
        truncated: true, catalogAttempts: 0, quoteAttempts: 0, cacheHits: 3 } } });
  for (const fragment of ['11 铜', '40', 'FC27_PURCHASE_REPAIR_NO_PLAN', '局部替换', '48', '20', '20000', '缓存 3']) expect(text).toContain(fragment);
  expect(text).toContain('优先 11 铜'); expect(text).not.toContain('未自动增加高品质卡');
  expect(text).toContain('不代表整个市场无解');
  expect(text).not.toContain('无法在选材限制内组成阵容');
});

it('explains reserved inventory and does not hide an expired price behind an inventory shortage', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED',
    plan: { safeCandidates: 0, nodes: 0, reservations: { excludedCachedItems: 233, activeTargets: 21, references: 233 } },
    purchaseSuggestion: { status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', diagnostics: {
      stage: 'local-market-search', route: 'joint', catalogPages: 3, catalogCandidates: 57,
      usableCandidates: 54, localReason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: 50000, truncated: true,
      catalogAttempts: 3, quoteAttempts: 0, cacheHits: 0,
    } } });
  expect(text).toContain('233 张');
  expect(text).toContain('21 个');
  expect(text).toContain('参考报价在规划结束前过期');
  expect(text).toContain('搜索达到上限');
  expect(text).toContain('不能据此判断市场无解');
  expect(text).toContain('57');
  expect(text).toContain('54');
});

it('does not infer a search limit from price expiry without search evidence', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED',
    purchaseSuggestion: { status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED',
      diagnostics: { stage: 'quote-read', route: 'joint' } } });
  expect(text).toContain('参考报价在规划结束前过期');
  expect(text).not.toContain('搜索达到上限');
});

it.each(['FC27_PURCHASE_QUOTES_UNAVAILABLE', 'FC27_MARKET_HTTP_429', 'FC27_MARKET_READ_BLOCKED', 'FC27_PURCHASE_CACHE_UNVERIFIED'])(
  'retains the actual procurement stop code %s instead of reporting only shortage', reason => {
    expect(formatFc27PuzzleNativeResult({ reason: 'SAFE_MATERIAL_SHORTAGE',
      purchaseSuggestion: { status: 'blocked', reason } })).toContain(reason);
  });

it('keeps unknown diagnostics unknown and does not display arbitrary error text', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'SAFE_MATERIAL_SHORTAGE',
    purchaseSuggestion: { status: 'blocked', reason: '<script>secret</script>' } });
  expect(text).not.toContain('secret'); expect(text).not.toContain('候选 0');
});

it('distinguishes a market runtime fingerprint stop from a puzzle shortage', () => {
  const text = formatFc27PuzzleNativeResult({ reason: 'SAFE_MATERIAL_SHORTAGE', purchaseSuggestion: {
    status: 'blocked', reason: 'FC27_MARKET_METHOD_0_CHANGED',
    diagnostics: { stage: 'query-planning', route: 'joint', catalogPages: 0, catalogCandidates: 0,
      usableCandidates: null, catalogAttempts: 0, quoteAttempts: 0, cacheHits: 0 },
  } });
  expect(text).toContain('FC27_MARKET_METHOD_0_CHANGED');
  expect(text).toContain('未发送 EA 市场请求');
  expect(text).toContain('不是库存无解');
  expect(text).not.toContain('补卡：规划未完成');
});

it('preserves the verified save message', () => {
  expect(formatFc27PuzzleNativeResult({ status: 'filled', saved: true })).toBe('阵容已保存，未提交 SBC。');
});

it('labels a concept estimate as incremental purchases, not full material value', () => {
  const message = formatFc27PuzzleNativeResult({ status: 'concept-filled', purchaseCount: 5, estimatedCost: 2850 });
  expect(message).toContain('预计新增购卡支出 2850 金币');
  expect(message).toContain('不含现有卡市值');
  expect(message).toContain('不保证全市场最低价');
});

it('shows total material value separately from additional purchases and existing inventory', () => {
  const message = formatFc27PuzzleNativeResult({ status: 'concept-filled', purchaseCount: 2, estimatedCost: 400,
    inventoryValue: 1800, materialValue: 2200 });
  expect(message).toContain('新增购卡支出 400');
  expect(message).toContain('整套材料估值 2200');
  expect(message).toContain('现有卡 1800');
});

it('explains that partial value coverage only optimized the quoted material subset', () => {
  const message = formatFc27PuzzleNativeResult({ status: 'filled', saved: true, materialValue: 8200,
    valueCoverageComplete: false, unpricedOwnedCount: 96 });
  expect(message).toContain('只在已估价候选中优化');
  expect(message).toContain('96 张未估值');
  expect(message).toContain('不代表全局最低');
});

it('makes an expired optimization fallback explicit after a successful save', () => {
  const message = formatFc27PuzzleNativeResult({ status: 'filled', saved: true,
    valueReason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED',
    procurementSummary: { status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' } });
  expect(message).toContain('降价优化未完成');
  expect(message).toContain('本次保留原合规阵容，不代表最低成本');
  expect(message).toContain('参考报价在规划结束前过期');
});

it('distinguishes a time-bounded improved result from proof of lowest cost', () => {
  const message = formatFc27PuzzleNativeResult({ status: 'filled', saved: true, materialValue: 5800,
    procurementSummary: { status: 'suggested', diagnostics: { localReason: 'FC27_PUZZLE_OPTIMIZATION_TIME_LIMIT' } } });
  expect(message).toContain('进一步降价搜索已达到30秒');
  expect(message).toContain('尚未确认最低材料成本');
  expect(message).not.toContain('保留原合规阵容');
});

it.each(['cache', 'request'])('explains a %s 401 and the user-triggered recovery without claiming login expired', source => {
  const text = formatFc27PuzzleNativeResult({ reason: 'SAFE_MATERIAL_SHORTAGE', purchaseSuggestion: {
    status: 'blocked', reason: 'FC27_MARKET_HTTP_401', diagnostics: {
      failureSource: source, httpStatus: 401, eaCode: 1234, retryAfterSeconds: 30,
    },
  } });
  expect(text).toContain(source === 'cache' ? '历史失败记录' : '本次查询');
  expect(text).toContain('30 秒'); expect(text).toContain('再次点击'); expect(text).toContain('1234');
  expect(text).not.toContain('登录已过期');
});
