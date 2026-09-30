// Read-only bridge to EA's own item entity and large-card renderer. The bridge
// never adds the entity to a Repository and never calls an EA service.
const at = (root, path) => path.split('.').reduce((value, key) => value?.[key], root);
const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
const validId = value => Number.isSafeInteger(value) && value > 0;

function cloneCardData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clone = (value, depth = 0) => {
    if (depth > 5) return null;
    if (Array.isArray(value)) return value.slice(0,128).map(item => item && typeof item === 'object' ? clone(item,depth+1) : item);
    if (value && typeof value === 'object') {
      const copy = {};
      for (const [key,item] of Object.entries(value).slice(0,256)) copy[key] = item && typeof item === 'object' ? clone(item,depth+1) : item;
      return copy;
    }
    return value;
  };
  return clone(raw);
}

function validEntity(entity, raw) {
  const definitionId = own(raw, 'resourceId') ?? own(raw, 'definitionId');
  return entity && entity.concept === true && validId(entity.definitionId)
    && entity.definitionId === definitionId && typeof entity.guidAssetId === 'string';
}

export function createFc27GalleryNativeRenderer(root, { document = root?.document } = {}) {
  const render = ({ parent, raw, label = '', onUnavailable = () => {} } = {}) => {
    const factory = at(root, 'factories.Item'), createItem = factory?.createItem;
    const viewFactory = at(root, 'UTItemViewFactory'), createLargeItem = viewFactory?.createLargeItem;
    if (!document || !parent || !raw || raw.itemType !== 'player' || raw.dream !== true
        || typeof createItem !== 'function' || typeof createLargeItem !== 'function') return null;
    let view, wrapper, timer, disposed = false, unavailableReported = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true; clearTimeout(timer);
      try { view?.dealloc?.(); } catch { /* UI only. */ }
      wrapper?.remove();
    };
    try {
      const entity = createItem.call(factory, cloneCardData(raw));
      if (!validEntity(entity, raw)) return null;
      // Enhancer's formItemWithoutConcept applies this only to a display copy.
      // Never publish that copy to inventory or treat it as ownership evidence.
      const display = Object.assign(new root.UTItemEntity(), entity);
      display.concept = false;
      view = createLargeItem.call(viewFactory, display);
      if (!view || typeof view.init !== 'function' || typeof view.render !== 'function'
          || typeof view.getRootElement !== 'function') { dispose(); return null; }
      view.init();
      view.renderRestrictions = true;
      const complete = view.renderComplete;
      const unavailable = () => {
        if (disposed) return;
        dispose();
        if (!unavailableReported) { unavailableReported = true; onUnavailable(); }
      };
      // EA normally retries a failed dynamic portrait with a base portrait,
      // then a silhouette. The user's explicit fallback here is text only.
      // Override this view instance, never EA's shared prototype or cache.
      for (const method of ['onLoadDynamicPortraitError','onLoadAssetError']) {
        const original = view[method];
        view[method] = function (type, ...args) {
          if (disposed) return;
          if (type === (root.ItemAssetType?.MAIN ?? 'main') || type === (root.ItemAssetType?.SHELL ?? 'shell')) unavailable();
          else original?.call(this, type, ...args);
        };
      }
      const loaded = view.onLoadComplete;
      view.onLoadComplete = function (...args) { if (!disposed) loaded?.apply(this, args); };
      view.renderComplete = function (...args) {
        if (disposed) return;
        complete?.apply(this, args);
        clearTimeout(timer);
        // Decorative assets (e.g. rank) may be absent on valid EA cards.
        // The card shell and exact-version player artwork must both exist.
        if (this.assetsLoaded?.get?.('shell') !== true || this.assetsLoaded?.get?.('main') !== true) unavailable();
      };
      const rootElement = view.getRootElement();
      if (!rootElement || rootElement.nodeType !== 1) { dispose(); return null; }
      wrapper = document.createElement('div');
      wrapper.className = 'gallery-native-card';
      wrapper.style.cssText = 'display:block;position:relative;pointer-events:none';
      wrapper.setAttribute('role', 'img');
      wrapper.setAttribute('aria-label', label);
      wrapper.append(rootElement);
      parent.append(wrapper);
      wrapper.__fcatDealloc = dispose;
      timer = setTimeout(unavailable, 15000);
      view.render(display, false);
      if (disposed) return null;
      return wrapper;
    } catch { dispose(); return null; }
  };
  return Object.freeze({ render });
}
