import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Production UI + sanitized public controls. No EA, price service or trades.
export async function exerciseGalleryLineupSearch(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..');
  const fixture = JSON.parse(await readFile(path.join(root, 'tests/fixtures/gallery-lineup-cost-2026-10-28.json'), 'utf8'));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'LineupFixture', target: 'chrome120' });
  for (const [index, control] of fixture.cases.entries()) {
    const page = await context.newPage(); let requests = 0; const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', () => { requests++; });
    try {
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><title>Gallery complete lineup planning control</title>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ input, prices }) => {
        const attach = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        const rows = input.progress.rows.map(row => ({ ...row, name: `Player ${row.eaId}` }));
        const set = { ...input.set, name: 'Control Club', slug: 'control-club',
          grades: input.set.grades.map(grade => ({ ...grade, rewards: [], rewardsComplete: false })) };
        const catalog = { ...input.catalog, revision: 'control', categories: [{ id: 'futgg:1', name: 'Control League', slug: 'control-league', sets: [set] }] };
        const totals = { total: rows.length, collected: rows.filter(row => row.collected === true).length,
          missing: rows.filter(row => row.collected === false).length, unknown: rows.filter(row => row.collected == null).length };
        const detail = { status: 'observed', scope: 'fixture', progress: { ...input.progress, source: 'futgg', rows, totals } };
        globalThis.lineupEvents = []; globalThis.lineupScopeReads = 0; globalThis.lineupBeats = 0;
        globalThis.lineupHeartbeat = setInterval(() => { globalThis.lineupBeats++; }, 25);
        globalThis.lineupPanel = globalThis.LineupFixture.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'lineup-fixture', targets: () => [],
          galleryAccountScope: () => { globalThis.lineupScopeReads++; return 'fixture'; },
          galleryCatalog: { peek: async () => null, load: async () => ({ status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() }) },
          gallerySetLoader: async () => detail,
          galleryPlanningPrices: async () => ({ source: 'public-references', policy: { source: 'futbin' },
            prices, freshPrices: prices, references: {}, expiresAt: Date.now() + 300000 }),
          galleryPlanningSettings: { scope: () => 'fixture', read: async () => ({ timeoutMs: 10000 }) },
          galleryDiagnosticLog: { record: async event => globalThis.lineupEvents.push(event) },
        }); globalThis.lineupPanel.open();
      }, { input: fixture.input, prices: control.prices });
      const host = page.locator('#lineup-fixture');
      await host.locator('#tab-gallery').click();
      await host.locator('#gallery-categories button').first().click();
      assert.deepEqual(errors, []);
      await host.locator('[data-set-id="futgg:17"]').getByRole('button', { name: '查看卡片', exact: true }).click();
      await host.locator('.gallery-plan select').first().selectOption('A');
      const started = performance.now();
      await host.getByRole('button', { name: '生成方案', exact: true }).click();
      await page.waitForFunction(() => globalThis.lineupEvents.some(event => event.event === 'grade-plan' && event.status === 'success'));
      const observation = await page.evaluate(() => ({ event: globalThis.lineupEvents.find(event => event.event === 'grade-plan'),
        scopeReads: globalThis.lineupScopeReads, beats: globalThis.lineupBeats }));
      const elapsed = Math.round(performance.now() - started);
      assert.equal(observation.event.replayInput.lineupSearch, true, 'The real single-club UI must use the new algorithm');
      assert.ok(observation.event.bestPrice <= control.maxPrice);
      assert.ok(observation.event.bestScore >= 4000);
      assert.ok(observation.event.evaluations <= 30000);
      assert.ok(observation.beats > 0, 'Planning must yield so the page keeps painting');
      assert.match(await host.locator('.gallery-plan-output').innerText(), /找到 \d+ 个候选方案/);
      assert.equal(requests, 0);
      assert.deepEqual(errors, []);
      if (index === 0) {
        await host.locator('.gallery-plan-output').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(directory, 'gallery-lineup-control-desktop.png') });
        await page.setViewportSize({ width: 390, height: 800 });
        await host.locator('.gallery-plan-output').scrollIntoViewIfNeeded();
        assert.equal(await host.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        await page.screenshot({ path: path.join(directory, 'gallery-lineup-control-mobile.png') });
      }
      console.log(`Gallery full-lineup UI control passed: ${JSON.stringify({ case: index + 1, elapsedMs: elapsed,
        computeMs: observation.event.durationMs, evaluations: observation.event.evaluations, price: observation.event.bestPrice,
        score: observation.event.bestScore, scopeReads: observation.scopeReads, beats: observation.beats })}`);
    } finally { await page.close(); }
  }
}
