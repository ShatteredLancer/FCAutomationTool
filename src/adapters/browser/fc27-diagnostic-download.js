// FC27 diagnostic exports. Keep the archived FC26 effects adapter unchanged.
export function downloadFc27Diagnostics(runtime, document, text, filename) {
  const blob = new runtime.Blob([String(text)], { type: 'application/json;charset=utf-8' });
  const url = runtime.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // Allow Chrome to consume the URL before releasing it. This protects
    // download creation, not the lifetime of the inspection process.
    runtime.setTimeout(() => runtime.URL.revokeObjectURL(url), 1000);
  }
}
