import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { wrapFc27Boot } from '../../scripts/fcat-boot-probe.mjs';

function fixture() {
  const attrs = {};
  const root = {};
  const sandbox = { unsafeWindow: root, document: { readyState: 'interactive',
    documentElement: { setAttribute: (key, value) => { attrs[key] = value; } } },
    console: { error() {} }, GM_getValue() {}, GM_setValue() {}, GM_xmlhttpRequest() {} };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  return { sandbox, attrs, root };
}

it('marks injection before any application/module initialization and then readiness', () => {
  const { sandbox, attrs, root } = fixture();
  runInNewContext(wrapFc27Boot("unsafeWindow.seen = unsafeWindow.__FCAT_BOOT_STARTED__.status;", '27.0.15'), sandbox);
  expect(root.seen).toBe('started');
  expect(root.__FCAT_BOOT_STARTED__).toMatchObject({ version: '27.0.15', status: 'ready', top: true,
    grants: { unsafeWindow: true, get: true, set: true, request: true } });
  expect(attrs).toMatchObject({ 'data-fcat-boot': '27.0.15', 'data-fcat-boot-status': 'ready' });
});

it('retains a sanitized failure marker and propagates the original exception', () => {
  const { sandbox, attrs, root } = fixture();
  expect(() => runInNewContext(wrapFc27Boot("throw new TypeError('secret account token');", '27.0.15'), sandbox))
    .toThrow('secret account token');
  expect(root.__FCAT_BOOT_STARTED__).toMatchObject({ status: 'failed',
    error: { name: 'TypeError', reason: 'FC27_BOOT_RUNTIME_FAILED' } });
  expect(JSON.stringify(root.__FCAT_BOOT_STARTED__)).not.toContain('secret');
  expect(attrs['data-fcat-boot-status']).toBe('failed');
});

it('diagnostic DOM or page-global failures do not prevent the application running', () => {
  const { sandbox } = fixture();
  sandbox.document.documentElement.setAttribute = () => { throw new Error('not available'); };
  runInNewContext(wrapFc27Boot('window.executed = true;', '27.0.15'), sandbox);
  expect(sandbox.executed).toBe(true);
});

it('works without GM APIs and reports their absence without reading storage', () => {
  const { sandbox, root } = fixture();
  delete sandbox.GM_getValue; delete sandbox.GM_setValue; delete sandbox.GM_xmlhttpRequest;
  runInNewContext(wrapFc27Boot('', '27.0.15'), sandbox);
  expect(root.__FCAT_BOOT_STARTED__.grants).toMatchObject({ get: false, set: false, request: false });
});
