import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../FCAutomationToolHotReload.user.js', import.meta.url), 'utf8');
function harness(season, script) {
  let boot; let reload;
  const status = { textContent: '' };
  const page = { APP_YEAR_SHORT: season, __FCLoopRunner: { destroy: vi.fn() }, eval: vi.fn() };
  const request = vi.fn(details => details.onload({ status: 200, responseText: script }));
  vm.runInNewContext(source, {
    unsafeWindow: page, console: { log() {}, error() {} },
    GM_xmlhttpRequest: request, GM_notification() {}, GM_getValue() {}, GM_setValue() {}, GM_deleteValue() {},
    setInterval(fn) { boot = fn; return 1; }, clearInterval() {},
    document: { body: { appendChild() {} }, head: { appendChild() {} }, createElement: () => ({}),
      querySelector(selector) {
        if (selector === '#loop-hot-reload-status') return status;
        if (selector === '#loop-hot-reload-btn') return { addEventListener(event, fn) { reload = fn; } };
        return null;
      } },
  });
  boot();
  return { page, request, status, run: () => reload() };
}
const legacy = '// ==UserScript==\n// @name FC26 Daily Loop Runner\n// @version 0.8.65\n// ==/UserScript==\n';

it.each(['27', undefined])('refuses non-FC26 or unknown season %s before network or page bridges', async season => {
  const h = harness(season, legacy);
  await h.run();
  expect(h.request).not.toHaveBeenCalled();
  expect(h.page.__FCLoopRunnerRequestText).toBeUndefined();
  expect(h.page.__FCLoopRunner.destroy).not.toHaveBeenCalled();
  expect(h.page.eval).not.toHaveBeenCalled();
});

it('rejects the new production artifact before destroying the legacy runtime', async () => {
  const h = harness('26', legacy.replace('FC26 Daily Loop Runner', 'FC Automation Tool').replace('0.8.65', '27.0.0'));
  await h.run();
  expect(h.request).toHaveBeenCalledOnce();
  expect(h.page.__FCLoopRunner.destroy).not.toHaveBeenCalled();
  expect(h.page.eval).not.toHaveBeenCalled();
  expect(h.status.textContent).toContain('LEGACY_SCRIPT_REQUIRED');
});

it('retains the verified FC26 reload and temporary GM bridge', async () => {
  const h = harness('26', legacy);
  h.page.eval.mockImplementation(() => expect(h.page.__FCLoopRunnerUserscriptApi.getValue).toBeTypeOf('function'));
  await h.run();
  expect(h.page.__FCLoopRunner.destroy).toHaveBeenCalledOnce();
  expect(h.page.eval).toHaveBeenCalledOnce();
  expect(h.page.__FCLoopRunnerUserscriptApi).toBeUndefined();
});
