import { expect, it, vi } from 'vitest';
import { mountFc27WorkbenchNavigation, NAV_SELECTORS } from '../../src/adapters/browser/fc27-workbench-navigation.js';

class Node {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.listeners = new Map(); this.id = ''; this.style = {}; }
  append(child) { child.parentNode = this; this.children.push(child); }
  before(child) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    child.parentNode = this.parentNode;
    this.parentNode.children.splice(index, 0, child);
  }
  remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null; }
  querySelector(selector) {
    if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
    if (selector.startsWith('.') && String(this.className || '').split(/\s+/).includes(selector.slice(1))) return this;
    for (const child of this.children) { const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.querySelector(selector) === child ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ isTrusted: false, ...event }); }
  setAttribute() {}
}

function documentFixture() {
  const body = new Node('body'); const nav = new Node('nav'); nav.className = 'ut-tab-bar'; body.append(nav);
  return { body, nav, createElement: tag => new Node(tag), querySelector: selector => body.querySelector(selector), defaultView: {} };
}

it('mounts one FCAT left-navigation entry and opens only for trusted clicks', () => {
  const document = documentFixture(); const onOpen = vi.fn();
  const dispose = mountFc27WorkbenchNavigation({ document, onOpen, observe: false });
  const button = document.nav.querySelector('#fcat-fc27-navigation-entry');
  expect(button).toBeTruthy();
  button.dispatch('click'); button.dispatch('click', { isTrusted: true });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(document.nav.children.filter(item => item.id === 'fcat-fc27-navigation-entry')).toHaveLength(1);
  dispose(); expect(document.nav.querySelector('#fcat-fc27-navigation-entry')).toBeNull();
});

it('keeps the navigation selector order stable for EA DOM rebuilds', () => {
  expect(NAV_SELECTORS[0]).toBe('.ut-tab-bar');
  expect(NAV_SELECTORS).toEqual(['.ut-tab-bar', '.ut-navigation-container-view--content']);
});

it('prefers the visible EA tab bar over the currency header', () => {
  const document = documentFixture();
  const tabBar = document.nav;
  const header = new Node('div'); header.className = 'ut-navigation-bar-view'; document.body.append(header);
  const dispose = mountFc27WorkbenchNavigation({ document, onOpen: vi.fn(), observe: false });
  expect(tabBar.querySelector('#fcat-fc27-navigation-entry')).toBeTruthy();
  expect(header.querySelector('#fcat-fc27-navigation-entry')).toBeNull();
  dispose();
});

it('appends FCAT after existing items, following Enhancer navigation order', () => {
  const document = documentFixture();
  const settings = new Node('button'); settings.className = 'icon-settings'; document.nav.append(settings);
  const dispose = mountFc27WorkbenchNavigation({ document, onOpen: vi.fn(), observe: false });
  expect(document.nav.children.map(item => item.id || item.className)).toEqual([
    'icon-settings', 'fcat-fc27-navigation-entry',
  ]);
  dispose();
});

it('mounts into an Enhancer-wrapped visible navigation root when native tab bar is absent', () => {
  const document = documentFixture();
  document.nav.remove();
  const sidebar = new Node('aside'); sidebar.className = 'ut-navigation-container-view--content';
  document.body.append(sidebar);
  const dispose = mountFc27WorkbenchNavigation({ document, onOpen: vi.fn(), observe: false });
  expect(sidebar.querySelector('#fcat-fc27-navigation-entry')).toBeTruthy();
  expect(document.body.querySelector('#fcat-fc27-navigation-entry')).toBeTruthy();
  dispose();
});

it('never inserts into currency headers or content when the tab bar is absent', () => {
  const document = documentFixture();
  document.nav.className = 'ut-navigation-bar-view';
  const eaNav = new Node('nav'); eaNav.className = 'ea-navigation-root';
  const runtime = { getAppMain: () => ({ getRootViewController: () => ({
    currentController: { parentViewController: { navigationBar: { __root: eaNav } } },
  }) }) };
  const onOpen = vi.fn();
  const dispose = mountFc27WorkbenchNavigation({ document, runtime, onOpen, observe: false });
  expect(eaNav.querySelector('#fcat-fc27-navigation-entry')).toBeNull();
  expect(document.nav.querySelector('#fcat-fc27-navigation-entry')).toBeNull();
  dispose();
});

function nativeFixture(document) {
  function TabItem() { this.root = new Node('button'); this.root.className = 'ut-tab-bar-item'; }
  TabItem.prototype.init = vi.fn();
  TabItem.prototype.setTag = function (tag) { this.tag = tag; };
  TabItem.prototype.getTag = function () { return this.tag; };
  TabItem.prototype.setText = function (text) { this.text = text; };
  TabItem.prototype.getText = function () { return this.text; };
  TabItem.prototype.addClass = function (name) { this.root.className += ` ${name}`; };
  function Flow() {}
  Flow.prototype.initWithRootController = function (controller) { this.rootController = controller; controller.navigation = this; };
  Flow.prototype.setNavigationVisibility = vi.fn();
  function Controller() {}
  Controller.prototype.getView = function () { return this.view ??= this._getViewInstanceFromData(); };
  Controller.prototype.getNavigationController = function () { return this.navigation; };
  function View() {}
  function TabBar() {}
  TabBar.prototype.initWithViewControllers = vi.fn(function (controllers) { this.controllers = controllers; return 'native-result'; });
  return { document, UTTabBarItemView: TabItem, UTGameFlowNavigationController: Flow,
    EAViewController: Controller, EAView: View, UTGameTabBarController: TabBar };
}

it('uses native Tab/Flow/View lifecycle and opens within the EA view on every visit', () => {
  const document = documentFixture(); const runtime = nativeFixture(document); const onOpen = vi.fn();
  const dispose = mountFc27WorkbenchNavigation({ document, runtime, onOpen, observe: false });
  const bar = new runtime.UTGameTabBarController();
  const other = { tabBarItem: { getTag: () => 20, getText: () => 'Other plugin' } };
  const controllers = [other];
  expect(bar.initWithViewControllers(controllers)).toBe('native-result');
  expect(controllers).toHaveLength(2);
  const flow = controllers[1];
  expect(flow.tabBarItem.getTag()).toBe(21);
  expect(flow.tabBarItem.getText()).toBe('FCAT');
  expect(onOpen).not.toHaveBeenCalled();
  flow.rootController.viewDidAppear();
  const root = flow.rootController.getView().getRootElement();
  expect(onOpen).toHaveBeenCalledWith(root);
  expect(root.className).toBe('ut-market-search-filters-view floating fcat-navigation-workbench');
  flow.rootController.viewDidAppear();
  expect(onOpen).toHaveBeenCalledTimes(2);
  bar.initWithViewControllers(controllers);
  expect(controllers).toHaveLength(2);
  dispose();
});

it('restores the hook on disposal and supports remounting', () => {
  const document = documentFixture(); const runtime = nativeFixture(document);
  const proto = runtime.UTGameTabBarController.prototype; const original = proto.initWithViewControllers;
  const dispose = mountFc27WorkbenchNavigation({ document, runtime, onOpen: vi.fn(), observe: false });
  expect(proto.initWithViewControllers).not.toBe(original);
  dispose(); expect(proto.initWithViewControllers).toBe(original);
  const disposeAgain = mountFc27WorkbenchNavigation({ document, runtime, onOpen: vi.fn(), observe: false });
  const controllers = []; new runtime.UTGameTabBarController().initWithViewControllers(controllers);
  expect(controllers).toHaveLength(1);
  disposeAgain();
});

it('does not remove a later plugin hook during disposal', () => {
  const document = documentFixture(); const runtime = nativeFixture(document);
  const proto = runtime.UTGameTabBarController.prototype;
  const dispose = mountFc27WorkbenchNavigation({ document, runtime, onOpen: vi.fn(), observe: false });
  const ours = proto.initWithViewControllers;
  const later = function (...args) { return ours.apply(this, args); }; proto.initWithViewControllers = later;
  dispose(); expect(proto.initWithViewControllers).toBe(later);
  const list = []; new runtime.UTGameTabBarController().initWithViewControllers(list);
  expect(list).toHaveLength(0);
});

it('reattaches after a tab bar rebuild and replaces the fallback when a native item appears', () => {
  const document = documentFixture(); let update;
  document.defaultView.MutationObserver = class { constructor(callback) { update = callback; } observe() {} disconnect() {} };
  const dispose = mountFc27WorkbenchNavigation({ document, onOpen: vi.fn() });
  document.nav.remove(); document.nav = new Node('nav'); document.nav.className = 'ut-tab-bar'; document.body.append(document.nav);
  update(); update();
  expect(document.nav.children).toHaveLength(1);
  const native = new Node('button'); native.className = 'fcat-navigation-entry';
  document.nav.children.unshift(native); native.parentNode = document.nav;
  update();
  expect(document.nav.children).toEqual([native]);
  dispose();
});
