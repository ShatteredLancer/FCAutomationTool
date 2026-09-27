import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFc27LlmAssistant, normalizeFc27LlmConfig, buildFc27LlmRequest, parseFc27LlmResponse } from '../../src/fc27/llm-assistant.js';
import { createFc27LlmFetchTransport } from '../../src/adapters/browser/fc27-llm-http.js';
import { pageKind } from './probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Explicit FCAT-only configuration. Never inspect credentials belonging to
// another application, copy process environment to the page, or log secrets.
export function readPuzzleAiEnvironment(env = process.env) {
  const config = { enabled: env.FCAT_LLM_ENABLED === 'true',
    protocol: env.FCAT_LLM_PROTOCOL || 'chat-completions', endpoint: env.FCAT_LLM_ENDPOINT || '', model: env.FCAT_LLM_MODEL || '',
    outputFormat: env.FCAT_LLM_FORMAT || 'json', chatTokenField: env.FCAT_LLM_CHAT_TOKEN_FIELD || 'max_tokens' };
  const normalized = normalizeFc27LlmConfig(config);
  if (normalized.status !== 'ready') return normalized;
  return { status: 'ready', config: normalized.config,
    approved: env.FCAT_LLM_SHARE_AGGREGATES === 'true',
    credential: { endpoint: env.FCAT_LLM_KEY_ENDPOINT, apiKey: env.FCAT_LLM_API_KEY } };
}

export async function testPuzzleAiConnection(settings = readPuzzleAiEnvironment(), transport = createFc27LlmFetchTransport()) {
  if (settings.status !== 'ready') return { status: settings.status, reason: settings.reason ?? 'FC27_LLM_DISABLED' };
  const built = buildFc27LlmRequest(settings.config, settings.credential,
    { task: 'Connection test only. Return finish with strategy balanced, groupId 0 and summary OK.', synthetic: true });
  if (built.status !== 'ready') return built;
  try {
    const response = parseFc27LlmResponse(settings.config.protocol, await transport(built.request, settings.config.timeoutMs));
    return { status: response.status === 'action' && response.action.action === 'finish' ? 'verified' : 'blocked',
      reason: response.status === 'action' && response.action.action === 'finish' ? 'FC27_LLM_CONNECTION_VERIFIED' : 'FC27_LLM_RESPONSE_INVALID',
      protocol: settings.config.protocol, synthetic: true, liveExecutionEnabled: false };
  } catch { return { status: 'blocked', reason: 'FC27_LLM_CONNECTION_FAILED', synthetic: true }; }
}

// No HTTP listener or remote-debug endpoint. The session exists only in a
// short-lived read-only page closure; the API key and network stay in Node.
export async function inspectPuzzleWithAi(page, setId, challengeId, { settings = readPuzzleAiEnvironment(), transport = createFc27LlmFetchTransport() } = {}) {
  if (settings.status !== 'ready') return { status: settings.status, reason: settings.reason ?? 'FC27_LLM_DISABLED' };
  if (!settings.approved) return { status: 'blocked', reason: 'FC27_LLM_DATA_APPROVAL_REQUIRED' };
  const preflight = buildFc27LlmRequest(settings.config, settings.credential, { synthetic: true });
  if (preflight.status !== 'ready') return preflight;
  if (pageKind(page.url()) !== 'web-app' || ![setId, challengeId].every(value => Number.isSafeInteger(value) && value > 0 && value < 1e9)) {
    return { status: 'blocked', reason: 'FC27_LLM_INPUT_INVALID' };
  }
  const source = `import { inspectFc27PuzzlePlan } from './src/adapters/ea/fc27-puzzle-read.js';
    import { createFc27PuzzleAssistantSession } from './src/fc27/puzzle-assistant-session.js';
    import { readFc27Context, readFc27CachedClub } from './src/adapters/ea/fc27-local-read.js';
    import { readFc27RunnerPolicy } from './src/adapters/ea/fc27-fsu-read.js';
    export { inspectFc27PuzzlePlan, createFc27PuzzleAssistantSession, readFc27Context, readFc27CachedClub, readFc27RunnerPolicy };`;
  const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, sourcefile: 'puzzle-ai-inspection.js' },
    bundle: true, write: false, metafile: true, format: 'iife', globalName: 'PuzzleAiRead', target: 'chrome120' });
  const allowed = new Set(['puzzle-ai-inspection.js', 'src/fc27/puzzle-assistant-session.js', 'src/adapters/ea/fc27-puzzle-read.js',
    'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-fsu-read.js', 'src/adapters/ea/fc27-fsu-diagnostics.js',
    'src/adapters/ea/fc27-traditional-read.js', 'src/adapters/ea/fc27-challenge-catalog.js', 'src/adapters/ea/fc27-sbc-read.js',
    'src/domain/player-rarity.js', 'src/fc27/prelaunch-contract.js', 'src/fc27/traditional-preview.js',
    'src/fc27/sbc-requirements.js', 'src/fc27/puzzle-preview.js', 'src/fc27/puzzle-material-policy.js', 'src/fc27/puzzle-evaluator.js']);
  if (Object.keys(result.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) throw new Error('Unreviewed AI inspection dependency');
  const key = `__fcat_puzzle_${randomUUID().replaceAll('-', '')}`;
  try {
    const initial = await page.evaluate(`(async () => { ${result.outputFiles[0].text}
      let session;
      const fingerprint = () => JSON.stringify({ context: PuzzleAiRead.readFc27Context(globalThis),
        policy: PuzzleAiRead.readFc27RunnerPolicy(globalThis, 74), club: PuzzleAiRead.readFc27CachedClub(globalThis) });
      const report = await PuzzleAiRead.inspectFc27PuzzlePlan(globalThis, ${JSON.stringify({ setId, challengeId })}, input => {
        session = PuzzleAiRead.createFc27PuzzleAssistantSession(input);
        return session.status === 'ready' ? session.result() : session;
      });
      if (!session || session.status !== 'ready') return { report };
      if (report.reason === 'FC27_RUNNER_INPUTS_CHANGED') return { report };
      const signature = fingerprint();
      const unchanged = () => { if (signature !== fingerprint()) throw new Error('FC27_LLM_INPUT_CHANGED'); };
      const timer = setTimeout(() => { delete globalThis[${JSON.stringify(key)}]; }, 180000);
      globalThis[${JSON.stringify(key)}] = { observe: () => { unchanged(); return session.observe(); },
        run: hint => { unchanged(); return session.run(hint); }, close: () => clearTimeout(timer) };
      return { report, observation: session.observe() };
    })()`);
    if (!initial.observation) return initial.report;
    // An already feasible local result never incurs model costs automatically.
    if (initial.observation.currentPlan?.status === 'preview') return { ...initial.report, assistant: { status: 'skipped', reason: 'LOCAL_PLAN_ALREADY_FOUND', requests: 0 } };
    let observation = initial.observation;
    const session = {
      observe: async () => {
        observation = await page.evaluate(key => globalThis[key].observe(), key);
        return observation;
      },
      run: async hint => {
        const next = await page.evaluate(({ key, hint }) => {
          const session = globalThis[key];
          const result = session.run(hint);
          return { result, observation: session.observe() };
        }, { key, hint });
        observation = next.observation;
        return next.result;
      },
    };
    const assistant = await runFc27LlmAssistant({ config: settings.config, credential: settings.credential,
      approved: settings.approved, transport, session });
    return { ...initial.report, status: observation.currentPlan.status, reason: observation.currentPlan.reason,
      baselinePlan: initial.report.plan, plan: observation.currentPlan, assistant, attempts: observation.attempts };
  } finally {
    await page.evaluate(key => { globalThis[key]?.close(); delete globalThis[key]; }, key).catch(() => {});
  }
}
