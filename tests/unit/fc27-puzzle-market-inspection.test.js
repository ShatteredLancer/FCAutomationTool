import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPuzzleMarketData, validatePuzzleMarketData, inspectPuzzleMarket, inspectPuzzleMarketWithAi } from '../../scripts/browser-inspection/puzzle-market.mjs';
import { readPuzzleAiEnvironment } from '../../scripts/browser-inspection/puzzle-ai.mjs';
import { marketFixture } from '../helpers/fc27-market-fixture.js';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal(); return { ...actual, open: vi.fn(actual.open) };
});
const snapshot = (evidence = 'observed-response') => {
  const f = marketFixture();
  return { schema: 1, platform: f.context.platform, catalog: { ...f.catalog, seasonEvidence: evidence },
    marketPolicy: f.marketPolicy, quotes: f.quotes };
};
const now = marketFixture().now;

it('rejects synthetic or incomplete market snapshots before browser evaluation', () => {
  const input = snapshot();
  expect(validatePuzzleMarketData(snapshot('synthetic-fixture'), now).reason).toBe('FC27_MARKET_SYNTHETIC_DATA_REJECTED');
  expect(validatePuzzleMarketData({ ...input, schema: 2 }, now).reason).toBe('FC27_MARKET_INPUT_INVALID');
  expect(validatePuzzleMarketData({ ...input, quotes: [] }, now).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
});

it('reads reviewed-schema snapshots without claiming catalog completeness and sanitizes malformed JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcat-market-input-'));
  try {
    const input = snapshot();
    const file = path.join(root, 'input.json'); await writeFile(file, JSON.stringify(input));
    expect(await readPuzzleMarketData({ file, now })).toMatchObject({ status: 'ready', data: { catalog: { complete: false } } });
    await writeFile(file, JSON.stringify({ ...input, catalog: { ...input.catalog, revision: 'changed' } }));
    expect((await readPuzzleMarketData({ file, now })).status).toBe('ready');
    await writeFile(file, '{');
    expect((await readPuzzleMarketData({ file, now })).reason).toBe('FC27_MARKET_INPUT_INVALID');
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temp directory');
    await rm(root, { recursive: true, force: true });
  }
});

it('requires explicit market approval for AI and never evaluates a rejected page or market input', async () => {
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn() };
  const input = snapshot();
  const settings = { status: 'ready', approved: true, config: {}, credential: {} };
  vi.stubEnv('FCAT_LLM_SHARE_MARKET', 'false');
  try {
    expect((await inspectPuzzleMarket(page, 19, 43, { withAi: true, settings, marketApproved: false, data: input })).reason)
      .toBe('FC27_LLM_MARKET_DATA_APPROVAL_REQUIRED');
  } finally { vi.unstubAllEnvs(); }
  expect(page.evaluate).not.toHaveBeenCalled();
  expect((await inspectPuzzleMarket({ url: () => 'https://example.test', evaluate: vi.fn() }, 19, 43, { data: input })).reason)
    .toBe('FC27_LLM_INPUT_INVALID');
});

it.each(['short-read', 'truncated', 'growth', 'same-size-change', 'oversized'])('handles %s without exposing file contents and always closes', async mode => {
  const bytes = Buffer.from(JSON.stringify(snapshot()));
  const stat = { isFile: () => true, size: bytes.length, mtimeMs: 1, ctimeMs: 1 };
  if (mode === 'oversized') stat.size = 24 * 1024 * 1024 + 1;
  const handle = { close: vi.fn(async () => {}), stat: vi.fn().mockResolvedValueOnce(stat)
    .mockResolvedValue({ ...stat, size: stat.size + (mode === 'growth' ? 1 : 0), mtimeMs: mode === 'same-size-change' ? 2 : 1 }),
    read: vi.fn(async (buffer, offset, length, position) => {
      const bytesRead = mode === 'truncated' ? 0 : Math.min(71, length);
      bytes.copy(buffer, offset, position, position + bytesRead); return { bytesRead };
    }) };
  vi.mocked(open).mockResolvedValueOnce(handle);
  const result = await readPuzzleMarketData({ file: 'synthetic-test-only', now });
  if (mode === 'short-read') { expect(result.status).toBe('ready'); expect(handle.read.mock.calls.length).toBeGreaterThan(1); }
  else expect(result.reason).toBe(mode === 'oversized' ? 'FC27_MARKET_INPUT_LIMIT' : 'FC27_MARKET_INPUT_CHANGED');
  expect(handle.close).toHaveBeenCalledOnce();
});

it.each([false, true])('compiles the read-only seam, keeps credentials in Node and cleans up with drift=%s', async drift => {
  const settings = readPuzzleAiEnvironment({ FCAT_LLM_ENABLED: 'true', FCAT_LLM_PROTOCOL: 'chat-completions',
    FCAT_LLM_ENDPOINT: 'https://relay.example/chat', FCAT_LLM_KEY_ENDPOINT: 'https://relay.example/chat',
    FCAT_LLM_API_KEY: 'synthetic-secret', FCAT_LLM_MODEL: 'test', FCAT_LLM_SHARE_AGGREGATES: 'true' });
  const data = snapshot(); data.catalog.observedAt = Date.now(); data.quotes.forEach(q => { q.observedAt = data.catalog.observedAt; });
  const observation = { schema: 1, season: '27', mode: 'market', required: 3, rules: [], remainingNodes: 100,
    groups: {}, attempts: [], currentPlan: { status: 'preview', reason: 'FC27_MARKET_PLAN_PREVIEW', estimatedCost: 200 },
    market: { canImprove: true } };
  const report = { status: 'preview', reason: 'FC27_MARKET_PLAN_PREVIEW', executable: false };
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async (fn) => {
    if (typeof fn === 'string') return undefined;
    if (fn.toString().includes('.start(')) return { report, observation };
    if (fn.toString().includes('.observe()')) { if (drift) throw new Error('private-detail'); return observation; }
    if (fn.toString().includes('.result()')) { if (drift) throw new Error('private-detail'); return report; }
  }) };
  const transport = vi.fn(async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    action: 'finish', strategy: 'balanced', groupId: 0, summary: 'private-model-text' }) } }] }));
  const result = await inspectPuzzleMarketWithAi(page, 19, 43, { settings, data, marketApproved: true, transport });
  expect(result.assistant.reason).toBe(drift ? 'FC27_LLM_INPUT_CHANGED' : 'FC27_LLM_FINISHED');
  expect(transport).toHaveBeenCalledTimes(drift ? 0 : 1);
  expect(JSON.stringify(page.evaluate.mock.calls)).not.toContain('synthetic-secret');
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(page.evaluate.mock.calls.at(-1)[0].toString()).toContain('delete globalThis');
});
