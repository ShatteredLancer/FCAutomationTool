import { panelCall, waitForPanel, clickPanelControl, selectPanelTab } from './production-panel-inspection.mjs';
import { writeFile } from 'node:fs/promises';

// Capture the already-sanitized export without opening a download tab. This
// avoids disturbing the dedicated EA session while collecting a replay.
async function capturePlanningDiagnostics(context, page) {
  await selectPanelTab(context, page, 'settings');
  await page.evaluate(() => {
    globalThis.__fcatInspectionExport = null;
    const documentObject = globalThis.document;
    const blobs = new Map(), original = globalThis.URL.createObjectURL;
    const captureBlob = function (blob) {
      const url = original.call(this, blob);
      if (blob.type?.startsWith('application/json')) blobs.set(url, blob);
      while (blobs.size > 4) blobs.delete(blobs.keys().next().value);
      return url;
    };
    globalThis.URL.createObjectURL = captureBlob;
    globalThis.__fcatInspectionExportRestore = () => {
      if (globalThis.URL.createObjectURL === captureBlob) globalThis.URL.createObjectURL = original;
    };
    const capture = event => {
      const anchor = event.target?.closest?.('a[download]');
      if (!anchor?.download?.startsWith('FCAutomationTool-FC27-diagnostics-') || !anchor.href.startsWith('blob:')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      documentObject.removeEventListener('click', capture, true);
      globalThis.__fcatInspectionExport = blobs.get(anchor.href)?.text() ?? Promise.resolve(null);
    };
    globalThis.__fcatInspectionExportCapture = capture;
    documentObject.addEventListener('click', capture, true);
  });
  try {
    await clickPanelControl(context, page, '#export-diagnostics');
    await page.waitForFunction(() => globalThis.__fcatInspectionExport != null, {}, { timeout: 10000 });
    const content = await page.evaluate(() => globalThis.__fcatInspectionExport);
    if (typeof content !== 'string') throw Error('FC27_INSPECTION_EXPORT_BLOB_UNAVAILABLE');
    const path = `artifacts/fc27-browser/gallery-planning-diagnostics-${Date.now()}.json`;
    await writeFile(path, content);
    return path;
  } finally {
    await page.evaluate(() => {
      globalThis.document?.removeEventListener('click', globalThis.__fcatInspectionExportCapture, true);
      globalThis.__fcatInspectionExportRestore?.(); delete globalThis.__fcatInspectionExportRestore;
      delete globalThis.__fcatInspectionExportCapture; delete globalThis.__fcatInspectionExport;
    });
  }
}

// Exercise the installed UI only. No purchase/list/relist/claim control is used.
// Selection and output changes are local planning state, never EA mutations.
export async function verifyGalleryPlanning(context, page, setName,
  { readGallery, targetGrade = null, planOnly = false, timeoutSettings = null } = {}) {
  const report = { status: 'blocked', phase: 'open', executable: false, liveExecutionEnabled: false };
  let settingState = null;
  const sameAccount = () => page.evaluate(() => {
    const service = globalThis.services?.User;
    const user = service?.repository?._collection?.[service.currentUserId];
    return globalThis.__fcatInspectionPlanningAccount === JSON.stringify([service?.currentUserId, user?.selectedPersona]);
  });
  const setPlanningSeconds = async seconds => {
    if (!await sameAccount()) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
    const point = await panelCall(context, page, function () {
      const input = this.querySelector('#gallery-planning-settings input');
      if (!input || input.disabled || !input.checkVisibility()) return null;
      input.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    });
    if (!point) throw Error('FC27_GALLERY_PLANNING_SETTINGS_UNAVAILABLE');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(seconds));
    if (!await sameAccount()) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
    await clickPanelControl(context, page, '#gallery-planning-settings button');
    await waitForPanel(context, page, function (value) {
      const input = this.querySelector('#gallery-planning-settings input');
      const output = this.querySelector('#gallery-planning-settings output')?.textContent ?? '';
      return input?.value === String(value) && output.includes('已保存') ? true : null;
    }, [String(seconds)], 10000);
  };
  const prepareTimeoutSetting = async () => {
    if (!Number.isSafeInteger(timeoutSettings)) return;
    await selectPanelTab(context, page, 'settings');
    const current = await waitForPanel(context, page, function () {
      const input = this.querySelector('#gallery-planning-settings input');
      return input && !input.disabled && input.value ? Number(input.value) : null;
    }, [], 10000);
    if (!Number.isSafeInteger(current)) throw Error('FC27_GALLERY_PLANNING_SETTINGS_UNAVAILABLE');
    const identityReady = await page.evaluate(() => {
      const service = globalThis.services?.User;
      const user = service?.repository?._collection?.[service.currentUserId];
      if (!service?.currentUserId || !user?.selectedPersona) return false;
      globalThis.__fcatInspectionPlanningAccount = JSON.stringify([service.currentUserId, user.selectedPersona]);
      return true;
    });
    if (!identityReady) throw Error('FC27_CONTEXT_UNAVAILABLE');
    settingState = { original: current, changed: current !== timeoutSettings };
    report.timeoutSettings = { originalSeconds: current, requestedSeconds: timeoutSettings };
    if (settingState.changed) await setPlanningSeconds(timeoutSettings);
    await selectPanelTab(context, page, 'gallery');
    await selectPanelTab(context, page, 'settings');
    const retained = await waitForPanel(context, page, function () {
      const input = this.querySelector('#gallery-planning-settings input');
      return input && !input.disabled && input.value ? input.value : null;
    }, [], 10000);
    report.timeoutSettings.savedSeconds = Number(retained);
    report.timeoutSettings.saved = retained === String(timeoutSettings);
    if (!report.timeoutSettings.saved) throw Error('FC27_GALLERY_PLANNING_SETTINGS_NOT_RETAINED');
    await selectPanelTab(context, page, 'gallery');
  };
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
    for (let attempt = 0; attempt < 2; attempt++) {
      await clickPanelControl(context, page, selector);
      await page.waitForTimeout(250);
      const outcome = await waitForPanel(context, page, function (selector, outputClass) {
        const text = this.querySelector(`#gallery-set-detail .${outputClass}`)?.textContent ?? '';
        if (this.querySelector(selector)?.disabled !== false || /^正在/.test(text)) return null;
        return text.length ? 'result' : 'idle';
      }, [selector, outputClass], outputClass === 'gallery-grade-overview'
        ? (timeoutSettings ?? 300) * 1000 * 5 + 30000 : (timeoutSettings ?? 300) * 1000 + 30000);
      if (outcome === 'result') return;
      // A background DOM replacement can cancel a read-only plan before it
      // starts. Retry only after the visible control has returned to idle.
    }
    throw Error('FC27_GALLERY_PLAN_CANCELLED_BY_REFRESH');
  };
  try {
    await prepareTimeoutSetting();
    await openDetail();
    if (targetGrade) await panelCall(context, page, function (grade) {
      const select = this.querySelector('#gallery-set-detail .gallery-plan select');
      select.value = grade;
      if (select.value !== grade) throw Error('FC27_GALLERY_GRADE_UNAVAILABLE');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, [targetGrade]);
    report.phase = 'plan';
    const startedAt = Date.now();
    await run('生成方案', 'gallery-plan-output');
    report.planMs = Date.now() - startedAt;
    if (planOnly) {
      report.before = await snapshot();
      report.phase = 'diagnostics';
      try { report.diagnosticsPath = await capturePlanningDiagnostics(context, page); }
      catch (error) { report.diagnosticsReason = /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')
        ? error.message : 'FC27_INSPECTION_DIAGNOSTICS_UNAVAILABLE'; }
      Object.assign(report, { status: 'observed', phase: 'complete' });
      return report;
    }
    report.phase = 'overview';
    const overviewStartedAt = Date.now();
    await run('各档费用', 'gallery-grade-overview');
    report.overviewMs = Date.now() - overviewStartedAt;
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
    const after = await Promise.resolve().then(snapshot).catch(() => null);
    Object.assign(report, { after, status: 'blocked', inspectionError: error?.name, reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')
      ? error.message : 'FC27_GALLERY_PLANNING_VERIFICATION_FAILED' });
    return report;
  } finally {
    if (settingState?.changed) {
      try {
        await selectPanelTab(context, page, 'settings');
        await setPlanningSeconds(settingState.original);
        const restored = await panelCall(context, page, function () {
          return this.querySelector('#gallery-planning-settings input')?.value ?? null;
        });
        report.timeoutSettings.restoredSeconds = Number(restored);
        report.timeoutSettings.restored = restored === String(settingState.original);
        if (!report.timeoutSettings.restored) throw Error('FC27_GALLERY_PLANNING_SETTINGS_NOT_RESTORED');
        await selectPanelTab(context, page, 'gallery');
      } catch {
        report.timeoutSettings.restoreFailed = true;
        report.status = 'blocked'; report.reason = 'FC27_GALLERY_PLANNING_SETTINGS_NOT_RESTORED';
      }
    }
    if (settingState) await page.evaluate(() => { delete globalThis.__fcatInspectionPlanningAccount; }).catch(() => {});
  }
}
