import { traditionalJournalScope } from './traditional-journal.js';
import { marketCandidates, puzzleOwnedValueCandidates, suggestFc27PuzzleJointPurchasesCooperatively } from './puzzle-procurement.js';
import { allowedFc27MarketTiers } from './market-query-route.js';
import { parseFc27SbcRequirements } from './sbc-requirements.js';
import { yieldStreamlinedTask } from '../streamlined/scheduling.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const positive = n => Number.isSafeInteger(n) && n > 0;
export const yieldPuzzleHintTask = () => yieldStreamlinedTask(typeof globalThis.MessageChannel === 'function'
  ? { MessageChannel: globalThis.MessageChannel } : globalThis);
const queryValid = query => query && ['bronze', 'silver', 'gold'].includes(query.level)
  && Number.isSafeInteger(query.start) && query.start >= 0 && query.start <= 1000 && query.count === 20
  && Object.keys(query).every(key => ['start', 'count', 'level', 'team', 'nation', 'league'].includes(key))
  && ['team', 'nation', 'league'].every(key => query[key] === undefined || positive(query[key]));

// Same-account native history is a map of places to look, not current facts.
// Return at most two query shapes, NEVER cards, quotes, plans or approvals.
export async function readFc27PuzzleCatalogHints({ input, list, get, readPrices, prices, materialPrices,
  usedQueries, costCeiling, now, assertCurrent = () => {} }) {
  const none = { queries: [], nodes: 0, pairs: 0 };
  const required = input.challenge.slotCount - input.challenge.brickIndices.length;
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required);
  if (parsed.status !== 'observed') return none;
  const tiers = allowedFc27MarketTiers(parsed.rules, input.policy);
  const prefix = `fcat-fc27-puzzle-market:${traditionalJournalScope(input.context)}:catalog:`;
  assertCurrent(); const keys = await list(); assertCurrent();
  if (!Array.isArray(keys) || keys.length > 50000) return none;
  const rows = [];
  for (const key of keys.filter(key => typeof key === 'string' && key.startsWith(prefix)).sort().slice(0, 64)) {
    const row = await get(key, null); assertCurrent();
    if (row?.schema !== 1 || row.kind !== 'catalog' || row.state !== 'observed' || !queryValid(row.query)
        || key !== `${prefix}${JSON.stringify(row.query)}` || !positive(row.at) || row.at > now()
        || row.result?.status !== 'observed' || row.result.source !== 'ea-defid' || row.result.season !== '27'
        || !same(row.query, row.result.query) || !positive(row.result.observedAt) || row.result.observedAt > now()
        || now() - Math.min(row.at, row.result.observedAt) > 30 * 86400000
        || !Array.isArray(row.result.entries) || row.result.entries.length > 20) continue;
    const entries = marketCandidates(input, row.result.entries).filter(card => tiers.some(tier => card.rating >= tier.min && card.rating <= tier.max));
    if (entries.length) rows.push({ query: row.query, entries });
  }
  const ids = [...new Set(rows.flatMap(row => row.entries.map(card => card.definitionId)))];
  if (!ids.length) return none;
  const cached = await readPrices(ids); assertCurrent();
  if (cached?.hintOnly !== true || !(cached.prices instanceof Map)) return none;
  const estimates = new Map([...cached.prices, ...prices, ...materialPrices]);
  const valued = card => {
    const price = estimates.get(card.definitionId);
    return Number.isSafeInteger(price) && price >= 150 && price <= 15000000;
  };
  const owned = puzzleOwnedValueCandidates(input).filter(valued);
  const slots = input.challenge.formation.positions.filter((_position, slot) => !input.challenge.brickIndices.includes(slot));
  const pairs = []; let examined = 0;
  for (let a = 0; a < rows.length; a++) for (let b = a; b < rows.length; b++) {
    if (++examined % 32 === 0) { assertCurrent(); await yieldPuzzleHintTask(); assertCurrent(); }
    const queries = a === b ? [rows[a].query] : [rows[a].query, rows[b].query];
    if (queries.every(query => usedQueries.some(used => same(used, query)))) continue;
    const unique = new Map(); let changed = false;
    for (const card of [...rows[a].entries, ...rows[b].entries].filter(valued)) {
      const old = unique.get(card.definitionId);
      if (old && !same(old, card)) { changed = true; break; }
      unique.set(card.definitionId, card);
    }
    if (changed) continue;
    const entries = [...unique.values()], pool = [...owned, ...entries];
    if (pool.length < required || parsed.rules.some(rule => rule.kind === 'quality-count' && rule.mode !== 'max'
      && pool.filter(card => rule.qualities.includes(card.rating < 65 ? 1 : card.rating < 75 ? 2 : 3)).length < rule.count)) continue;
    const floor = slots.reduce((sum, position) => sum + Math.min(Infinity,
      ...pool.filter(card => card.positions.includes(position)).map(card => estimates.get(card.definitionId))), 0);
    if (floor < costCeiling) pairs.push({ queries, entries, floor });
  }
  let nodes = 0, best = null;
  for (const pair of pairs.sort((a, b) => a.floor - b.floor || JSON.stringify(a.queries).localeCompare(JSON.stringify(b.queries))).slice(0, 12)) {
    assertCurrent();
    const result = await suggestFc27PuzzleJointPurchasesCooperatively(input, pair.entries, {
      prices: estimates, materialPrices: estimates, costCeiling: best?.cost ?? costCeiling,
      maxNodes: 2000, assertCurrent, yieldControl: yieldPuzzleHintTask,
    });
    nodes += result.nodes ?? 0;
    const plan = result.plans?.[0];
    if (result.status === 'suggested' && Number.isSafeInteger(plan?.materialValue)
        && plan.materialValue < (best?.cost ?? costCeiling)) best = { queries: pair.queries, cost: plan.materialValue };
  }
  assertCurrent();
  return { queries: best?.queries ?? [], nodes, pairs: Math.min(12, pairs.length) };
}
