const validId = value => Number.isSafeInteger(value) && value > 0;

export function normalizeGalleryFirstOwnerHistory(rows, { max = 100000 } = {}) {
  if (!Array.isArray(rows) || rows.length > max) return [];
  const result = new Map();
  for (const row of rows) {
    const definitionId = Number(row?.definitionId);
    if (!validId(definitionId) || typeof row?.firstOwned !== 'boolean') continue;
    const updatedAt = Number.isSafeInteger(row.updatedAt) && row.updatedAt >= 0 ? row.updatedAt : 0;
    result.set(definitionId, { definitionId, firstOwned: row.firstOwned, updatedAt });
  }
  return [...result.values()].sort((a, b) => a.definitionId - b.definitionId);
}

export function applyGalleryFirstOwnerHistory(rows, history) {
  const overrides = new Map(normalizeGalleryFirstOwnerHistory(history).map(row => [row.definitionId, row]));
  return (Array.isArray(rows) ? rows : []).map(row => {
    const override = overrides.get(row?.definitionId);
    return override ? { ...row, firstOwned: override.firstOwned, firstOwnedSource: 'local-history' } : row;
  });
}

export function toggleGalleryFirstOwnerHistory(history, definitionId, firstOwned, updatedAt = Date.now()) {
  const current = normalizeGalleryFirstOwnerHistory(history);
  const id = Number(definitionId);
  if (!validId(id) || typeof firstOwned !== 'boolean' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return current;
  const next = current.filter(row => row.definitionId !== id);
  next.push({ definitionId: id, firstOwned, updatedAt });
  return normalizeGalleryFirstOwnerHistory(next);
}

export function removeGalleryFirstOwnerHistory(history, definitionId) {
  const id = Number(definitionId);
  return normalizeGalleryFirstOwnerHistory(history).filter(row => row.definitionId !== id);
}
