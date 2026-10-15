import { createHash, webcrypto } from 'node:crypto';
import observation from '../fixtures/fc27-streamlined-storage-observation-2026-10-15.json';

// Compile the exact public function text, with only its reviewed string decoder
// and synthetic dependencies. Its real SHA256 is not replaced by the harness.
export function observedStorageFunction(method, dependencies = {}) {
  if (createHash('sha256').update(method.source).digest('hex') !== method.sha256) throw Error('Storage fixture hash mismatch');
  const alias = method.source.match(/var _0x[\da-f]+=(_0x[\da-f]+)/)[1];
  const strings = new Map(Object.entries(method.strings).map(([key, value]) => [Number(key), value]));
  return Function(...Object.keys(dependencies), alias, `return (${method.source});`)(...Object.values(dependencies), value => {
    if (!strings.has(value)) throw Error('Unexpected public string constant');
    return strings.get(value);
  });
}

export function installObservedStorage(f) {
  f.root.services.Item.itemDao.searchStorageItems = observedStorageFunction(observation.methods[0]);
  f.root.UTHttpRequest.prototype.setUrlVariables = observedStorageFunction(observation.methods[1], {
    HttpUtils: { generateUrlParams: values => `?${new URLSearchParams(values)}` },
  });
  const syntheticDigest = f.root.crypto.subtle.digest;
  const sources = new Set(observation.methods.map(method => method.source));
  f.root.crypto.subtle.digest = (algorithm, bytes) => sources.has(new TextDecoder().decode(bytes).replace(/\r\n/g, '\n'))
    ? webcrypto.subtle.digest(algorithm, bytes) : syntheticDigest(algorithm, bytes);
}
