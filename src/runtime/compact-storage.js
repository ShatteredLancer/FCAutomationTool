// Lossless storage transport only. Business validators still receive the complete
// original object, including unknown/pending evidence and future fields.
const FORMAT = 'fcat-gzip-json-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MIN_BYTES = 32 * 1024;
export const storedJsonBytes = value => new globalThis.TextEncoder().encode(JSON.stringify(value)).byteLength;
const invalid = () => { throw Error('FCAT_STORAGE_COMPRESSION_INVALID'); };

async function collect(stream, limit) {
  const reader = stream.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) invalid();
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function encodeStoredValue(value) {
  if (value == null || typeof globalThis.CompressionStream !== 'function') return value;
  const bytes = new globalThis.TextEncoder().encode(JSON.stringify(value));
  // Never truncate a large transaction or drop it to satisfy a cache budget.
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return value;
  const compressed = await collect(new globalThis.Blob([bytes]).stream().pipeThrough(new globalThis.CompressionStream('gzip')), MAX_BYTES);
  let binary = '';
  for (let i = 0; i < compressed.length; i += 8192) binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  const packed = { fcatStorage: FORMAT, bytes: bytes.length, data: globalThis.btoa(binary) };
  return storedJsonBytes(packed) < bytes.length ? packed : value;
}
export async function decodeStoredValue(value) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'fcatStorage')) return value;
  if (value.fcatStorage !== FORMAT || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_BYTES
      || typeof value.data !== 'string' || value.data.length > Math.ceil(MAX_BYTES / 3) * 4
      || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
      || typeof globalThis.DecompressionStream !== 'function') invalid();
  const binary = globalThis.atob(value.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const unpacked = await collect(new globalThis.Blob([bytes]).stream().pipeThrough(new globalThis.DecompressionStream('gzip')), value.bytes);
  if (unpacked.length !== value.bytes) invalid();
  return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(unpacked));
}
export function createCompactStorage({ get, set }) {
  return Object.freeze({
    get: async (key, fallback) => decodeStoredValue(await get(key, fallback)),
    set: async (key, value) => set(key, await encodeStoredValue(value)),
  });
}
