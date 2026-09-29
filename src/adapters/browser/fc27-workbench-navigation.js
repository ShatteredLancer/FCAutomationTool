// Native EA Tab/Flow/View lifecycle, as observed in Enhancer's sidebar.
// The late-load DOM fallback is confined to the actual tab bar, never the
// currency header or the page content container.
const NAV_SELECTORS = Object.freeze(['.ut-tab-bar']);

const TAB_PATCH = Symbol.for('fcat.fc27.tab-bar-patch');
const TAB_OWNER = Symbol.for('fcat.fc27.workbench-tab');

function inherits(runtime, child, parent) {
  if (typeof runtime?.JSUtils?.inherits === 'function') {
    runtime.JSUtils.inherits(child, parent);
    return;
  }
  child.prototype = Object.create(parent.prototype);
  child.prototype.constructor = child;
}

function createNativeTab(runtime, onOpen) {
  const TabItem = runtime?.UTTabBarItemView;
  const Flow = runtime?.UTGameFlowNavigationController;
  const ViewController = runtime?.EAViewController;
  const View = runtime?.EAView;
  if (!TabItem || !Flow || !ViewController || !View
      || !runtime?.UTGameTabBarController?.prototype?.initWithViewControllers) return null;
  try {
    function WorkbenchView() { View.call(this); }
    inherits(runtime, WorkbenchView, View);
    WorkbenchView.prototype._generate = function _generate() {
      if (this.__root) return this.__root;
      const element = runtime.document.createElement('div');
      element.className = 'ut-market-search-filters-view floating fcat-navigation-workbench';
      element.style.cssText = 'height:100%;overflow:auto';
      this.__root = element;
      this._generated = true;
      return element;
    };
    WorkbenchView.prototype.getRootElement = function getRootElement() { return this.__root ?? this._generate(); };

    function WorkbenchController() { ViewController.call(this); }
    inherits(runtime, WorkbenchController, ViewController);
    WorkbenchController.prototype._getViewInstanceFromData = function _getViewInstanceFromData() { return new WorkbenchView(); };
    WorkbenchController.prototype.getNavigationTitle = function getNavigationTitle() { return 'FC Automation Tool'; };
    WorkbenchController.prototype.viewDidAppear = function viewDidAppear(...args) {
      this.getNavigationController?.().setNavigationVisibility?.(true, true);
      onOpen?.(this.getView().getRootElement());
      return ViewController.prototype.viewDidAppear?.call(this, ...args);
    };

    const createController = existing => {
      const item = new TabItem();
      item.init?.();
      const tags = (existing ?? []).map(value => value?.tabBarItem?.getTag?.()).filter(Number.isFinite);
      item.setTag?.(Math.max(19, ...tags) + 1);
      item.setText?.('FCAT');
      item.addClass?.('icon-transfer');
      item.addClass?.('fcat-navigation-entry');
      const controller = new Flow();
      controller.initWithRootController?.(new WorkbenchController());
      controller.tabBarItem = item;
      controller[TAB_OWNER] = true;
      return controller;
    };
    const prototype = runtime.UTGameTabBarController.prototype;
    if (!prototype[TAB_PATCH]) {
      const original = prototype.initWithViewControllers;
      if (typeof original !== 'function') return null;
      const patched = function initWithViewControllers(viewControllers, ...args) {
        const list = Array.isArray(viewControllers) ? viewControllers : [];
        if (prototype[TAB_PATCH]?.active && !list.some(value => value?.[TAB_OWNER])) list.push(createController(list));
        return original.call(this, list, ...args);
      };
      Object.defineProperty(prototype, TAB_PATCH, { value: { original, patched, active: true }, configurable: true });
      prototype.initWithViewControllers = patched;
    }
    return { createController };
  } catch {
    return null;
  }
}

export function mountFc27WorkbenchNavigation({ document, runtime, onOpen, observe = true } = {}) {
  if (!document?.body || typeof onOpen !== 'function') return () => {};
  let disposed = false;
  let button = null;
  let native = createNativeTab(runtime, onOpen);
  const attach = () => {
    if (disposed) return;
    native ??= createNativeTab(runtime, onOpen);
    const root = document.querySelector?.('.ut-tab-bar');
    if (!root) return;
    const nativeEntry = [...(root.querySelectorAll?.('.fcat-navigation-entry') ?? [root.querySelector?.('.fcat-navigation-entry')])]
      .find(entry => entry && entry !== button);
    if (nativeEntry && nativeEntry !== button) { button?.remove?.(); button = null; return; }
    const existing = document.querySelector?.('#fcat-fc27-navigation-entry')
      ?? root.querySelector?.('#fcat-fc27-navigation-entry');
    if (existing) { button = existing; return; }
    button = document.createElement('button');
    button.id = 'fcat-fc27-navigation-entry';
    button.type = 'button';
    button.className = 'ut-tab-bar-item fcat-navigation-entry';
    button.setAttribute('aria-label', 'FC Automation Tool');
    button.title = 'FC Automation Tool';
    button.innerHTML = '<span aria-hidden="true" class="fcat-navigation-glyph">FC</span><span class="fcat-navigation-label">FCAT</span>';
    button.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:64px;min-height:48px;border:0;border-radius:0;background:transparent;color:inherit;font:600 11px/1 Arial,sans-serif;cursor:pointer;z-index:2';
    button.querySelector?.('.fcat-navigation-glyph')?.setAttribute('style', 'display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#2b7a61;color:#fff;font-size:10px;font-weight:700');
    button.querySelector?.('.fcat-navigation-label')?.setAttribute('style', 'font-size:11px;line-height:14px;white-space:nowrap');
    button.addEventListener('click', event => { if (event.isTrusted) onOpen(); });
    root.append(button);
  };
  attach();
  const Observer = document.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  const observer = observe && typeof Observer === 'function' ? new Observer(attach) : null;
  observer?.observe(document.body, { childList: true, subtree: true });
  return () => {
    disposed = true;
    observer?.disconnect();
    button?.remove?.();
    button = null;
    const patch = runtime?.UTGameTabBarController?.prototype?.[TAB_PATCH];
    if (patch?.patched) {
      patch.active = false;
      // Do not erase another plugin's wrapper installed after ours.
      if (runtime.UTGameTabBarController.prototype.initWithViewControllers === patch.patched) {
        runtime.UTGameTabBarController.prototype.initWithViewControllers = patch.original;
        delete runtime.UTGameTabBarController.prototype[TAB_PATCH];
      }
    }
  };
}

export { NAV_SELECTORS };
