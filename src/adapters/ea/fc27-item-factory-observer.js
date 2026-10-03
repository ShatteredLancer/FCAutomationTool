// Private sandbox registry: only wrappers constructed here can be unwrapped.
// Never trust an `original` property supplied by the page or another plugin.
const originals = new WeakMap();

export function observeFc27ItemFactory(original, observe) {
  const wrapped = function(raw) {
    const item = original.apply(this, arguments);
    try { observe(item, raw); } catch { /* Passive observation cannot break EA. */ }
    return item;
  };
  originals.set(wrapped, original);
  return wrapped;
}

export function unwrapFc27ItemFactory(fn) {
  for (let depth = 0; depth < 8 && originals.has(fn); depth++) fn = originals.get(fn);
  return fn;
}
