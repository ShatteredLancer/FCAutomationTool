// Reduced public DTO shapes, synthetic catalogue values; no EA account state.
export function futggGallery() {
  return { data: { game: 'fc27', schemaVersion: 1, capturedAt: '2026-09-27T10:49:25Z',
    categories: [{ id: 1, slug: 'league', name: 'League', sets: [
      { id: 30, categoryId: 1, name: 'Example Club', slug: 'example-club', requiredCards: 20,
        description: 'Collect Player Items.', grades: ['D', 'C', 'B', 'A', 'S'].map((name, index) => ({
          name, threshold: [10, 110000, 700000, 1300000, 2500000][index],
          rewards: [{ type: index === 0 ? 'badge' : 'event_token_1', count: 1, value: index === 0 ? 1 : index * 10,
            label: index === 0 ? 'Club Badge' : `${index * 10} Gallery Tokens` }],
        })) },
    ] }], tags: [{ id: 1, name: 'Example bonus', rules: [{ newOperator: true }], tiers: [] }] } };
}
export function fodderGallery() {
  const original = futggGallery().data;
  return { engine: { version: 1 }, categories: original.categories.map(category => ({ name: category.name, slug: category.slug,
    sets: category.sets.map(set => ({ name: set.name, slug: set.slug, required: set.requiredCards,
      clubs: [1], leagues: [], rareflags: [], holo: false,
      grades: set.grades.map((grade, index) => ({ grade: grade.name, score: grade.threshold, tokens: index * 10 })), reach: { price: 100 },
    })),
  })), tags: [{ id: 1, name: 'Example bonus', steps: [], match: { unknown: true } }] };
}

export function futggGalleryPool(setId = 30) {
  return { data: { schemaVersion: 1, game: 'fc27', setId, requiredCards: 2, poolSize: 3, isTruncated: false,
    generatedAt: '2026-09-29T10:00:00Z', items: [1, 2, 3].map(index => ({
      eaId: 900000 + index, playerEaId: 800000 + index, score: index * 100, overall: 80 + index,
      clubEaId: 100 + index, leagueEaId: 200, nationEaId: 300, rarityEaId: 400 + index,
      positions: ['ST'], cardName: `Player ${index}`, rarityName: 'Gallery', holographic: false,
      cardImageUrl: `https://game-assets.fut.gg/fc27/player-${index}.webp`,
      simpleCardImageUrl: `https://game-assets.fut.gg/fc27/player-${index}-simple.webp`,
    })) } };
}
