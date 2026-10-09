// Runs before bundled module initializers, without EA or GM storage access.
export function wrapFc27Boot(script, version) {
  return `(() => {
  let root;
  let state;
  const mark = status => {
    try { document.documentElement?.setAttribute('data-fcat-boot-status', status); } catch {}
  };
  try {
    root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    state = { version: ${JSON.stringify(version)}, at: Date.now(), status: 'started',
      readyState: document.readyState, top: window.top === window,
      grants: { unsafeWindow: typeof unsafeWindow !== 'undefined',
        get: typeof GM_getValue === 'function', set: typeof GM_setValue === 'function',
        request: typeof GM_xmlhttpRequest === 'function' } };
    root.__FCAT_BOOT_STARTED__ = state;
    document.documentElement?.setAttribute('data-fcat-boot', state.version);
    mark('started');
  } catch {}
  try {
${script}
    if (state) state.status = 'ready';
    mark('ready');
  } catch (error) {
    try {
      const name = /^(TypeError|ReferenceError|RangeError|SyntaxError|Error)$/.test(error?.name) ? error.name : 'Error';
      const reason = /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_BOOT_RUNTIME_FAILED';
      if (state) { state.status = 'failed'; state.error = { name, reason }; }
      mark('failed');
      console.error('[FCAT_BOOT_FAILED]', name, reason);
    } catch {}
    throw error;
  }
})();`;
}
