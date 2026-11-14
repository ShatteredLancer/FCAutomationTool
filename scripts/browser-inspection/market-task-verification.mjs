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
    // Open a disposable draft solely to exercise the local catalog. Never save
    // it, start it, change account settings, or close an existing user draft.
    const inspectDraft = async () => {
      const value = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function () { return { open: !!this.querySelector('dialog[open]'),
          rows: this.querySelectorAll('#pool .picker-row').length, page: this.getElementById('poolPage')?.textContent,
          summary: this.getElementById('filterCount')?.textContent,
          pending: this.getElementById('pool')?.textContent?.includes('正在查找') }; }` });
      if (value.exceptionDetails) throw Error('MARKET_INSPECTION_READ_FAILED'); return value.result.value;
    };
    const clickDraft = async selector => {
      const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        arguments: [{ value: selector }], functionDeclaration: `function (selector) {
          const node = this.querySelector(selector); if (!node || node.disabled || !node.checkVisibility()) return null;
          node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
          const outer=this.host.getRootNode(), hit=this.elementFromPoint(x,y);
          if (!(hit===node || node.contains(hit)) || outer.elementFromPoint(x,y)!==this.host
            || this.ownerDocument.elementFromPoint(x,y)!==outer.host) return null;
          return {x,y};
        }` });
      if (result.exceptionDetails || !result.result.value) return false;
      await page.mouse.click(result.result.value.x, result.result.value.y); return true;
    };
    let catalogPreview = { status: 'skipped-existing-dialog' };
    if (!(await inspectDraft()).open && await clickDraft('#newTask')) {
      try {
        if (await clickDraft('[data-mode="filter"]') && await clickDraft('#previewPool')) {
          let draft;
          for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); draft = await inspectDraft(); if (!draft.pending) break; }
          catalogPreview = { status: 'observed', rows: draft.rows, page: draft.page, summary: draft.summary };
        } else catalogPreview = { status: 'control-unavailable' };
      } finally { await clickDraft('[data-close="editor"]'); }
    }
    await page.screenshot({ path: path.join(directory, 'market-task-readonly.png') });
    return { status: 'observed', before: { ...before, recoverPoint: undefined }, after: { ...after, recoverPoint: undefined },
      catalogPreview, taskStarts: 0, taskSaves: 0, settingsWrites: 0, eaMutations: 0 };
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'market-inspection' }).catch(() => {}); await cdp.detach(); }
}
