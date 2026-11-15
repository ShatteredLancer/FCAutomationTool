const text = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

// Enhancer 27.0.1.8 home order, confirmed by the category screenshot. Its
// categories endpoint differs from FUT.GG (which puts Rarities first).
// Keep this presentation-only: source snapshots, set order and plans stay intact.
const categoryOrder = new Map(['premier-league', 'laliga', 'bundesliga', 'ligue-1', 'serie-a',
  'leagues', 'rarities', 'roshn-saudi-league', 'mls', 'national-women-s-soccer-league']
  .map((slug, index) => [slug, index]));

export function orderGalleryCategories(categories) {
  return categories.slice().sort((a, b) => (categoryOrder.get(a.slug) ?? categoryOrder.size)
    - (categoryOrder.get(b.slug) ?? categoryOrder.size));
}

// Search and sorting use only the already displayed catalogue and summaries.
// Unsynced collections remain unknown and are sorted after known progress.
export function browseGallerySets(catalog, { categoryId = null, query = '', order = 'catalog',
  followedOnly = false, targets = [], summaries = new Map() } = {}) {
  const needle = text(query), followed = new Set(targets.map(row => row.setId));
  const rows = (catalog?.categories ?? []).filter(category => !categoryId || category.id === categoryId)
    .flatMap(category => category.sets.map(set => ({ category, set })) )
    .filter(({ category, set }) => (!followedOnly || followed.has(set.id))
      && (!needle || text(`${category.name} ${set.name} ${set.description ?? ''}`).includes(needle)));
  const name = (a, b) => a.set.name.localeCompare(b.set.name) || a.set.id.localeCompare(b.set.id);
  if (order === 'name') rows.sort(name);
  if (order === 'cards') rows.sort((a, b) => a.set.requiredCards - b.set.requiredCards || name(a, b));
  if (order === 'progress') {
    const progress = row => {
      const summary = summaries.get(row.set.id);
      return Number.isSafeInteger(summary?.collected) && summary.collected >= 0
        ? summary.collected / row.set.requiredCards : null;
    };
    rows.sort((a, b) => {
      const x = progress(a), y = progress(b);
      return x === null && y !== null ? 1 : y === null && x !== null ? -1 : (y ?? 0) - (x ?? 0) || name(a, b);
    });
  }
  return rows;
}
