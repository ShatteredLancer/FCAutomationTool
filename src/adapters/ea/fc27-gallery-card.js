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

function sourceDefinitionId(source) {
  return own(source, 'resourceId') ?? own(source, 'definitionId');
}

function isNativeEntity(root, source) {
  const Entity = root?.UTItemEntity;
  return typeof Entity === 'function' && source instanceof Entity;
}

function validEntity(entity, source, native, ownedDisplay) {
  const definitionId = sourceDefinitionId(source);
  const player = typeof entity?.isPlayer === 'function' && entity.isPlayer();
  return entity && validId(entity.definitionId) && validId(definitionId)
    && entity.definitionId === definitionId && player
    && (ownedDisplay ? native && entity.concept === false : entity.concept === true && (native || source?.dream === true))
    && (own(source, 'resourceId') == null || own(source, 'resourceId') === definitionId)
    && (own(source, 'definitionId') == null || own(source, 'definitionId') === definitionId);
}

export function createFc27GalleryNativeRenderer(root, { document = root?.document, diagnosticLog } = {}) {
  const reported = new Set();
  const record = (phase, reason, status = 'failed') => {
    const key = `${phase}:${reason ?? status}`;
    if (reported.has(key)) return;
    reported.add(key);
    try { Promise.resolve(diagnosticLog?.record?.({ area:'gallery', event:'card-render', source:'ea', phase, status, ...(reason ? { reason } : {}) })).catch(() => {}); }
    catch { /* Diagnostics never affect rendering. No card/account data. */ }
  };
  const render = ({ parent, raw, label = '', slot = '', onUnavailable = () => {} } = {}, ownedDisplay = false) => {
    const viewFactory = at(root, 'UTItemViewFactory');
    const createView = ownedDisplay ? viewFactory?.createSmallItem : viewFactory?.createLargeItem;
    const native = isNativeEntity(root, raw);
    const phase = native ? 'native-entity' : 'cached-dto';
    if (!document || !parent || !raw || (!native && (raw.itemType !== 'player' || raw.dream !== true))
        || typeof root?.UTItemEntity !== 'function' || typeof createView !== 'function') {
      record(phase, 'FC27_GALLERY_CARD_INPUT_UNAVAILABLE'); return null;
    }
    let view, wrapper, timer, disposed = false, unavailableReported = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true; clearTimeout(timer);
      try { view?.dealloc?.(); } catch { /* UI only. */ }
      wrapper?.remove();
    };
    try {
      // Enhancer's Gallery path receives a complete UTItemEntity from
      // searchConceptItems and shallow-copies it for display. Cached rows are
      // bounded network DTOs, so rebuild those through EA's own factory first;
      // this preserves the constructor's private rarity/cosmetic fields.
      let entity = raw;
      if (!native) {
        const createItem = at(root, 'factories.Item.createItem');
        if (typeof createItem !== 'function') { record(phase, 'FC27_GALLERY_CARD_FACTORY_UNAVAILABLE'); return null; }
        entity = createItem.call(root.factories.Item, cloneCardData(raw));
      }
      if (!validEntity(entity, raw, native, ownedDisplay)) { record(phase, 'FC27_GALLERY_CARD_ENTITY_UNVERIFIED'); return null; }
      const display = Object.assign(new root.UTItemEntity(), entity);
      // Enhancer's formItemWithoutConcept applies this only to a display copy.
      // Never publish that copy to inventory or treat it as ownership evidence.
      display.concept = false;
      view = createView.call(viewFactory, display);
      if (!view || typeof view.init !== 'function' || typeof view.render !== 'function'
          || typeof view.getRootElement !== 'function') { record(phase, 'FC27_GALLERY_CARD_VIEW_UNAVAILABLE'); dispose(); return null; }
      view.init();
      view.renderRestrictions = true;
      const complete = view.renderComplete;
      const unavailable = (reason = 'FC27_GALLERY_CARD_ARTWORK_TIMEOUT') => {
        if (disposed) return;
        record(phase, reason);
        dispose();
        if (!unavailableReported) { unavailableReported = true; onUnavailable(); }
      };
      // Enhancer does not replace EA's asset error handlers.  EA's player view
      // deliberately retries a failed special portrait with the database
      // portrait, and retries a failed shell with the local shell.  Replacing
      // either callback here destroys Hero/Holographics before that fallback
      // chain can finish. Keep the native callbacks untouched; fall back to
      // text only after EA finishes with missing artwork or stops completing.
      const loaded = view.onLoadComplete;
      view.onLoadComplete = function (...args) { if (!disposed) loaded?.apply(this, args); };
      view.renderComplete = function (...args) {
        if (disposed) return;
        complete?.apply(this, args);
        // EA marks a terminal asset failure false, after its retries finish.
        // Other renderComplete callers may run before resources settle: absent
        // keys are pending, not failures. Optional rank/foil failures are not
        // reasons to discard an otherwise complete card.
        const main = this.assetsLoaded?.get?.(root.ItemAssetType?.MAIN ?? 'main');
        const shell = this.assetsLoaded?.get?.(root.ItemAssetType?.SHELL ?? 'shell');
        // Hero/Holographics can expose a false asset state while EA's own
        // portrait/shell error handler schedules its fallback. Keep the
        // native view alive during that retry; the bounded timeout below is
        // the fallback for a genuinely stalled card.
        if (main === false || shell === false) return;
        if (main !== true || shell !== true) return;
        clearTimeout(timer);
        record(phase, null, 'success');
      };
      const rootElement = view.getRootElement();
      if (!rootElement || rootElement.nodeType !== 1) { record(phase, 'FC27_GALLERY_CARD_VIEW_UNAVAILABLE'); dispose(); return null; }
      wrapper = document.createElement('div');
      wrapper.className = 'gallery-native-card';
      // Slot assignment must happen before insertion. EA's global card CSS
      // and the shadow host resolve the slot during append, so assigning it
      // afterwards creates an intermittent blank/un-styled special card.
      if (slot) wrapper.slot = String(slot);
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
    } catch { record(phase, 'FC27_GALLERY_CARD_RENDER_FAILED'); dispose(); return null; }
  };
  return Object.freeze({ render: options => render(options), renderOwned: options => render(options, true) });
}
