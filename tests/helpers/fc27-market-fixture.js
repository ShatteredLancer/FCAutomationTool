export const marketRow = (key, value, count = -1, scope = 0) => ({ count, scope, pairs: [{ key, values: [value] }] });
export function marketFixture() {
  const now = 1790348400000;
  const context = { season: '27', accountScope: 'synthetic', platform: 'pc' };
  const player = id => ({ id, definitionId: 100 + id, type: 'player', pile: 'club', rating: 60,
    nationId: 1, teamId: id, leagueId: 1, positions: [5], rarity: 0, groups: [], special: false, evolution: false,
    cosmetic: false, concept: false, academyEnrolled: false, activeTrade: false, limitedUse: false,
    loans: -1, protected: false, tradeable: false, locked: false, activeSquad: false });
  const entries = [1, 2, 3, 4].map(id => ({ definitionId: 200 + id, rating: 60, nationId: 2,
    teamId: id + 10, leagueId: 2, positions: [5], rarity: 0, groups: [], marketable: true,
    special: false, evolution: false, cosmetic: false }));
  return { context, now, clubLinks: { schema: 1, complete: true, links: [] },
    challenge: { schema: 1, context, mechanism: 'traditional-puzzle', setId: 19, id: 43,
      completed: false, requirementsOperation: 'AND', slotCount: 3, brickIndices: [],
      rawRequirements: [marketRow(3, 1, -1, 2)] },
    // Synthetic procurement tests explicitly allow tradable materials. Live
    // inspection retains its approved untradeable-only policy.
    policy: { schema: 1, context, reviewed: true, maxRating: 74, goldRange: [75, 83], onlyUntradeable: false,
      protectFsuLockedPlayers: true, protectActiveSquad: true, storageFirst: true, excludedLeagueIds: [] },
    inventory: { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', items: [player(1), player(2)] },
    catalog: { schema: 1, season: '27', source: 'synthetic-test', revision: 'fixture-1',
      seasonEvidence: 'synthetic-fixture', observedAt: now, complete: false, entries },
    quotes: entries.map(entry => ({ season: '27', platform: 'pc', definitionId: entry.definitionId,
      price: 200, observedAt: now, source: 'synthetic-test' })),
    marketPolicy: { budget: 2000, maxPurchases: 3, maxUnitPrice: 1000, minimumRetainedCoins: 1000, availableCoins: 4000 },
  };
}
