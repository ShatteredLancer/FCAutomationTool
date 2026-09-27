// Credential-bearing transport. Used by the local Node inspection process;
// production userscript permissions and EA network transport remain unchanged.
export function createFc27LlmFetchTransport({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('FC27_LLM_HTTP_UNAVAILABLE');
  return async (request, timeoutMs = 20000, signal) => {
    let url;
    try { url = new URL(request?.url); } catch { throw new Error('FC27_LLM_REQUEST_INVALID'); }
    if (request.method !== 'POST' || url.username || url.password || url.search || url.hash
        || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('FC27_LLM_REQUEST_INVALID');
    if (signal?.aborted) throw new Error('FC27_LLM_CANCELLED');
    const controller = new AbortController();
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const abort = reason => { controller.abort(); rejectAbort(new Error(reason)); };
    const cancel = () => abort('FC27_LLM_CANCELLED');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => abort('FC27_LLM_TIMEOUT'), timeoutMs);
    const execute = async () => {
      const response = await fetchImpl(url.href, { method: 'POST', headers: request.headers,
        body: JSON.stringify(request.body), credentials: 'omit', redirect: 'error',
        cache: 'no-store', signal: controller.signal });
      if (!response.ok) { controller.abort(); throw new Error(`FC27_LLM_HTTP_${response.status}`); }
      const maxBytes = 131072;
      if (Number(response.headers?.get('content-length')) > maxBytes) throw new Error('FC27_LLM_RESPONSE_LIMIT');
      // Bound decoded bytes even when Content-Length is absent, compressed or wrong.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('FC27_LLM_RESPONSE_JSON_INVALID');
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('FC27_LLM_RESPONSE_LIMIT');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new globalThis.TextDecoder().decode(bytes)); }
      catch { throw new Error('FC27_LLM_RESPONSE_JSON_INVALID'); }
    };
    try { return await Promise.race([aborted, execute()]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); }
  };
}
