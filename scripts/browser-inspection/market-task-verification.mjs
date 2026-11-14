import path from 'node:path';
import { openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';

// DOM-only inspection of the nested, closed task view. Never creates/starts a
// task, approves a run, edits settings, or clicks an EA mutation control.
export async function verifyMarketTaskPage(context, page, directory) {
  await openProductionPanel(context, page); await selectPanelTab(context, page, 'trading');
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => {
      const attrs = node.attributes ?? [], index = attrs.indexOf('class');
      if (index >= 0 && attrs[index + 1].split(' ').includes('market-task-manager')) return node;
      for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) { const hit = find(child); if (hit) return hit; }
      return null;
    };
    const host = find(root), shadow = host?.shadowRoots?.find(node => node.shadowRootType === 'closed');
    if (!shadow) throw Error('MARKET_INSPECTION_VIEW_UNAVAILABLE');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'market-inspection' });
    const read = async () => {
      const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function () {
          const text = id => this.getElementById(id)?.textContent ?? null;
          const recover = this.getElementById('market-recover'), rect = recover?.getBoundingClientRect();
          const x = rect ? rect.x+rect.width/2 : 0, y = rect ? rect.y+rect.height/2 : 0, outer = this.host.getRootNode();
          const hit = this.elementFromPoint(x,y), uncovered = (hit === recover || recover?.contains(hit))
            && outer.elementFromPoint(x,y) === this.host && this.ownerDocument.elementFromPoint(x,y) === outer.host;
          return { status: text('toast'), runtime: text('market-runtime-status'), coordination: text('market-coordination-status'),
            sources: [...this.getElementById('source')?.options ?? []].map(o => o.value),
            tasks: this.querySelectorAll('[data-action="start"]').length,
            canStart: this.querySelectorAll('[data-action="start"]:not(:disabled)').length,
            readonlyRecovery: !!recover && !recover.disabled,
            recoverPoint: rect && rect.width > 0 && rect.height > 0 && recover.checkVisibility() && uncovered ? {x,y}:null };
        }` });
      if (result.exceptionDetails) throw Error('MARKET_INSPECTION_READ_FAILED');
      return result.result.value;
    };
    let before;
    for (let i = 0; i < 50; i++) { before = await read(); if (!before.status?.includes('读取本地任务')) break; await page.waitForTimeout(100); }
    if (!before.recoverPoint || !before.readonlyRecovery) return { status: 'unavailable', ui: { ...before, recoverPoint: undefined } };
    await page.mouse.click(before.recoverPoint.x, before.recoverPoint.y);
    let after;
    for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); after = await read(); if (after.runtime !== '核对交易接口' && after.readonlyRecovery && after.status !== before.status) break; }
    await page.screenshot({ path: path.join(directory, 'market-task-readonly.png') });
    return { status: 'observed', before: { ...before, recoverPoint: undefined }, after: { ...after, recoverPoint: undefined },
      taskStarts: 0, settingsWrites: 0, eaMutations: 0 };
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'market-inspection' }).catch(() => {}); await cdp.detach(); }
}
