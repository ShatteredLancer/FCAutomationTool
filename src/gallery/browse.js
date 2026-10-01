const text = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

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
