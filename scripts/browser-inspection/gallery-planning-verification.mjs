import { panelCall, waitForPanel, clickPanelControl, selectPanelTab } from './production-panel-inspection.mjs';

// Exercise the installed UI only. No purchase/list/relist/claim control is used.
// Selection and output changes are local planning state, never EA mutations.
export async function verifyGalleryPlanning(context, page, setName, { readGallery } = {}) {
  const report = { status: 'blocked', phase: 'open', executable: false, liveExecutionEnabled: false };
  const openDetail = async () => {
    const read = await readGallery(context, page, setName);
    if (read.status !== 'observed') throw Error(read.reason || 'FC27_GALLERY_SET_UNAVAILABLE');
    const selector = await panelCall(context, page, function (name) {
      const card = [...this.querySelectorAll('#gallery-set-list .gallery-set')].find(row =>
        row.querySelector('h4')?.textContent?.trim()?.toLowerCase() === name.toLowerCase());
      return card ? `[data-set-id="${globalThis.CSS.escape(card.dataset.setId)}"] .gallery-open-set` : null;
    }, [setName]);
    if (!selector) throw Error('FC27_GALLERY_SET_BUTTON_UNAVAILABLE');
    await clickPanelControl(context, page, selector);
    await waitForPanel(context, page, function () {
      return !!this.querySelector('#gallery-set-detail .gallery-plan select');
    }, [], 30000);
  };
  const snapshot = () => panelCall(context, page, function () {
    const root = this.querySelector('#gallery-set-detail');
    return { plan: root?.querySelector('.gallery-plan-output')?.textContent?.slice(0, 12000) ?? '',
      overview: root?.querySelector('.gallery-grade-overview')?.textContent?.slice(0, 4000) ?? '',
      overviewRows: [...(root?.querySelectorAll('.gallery-grade-overview-row') ?? [])]
        .map(row => row.textContent.trim()),
      grade: root?.querySelector('.gallery-plan select')?.value ?? null,
      gradeRows: root?.querySelectorAll('.gallery-grade-overview-row').length ?? 0,
      cards: root?.querySelectorAll('.gallery-card').length ?? 0 };
  });
  const run = async (label, outputClass) => {
    const selector = await panelCall(context, page, function (label) {
      const row = this.querySelector('#gallery-set-detail .gallery-plan .row');
      const button = [...(row?.children ?? [])].find(node => node.tagName === 'BUTTON' && node.textContent === label);
      return button ? `#gallery-set-detail .gallery-plan .row > :nth-child(${[...row.children].indexOf(button) + 1})` : null;
    }, [label]);
    if (!selector) throw Error('FC27_GALLERY_PLAN_CONTROL_UNAVAILABLE');
    await clickPanelControl(context, page, selector);
    await waitForPanel(context, page, function (selector, outputClass) {
      const text = this.querySelector(`#gallery-set-detail .${outputClass}`)?.textContent ?? '';
      return this.querySelector(selector)?.disabled === false && text.length > 0 && !/^正在/.test(text);
    }, [selector, outputClass], 90000);
  };
  try {
    await openDetail();
    report.phase = 'plan';
    const startedAt = Date.now();
    await run('生成方案', 'gallery-plan-output');
    report.planMs = Date.now() - startedAt;
    report.phase = 'overview';
    await run('各档费用', 'gallery-grade-overview');
    report.before = await snapshot();
    report.phase = 'tab-return';
    await selectPanelTab(context, page, 'settings');
    await selectPanelTab(context, page, 'gallery');
    report.categoriesOnly = await panelCall(context, page, function () {
      return this.getElementById('gallery-summary')?.hidden === false
        && this.getElementById('gallery-set-detail')?.hidden === true
        && this.getElementById('gallery-sets')?.hidden === true;
    });
    await openDetail();
    report.after = await snapshot();
    // A retained plan may gain a stale-data note; the original content must remain.
    report.planRetained = !!report.before.plan && report.after.plan.includes(report.before.plan);
    // Compare grade results, not the transient footer: a partial search note
    // can be replaced by a stale-quote note without losing any computed row.
    report.overviewRetained = report.before.overviewRows.length > 0
      && JSON.stringify(report.before.overviewRows) === JSON.stringify(report.after.overviewRows);
    report.status = report.planRetained && report.overviewRetained && report.categoriesOnly ? 'observed' : 'blocked';
    if (report.status === 'blocked') report.reason = 'FC27_GALLERY_PLAN_DISPLAY_NOT_RETAINED';
    report.planningOutcome = /方案 1|当前已达到/.test(report.before.plan) ? 'candidate-or-achieved' : 'no-candidate';
    report.phase = 'complete';
    return report;
  } catch (error) {
    return { ...report, status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')
      ? error.message : 'FC27_GALLERY_PLANNING_VERIFICATION_FAILED' };
  }
}
