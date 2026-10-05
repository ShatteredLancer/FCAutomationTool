import { expect, it } from 'vitest';
import { formatFc27PuzzleNativeResult, formatFc27PuzzleProgress } from '../../src/adapters/browser/fc27-puzzle-native-button.js';

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
  expect(text).toContain('不代表整个市场无解');
  expect(text).not.toContain('无法在选材限制内组成阵容');
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
