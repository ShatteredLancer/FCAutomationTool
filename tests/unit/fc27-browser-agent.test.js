import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
import { runAgentSession } from '../../scripts/browser-inspection/agent-session.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';
import { observeRuntime } from '../../scripts/browser-inspection/runtime-observation.mjs';
import * as navigation from '../../scripts/browser-inspection/navigation.mjs';

it('operates one owned session through restricted stdin and writes only a sanitized local report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcat-agent-test-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const page = new EventEmitter();
  page.url = () => WEB_APP_URL;
  page.evaluate = async (fn, args) => vm.runInNewContext(`(${fn.toString()})(argument)`,
    { argument: args, APP_YEAR_SHORT: 27, privateAccount: 'do-not-export' });
  page.locator = () => ({ count: async () => 0, evaluateAll: async () => [] });
  const context = new EventEmitter();
  context.pages = () => [page];
  context.browser = () => ({ version: () => 'synthetic-browser' });
  const commands = ['inspect', 'submit', 'sbc', 'set 1', 'q'];
  try {
    await runAgentSession({ context, root, withExtensions: false,
      loadHelpers: async () => ({ observeRuntime, ...navigation }),
      terminal: { question: async () => commands.shift() } });
    const directory = path.join(root, 'artifacts/fc27-browser');
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const text = await readFile(path.join(directory, files[0]), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ mode: 'agent', liveExecutionEnabled: false,
      action: 'NATIVE_SBC_HUB_NOT_CONFIRMED', report: { season: '27' } });
    expect(text).not.toContain('do-not-export');
    expect(page.listenerCount('response')).toBe(0);
    expect(context.listenerCount('page')).toBe(0);
    expect(log).toHaveBeenCalledWith('Unsupported read-only command.');
  } finally {
    log.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])('gates native provider and squad commands when extensions enabled=%s', async withExtensions => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcat-agent-guards-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const page = new EventEmitter();
  page.url = () => WEB_APP_URL;
  const inspectInProgressSquad = () => ({ status: 'observed', reason: 'IN_PROGRESS_SQUAD_READ', liveExecutionEnabled: false });
  page.evaluate = async (fn, args) => fn === inspectInProgressSquad ? fn(args)
    : vm.runInNewContext(`(${fn.toString()})(argument)`, { argument: args, APP_YEAR_SHORT: 27 });
  const context = new EventEmitter();
  context.pages = () => [page];
  context.browser = () => ({ version: () => 'synthetic-browser' });
  const inspectNativeProvider = vi.fn(async () => ({ status: 'observed', liveExecutionEnabled: false }));
  const commands = ['provider', 'club', 'squad 1 2', 'inspect', 'q'];
  try {
    await runAgentSession({ context, root, withExtensions,
      loadHelpers: async () => ({ observeRuntime, inspectNativeProvider, inspectInProgressSquad,
        observePageUi: async () => ({ challenges: true, login: false, modal: false, loading: false }) }),
      terminal: { question: async () => commands.shift() } });
    const directory = path.join(root, 'artifacts/fc27-browser');
    const [name] = await readdir(directory);
    const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    expect(report.squadReads).toHaveLength(withExtensions ? 0 : 1);
    expect(inspectNativeProvider).toHaveBeenCalledTimes(withExtensions ? 0 : 2);
    expect(report.clubReads).toHaveLength(withExtensions ? 0 : 1);
    if (!withExtensions) expect(inspectNativeProvider).toHaveBeenLastCalledWith(page, { fresh: true });
    expect(report.liveExecutionEnabled).toBe(false);
  } finally {
    log.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
