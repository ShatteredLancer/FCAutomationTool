// Descriptor-only capability discovery. No model getters or reward methods run.
export function inspectGalleryRewardCapabilities(root = globalThis) {
  const own = (object, key) => {
    try { return Object.getOwnPropertyDescriptor(object, key); } catch { return null; }
  };
  const keys = object => {
    try { return Reflect.ownKeys(object).filter(key => typeof key === 'string').slice(0, 10000); }
    catch { return []; }
  };
  const relevant = name => /^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(name)
    && /Gallery|Collection|Collectible|Album|EventToken|Reward/i.test(name);
  const describe = (path, descriptor) => {
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { path, kind: 'accessor', methods: [] };
    const value = descriptor.value;
    if (value == null || !['object', 'function'].includes(typeof value)) return { path, kind: typeof value, methods: [] };
    const methods = [], seen = new Set();
    let layer = typeof value === 'function' ? own(value, 'prototype')?.value : value;
    for (let depth = 0; layer && depth < 4; depth++) {
      for (const name of keys(layer).slice(0, 256)) {
        if (name === 'constructor' || seen.has(name) || !/^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(name)) continue;
        seen.add(name);
        const field = own(layer, name);
        if (typeof field?.value === 'function') methods.push({ name, kind: 'function' });
        else if (field && !Object.hasOwn(field, 'value')) methods.push({ name, kind: 'accessor' });
        if (methods.length >= 64) break;
      }
      if (methods.length >= 64) break;
      try { layer = Object.getPrototypeOf(layer); } catch { break; }
      if (layer === Object.prototype || layer === Function.prototype) break;
    }
    return { path, kind: typeof value, methods };
  };
  const capabilities = [];
  const names = keys(root).filter(relevant).filter(name => !/^HTML/.test(name));
  const priority = name => /Gallery|Album/i.test(name) ? 0 : /Collection|Collectible/i.test(name) ? 1 : 2;
  names.sort((a, b) => priority(a) - priority(b));
  let capped = names.length > 64;
  for (const name of names.slice(0, 64)) capabilities.push(describe(name, own(root, name)));
  for (const namespace of ['services', 'repositories']) {
    const descriptor = own(root, namespace);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) {
      capabilities.push({ path: namespace, kind: 'accessor', methods: [] }); continue;
    }
    const object = descriptor?.value;
    if (!object) continue;
    const children = keys(object).filter(relevant);
    capped ||= children.length > 32;
    for (const name of children.slice(0, 32)) capabilities.push(describe(`${namespace}.${name}`, own(object, name)));
  }
  return { schema: 1, status: 'observed', mode: 'descriptors-only', capabilities, capped,
    claimState: 'unverified', rewardSemantics: 'unverified', liveExecutionEnabled: false };
}
