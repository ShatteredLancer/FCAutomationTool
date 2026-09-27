import { expect, it, vi } from 'vitest';
import { FC27_LLM_PROTOCOL, buildFc27LlmRequest, normalizeFc27LlmConfig, parseFc27LlmAction,
  parseFc27LlmResponse, projectFc27LlmObservation, runFc27LlmAssistant } from '../../src/fc27/llm-assistant.js';

const config = (protocol = 'chat-completions') => ({ enabled: true, protocol,
  endpoint: protocol === 'gemini' ? 'https://relay.example/v1beta/models/{model}:generateContent' : `https://relay.example/v1/${protocol}`,
  model: 'vendor/model-name', maxRequests: 2, timeoutMs: 1000 });
const credential = current => ({ endpoint: current.endpoint, apiKey: 'synthetic-secret' });
const action = (extra = {}) => ({ action: 'finish', strategy: 'balanced', groupId: 0, summary: 'OK', ...extra });
const chat = value => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const observation = () => ({ schema: 1, season: '27', required: 11, rules: [{ kind: 'min-chemistry', value: 14 }],
  groups: { nation: { entries: [{ id: 1, count: 5 }] } }, ratings: { 70: 12 }, safeCandidates: 12,
  currentPlan: { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: 100 }, attempts: [] });
const session = () => ({ observe: vi.fn(observation), run: vi.fn(() => ({ status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT' })) });

it.each(Object.values(FC27_LLM_PROTOCOL))('builds a custom %s endpoint/model without brand locks', protocol => {
  const current = config(protocol); const result = buildFc27LlmRequest(current, credential(current), observation());
  expect(result.status).toBe('ready'); expect(result.request.url).toContain('relay.example');
  expect(result.request.body).not.toHaveProperty('tools'); expect(result.request.body).not.toHaveProperty('temperature');
  if (protocol === 'gemini') {
    expect(result.request.url).toContain('vendor%2Fmodel-name:generateContent');
    expect(result.request.headers['x-goog-api-key']).toBe('synthetic-secret');
    expect(result.request.body.generationConfig.responseMimeType).toBe('application/json');
  } else {
    expect(result.request.body.model).toBe(current.model); expect(result.request.headers.Authorization).toBe('Bearer synthetic-secret');
    if (protocol === 'responses') expect(result.request.body).toMatchObject({ store: false, max_output_tokens: 2048 });
    else expect(result.request.body).toMatchObject({ stream: false, max_tokens: 2048, response_format: { type: 'json_object' } });
  }
});

it.each(['javascript:bad', 'http://relay.example/v1/chat', 'https://user:pass@relay.example/a',
  'https://relay.example/a?key=secret', 'https://relay.example/a#fragment', 'https://relay.example',
  'https://relay.example/{model}', 'https://relay.example/\napi'])('rejects unsafe or ambiguous endpoint %s', endpoint => {
  expect(normalizeFc27LlmConfig({ ...config(), endpoint }).status).toBe('blocked');
});

it('supports explicit loopback and refuses key reuse at an edited endpoint', () => {
  expect(normalizeFc27LlmConfig({ ...config(), endpoint: 'http://127.0.0.1:8080/v1/chat/completions' }).status).toBe('ready');
  const before = config();
  expect(buildFc27LlmRequest({ ...before, endpoint: 'https://other.example/chat' }, credential(before), observation()).reason).toBe('FC27_LLM_CREDENTIAL_REQUIRED');
  expect(normalizeFc27LlmConfig({ ...config('gemini'), endpoint: 'https://relay.example/models/wrong:generateContent' }).reason).toBe('FC27_LLM_MODEL_ENDPOINT_MISMATCH');
  expect(normalizeFc27LlmConfig({ ...config('gemini'), model: 'test', endpoint: 'https://{model}/models/test:generateContent' }).status).toBe('blocked');
});

it('supports explicit strict JSON/text modes and both chat token caps without retrying compatibility errors', () => {
  for (const protocol of Object.values(FC27_LLM_PROTOCOL)) {
    const current = { ...config(protocol), outputFormat: 'schema', chatTokenField: 'max_completion_tokens' };
    const result = buildFc27LlmRequest(current, credential(current), observation());
    const schema = protocol === 'gemini' ? result.request.body.generationConfig.responseJsonSchema
      : protocol === 'responses' ? result.request.body.text.format.schema : result.request.body.response_format.json_schema.schema;
    expect(schema.required).toEqual(Object.keys(schema.properties)); expect(schema.additionalProperties).toBe(false);
  }
  const current = { ...config(), outputFormat: 'text', chatTokenField: 'max_completion_tokens' };
  const body = buildFc27LlmRequest(current, credential(current), observation()).request.body;
  expect(body.max_completion_tokens).toBe(2048); expect(body).not.toHaveProperty('response_format');
});

it('projects allowlisted aggregate facts and strips nested secrets/IDs at the transport boundary', () => {
  const source = observation(); source.accountScope = 'private-account'; source.items = [{ id: 999999, definitionId: 888888 }];
  source.rules[0].secret = 'private-secret'; source.currentPlan.selected = source.items;
  source.groups.nation.entries[0].secret = 'private-secret'; source.ratings.secret = 'private-secret';
  source.attempts = [{ strategy: 'nation', groupId: 1, ...source.currentPlan, summary: 'private-secret' }];
  const projected = projectFc27LlmObservation(source);
  expect(projected.rules).toEqual([{ kind: 'min-chemistry', value: 14 }]);
  const body = JSON.stringify(buildFc27LlmRequest(config(), credential(config()), source).request.body);
  for (const value of ['private-account', 'private-secret', '999999', '888888']) expect(body).not.toContain(value);
  expect(buildFc27LlmRequest(config(), credential(config()), { arbitrary: 'private' }).reason).toBe('FC27_LLM_INPUT_INVALID');
});

it('parses three response envelopes, omits reasoning and never returns model prose', () => {
  const value = action({ summary: 'untrusted-model-text' });
  expect(parseFc27LlmResponse('chat-completions', chat(value)).action).toEqual(value);
  expect(parseFc27LlmResponse('responses', { status: 'completed', output: [{ type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }).action).toEqual(value);
  expect(parseFc27LlmResponse('gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [
    { thought: true, text: 'private-thought' }, { text: JSON.stringify(value) }] } }] }).action).toEqual(value);
});

it.each(['buy', 'submit', 'fill', 'quote_market', 'eval'])('rejects unsupported action %s', name => {
  expect(parseFc27LlmAction(action({ action: name })).status).toBe('blocked');
});

it('rejects truncation, refusal, native tool calls, malformed output and invented properties', () => {
  const responses = [chat({ ...action(), selected: [1] }), { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(action()) } }] },
    { choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: JSON.stringify(action()) } }] },
    { choices: [{ finish_reason: 'stop', message: { tool_calls: [{}] } }] }, chat(null), chat(action({ groupId: -1 }))];
  for (const response of responses) expect(parseFc27LlmResponse('chat-completions', response).status).toBe('blocked');
  expect(parseFc27LlmResponse('responses', { status: 'completed', output: [{ type: 'message', content: {} }] }).status).toBe('blocked');
  expect(parseFc27LlmResponse('gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }).status).toBe('blocked');
});

it('does no HTTP/tool work when disabled, unapproved, already solved or in a non-search safety stop', async () => {
  const transport = vi.fn(); const local = session();
  expect((await runFc27LlmAssistant({ config: {}, session: local, transport })).status).toBe('disabled');
  expect((await runFc27LlmAssistant({ config: config(), credential: credential(config()), session: local, transport })).reason).toBe('FC27_LLM_DATA_APPROVAL_REQUIRED');
  for (const currentPlan of [{ status: 'preview' }, { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE' },
    { status: 'blocked', reason: 'FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE' }]) {
    local.observe.mockReturnValue({ ...observation(), currentPlan });
    expect((await runFc27LlmAssistant({ config: config(), credential: credential(config()), session: local, transport, approved: true })).status).toBe('skipped');
  }
  expect(transport).not.toHaveBeenCalled(); expect(local.run).not.toHaveBeenCalled();
  local.observe.mockReturnValue({ ...observation(), remainingNodes: 0 });
  expect((await runFc27LlmAssistant({ config: config(), credential: credential(config()), session: local, transport, approved: true })).reason).toBe('FC27_PUZZLE_TOTAL_BUDGET');
  expect(transport).not.toHaveBeenCalled();
});

it('awaits read-only hints and re-observes results without replaying raw model history', async () => {
  const local = session(); let runs = 0;
  local.run.mockImplementation(async () => { runs++; return { status: runs === 2 ? 'preview' : 'blocked' }; });
  const transport = vi.fn().mockResolvedValueOnce(chat(action({ action: 'run_puzzle_planner', strategy: 'nation', groupId: 1, summary: 'do-not-replay' })))
    .mockResolvedValueOnce(chat(action({ action: 'run_puzzle_planner', strategy: 'low-rating' })));
  const result = await runFc27LlmAssistant({ config: config(), credential: credential(config()), session: local, transport, approved: true });
  expect(result).toMatchObject({ reason: 'FC27_LLM_LOCAL_PLAN_FOUND', requests: 2, liveExecutionEnabled: false });
  expect(local.observe).toHaveBeenCalledTimes(2); expect(result).not.toHaveProperty('selected');
  expect(JSON.stringify(transport.mock.calls[1])).not.toContain('do-not-replay');
});

it('stops duplicate strategies, exhausted requests, cancellation and HTTP failures without retries', async () => {
  const args = { config: config(), credential: credential(config()), session: session(), approved: true };
  const transport = vi.fn(async () => chat(action({ action: 'run_puzzle_planner' })));
  expect((await runFc27LlmAssistant({ ...args, transport })).reason).toBe('FC27_LLM_NO_PROGRESS');
  expect((await runFc27LlmAssistant({ ...args, config: { ...args.config, maxRequests: 1 }, transport })).reason).toBe('FC27_LLM_REQUEST_LIMIT');
  const failing = vi.fn(async () => { throw new Error('FC27_LLM_HTTP_429'); });
  expect((await runFc27LlmAssistant({ ...args, transport: failing })).reason).toBe('FC27_LLM_HTTP_429'); expect(failing).toHaveBeenCalledOnce();
  const controller = new AbortController(); controller.abort(); const never = vi.fn();
  expect((await runFc27LlmAssistant({ ...args, transport: never, signal: controller.signal })).reason).toBe('FC27_LLM_CANCELLED'); expect(never).not.toHaveBeenCalled();
});

const marketObservation = () => ({ ...observation(), mode: 'market', remainingNodes: 100,
  currentPlan: { status: 'preview', reason: 'FC27_MARKET_PLAN_PREVIEW', estimatedCost: 600, purchaseCount: 3 },
  market: { canImprove: true, budget: 2000, maxPurchases: 3, maxUnitPrice: 1000 },
  groups: { nation: { entries: [{ id: 1, count: 8, ownedCount: 3, marketCount: 5, minPrice: 200 }] } } });

it('allows a cheaper market route despite an existing costly preview and re-observes its aggregate result', async () => {
  const current = marketObservation(); const local = { observe: vi.fn(() => current), run: vi.fn(() => {
    current.currentPlan = { ...current.currentPlan, estimatedCost: 400, purchaseCount: 2 }; return current.currentPlan;
  }) };
  const transport = vi.fn().mockResolvedValueOnce(chat(action({ action: 'run_puzzle_planner', strategy: 'nation', groupId: 1 })))
    .mockResolvedValueOnce(chat(action()));
  const result = await runFc27LlmAssistant({ config: config(), credential: credential(config()), approved: true, session: local, transport });
  expect(result).toMatchObject({ reason: 'FC27_LLM_FINISHED', requests: 2 });
  expect(local.run).toHaveBeenCalledOnce();
  expect(JSON.parse(transport.mock.calls[1][0].body.messages[1].content).currentPlan.estimatedCost).toBe(400);
});

it('does not spend a model request on a zero-cost or exhausted market session', async () => {
  for (const cost of [0, 400]) {
    const current = marketObservation(); current.currentPlan.estimatedCost = cost; current.market.canImprove = false;
    const local = { observe: () => current, run: vi.fn() }; const transport = vi.fn();
    expect((await runFc27LlmAssistant({ config: config(), credential: credential(config()), approved: true, session: local, transport })).status).toBe('skipped');
    expect(transport).not.toHaveBeenCalled(); expect(local.run).not.toHaveBeenCalled();
  }
});

it('uploads market group counts and budget only, not owned IDs or catalog/quote records', () => {
  const current = marketObservation();
  current.catalog = [{ definitionId: 987654321, private: 'do-not-share-catalog' }];
  current.market.quotes = [{ definitionId: 987654321, private: 'do-not-share-quote' }];
  current.currentPlan.selectedOwned = [{ id: 99999999 }];
  current.groups.nation.entries[0].players = current.catalog;
  const projected = projectFc27LlmObservation(current);
  expect(projected.groups.nation.entries[0]).toEqual({ id: 1, count: 8, ownedCount: 3, marketCount: 5, minPrice: 200 });
  expect(projected.market.budget).toBe(2000);
  for (const secret of ['987654321', '99999999', 'do-not-share']) expect(JSON.stringify(projected)).not.toContain(secret);
});

it('stops market assistance on snapshot drift, duplicate routes and exhausted nodes', async () => {
  const current = marketObservation(); const local = { observe: vi.fn(() => current), run: vi.fn(() => current.currentPlan) };
  const transport = vi.fn(async () => chat(action({ action: 'run_puzzle_planner', strategy: 'nation', groupId: 1 })));
  const args = { config: config(), credential: credential(config()), approved: true, session: local, transport };
  expect((await runFc27LlmAssistant(args)).reason).toBe('FC27_LLM_NO_PROGRESS');
  expect(local.run).toHaveBeenCalledOnce();
  transport.mockClear(); current.remainingNodes = 0;
  expect((await runFc27LlmAssistant(args)).reason).toBe('FC27_PUZZLE_TOTAL_BUDGET');
  local.observe.mockImplementation(() => { throw new Error('private drift detail'); });
  expect((await runFc27LlmAssistant(args)).reason).toBe('FC27_LLM_INPUT_CHANGED');
  expect(transport).not.toHaveBeenCalled();
});
