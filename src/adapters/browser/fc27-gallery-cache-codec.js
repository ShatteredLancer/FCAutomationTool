const FORMAT = 'fcat-gallery-gzip-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MIN_BYTES = 128 * 1024;

async function collect(stream) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('FC27_GALLERY_CACHE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

// Lossless transport compaction, not a change to collection/card semantics.
// Tampermonkey sends all GM values on startup, even before GM_getValue runs.
export async function encodeGalleryCacheValue(value) {
  if (typeof globalThis.CompressionStream !== 'function') return value;
  const text = JSON.stringify(value), bytes = new globalThis.TextEncoder().encode(text);
  if (bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES) return value;
  const packed = await collect(new globalThis.Blob([bytes]).stream().pipeThrough(new globalThis.CompressionStream('gzip')));
  let binary = '';
  for (let offset = 0; offset < packed.length; offset += 8192) {
    binary += String.fromCharCode(...packed.subarray(offset, offset + 8192));
  }
  const data = globalThis.btoa(binary);
  if (data.length >= text.length) return value;
  return { schema: 4, format: FORMAT, data };
}

export async function decodeGalleryCacheValue(value) {
  if (value?.schema !== 4) return value;
  if (value.format !== FORMAT || typeof value.data !== 'string' || value.data.length > MAX_BYTES * 2
      || typeof globalThis.DecompressionStream !== 'function') throw new Error('FC27_GALLERY_CACHE_INVALID');
  const binary = globalThis.atob(value.data), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const unpacked = await collect(new globalThis.Blob([bytes]).stream().pipeThrough(new globalThis.DecompressionStream('gzip')));
  return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(unpacked));
}

// Compatibility names retained for the collection migration API.
export const encodeGalleryCollectionCache = encodeGalleryCacheValue;
export const decodeGalleryCollectionCache = decodeGalleryCacheValue;
