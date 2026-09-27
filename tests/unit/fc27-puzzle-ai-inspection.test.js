import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { inspectPuzzleWithAi, readPuzzleAiEnvironment, testPuzzleAiConnection } from '../../scripts/browser-inspection/puzzle-ai.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

const settings = () => readPuzzleAiEnvironment({ FCAT_LLM_ENABLED: 'true', FCAT_LLM_PROTOCOL: 'chat-completions',
  FCAT_LLM_ENDPOINT: 'https://relay.example/v1/chat/completions', FCAT_LLM_MODEL: 'my-model',
  FCAT_LLM_KEY_ENDPOINT: 'https://relay.example/v1/chat/completions', FCAT_LLM_API_KEY: 'synthetic-secret',
  FCAT_LLM_SHARE_AGGREGATES: 'true' });
const chat = action => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(action) } }] });
const finish = { action: 'finish', strategy: 'balanced', groupId: 0, summary: 'do-not-export' };
const observation = () => ({ schema: 1, season: '27', required: 11, rules: [{ kind: 'min-chemistry', value: 14 }],
  groups: { nation: { entries: [{ id: 1, count: 11 }] } }, ratings: { 70: 20 },
  currentPlan: { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', selectedCount: 0, nodes: 50000 }, attempts: [] });

it('defaults off, uses only FCAT settings and requires separate endpoint binding for credentials', async () => {
  const transport = vi.fn();
  expect(readPuzzleAiEnvironment({ OPENAI_API_KEY: 'not-authorized' }).status).toBe('disabled');
  expect((await testPuzzleAiConnection(readPuzzleAiEnvironment({}), transport)).status).toBe('disabled');
  const value = settings(); value.credential.endpoint = 'https://different.example/chat';
  expect((await testPuzzleAiConnection(value, transport)).reason).toBe('FC27_LLM_CREDENTIAL_REQUIRED');
  expect(transport).not.toHaveBeenCalled();
});

it('tests a provider with synthetic data only and discards its text', async () => {
  const transport = vi.fn(async () => chat(finish));
  const result = await testPuzzleAiConnection(settings(), transport);
  expect(result).toMatchObject({ status: 'verified', synthetic: true, liveExecutionEnabled: false });
  expect(JSON.stringify(result)).not.toContain('do-not-export');
  expect(transport.mock.calls[0][0].body.messages[1].content).toContain('"synthetic":true');
  expect(transport.mock.calls[0][0].body.messages[1].content).not.toContain('inventory');
});

it.each(['chat-completions', 'responses', 'gemini'])('round trips %s through a real local HTTP fixture without external API access', async protocol => {
  const observed = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      observed.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      const response = protocol === 'gemini' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(finish) }] } }] }
        : protocol === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(finish) }] }] }
        : chat(finish);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/${protocol === 'gemini' ? 'models/{model}:generateContent' : protocol}`;
    const input = readPuzzleAiEnvironment({ FCAT_LLM_ENABLED: 'true', FCAT_LLM_PROTOCOL: protocol, FCAT_LLM_ENDPOINT: endpoint,
      FCAT_LLM_KEY_ENDPOINT: endpoint, FCAT_LLM_API_KEY: 'synthetic-secret', FCAT_LLM_MODEL: 'test' });
    expect((await testPuzzleAiConnection(input)).status).toBe('verified');
    expect(observed).toHaveLength(1); expect(observed[0].headers.cookie).toBeUndefined();
    expect(observed[0].headers[protocol === 'gemini' ? 'x-goog-api-key' : 'authorization']).toContain('synthetic-secret');
    expect(JSON.stringify(observed[0].body)).not.toContain('synthetic-secret');
    expect(JSON.stringify(observed[0].body)).toContain('synthetic');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

it('does not inspect a page without data consent or when disabled', async () => {
  const page = { evaluate: vi.fn() }; const transport = vi.fn();
  expect((await inspectPuzzleWithAi(page, 19, 43, { settings: { status: 'disabled' }, transport })).status).toBe('disabled');
  expect((await inspectPuzzleWithAi(page, 19, 43, { settings: { ...settings(), approved: false }, transport })).reason).toBe('FC27_LLM_DATA_APPROVAL_REQUIRED');
  expect(page.evaluate).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});

it('compiles only read dependencies, keeps keys outside the page and cleans up after an assisted plan', async () => {
  let current = observation();
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async (fn, arg) => {
    if (typeof fn === 'string') return { report: { ...current.currentPlan, plan: current.currentPlan, liveExecutionEnabled: false }, observation: current };
    if (typeof arg === 'object') {
      current = { ...current, currentPlan: { status: 'preview', reason: 'READ_ONLY_PLAN', selectedCount: 11, chemistry: 17 } };
      return { result: current.currentPlan, observation: current };
    }
    if (fn.toString().includes('.observe()')) return current;
    return undefined;
  }) };
  const transport = vi.fn(async () => chat({ ...finish, action: 'run_puzzle_planner', strategy: 'nation', groupId: 1 }));
  const result = await inspectPuzzleWithAi(page, 19, 43, { settings: settings(), transport });
  expect(result).toMatchObject({ status: 'preview', reason: 'READ_ONLY_PLAN', liveExecutionEnabled: false,
    assistant: { reason: 'FC27_LLM_LOCAL_PLAN_FOUND' }, plan: { selectedCount: 11 } });
  expect(JSON.stringify(page.evaluate.mock.calls)).not.toContain('synthetic-secret');
  expect(JSON.stringify(result)).not.toContain('do-not-export');
  expect(page.evaluate.mock.calls.at(-1)[0].toString()).toContain('delete globalThis');
  expect(transport).toHaveBeenCalledOnce();
});

it('skips external calls for a successful local baseline', async () => {
  const current = { ...observation(), currentPlan: { status: 'preview', reason: 'READ_ONLY_PLAN' } };
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async fn => typeof fn === 'string'
    ? { report: { status: 'preview', reason: 'READ_ONLY_PLAN' }, observation: current } : undefined) };
  const transport = vi.fn();
  expect((await inspectPuzzleWithAi(page, 19, 43, { settings: settings(), transport })).assistant.reason).toBe('LOCAL_PLAN_ALREADY_FOUND');
  expect(transport).not.toHaveBeenCalled();
});

it('stops on page input drift and still removes the local session', async () => {
  const current = observation();
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async fn => {
    if (typeof fn === 'string') return { report: current.currentPlan, observation: current };
    if (fn.toString().includes('.observe()')) throw new Error('private failure');
  }) };
  const transport = vi.fn();
  const result = await inspectPuzzleWithAi(page, 19, 43, { settings: settings(), transport });
  expect(result.assistant.reason).toBe('FC27_LLM_INPUT_CHANGED'); expect(transport).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private failure');
  expect(page.evaluate.mock.calls.at(-1)[0].toString()).toContain('delete globalThis');
});
