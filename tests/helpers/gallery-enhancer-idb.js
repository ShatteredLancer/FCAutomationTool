// Minimal asynchronous IDB contract double; no real account data or network.
export function enhancerDatabase(value, { listed = true, upgrade = false, blocked = false } = {}) {
  const calls = [], db = {
    objectStoreNames: { contains: name => name === 'setting' },
    close: () => calls.push(['close']),
    transaction(name, mode) {
      calls.push(['transaction', name, mode]);
      const tx = { objectStore: store => ({ get(key) {
        calls.push(['get', store, key]); const req = {};
        queueMicrotask(() => { req.result = value; req.onsuccess?.(); tx.oncomplete?.(); });
        return req;
      } }) };
      return tx;
    },
  };
  return { calls, databases: async () => { calls.push(['databases']); return listed ? [{ name: 'fce-27' }] : []; },
    open(name) {
      calls.push(['open', name]); const req = { result: db, transaction: { abort: () => calls.push(['abort']) } };
      queueMicrotask(() => { if (blocked) req.onblocked?.(); else if (upgrade) req.onupgradeneeded?.(); else req.onsuccess?.(); });
      return req;
    } };
}
