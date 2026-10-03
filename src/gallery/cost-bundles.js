const priced = candidates => candidates.filter(row => Number.isSafeInteger(row.price) && row.price > 0)
  .slice().sort((a, b) => a.price - b.price || (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);

// Enumerate a fixed-size priced pool in nondecreasing total cost. Index vectors
// uniquely identify combinations; expanding only increasing indices avoids
// permutations. Callers bound iteration and independently verify every score.
export function* galleryCostBundles(candidates, size, limit) {
  const rows = priced(candidates);
  if (size < 1 || size > rows.length || limit < 1) return;
  const heap = [], seen = new Set(); let sequence = 0;
  const before = (a, b) => a.cost < b.cost || a.cost === b.cost && a.sequence < b.sequence;
  const push = indices => {
    const key = indices.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const node = { indices, cost: indices.reduce((sum, i) => sum + rows[i].price, 0), sequence: sequence++ };
    let i = heap.length; heap.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(node, heap[parent])) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = node;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
        if (!before(heap[child], last)) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  push(Array.from({ length: size }, (_, i) => i));
  for (let count = 0; count < limit && heap.length; count++) {
    const node = pop();
    yield node.indices.map(i => rows[i].id);
    for (let slot = size - 1; slot >= 0; slot--) {
      const indices = node.indices.slice();
      if (indices[slot] + 1 >= (indices[slot + 1] ?? rows.length)) continue;
      indices[slot]++; push(indices);
    }
  }
}

// Jump straight to a complete cheap bundle containing a rule group. This
// reaches multi-card tiers even when every intermediate swap loses points.
export function* galleryBonusBundles(candidates, size, limit) {
  const rows = priced(candidates), groups = new Map(), seen = new Set();
  // Price bands also seed several affordable score upgrades together, before
  // thousands of equal-price low-score combinations consume the search budget.
  for (const price of new Set(rows.map(row => row.price))) {
    groups.set(`price:${price}`, rows.filter(row => row.price <= price)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.price - b.price || a.id - b.id));
  }
  for (const row of rows) for (const key of row.diversityKeys ?? []) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let count = 0;
  if (size < 1 || size > rows.length) return;
  for (const group of groups.values()) for (let required = 1; required <= Math.min(size, group.length); required++) {
    if (count >= limit) return;
    const ids = new Set(group.slice(0, required).map(row => row.id));
    for (const row of rows) { if (ids.size >= size) break; ids.add(row.id); }
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key); count++;
    yield [...ids];
  }
}
