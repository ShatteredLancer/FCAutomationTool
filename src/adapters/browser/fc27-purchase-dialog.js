// One presentation contract for Gallery and native SBC purchases. No EA calls.
export const purchaseDialogStyles = `
dialog.fcat-purchase-dialog{position:fixed;inset:0;margin:auto;width:680px;min-width:0;max-width:calc(100vw - 24px);height:fit-content;max-height:85vh;box-sizing:border-box;padding:16px;border:1px solid #617781;border-radius:10px;background:#22323d;color:#edf1f4;font:14px/1.5 Arial,sans-serif;text-align:left;overflow:hidden}
dialog.fcat-purchase-dialog[open]{display:flex;flex-direction:column;gap:10px}
dialog.fcat-purchase-dialog::backdrop{background:#0009}
.fcat-purchase-dialog [hidden]{display:none!important}
.fcat-purchase-dialog .purchase-dialog-header{display:flex;align-items:center;gap:12px;flex:0 0 auto;margin:0;padding:0}
.fcat-purchase-dialog .purchase-dialog-header>strong{flex:1;min-width:0;font:600 16px/1.5 Arial,sans-serif}
.fcat-purchase-dialog .purchase-dialog-header>button{position:static;float:none;display:block;width:auto;height:36px;min-height:36px;flex:0 0 auto;margin:0;padding:6px 12px;box-sizing:border-box;border:1px solid #617781;border-radius:5px;background:#202d36;color:#edf1f4;font:14px/1.5 Arial,sans-serif;cursor:pointer}
.fcat-purchase-dialog .purchase-dialog-header>button:disabled{opacity:.5;cursor:default}
.fcat-purchase-dialog .purchase-dialog-progress{display:block;flex:0 0 auto;width:100%;height:8px;margin:0;appearance:none;border:0;border-radius:4px;overflow:hidden;background:#46545d;accent-color:#9df3d5}
.fcat-purchase-dialog .purchase-dialog-progress::-webkit-progress-bar{background:#46545d}
.fcat-purchase-dialog .purchase-dialog-progress::-webkit-progress-value{background:#9df3d5}
.fcat-purchase-dialog .purchase-dialog-progress::-moz-progress-bar{background:#9df3d5}
.fcat-purchase-dialog .purchase-dialog-message{display:block;flex:0 0 auto;margin:0;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere}
.fcat-purchase-dialog .purchase-dialog-results{display:block;min-height:0;margin:0;padding:0;overflow:auto;overscroll-behavior:contain;list-style:none}
`;

export function purchaseDialogMarkup(kind) {
  const prefix = kind === 'gallery' ? 'gallery-purchase' : 'fcat-puzzle-purchase';
  const title = kind === 'gallery' ? 'Gallery 购买' : 'SBC 购买';
  return `<dialog id="${prefix}-dialog" class="fcat-purchase-dialog" aria-label="${title}">
    <div class="purchase-dialog-header"><strong>${title}</strong><button id="${prefix}-stop" type="button">停止购买</button><button id="${prefix}-close" type="button" hidden>关闭</button></div>
    <progress id="${prefix}-progress" class="purchase-dialog-progress" aria-label="购买处理进度" max="1" value="0"></progress>
    <output id="${prefix}-message" class="purchase-dialog-message" role="status"></output>
    <div id="${prefix}-results" class="purchase-dialog-results" aria-label="购买卡列表"></div>
  </dialog>`;
}

export function updatePurchaseDialogProgress(dialog, value) {
  const progress = dialog.querySelector('.purchase-dialog-progress');
  const rows = value?.results ?? [];
  const total = value?.total ?? rows.length;
  // A purchase receipt alone is not completed: moving/reconciliation still runs.
  const completed = Number.isFinite(value?.completed) ? value.completed : rows.filter(row => ['club', 'unassigned', 'collected'].includes(row.state)
    || row.state === 'waiting' && row.attempt?.failed).length;
  progress.max = Number.isFinite(total) && total > 0 ? total : 1;
  progress.value = Number.isFinite(completed) ? Math.max(0, Math.min(progress.max, completed)) : 0;
}
