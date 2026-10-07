import { expect, it, vi } from 'vitest';
import { downloadFc27Diagnostics } from '../../src/adapters/browser/fc27-diagnostic-download.js';

it.each([false, true])('keeps diagnostic URL alive through download dispatch, click failure=%s', throws => {
  const anchor = { click: vi.fn(() => { if (throws) throw Error('download'); }), remove: vi.fn() };
  const runtime = { Blob, URL: { createObjectURL: vi.fn(() => 'blob:fixture'), revokeObjectURL: vi.fn() }, setTimeout: vi.fn() };
  const document = { createElement: () => anchor, body: { appendChild: vi.fn() } };
  const run = () => downloadFc27Diagnostics(runtime, document, '{"entries":[]}', 'diagnostics.json');
  if (throws) expect(run).toThrow('download'); else run();
  expect(anchor.download).toBe('diagnostics.json');
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(runtime.URL.createObjectURL.mock.calls[0][0].type).toBe('application/json;charset=utf-8');
  expect(runtime.URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(runtime.setTimeout.mock.calls[0][1]).toBe(1000);
  runtime.setTimeout.mock.calls[0][0]();
  expect(runtime.URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:fixture');
});
