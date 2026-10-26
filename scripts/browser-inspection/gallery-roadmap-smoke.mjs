import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryRoadmap(context, directory) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'RoadmapFixture', target: 'chrome120' });
  const input = futggGallery(), base = input.data.categories[0].sets[0];
  base.requiredCards = 1; base.name = 'Club Alpha';
  base.grades.forEach((grade, i) => { grade.threshold = 10 + i * 10;
    grade.rewards = [{ type: 'event_token_1', count: 1, value: [0, 0, 5, 8, 15][i], label: `${[0, 0, 5, 8, 15][i]} Tokens` }]; });
  const b = structuredClone(base); b.id = 31; b.name = 'Club Beta'; b.slug = 'club-beta';
  const league = structuredClone(base); league.id = 32; league.name = 'Shared League'; league.slug = 'shared-league'; league.requiredCards = 2;
  league.grades.forEach((grade, i) => { grade.threshold = [10, 20, 120, 160, 200][i]; });
  input.data.categories[0].sets = [base, b, league];
  input.data.tags = [{ id: 1, name: 'No-op bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 1 }] }];
  const catalog = normalizeGalleryCatalog('futgg', input);
  let requests = 0; page.on('request', () => { requests++; });
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.setContent('<!doctype html><title>Gallery overall route — offline fixture</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(catalog => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.roadmapScope = 'fixture-account-a';
      globalThis.roadmapKnobs = { priceTtl: 300000, holdSync: false };
      globalThis.roadmapCalls = { buys: 0, lists: 0, setReads: 0, quoteReads: 0, sync: 0, levelReads: 0 };
      const notes = new Map();
      const levelData = { status: 'observed', source: 'ea-gallery-objective-milestones', observedAt: Date.now(),
        exactLevel: null, confirmedAtLeast: 5, nextMilestone: { level: 10, rewards: ['1 of 5 Holographic Base Hero Player Pick'] },
        milestones: [{ level: 5, completed: true, claimed: true, rewards: [] }, { level: 10, completed: null, claimed: null,
          rewards: ['1 of 5 Holographic Base Hero Player Pick'] }] };
      const prices = { 1: 60000, 2: 50000 };
      const row = eaId => ({ eaId, playerEaId: eaId, name: `Player ${eaId}`, version: 'Gallery', overall: 80,
        gradingScore: 100, galleryScore: 100, collected: false, inClub: false, held: null, firstOwned: false,
        holographic: false, positions: ['ST'], skillMoves: 3, weakFoot: 3, nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1 });
      const detail = setId => {
        const ids = setId === 30 ? [1] : setId === 31 ? [2] : [1, 2];
        return { status: 'observed', scope: globalThis.roadmapScope, fetchedAt: Date.now(),
          pool: { source: 'futgg', setId, revision: `pool-${setId}` }, prices,
          priceSnapshot: { prices, freshPrices: prices, expiresAt: Date.now() + 300000, policy: { source: 'futbin' } },
          progress: { source: 'ea-gallery-progress', season: '27', setId, complete: true, poolComplete: true,
            rows: ids.map(row), totals: { total: ids.length, collected: 0, missing: ids.length, unknown: 0 } } };
      };
      globalThis.roadmapPanel = globalThis.RoadmapFixture.mountFc27AcceptancePanel({ document: globalThis.document, targets: () => [], hostId: 'roadmap-test',
        galleryAccountScope: () => globalThis.roadmapScope,
        galleryLevel: { scope: () => globalThis.roadmapScope, peek: () => levelData,
          readNote: async () => notes.get(globalThis.roadmapScope) ?? null,
          saveNote: async level => { const note = { level, source: 'console-user-recorded', recordedAt: Date.now() }; notes.set(globalThis.roadmapScope, note); return note; },
          refresh: async () => { globalThis.roadmapCalls.levelReads++; return levelData; } },
        galleryCatalog: { peek: async () => null, load: async () => ({ source: 'futgg', status: 'observed', catalog }),
          refresh: async () => ({ source: 'futgg', status: 'observed', catalog }) },
        gallerySync: { state: () => ({ synced: true, syncedAt: Date.now(), busy: false }), stop() {}, subscribe: () => () => {},
          sync: async ({ onProgress }) => { globalThis.roadmapCalls.sync++; onProgress?.({ phase: 'ea', index: 1, total: 1, count: 2 });
            if (globalThis.roadmapKnobs.holdSync) await new Promise(resolve => { globalThis.releaseRoadmapSync = resolve; });
            return { status: 'observed', details: [30, 31, 32].map(detail) }; },
          peekDetails: async () => [30, 31, 32].map(detail) },
        gallerySetLoader: async ({ setId }) => { globalThis.roadmapCalls.setReads++; return detail(Number(setId.split(':')[1])); },
        galleryPlanningPrices: async ids => { globalThis.roadmapCalls.quoteReads++;
          return { source: 'public-references', policy: { source: 'futbin' }, prices, freshPrices: prices,
            references: Object.fromEntries(ids.map(id => [id, { futbin: prices[id], futgg: prices[id], maxBuy: prices[id] }])), expiresAt: Date.now() + globalThis.roadmapKnobs.priceTtl }; },
        purchaseGallery: async () => { globalThis.roadmapCalls.buys++; throw Error('No buys in offline route'); },
      }); globalThis.roadmapPanel.open();
    }, catalog);
    const shadow = page.locator('#roadmap-test');
    await shadow.locator('#tab-gallery').click();
    const levelPanel = shadow.locator('#gallery-level-panel');
    await levelPanel.getByText('等级来源 / 主机记录', { exact: true }).click();
    await levelPanel.getByLabel('主机确认等级（可选）', { exact: true }).fill('8');
    await levelPanel.getByRole('button', { name: '保存主机记录', exact: true }).click();
    await levelPanel.getByText('已保存本机主机记录；不是 EA 自动读取的精确等级。', { exact: true }).waitFor();
    assert.ok((await levelPanel.innerText()).includes('Lv.8（主机记录）'));
    await levelPanel.getByRole('button', { name: '刷新等级奖励', exact: true }).click();
    await levelPanel.getByText('已刷新 EA 等级里程碑；精确等级与升级 XP 尚未由此接口提供。', { exact: true }).waitFor();
    assert.ok((await levelPanel.innerText()).includes('Hero Player Pick'));
    await levelPanel.screenshot({ path: path.join(directory, 'gallery-level-panel.png') });
    await levelPanel.getByText('等级来源 / 主机记录', { exact: true }).click();
    await shadow.getByRole('button', { name: '整体方案', exact: true }).click();
    const dialog = shadow.getByRole('dialog', { name: '全画廊整体方案' });
    await dialog.getByLabel('可周转金币', { exact: true }).fill('80000');
    await dialog.getByRole('button', { name: '生成整体方案', exact: true }).click();
    await dialog.getByText('整体路线已生成；进入具体合集后再确认操作。', { exact: true }).waitFor();
    const text = await dialog.innerText();
    for (const expected of ['84', '60,000', '5,500', '110,000', 'Club Alpha', 'Club Beta', 'Shared League']) assert.ok(text.includes(expected), expected);
    assert.ok(text.includes('并非要求一次买齐'));
    assert.ok((await dialog.boundingBox()).width >= 950, 'Desktop roadmap must not inherit the 440px confirmation-dialog cap');
    assert.equal(await dialog.getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count(), 3);
    await page.screenshot({ path: path.join(directory, 'gallery-roadmap-desktop.png') });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出分析快照', exact: true }).click();
    const download = await downloadPromise, file = path.join(directory, 'gallery-roadmap-analysis-fixture.json');
    await download.saveAs(file);
    const exported = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(exported.coverage.total, 3); assert.equal(exported.versions.length, 2);
    assert.equal(exported.roadmap.addedTokens, 84);
    assert.equal(exported.galleryLevel.exactLevel, null); assert.equal(exported.galleryLevel.consoleNote.level, 8);
    assert.ok(!JSON.stringify(exported).includes('fixture-account-a'));
    await page.setViewportSize({ width: 420, height: 900 });
    await page.screenshot({ path: path.join(directory, 'gallery-roadmap-mobile.png') });
    const geometry = await dialog.evaluate(node => ({ width: node.getBoundingClientRect().width, viewport: globalThis.innerWidth }));
    assert.ok(geometry.width <= geometry.viewport);
    await page.setViewportSize({ width: 1400, height: 900 });
    await dialog.getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).first().click();
    await shadow.locator('#gallery-set-detail .gallery-plan select').waitFor();
    assert.equal(await shadow.locator('#gallery-set-detail .gallery-plan select').inputValue(), 'S');
    assert.ok((await shadow.locator('#gallery-set-detail').innerText()).includes('整体路线目标 S'));
    await shadow.getByRole('button', { name: '整体方案', exact: true }).click();
    assert.ok((await dialog.innerText()).includes('110,000'), 'A semantically identical club read must keep the overall route');
    await page.evaluate(() => { globalThis.roadmapKnobs.priceTtl = -1; });
    await dialog.getByRole('button', { name: '重新生成整体方案', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.querySelector('#roadmap-test').shadowRoot.querySelector('.gallery-roadmap-controls + .row button').disabled);
    assert.ok((await dialog.innerText()).includes('公开报价已过期'), 'Expired quote must not publish a newly feasible route');
    assert.equal(await dialog.getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count(), 0);
    await page.evaluate(() => { globalThis.roadmapKnobs.priceTtl = 300000; globalThis.roadmapKnobs.holdSync = true; });
    await dialog.getByRole('button', { name: '生成整体方案', exact: true }).click();
    await dialog.getByRole('button', { name: '停止分析', exact: true }).click();
    await page.evaluate(() => globalThis.releaseRoadmapSync());
    await dialog.getByText('数据读取已停止；未进行买卖。', { exact: true }).waitFor({ timeout: 2000 });
    await dialog.getByRole('button', { name: '生成整体方案', exact: true }).click();
    await page.evaluate(() => { globalThis.roadmapScope = 'fixture-account-b'; globalThis.releaseRoadmapSync(); });
    await dialog.waitFor({ state: 'hidden' });
    await shadow.getByRole('button', { name: '整体方案', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count(), 0, 'No route from the previous account');
    assert.ok(!(await levelPanel.innerText()).includes('Lv.8（主机记录）'), 'Console note must not cross account scopes');
    const calls = await page.evaluate(() => globalThis.roadmapCalls);
    assert.equal(calls.buys, 0); assert.equal(calls.lists, 0); assert.ok(calls.setReads > 0);
    assert.equal(requests, 0);
    console.log('Gallery overall roadmap Chrome passed: automatic full catalog, 80k capital / 110k turnover, shared cards, JSON redaction, club handoff, retained route, mobile, expired quotes, Stop and account isolation; no EA access.');
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'gallery-roadmap-error.png') });
    console.log(await page.locator('#roadmap-test .gallery-roadmap-status').textContent());
    throw error;
  } finally { await page.close(); }
}
