import { FC27_STREAMLINED_STORAGE_HASH, FC27_STREAMLINED_STORAGE_QUERY_HASH } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';

export function addStorageRuntime(f, { payload = [], status = 200 } = {}) {
  const { root } = f;
  const state = { payload, status, hold: false, wrongOwner: false };
  root.ItemPile.STORAGE = 8;
  root.repositories.Item.storage = { _collection: {} };
  const search = function() { throw Error('native cache path must not be called'); };
  root.services.Item = { itemDao: { authDelegate: {}, searchStorageItems: search } };
  const query = function(values) { this.urlVariables = `?${new URLSearchParams(values)}`; };
  root.UTHttpRequest.prototype.setUrlVariables = query;
  const originalDigest = root.crypto.subtle.digest;
  root.crypto.subtle.digest = async (algorithm, bytes) => {
    if (new TextDecoder().decode(bytes) === String(search)) return Uint8Array.from(Buffer.from(FC27_STREAMLINED_STORAGE_HASH, 'hex')).buffer;
    if (new TextDecoder().decode(bytes) === String(query)) return Uint8Array.from(Buffer.from(FC27_STREAMLINED_STORAGE_QUERY_HASH, 'hex')).buffer;
    return originalDigest(algorithm, bytes);
  };
  const NativeRequest = root.UTHttpRequest;
  // Preserve reviewed prototype bindings; only intercept the synthetic send.
  const originalSend = NativeRequest.prototype.send;
  const send = function() {
    if (!this.url.endsWith('/storagepile')) return originalSend.call(this);
    f.calls.push({ kind: 'storage', url: this.url + this.urlVariables, method: this.requestType, cache: this.cache,
      retry: this.doRetry, reauth: this.doReauth });
    state.request = this;
    if (!state.hold) this.callback(state.wrongOwner ? {} : this, { success: state.status === 200, status: state.status,
      response: { itemData: state.payload } });
  };
  NativeRequest.prototype.send = send;
  const source = String(send).replace(/\r\n/g, '\n');
  const digest = root.crypto.subtle.digest;
  root.crypto.subtle.digest = (algorithm, bytes) => new TextDecoder().decode(bytes) === source
    ? digest(algorithm, new TextEncoder().encode(String(originalSend).replace(/\r\n/g, '\n'))) : digest(algorithm, bytes);
  const create = root.factories.Item.createItem;
  const createItem = data => ({ ...create.call(root.factories.Item, data),
    ...(data.pile === 8 ? { utasPile: 8 } : {}) });
  root.UTItemEntityFactory.prototype.createItem = createItem;
  const requestDigest = root.crypto.subtle.digest;
  root.crypto.subtle.digest = (algorithm, bytes) => new TextDecoder().decode(bytes) === String(createItem).replace(/\r\n/g, '\n')
    ? requestDigest(algorithm, new TextEncoder().encode(String(create).replace(/\r\n/g, '\n'))) : requestDigest(algorithm, bytes);
  return state;
}
