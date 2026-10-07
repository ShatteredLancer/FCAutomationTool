import { summarizeGalleryScoreSteps } from './scoring.js';
import { runGalleryPlan } from './cooperative-plan.js';

const scoreFields = ['eaId', 'gradingScore', 'collected', 'overall', 'nationEaId', 'clubEaId',
  'leagueEaId', 'playerEaId', 'rarityEaId', 'firstOwned', 'holographic', 'positions', 'weakFoot', 'skillMoves'];
const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value?.[field] ?? null]));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

// Rendering never runs a lineup search. Cache by data rather than freshly
// projected object identity, and run only one cooperative search at a time.
export function createGalleryScoreQueue({ onUpdate = () => {}, now = () => performance.now(),
  cache = null,
  schedule = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const entries = new Map();
  let task = null, epoch = 0, disposed = false;
  const start = () => {
    if (task || disposed || ![...entries.values()].some(value => value.pending)) return;
    const generation = epoch;
    task = (async () => {
      const writes = new Map();
      // Allow the tab and collection counts to paint before any search work.
      await schedule();
      while (!disposed && generation === epoch) {
        const entry = [...entries.values()].filter(value => value.pending).sort((a, b) => b.priority - a.priority)[0];
        if (!entry) break;
        const current = () => !disposed && generation === epoch && entries.get(entry.id) === entry;
        let summary;
        try {
          try { summary = await cache?.read(entry.scope, entry.input.set.id, entry.key); }
          catch { summary = null; }
          if (!current()) break;
          if (summary?.lineup) {
            const rows = new Map(entry.input.progress.rows.map(row => [row.eaId, row]));
            if (summary.lineup.every(row => rows.has(row.eaId))) summary.lineup = summary.lineup.map(row => rows.get(row.eaId));
            else summary = null;
          }
          summary ??= await runGalleryPlan(summarizeGalleryScoreSteps(entry.input), {
          current, now, schedule, sliceMs: 8, maxMs: Infinity }); }
        catch { summary = {status:'unavailable',reason:'input-invalid'}; }
        if (!current() || !summary) break;
        entry.summary = summary; entry.pending = false;
        if (cache) {
          if (!writes.has(entry.scope)) writes.set(entry.scope, []);
          writes.get(entry.scope).push({ id: entry.input.set.id, key: entry.key, summary });
        }
        try { onUpdate(entry.input.set.id); } catch { /* Presentation cannot stop the queue. */ }
        await schedule();
      }
      for (const [scope, rows] of writes) {
        try { await cache.write(scope, rows); } catch { /* Cache failure never blocks presentation. */ }
      }
    })().finally(() => { task = null; if ([...entries.values()].some(value => value.pending)) start(); });
  };
  // Only fields consumed by the scoring engine participate in the cache key.
  // EA snapshots also contain volatile transport/entity metadata; including
  // that metadata made an unchanged score look new on every refresh.
  const scoringKey = input => {
    const rows = (input.progress?.rows ?? []).map(row => pick(row, scoreFields));
    return { season: input.progress?.season, setId: input.progress?.setId,
      complete: input.progress?.complete, rows };
  };
  const cancel = () => {
    epoch++;
    for (const [key, entry] of entries) if (entry.pending) entries.delete(key);
  };
  return Object.freeze({
    // Presentation-only lookup: no hashing, scheduling, cache I/O or requests.
    peek: (scope, setId) => entries.get(`${scope}:${setId}`)?.summary ?? null,
    read(scope, input, { priority = 1 } = {}) {
      if (disposed) return null;
      const id = `${scope}:${input.set.id}`;
      const catalog = input.catalog;
      const tags = (catalog.tags ?? []).map(tag => pick(tag, catalog.source === 'fodder'
        ? ['id', 'match', 'steps'] : ['id', 'rules', 'tiers', 'bonusType', 'thresholdType']));
      const key = JSON.stringify(stable([pick(input.set, ['id', 'requiredCards']),
        input.set?.grades?.map(grade => pick(grade, ['name', 'threshold'])), catalog.source, tags,
        catalog.source === 'fodder' ? pick(catalog.engine, ['version', 'goldFrom', 'silverFrom', 'bonusMinusOne']) : null,
        scoringKey(input)]));
      let entry = entries.get(id);
      if (entry?.key !== key) {
        entry = { id, key, scope, input, priority, pending: true, summary: {status:'calculating'} }; entries.set(id, entry);
        while (entries.size > 256) entries.delete(entries.keys().next().value);
      }
      entry.priority = Math.max(entry.priority, priority);
      start(); return entry.summary;
    },
    idle: async () => { while (task) await task; },
    cancel,
    dispose: () => { disposed = true; cancel(); entries.clear(); },
  });
}
