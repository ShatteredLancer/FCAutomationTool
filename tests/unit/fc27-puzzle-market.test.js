import { expect, it } from 'vitest';
import { previewFc27PuzzleMarket } from '../../src/fc27/puzzle-market.js';
import { marketFixture, marketRow as row } from '../helpers/fc27-market-fixture.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

it('jointly plans owned and missing versions without creating fake owned item identities', () => {
  const input = marketFixture(); const before = structuredClone(input);
  const result = previewFc27PuzzleMarket(input);
  expect(result).toMatchObject({ status: 'preview', reason: 'FC27_MARKET_PLAN_PREVIEW', executable: false,
    selectedOwned: [{ id: 1 }, { id: 2 }], purchaseCount: 1, estimatedCost: 200,
    requiresPurchasedMaterialApproval: true, marketAvailabilityVerified: false });
  expect(result.purchases[0]).toMatchObject({ definitionId: 201, quantity: 1, estimatedUnitPrice: 200 });
  expect(result.purchases[0]).not.toHaveProperty('id');
  expect(result.selected).toEqual([]);
  expect(input).toEqual(before);
});

it('blocks purchased materials under untradeable-only without changing the policy', () => {
  const input = marketFixture(); input.policy.onlyUntradeable = true;
  const before = structuredClone(input);
  expect(previewFc27PuzzleMarket(input)).toMatchObject({ status: 'blocked',
    reason: 'FC27_MARKET_ONLY_UNTRADEABLE_POLICY', purchases: [], selected: [], executable: false });
  expect(input).toEqual(before);
  input.inventory.items.push({ ...input.inventory.items[0], id: 3, definitionId: 103 });
  expect(previewFc27PuzzleMarket(input)).toMatchObject({ status: 'preview', purchaseCount: 0, estimatedCost: 0 });
});

it('replans owned cards too: three cheap purchases beat retaining one owned card plus two expensive cards', () => {
  const input = marketFixture(); input.challenge.rawRequirements.push(row(4, 3));
  input.inventory.items = input.inventory.items.slice(0, 1);
  input.catalog.entries[0].nationId = 1; input.catalog.entries[1].nationId = 1;
  input.catalog.entries.push({ ...input.catalog.entries[2], definitionId: 205 });
  input.quotes = input.catalog.entries.map((entry, i) => ({ ...input.quotes[0], definitionId: entry.definitionId, price: i < 2 ? 800 : 200 }));
  const result = previewFc27PuzzleMarket(input);
  expect(result).toMatchObject({ status: 'preview', purchaseCount: 3, estimatedCost: 600, selectedOwned: [] });
});

it('does not sum overlapping deficits or filter every slot to a partially required nation', () => {
  const input = marketFixture(); input.challenge.rawRequirements.push(row(10, 2, 1), row(11, 2, 1));
  expect(previewFc27PuzzleMarket(input)).toMatchObject({ status: 'preview', purchaseCount: 1, estimatedCost: 200 });
});

it.each(['budget', 'maxPurchases', 'maxUnitPrice'])('respects the %s cap', key => {
  const input = marketFixture(); input.marketPolicy[key] = key === 'maxPurchases' ? 0 : 100;
  const result = previewFc27PuzzleMarket(input);
  expect(result.status).toBe('blocked'); expect(result.selected).toEqual([]); expect(result.purchases).toEqual([]);
});

it('keeps coin reserve and refuses unknown balance rather than assuming affordability', () => {
  const input = marketFixture(); input.marketPolicy.availableCoins = 1100;
  expect(previewFc27PuzzleMarket(input).status).toBe('blocked');
  input.marketPolicy.availableCoins = null;
  expect(previewFc27PuzzleMarket(input).reason).toBe('FC27_MARKET_POLICY_INVALID');
});

it.each(['locked', 'activeSquad', 'special', 'evolution', 'tradeable', 'protected'])('does not bypass owned %s protections by copying the same definition from catalog', key => {
  const input = marketFixture(); input.inventory.items[0][key] = true;
  input.catalog.entries = [{ ...input.catalog.entries[0], definitionId: 101 }];
  input.quotes = [{ ...input.quotes[0], definitionId: 101 }];
  expect(previewFc27PuzzleMarket(input).status).toBe('blocked');
});

it('distinguishes search exhaustion from candidate-pool failure and does not claim a market-wide proof', () => {
  expect(previewFc27PuzzleMarket({ ...marketFixture(), maxNodes: 1 }).reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  const input = marketFixture(); input.challenge.rawRequirements.push(row(10, 99, 1));
  const result = previewFc27PuzzleMarket(input);
  expect(result.reason).toBe('FC27_MARKET_POOL_NO_PLAN');
  expect(result.marketWideInfeasibilityProven).toBe(false);
});

it('returns a valid incumbent, not a failure, when cost optimization reaches its bound', () => {
  let limited;
  for (let maxNodes = 4; maxNodes < 30; maxNodes++) {
    const r = previewFc27PuzzleMarket({ ...marketFixture(), maxNodes });
    if (r.status === 'preview' && !r.optimization.searchComplete) { limited = r; break; }
  }
  expect(limited).toMatchObject({ status: 'preview', estimatedCost: 200 });
});

it('requires known facts, skips stale or wrong-platform quotes, and preserves existing inputs', () => {
  const input = marketFixture(); input.quotes.forEach(quote => { quote.observedAt -= 600001; });
  expect(previewFc27PuzzleMarket(input).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
  input.quotes.forEach(quote => { quote.observedAt = input.now; quote.platform = 'console'; });
  expect(previewFc27PuzzleMarket(input).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
});

it('finds and returns owned-only solutions without a catalog or quotes', () => {
  const input = marketFixture(); input.inventory.items.push({ ...input.inventory.items[0], id: 3, definitionId: 103 });
  delete input.catalog; delete input.quotes;
  expect(previewFc27PuzzleMarket(input)).toMatchObject({ status: 'preview', purchaseCount: 0, estimatedCost: 0 });
});

it('reserves joint-search nodes after an inconclusive owned search', () => {
  const input = marketFixture(); input.challenge.rawRequirements = [row(35, 3)];
  input.inventory.items.push({ ...input.inventory.items[0], id: 3, definitionId: 103 });
  input.challenge.formation = { positions: [5, 5, 5] };
  input.evaluateSquad = squad => ({ chemistry: squad.some(item => item?.catalogRef) ? 3 : 0 });
  const result = previewFc27PuzzleMarket({ ...input, maxNodes: 100 });
  expect(result).toMatchObject({ status: 'preview', estimatedCost: 200 });
  expect(result.nodes).toBeLessThanOrEqual(100);
});

it('preserves brick slots and dynamic group facts when assigning purchased versions', () => {
  const input = marketFixture(); input.challenge.slotCount = 4; input.challenge.brickIndices = [1];
  input.challenge.rawRequirements.push(row(25, 83, 1)); input.catalog.entries[0].groups = [83];
  const result = previewFc27PuzzleMarket(input);
  expect(result.status).toBe('preview');
  expect([...result.selectedOwned, ...result.purchases].map(item => item.slot).sort()).toEqual([0, 2, 3]);
  expect(result.purchases[0].definitionId).toBe(201);
  input.catalog.entries.forEach(item => { item.groups = null; });
  expect(previewFc27PuzzleMarket(input).reason).toBe('FC27_MARKET_CANDIDATE_FACTS_UNAVAILABLE');
});

it('matches exhaustive minimum additional-coins solutions across small corpora', () => {
  for (let seed = 0; seed < 60; seed++) {
    const input = marketFixture(); input.challenge.rawRequirements = [row(10, 1, 1, seed % 3), row(6, 2, -1, (seed + 1) % 3)];
    input.catalog.entries.forEach((item, i) => { item.nationId = (seed + i) % 3 + 1; item.teamId = (seed + i * 2) % 3 + 1; });
    input.quotes.forEach((q, i) => { q.price = 100 + (seed * (i + 1) % 8) * 50; });
    input.marketPolicy.maxPurchases = seed % 4;
    const all = [...input.inventory.items.map(item => ({ ...item, cost: 0 })),
      ...input.catalog.entries.map((item, i) => ({ ...item, cost: input.quotes[i].price }))];
    const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 3).rules;
    let best = Infinity;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 6; c++) {
      const squad = [a, b, c].map(i => all[i]); const cost = squad.reduce((sum, item) => sum + item.cost, 0);
      if (squad.filter(item => item.cost > 0).length <= input.marketPolicy.maxPurchases && cost <= input.marketPolicy.budget
          && matchFc27SbcRequirements({ requirements: rules, squad, clubLinks: input.clubLinks }).satisfied) best = Math.min(best, cost);
    }
    const result = previewFc27PuzzleMarket(input);
    expect(result.status === 'preview', `seed ${seed}`).toBe(Number.isFinite(best));
    if (Number.isFinite(best)) expect(result.estimatedCost, `seed ${seed}`).toBe(best);
  }
});
