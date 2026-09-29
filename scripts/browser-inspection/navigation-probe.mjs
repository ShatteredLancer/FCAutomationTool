function safeOwnKeys(value) {
  try { return Reflect.ownKeys(value).filter(key => typeof key === 'string').slice(0, 32); } catch { return []; }
}

function className(value) {
  try { return value?.constructor?.name ?? null; } catch { return null; }
}

function elementSummary(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect?.();
  return {
    tag: element.tagName ?? null,
    id: element.id || null,
    className: typeof element.className === 'string' ? element.className.slice(0, 240) : null,
    text: (element.innerText ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    ariaLabel: element.getAttribute?.('aria-label') ?? null,
    childCount: element.children?.length ?? null,
    visible: !!rect && rect.width > 0 && rect.height > 0,
  };
}

export function inspectFc27Navigation() {
  const w = globalThis;
  const document = w.document;
  const safeOwnKeys = value => {
    try { return Reflect.ownKeys(value).filter(key => typeof key === 'string').slice(0, 32); } catch { return []; }
  };
  const className = value => {
    try { return value?.constructor?.name ?? null; } catch { return null; }
  };
  const elementSummary = element => {
    if (!element) return null;
    const rect = element.getBoundingClientRect?.();
    return {
      tag: element.tagName ?? null,
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 240) : null,
      text: (element.innerText ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
      ariaLabel: element.getAttribute?.('aria-label') ?? null,
      childCount: element.children?.length ?? null,
      visible: !!rect && rect.width > 0 && rect.height > 0,
    };
  };
  const app = w.getAppMain?.() ?? w.W?.getAppMain?.();
  const chain = [];
  let controller = app?.getRootViewController?.() ?? app?._rootViewController;
  const seen = new Set();
  for (let depth = 0; controller && depth < 8 && !seen.has(controller); depth += 1) {
    seen.add(controller);
    const navigationBar = controller.navigationBar ?? controller.getView?.()?.navigationBar ?? null;
    const root = navigationBar?.__root ?? null;
    chain.push({
      depth,
      className: className(controller),
      keys: safeOwnKeys(controller),
      navigationBar: navigationBar ? {
        className: className(navigationBar), keys: safeOwnKeys(navigationBar),
        root: elementSummary(root),
        rootChildren: Array.from(root?.children ?? []).slice(0, 20).map(elementSummary),
        currencies: elementSummary(navigationBar.__currencies),
        rightContainer: elementSummary(navigationBar.rightContainer),
      } : null,
    });
    controller = controller.currentController ?? controller.presentedViewController ?? controller.parentViewController;
  }
  const roots = [...document.querySelectorAll('nav, [class*="navigation"], [class*="navbar"], [class*="nav-bar"]')]
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).slice(0, 30).map(element => ({ ...elementSummary(element), children: [...element.children].slice(0, 18).map(elementSummary) }));
  const buttons = [...document.querySelectorAll('button, a, [role="button"]')]
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).slice(0, 80).map(elementSummary);
  const fcatEntries = [...document.querySelectorAll('[id^="fcat-"], .fcat-navigation-entry')].slice(0, 20).map(element => ({
    ...elementSummary(element), version: element.dataset?.version ?? null,
  }));
  return { chain, roots, buttons, fcatEntries };
}
