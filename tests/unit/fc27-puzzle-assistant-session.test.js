import { expect, it } from 'vitest';
import { createFc27PuzzleAssistantSession } from '../../src/fc27/puzzle-assistant-session.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { runFc27LlmAssistant } from '../../src/fc27/llm-assistant.js';

function fixture() {
  const context = { season: '27', accountScope: 'private-account', platform: 'pc' };
  const player = id => ({ id: 50000 + id, definitionId: 60000 + id, type: 'player', pile: 'club', rating: 60,
    nationId: id < 5 ? 1 : 2, teamId: id, leagueId: 1, rarity: 0, special: false, evolution: false,
    cosmetic: false, concept: false, academyEnrolled: false, activeTrade: false,
    limitedUse: false, loans: -1, protected: false, tradeable: false, locked: false, activeSquad: false });
  return { context, clubLinks: { schema: 1, complete: true, links: [] },
    challenge: { schema: 1, context, mechanism: 'traditional-puzzle', setId: 19, id: 43, completed: false,
      requirementsOperation: 'AND', slotCount: 3, brickIndices: [],
      rawRequirements: [{ count: -1, scope: 0, pairs: [{ key: 35, values: [3] }] }] },
    policy: { schema: 1, context, reviewed: true, maxRating: 74, goldRange: [75, 83], onlyUntradeable: true,
      protectFsuLockedPlayers: true, protectActiveSquad: true, storageFirst: true, excludedLeagueIds: [] },
    inventory: { schema: 1, context, kind: 'normalized-inventory', status: 'provisional', scope: 'club-only', items: [1, 2, 3, 4, 5, 6, 7].map(player) },
    evaluateSquad: squad => ({ chemistry: squad.every(item => item.nationId === 2) ? 3 : 0 }),
  };
}

it('finds a plan using a model-selected group after a bounded local search fails', async () => {
  const input = fixture(); const local = createFc27PuzzleAssistantSession(input, { nodesPerAttempt: 12, totalNodes: 36 });
  expect(local.result().reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  const config = { enabled: true, protocol: 'chat-completions', endpoint: 'https://relay.example/chat', model: 'test' };
  const result = await runFc27LlmAssistant({ config, credential: { endpoint: config.endpoint, apiKey: 'synthetic' }, approved: true, session: local,
    transport: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'run_puzzle_planner',
      strategy: 'nation', groupId: 2, summary: 'Try the connected group.' }) } }] }) });
  expect(result.reason).toBe('FC27_LLM_LOCAL_PLAN_FOUND');
  expect(local.result()).toMatchObject({ status: 'preview', validation: { satisfied: true }, liveExecutionEnabled: false });
  expect(local.result().selected.map(item => item.id).sort()).toEqual([50005, 50006, 50007]);
});

it('exports no account or card identity and freezes the planning snapshot', () => {
  const input = fixture(); const local = createFc27PuzzleAssistantSession(input, { nodesPerAttempt: 12, totalNodes: 36 });
  const before = local.observe(); input.inventory.items[6].nationId = 99;
  const output = JSON.stringify(local.observe());
  for (const value of ['private-account', '50001', '60001', 'definitionId', '"selected":']) expect(output).not.toContain(value);
  expect(local.observe()).toEqual(before);
  const copy = local.observe(); copy.groups.nation.entries.length = 0;
  expect(local.observe()).toEqual(before);
});

it.each(['locked', 'activeSquad', 'evolution', 'special', 'protected', 'tradeable'])('never reintroduces %s candidates using hints', guard => {
  const input = fixture(); input.inventory.items[6][guard] = true;
  const local = createFc27PuzzleAssistantSession(input, { nodesPerAttempt: 12, totalNodes: 36 });
  expect(local.status).toBe('ready'); local.run({ strategy: 'nation', groupId: 2 });
  expect(local.result().status).toBe('blocked'); expect(local.observe().safeCandidates).toBe(6);
});

it('keeps defaults identical, refuses invented groups/extra args and enforces shared budget', () => {
  const input = fixture();
  expect(previewFc27PuzzleSquad({ ...input, maxNodes: 12 })).toEqual(previewFc27PuzzleSquad({ ...input, maxNodes: 12, searchHint: { strategy: 'balanced', groupId: 0 } }));
  const local = createFc27PuzzleAssistantSession(input, { nodesPerAttempt: 12, totalNodes: 24 });
  expect(local.run({ strategy: 'nation', groupId: 123 }).reason).toBe('FC27_PUZZLE_STRATEGY_INVALID');
  expect(local.run({ strategy: 'nation', groupId: 2, maxRating: 99 }).reason).toBe('FC27_PUZZLE_STRATEGY_INVALID');
  expect(local.run({ strategy: 'balanced', groupId: 0 }).reason).toBe('FC27_LLM_NO_PROGRESS');
  local.run({ strategy: 'low-rating', groupId: 0 });
  expect(local.run({ strategy: 'nation', groupId: 2 }).reason).toBe('FC27_PUZZLE_TOTAL_BUDGET');
  expect(local.observe().attempts.reduce((sum, item) => sum + item.nodes, 0)).toBe(24);
});

it('preserves Storage priority even when an AI hint prefers another group', () => {
  const input = fixture(); input.inventory.items[0].pile = 'storage';
  input.challenge.rawRequirements = [{ count: -1, scope: 0, pairs: [{ key: 3, values: [1] }] }];
  const result = previewFc27PuzzleSquad({ ...input, searchHint: { strategy: 'nation', groupId: 2 } });
  expect(result.status).toBe('preview'); expect(result.selected[0].pile).toBe('storage');
});

it('keeps an advertised route usable when native quality rules remove every member', () => {
  const input = fixture();
  input.challenge.rawRequirements = [{ count: -1, scope: 2, pairs: [{ key: 3, values: [1] }] }];
  input.inventory.items.forEach(item => { if (item.nationId === 1) item.rating = 70; });
  const session = createFc27PuzzleAssistantSession(input);
  expect(session.observe().groups.nation.entries.some(entry => entry.id === 1)).toBe(true);
  expect(session.run({ strategy: 'nation', groupId: 1 })).toMatchObject({ status: 'preview', selectedCount: 3 });
  expect(session.result().selected.every(item => item.rating === 60)).toBe(true);
  const best = session.result();
  expect(session.run({ strategy: 'nation', groupId: 999 }).reason).toBe('FC27_PUZZLE_STRATEGY_INVALID');
  expect(session.result()).toEqual(best);
});
