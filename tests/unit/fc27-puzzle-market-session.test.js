import { expect, it } from 'vitest';
import { createFc27PuzzleMarketSession } from '../../src/fc27/puzzle-market-session.js';
import { marketFixture } from '../helpers/fc27-market-fixture.js';

it('keeps exact item references inside the session and exposes only aggregate market facts', () => {
  const input = marketFixture();
  const session = createFc27PuzzleMarketSession(input, { nodesPerAttempt: 100, totalNodes: 300 });
  const observation = session.observe();
  expect(observation).toMatchObject({ schema: 1, season: '27', mode: 'market', required: 3,
    safeCandidates: 2, market: { eligible: 4, priced: 4, poolSize: 4, budget: 2000, maxPurchases: 3 } });
  expect(JSON.stringify(observation)).not.toContain('item-');
  expect(JSON.stringify(observation)).not.toContain('definitionId":101');
  expect(session.result().purchases[0]).not.toHaveProperty('id');
  expect(Object.isFrozen(session)).toBe(true);
});

it('bounds strategy attempts and stops advertising improvement after five routes', () => {
  const input = marketFixture();
  input.clubLinks = { schema: 1, complete: true, links: [[11, 101], [12, 102], [13, 103], [14, 104]] };
  input.catalog.entries = input.catalog.entries.map((entry, index) => ({ ...entry,
    nationId: index + 2, leagueId: index + 10, teamId: index + 11 }));
  input.inventory.items = input.inventory.items.map((item, index) => ({ ...item,
    nationId: index + 2, leagueId: index + 10, teamId: index + 11 }));
  const session = createFc27PuzzleMarketSession(input, { nodesPerAttempt: 100, totalNodes: 500 });
  const groups = session.observe().groups;
  const hints = [
    { strategy: 'low-rating', groupId: 0 },
    { strategy: 'nation', groupId: groups.nation.entries[0].id },
    { strategy: 'league', groupId: groups.league.entries[0].id },
    { strategy: 'club', groupId: groups.club.entries[0].id },
  ];
  for (const hint of hints) session.run(hint);
  const before = session.observe();
  expect(before.attempts.length).toBe(5);
  expect(before.market.canImprove).toBe(false);
  expect(session.run({ strategy: 'balanced', groupId: 0 }).reason).toBe('FC27_PUZZLE_TOTAL_BUDGET');
});

it('snapshots inputs and returns detached observations and plans', () => {
  const input = marketFixture(); const session = createFc27PuzzleMarketSession(input);
  const before = session.result();
  input.inventory.items.length = 0; input.quotes[0].price = 900; input.policy.maxRating = 1;
  const observation = session.observe(); observation.groups.nation.entries.length = 0;
  const plan = session.result(); plan.purchases.length = 0; plan.selectedOwned[0].id = 999999;
  expect(session.run({ strategy: 'low-rating', groupId: 0 }).estimatedCost).toBe(200);
  expect(session.result()).toEqual(before);
  expect(session.observe().groups.nation.entries.length).toBeGreaterThan(0);
});

it('rejects duplicate and unknown routes without consuming another attempt', () => {
  const session = createFc27PuzzleMarketSession(marketFixture()); const before = session.observe();
  expect(session.run({ strategy: 'balanced', groupId: 0 }).reason).toBe('FC27_LLM_NO_PROGRESS');
  for (const hint of [null, { strategy: 'buy', groupId: 0 }, { strategy: 'nation', groupId: 999 },
    { strategy: 'balanced', groupId: 0, relax: true }]) {
    expect(session.run(hint).reason).toBe('FC27_PUZZLE_STRATEGY_INVALID');
  }
  expect(session.observe()).toEqual(before);
});

it('can use a market-only group without requiring it to exist in the owned baseline', () => {
  const session = createFc27PuzzleMarketSession(marketFixture());
  expect(session.observe().groups.nation.entries.find(entry => entry.id === 2)).toMatchObject({ ownedCount: 0, marketCount: 4 });
  const result = session.run({ strategy: 'nation', groupId: 2 });
  expect(result).toMatchObject({ status: 'preview', reason: 'FC27_MARKET_PLAN_PREVIEW', purchaseCount: 1 });
  expect(session.result().estimatedCost).toBe(200);
});

it('enforces a shared node budget and retains the incumbent when a later search is limited', () => {
  const session = createFc27PuzzleMarketSession(marketFixture(), { nodesPerAttempt: 13, totalNodes: 14 });
  const best = session.result(); expect(best.status).toBe('preview');
  expect(session.run({ strategy: 'low-rating', groupId: 0 }).reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(session.result()).toEqual(best);
  expect(session.observe()).toMatchObject({ remainingNodes: 0, market: { canImprove: false } });
  expect(session.run({ strategy: 'nation', groupId: 1 }).reason).toBe('FC27_PUZZLE_TOTAL_BUDGET');
});

it('bounds group summaries and skips improvement for zero-cost plans', () => {
  const input = marketFixture();
  input.catalog.entries = Array.from({ length: 100 }, (_, i) => ({ ...input.catalog.entries[0], definitionId: 2000 + i, nationId: i + 1 }));
  input.quotes = input.catalog.entries.map(item => ({ ...input.quotes[0], definitionId: item.definitionId }));
  input.inventory.items.push({ ...input.inventory.items[0], id: 3, definitionId: 103 });
  const session = createFc27PuzzleMarketSession(input);
  expect(session.observe().groups.nation).toMatchObject({ truncated: true });
  expect(session.observe().groups.nation.entries).toHaveLength(32);
  expect(session.observe().market.canImprove).toBe(false);
  expect(session.result().estimatedCost).toBe(0);
});
