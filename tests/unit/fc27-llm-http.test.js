import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createFc27LlmFetchTransport } from '../../src/adapters/browser/fc27-llm-http.js';

const request = { method: 'POST', url: 'https://relay.example/chat', headers: { Authorization: 'Bearer synthetic' }, body: { model: 'test' } };

it('posts JSON without cookies or redirects and returns bounded decoded data', async () => {
  const fetchImpl = vi.fn(async () => new Response('{"ok":true}'));
  expect(await createFc27LlmFetchTransport({ fetchImpl })(request)).toEqual({ ok: true });
  expect(fetchImpl).toHaveBeenCalledWith(request.url, expect.objectContaining({ method: 'POST', body: '{"model":"test"}',
    credentials: 'omit', redirect: 'error', cache: 'no-store' }));
});

it('returns only a status code for failure and refuses invalid JSON', async () => {
  await expect(createFc27LlmFetchTransport({ fetchImpl: async () => new Response('sensitive error', { status: 429 }) })(request)).rejects.toThrow('FC27_LLM_HTTP_429');
  await expect(createFc27LlmFetchTransport({ fetchImpl: async () => new Response('sensitive html') })(request)).rejects.toThrow('FC27_LLM_RESPONSE_JSON_INVALID');
});

it('bounds streaming bytes and rejects excessive Content-Length', async () => {
  for (const response of [new Response('x'.repeat(131073)), new Response('{}', { headers: { 'content-length': '131073' } })]) {
    await expect(createFc27LlmFetchTransport({ fetchImpl: async () => response })(request)).rejects.toThrow('FC27_LLM_RESPONSE_LIMIT');
  }
});

it('enforces timeout even when an injected transport ignores AbortSignal', async () => {
  vi.useFakeTimers();
  try {
    const promise = createFc27LlmFetchTransport({ fetchImpl: () => new Promise(() => {}) })(request, 1000);
    const assertion = expect(promise).rejects.toThrow('FC27_LLM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(1000); await assertion;
  } finally { vi.useRealTimers(); }
});

it('cancels an in-flight request and removes the cancellation listener', async () => {
  const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const promise = createFc27LlmFetchTransport({ fetchImpl: () => new Promise(() => {}) })(request, 1000, controller.signal);
  const assertion = expect(promise).rejects.toThrow('FC27_LLM_CANCELLED'); controller.abort(); await assertion;
  expect(remove).toHaveBeenCalled();
});

it.each(['javascript:bad', 'http://other.example/chat', 'https://user:pass@example.com/chat', 'https://example.com/chat?key=abc'])('rejects endpoint %s before fetch', async url => {
  const fetchImpl = vi.fn();
  await expect(createFc27LlmFetchTransport({ fetchImpl })({ ...request, url })).rejects.toThrow('FC27_LLM_REQUEST_INVALID');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('does not follow an actual HTTP redirect to another credential recipient', async () => {
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === '/chat') { res.writeHead(307, { location: '/leak' }); res.end(); }
    else { redirected++; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/chat`;
    await expect(createFc27LlmFetchTransport()({ ...request, url })).rejects.toThrow();
    expect(redirected).toBe(0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
