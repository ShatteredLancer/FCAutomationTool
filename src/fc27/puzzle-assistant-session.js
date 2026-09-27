import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { previewFc27PuzzleSquad } from './puzzle-preview.js';
import { createFc27ClubResolver, parseFc27SbcRequirements } from './sbc-requirements.js';

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const blocked = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false });
const numberOrNull = value => Number.isFinite(value) ? value : null;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function summarizePlan(plan) {
  return { status: plan.status, reason: plan.reason, selectedCount: plan.selected?.length ?? 0,
    nodes: plan.nodes ?? 0, safeCandidates: plan.safeCandidates ?? null,
    chemistry: numberOrNull(plan.teamFacts?.chemistry), teamRating: numberOrNull(plan.teamFacts?.teamRating) };
}

// Only numeric aggregates leave this closure. No arbitrary nested fields, card
// IDs, account scope, EA entities, names, policy secrets or model text is echoed.
export function createFc27PuzzleAssistantSession(input, { nodesPerAttempt = 50000, totalNodes = 150000 } = {}) {
  if (!integer(nodesPerAttempt, 1, 50000) || !integer(totalNodes, nodesPerAttempt, 200000)
      || input?.challenge?.mechanism !== 'traditional-puzzle') return blocked('FC27_LLM_INPUT_INVALID');
  const { evaluateSquad, boundSquad, groupMatcher, ...data } = input;
  const snapshot = freeze(structuredClone(data));
  const required = snapshot.challenge.slotCount - (snapshot.challenge.brickIndices?.length ?? NaN);
  const pool = collectSafeTraditionalCandidates({ ...snapshot, challenge: { ...snapshot.challenge, mechanism: 'traditional',
    requirements: [{ kind: 'player-count', count: required }] } });
  if (pool.status !== 'candidates') return pool;
  const parsed = parseFc27SbcRequirements(snapshot.challenge.rawRequirements, required);
  if (parsed.status !== 'observed') return blocked(parsed.reason);
  const resolveClub = createFc27ClubResolver(snapshot.clubLinks);
  const groups = {};
  const readers = { nation: item => item.nationId, league: item => item.leagueId,
    club: item => resolveClub?.(item.teamId ?? item.clubId) };
  for (const [name, read] of Object.entries(readers)) {
    const counts = new Map();
    for (const item of pool.candidates) {
      const id = read(item);
      if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) continue;
      if (!counts.has(id)) counts.set(id, new Set());
      counts.get(id).add(item.definitionId);
    }
    const entries = [...counts].map(([id, values]) => ({ id, count: values.size })).sort((a, b) => b.count - a.count || a.id - b.id);
    groups[name] = { entries: entries.slice(0, 32), truncated: entries.length > 32 };
  }
  const rules = parsed.rules.map(rule => {
    const result = { kind: rule.kind };
    for (const key of ['value', 'count', 'quality', 'minRating', 'maxRating', 'groupId']) {
      if (Number.isSafeInteger(rule[key])) result[key] = rule[key];
    }
    if (['min', 'max', 'exact'].includes(rule.mode)) result.mode = rule.mode;
    for (const key of ['ids', 'qualities']) if (Array.isArray(rule[key])) result[key] = rule[key].filter(Number.isSafeInteger).slice(0, 32);
    return result;
  });
  const ratings = {};
  pool.candidates.forEach(item => { ratings[item.rating] = (ratings[item.rating] ?? 0) + 1; });
  const attempts = []; let remaining = totalNodes; let best = null;
  const run = (hint = { strategy: 'balanced', groupId: 0 }) => {
    if (attempts.length >= 5 || remaining <= 0) return blocked('FC27_PUZZLE_TOTAL_BUDGET');
    if (!hint || Object.keys(hint).sort().join(',') !== 'groupId,strategy'
        || !['balanced', 'low-rating', 'nation', 'league', 'club'].includes(hint.strategy)
        || (['balanced', 'low-rating'].includes(hint.strategy) ? hint.groupId !== 0
          : !groups[hint.strategy].entries.some(entry => entry.id === hint.groupId))) return blocked('FC27_PUZZLE_STRATEGY_INVALID');
    if (attempts.some(attempt => attempt.strategy === hint.strategy && attempt.groupId === hint.groupId)) return blocked('FC27_LLM_NO_PROGRESS');
    const plan = previewFc27PuzzleSquad({ ...snapshot, evaluateSquad, boundSquad, groupMatcher,
      searchHint: hint, maxNodes: Math.min(nodesPerAttempt, remaining) });
    remaining -= plan.nodes ?? 0;
    if (!best || best.status !== 'preview') best = plan;
    const summary = summarizePlan(plan);
    attempts.push({ strategy: hint.strategy, groupId: hint.groupId, ...summary });
    return structuredClone(summary);
  };
  const session = { status: 'ready', run,
    observe: () => structuredClone({ schema: 1, season: '27', rules, required,
      groups, ratings, safeCandidates: pool.candidates.length,
      inventory: { status: snapshot.inventory.status, complete: snapshot.inventory.complete === true,
        scope: snapshot.inventory.scope === 'club-only' ? 'club-only' : 'selected-piles' },
      remainingNodes: remaining, attempts, currentPlan: best ? summarizePlan(best) : null }),
    result: () => structuredClone(best),
  };
  // AI is an optional second attempt, never a prerequisite for the baseline.
  run();
  return Object.freeze(session);
}
