// Optional local interoperability with Enhancer 27.0.1.8's persisted v2
// Gallery store. Read one exact key; never create/upgrade/write a database,
// contact its backend, or use a different persona's collection.
export function parseEnhancerGalleryHistory(value, personaId) {
  if (typeof value !== 'string' || value.length > 4000000 || !/^[1-9]\d*$/.test(String(personaId))) return null;
  try {
    const envelope = JSON.parse(value);
    const rows = envelope?.version === 2 ? envelope.state?.playersByPersonaId?.[personaId] : null;
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return null;
    const entries = Object.entries(rows);
    if (entries.length > 100000 || entries.some(([key, flag]) => !/^[1-9]\d*$/.test(key)
      || !Number.isSafeInteger(Number(key)) || typeof flag !== 'boolean')) return null;
    return new Map(entries.map(([key, flag]) => [Number(key), flag]));
  } catch { return null; }
}

export function readEnhancerGalleryHistory(indexedDB, personaId, { timeoutMs = 1500 } = {}) {
  return new Promise(resolve => {
    let done = false, db = null;
    const finish = value => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { db?.close(); } catch { /* Optional local history. */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    (async () => {
      // Without enumeration, open() could create a database on older browsers.
      if (typeof indexedDB?.databases !== 'function') return finish(null);
      const databases = await indexedDB.databases();
      if (done) return;
      if (!databases.some(entry => entry.name === 'fce-27')) return finish(null);
      const request = indexedDB.open('fce-27');
      request.onerror = request.onblocked = () => finish(null);
      request.onupgradeneeded = () => {
        // The database may have been deleted between enumeration and open.
        try { request.transaction.abort(); } catch { /* Never complete an upgrade. */ }
        finish(null);
      };
      request.onsuccess = () => {
        db = request.result;
        if (done) { db.close(); return; }
        try {
          if (!db.objectStoreNames.contains('setting')) return finish(null);
          db.onversionchange = () => finish(null);
          const transaction = db.transaction('setting', 'readonly');
          const read = transaction.objectStore('setting').get('gallery-collected-players-state');
          let result = null;
          read.onsuccess = () => { result = parseEnhancerGalleryHistory(read.result, personaId); };
          read.onerror = transaction.onerror = transaction.onabort = () => finish(null);
          transaction.oncomplete = () => finish(result);
        } catch { finish(null); }
      };
    })().catch(() => finish(null));
  });
}
