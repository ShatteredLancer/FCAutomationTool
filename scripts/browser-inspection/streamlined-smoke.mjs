import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exerciseStreamlined(context) {
  const page = await context.newPage();
  try {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { mountFc27StreamlinedPanel } from './src/adapters/browser/fc27-streamlined-panel.js';
      export { createFc27StreamlinedSession } from './src/adapters/browser/fc27-streamlined-session.js';
      export { createFc27StreamlinedMarket } from './src/adapters/ea/fc27-streamlined-market.js';
      export { createGalleryReferencePrices } from './src/gallery/reference-prices.js';
      export { readFutbinBatchPrices } from './src/fc27/futbin-batch-prices.js';
      export { readFc27Context } from './src/adapters/ea/fc27-local-read.js';
      export { challenge, safeItem, policy, eligibility } from './tests/helpers/streamlined.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'StreamlinedSmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Streamlined offline</title><main id="native"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const a = globalThis.StreamlinedSmoke, c = a.challenge(), context = c.context, anchor = globalThis.document.getElementById('native');
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      const saved = new Map(); globalThis.streamlinedEvidence = { writes: 0, quotes: 0, current: true, progress: [], rendered: 0, disposed: 0 };
      const inventory = Array.from({ length: 80 }, (_, i) => a.safeItem({ id: i + 1, definitionId: i + 101,
        points: i < 60 ? 35 : 20, name: `Fixture ${i + 1}` }));
      inventory.push(a.safeItem({ id: 81, definitionId: 181, rating: 84, points: 830 }));
      const session = a.createFc27StreamlinedSession({
        createExecution: async () => {
          if (!globalThis.streamlinedEvidence.executionEnabled) throw Error('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED');
          return { prepare: () => true, transaction: {
            stop: () => { globalThis.streamlinedEvidence.stopped = true; },
            async recover() {
              if (globalThis.streamlinedEvidence.recoveryThrows) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED');
              return globalThis.streamlinedEvidence.recoveryOutcome ?? { status: 'absent' };
            },
            async execute(plan, approval, callbacks) {
              if (globalThis.streamlinedEvidence.purchasePending) return { status: 'blocked', reason: 'FC27_BUY_RECOVERY_REQUIRED' };
              globalThis.streamlinedEvidence.approval = approval;
              const record = { plan, submittedScore: 0, batches: plan.batches.map(() => ({ state: 'waiting' })) };
              for (const index of approval.batchIndices) {
                globalThis.streamlinedEvidence.writes++;
                record.batches[index].state = 'confirmed';
                record.submittedScore += plan.batches[index].reduce((sum, item) => sum + item.points, 0);
                callbacks.onProgress({ phase: 'confirmed', index, submittedScore: record.submittedScore });
              }
              return { status: 'partial', record };
            },
          } };
        },
        inspect: () => { if (!globalThis.streamlinedEvidence.current) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); return { context, challenge: c }; },
        readInputs: () => ({ context, challenge: c, inventory, policy: { ...a.policy, goldRange: [75, 83] }, eligibility: a.eligibility,
          assertCurrent: () => {}, priceRows: [], resolveDisplayItem: ref => inventory.find(item => item.id === ref.id) }),
        get: async (key, fallback) => saved.get(key) ?? fallback,
        set: async (key, value) => { saved.set(key, value); },
      });
      const original = session.plan;
      const observed = { ...session, plan: (settings, options) => original(settings, { onProgress: p => {
        globalThis.streamlinedEvidence.progress.push(p.nodes); options.onProgress(p);
      } }) };
      globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session: observed,
        readTarget: () => globalThis.streamlinedEvidence.current ? { anchor, setId: 31, challengeId: 61 } : null,
        nativeRenderer: { renderOwned({ parent, raw, slot, onUnavailable }) {
          if (raw.id % 5 === 0) return null;
          const node = globalThis.document.createElement('div'); node.slot = slot; node.className = 'gallery-native-card';
          node.textContent = 'Native card fixture'; node.style.cssText = 'width:144px;height:200px'; node.classList.add('owned-card'); parent.append(node);
          globalThis.streamlinedEvidence.rendered++;
          let disposed = false;
          node.__fcatDealloc = () => { if (!disposed) globalThis.streamlinedEvidence.disposed++; disposed = true; };
          if (raw.id % 7 === 0) setTimeout(onUnavailable, 20);
          return node;
        } } });
    });
    await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    await page.getByText('Batch 3', { exact: false }).waitFor();
    const text = await page.getByRole('dialog').innerText();
    assert.match(text, /80 cards \/ 3 batches/);
    assert.match(text, /Batch 1 · 30 cards \(Inventory 30 \/ To buy 0\) · 1,050 points/);
    assert.match(text, /Fixture 1/);
    assert.match(text, /55 OVR/);
    assert.match(text, /Club · owned/);
    assert.match(text, /FSU gold rating cap 83/);
    assert.match(text, /Excluded inventory 1 card/);
    await page.getByText('Excluded inventory 1 card', { exact: true }).click();
    assert.match(await page.getByRole('dialog').innerText(), /Outside the FSU gold rating range · Club · 84 OVR ×1/);
    assert.equal(await page.locator('[data-market-rating]').inputValue(), '99');
    assert.ok((await page.locator('.player-card').first().boundingBox()).width >= 100, 'Readable desktop card');
    assert.match(text, /To buy 0 coins/);
    assert.equal(await page.getByRole('button', { name: 'Contribute selected batches' }).isDisabled(), true);
    assert.equal(await page.locator('[data-inventory-review]').evaluate(node => node.open), true);
    assert.equal(await page.locator('.inventory-row').count(), 50, 'Inventory review is bounded and paginated');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.locator('.inventory-row').count(), 30);
    assert.ok((await page.evaluate(() => globalThis.streamlinedEvidence.progress)).length > 0);
    assert.equal(await page.locator('.player-row').count(), 30, 'Only the expanded batch renders');
    assert.ok(await page.locator('.gallery-native-card').count() > 0);
    await page.getByRole('checkbox', { name: 'Select batch 1' }).uncheck();
    assert.equal(await page.locator('.inventory-row').count(), 50);
    assert.match(await page.locator('[data-inventory-review] summary').innerText(), /50 cards/);
    assert.match(await page.locator('[data-selection]').innerText(), /Selected 2 batches · 50 cards · 1,450 points · Remaining 1,050/);
    await page.getByText('Batch 2 ·', { exact: false }).click();
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelectorAll('.player-row').length === 60);
    assert.equal(await page.locator('.player-row').count(), 60);
    await page.setViewportSize({ width: 390, height: 600 });
    assert.ok((await page.locator('.player-card').first().boundingBox()).width >= 88, 'Readable mobile card');
    const metrics = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    assert.ok(metrics.width <= 390 && metrics.scrollWidth <= metrics.clientWidth + 1, 'No horizontal overflow on mobile');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('.gallery-native-card').count(), 0, 'Close deallocates every native card');
    const cleanup = await page.evaluate(() => globalThis.streamlinedEvidence);
    assert.equal(cleanup.rendered, cleanup.disposed);
    await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    await page.getByText('Batch 3', { exact: false }).waitFor();
    await page.evaluate(() => { globalThis.streamlinedEvidence.current = false; });
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-entry'));
    assert.equal(await page.locator('.gallery-native-card').count(), 0, 'Navigation also clears cards');
    assert.deepEqual(await page.evaluate(() => ({ writes: globalThis.streamlinedEvidence.writes, quotes: globalThis.streamlinedEvidence.quotes })), { writes: 0, quotes: 0 });
    // The enabled variant uses only an explicit synthetic execution adapter.
    // Exercise actual trusted UI clicks, selected-batch approval and redraw.
    await page.evaluate(() => { globalThis.streamlinedEvidence.current = true; globalThis.streamlinedEvidence.executionEnabled = true; });
    await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    await page.getByText('Batch 3', { exact: false }).waitFor();
    const contribute = page.getByRole('button', { name: 'Contribute selected batches', exact: true });
    assert.equal(await contribute.isEnabled(), true);
    // Screenshot regression: recovery errors/other-target history must not
    // leave an old generated plan and active contribution button underneath.
    for (const scenario of ['absent', 'other-target', 'context-error']) {
      await page.evaluate(scenario => {
        globalThis.streamlinedEvidence.recoveryThrows = scenario === 'context-error';
        globalThis.streamlinedEvidence.recoveryOutcome = scenario === 'other-target'
          ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED', recovery: { setId: 48, challengeId: 85 } }
          : { status: 'absent' };
      }, scenario);
      await page.getByRole('button', { name: 'Check & recover', exact: true }).click();
      await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
      assert.equal(await contribute.isVisible(), false);
      assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
      assert.equal(await page.locator('.player-row').count(), 0);
      assert.equal(await page.locator('.gallery-native-card').count(), 0);
      const message = await page.locator('[data-status]').innerText();
      assert.match(message, scenario === 'absent' ? /This SBC has no contribution record/ : scenario === 'other-target' ? /Set 48 \/ Challenge 85/ : /The account, SBC or points changed/);
      assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 0);
      await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
      await page.getByText('Batch 3', { exact: false }).waitFor();
      assert.equal(await contribute.isEnabled(), true, 'A new valid plan is independently usable');
    }
    await page.getByRole('checkbox', { name: 'Select batch 1' }).uncheck();
    await page.getByRole('checkbox', { name: 'Select batch 3' }).uncheck();
    await contribute.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 0, 'Untrusted clicks never contribute');
    await contribute.click();
    await page.getByText('Contribution confirmed. Remaining batches can continue.', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.streamlinedEvidence.approval.batchIndices), [1]);
    assert.equal(await page.getByRole('checkbox', { name: 'Select batch 2' }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Select batch 1' }).isEnabled(), true);
    // A purchase marker can appear between planning and execution. Preserve
    // the actual failure after redraw instead of saying the writer is absent.
    await page.evaluate(() => { globalThis.streamlinedEvidence.purchasePending = true; });
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    await page.getByText('Batch 3', { exact: false }).waitFor();
    await contribute.click();
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
      .querySelector('[data-status]').textContent.includes('Puzzle purchase record'));
    assert.equal(await contribute.isDisabled(), true);
    const blocked = await page.getByRole('dialog').innerText();
    assert.match(blocked, /Execution unavailable: This account has an unresolved Puzzle purchase record/);
    assert.doesNotMatch(blocked, /contribution interface unavailable/);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 1, 'Pending purchase never spends materials');
    await exerciseStreamlinedMarket(page);
    await exerciseStreamlinedValue(page);
    await exerciseStreamlinedOwnedRecipe(page);
    await exerciseStreamlinedDistinctRecipe(page);
    await exerciseStreamlinedQuoteWait(page);
    await exerciseStreamlinedQuoteExpiry(page);
    await exerciseStreamlinedRollingExpiry(page);
    await exerciseStreamlinedBatchedInventory(page);
    await exerciseStreamlinedProtectionBlocked(page);
    console.log('Streamlined offline browser passed: native entry, settings, 30+30+20, market routes, frozen settings, partial progress, stop/recover, unavailable supply, completion, responsive dialog, no EA writes.');
  } finally { await page.close(); }
}

async function exerciseStreamlinedProtectionBlocked(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge();
    const evidence = { writes: 0, quoteReads: 0, execution: 0, logs: [], phase: 'protection-lock-list' };
    globalThis.protectionSmoke = evidence;
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => {
        const error = Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
        error.evidence = { phase: evidence.phase, count: 11, requiredSlots: 23, mismatch: 'length' };
        throw error;
      }, get: async () => null, set: async () => { evidence.writes++; },
      prices: { load: async () => { evidence.quoteReads++; } },
      createExecution: async () => { evidence.execution++; }, diagnosticLog: { record: row => evidence.logs.push(row) } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  for (const [phase, message] of [['protection-lock-list', 'FSU lock list'], ['protection-slot-list', '11 / 23'],
    ['protection-active-state', 'active squad status could not be verified']]) {
    await page.evaluate(value => { globalThis.protectionSmoke.phase = value; }, phase);
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-solve]').disabled);
    assert.ok((await page.locator('[data-result]').innerText()).includes(message));
    assert.ok((await page.locator('[data-status]').innerText()).includes(message), 'The footer explains the protection failure too');
    assert.equal(await page.locator('[data-contribute]').isVisible(), false);
  }
  assert.deepEqual(await page.evaluate(() => {
    const e = globalThis.protectionSmoke; return { writes: e.writes, quoteReads: e.quoteReads, execution: e.execution, phases: e.logs.map(row => row.phase) };
  }), { writes: 0, quoteReads: 0, execution: 0, phases: ['protection-lock-list', 'protection-slot-list', 'protection-active-state'] });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-protection-blocked.png' });
}

async function exerciseStreamlinedBatchedInventory(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    const evidence = { requests: 0, writes: 0, maxActive: 0, active: 0, progress: [] }, cache = new Map();
    globalThis.batchedInventorySmoke = evidence;
    const inventory = Array.from({ length: 482 }, (_, index) => a.safeItem({ id: index + 1000, definitionId: index + 1000,
      rating: 75 + index % 10, points: index % 10 === 9 ? 830 : 100, name: `Inventory ${index}` }));
    const rows = inventory.map(item => ({ definitionId: item.definitionId, rating: item.rating }));
    const shared = a.createGalleryReferencePrices({
      readFutbin: async () => { throw Error('Unexpected per-version read'); },
      readFutbinBatch: (ids, players, options) => a.readFutbinBatchPrices(ids, players, { ...options, cache,
        request: async address => {
          evidence.requests++; evidence.maxActive = Math.max(evidence.maxActive, ++evidence.active);
          await new Promise(resolve => setTimeout(resolve, 100)); evidence.active--;
          const url = new URL(address), rating = Number(url.searchParams.get('rating').split('-')[0]);
          const page = Number(url.searchParams.get('page'));
          return JSON.stringify({ errorcode: '200', data: rows.filter(row => row.rating === rating)
            .slice((page - 1) * 32, page * 32).map(row => ({ resource_id: row.definitionId,
              rating, pc_LCPrice: 1000, ps_LCPrice: 2000 })) });
        } }),
    });
    const prices = { load: (ids, options) => shared.load(ids, { ...options, platform: 'pc', sources: ['futbin'],
      policy: { source: 'futbin' }, onProgress: p => { evidence.progress.push(p.index); options.onProgress(p); } }) };
    const session = a.createFc27StreamlinedSession({ prices, inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => ({ context: c.context, challenge: c, inventory, priceRows: rows, eligibility: a.eligibility,
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97] }, assertCurrent() {} }),
      get: async () => null, set: async () => { evidence.writes++; } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.locator('[data-mode]').selectOption('inventory');
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.getByText(/Inventory quotes \d+ \/ 482 · FUTBIN/, { exact: false }).waitFor();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-batched-inventory-progress.png' });
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('Total card value'));
  const evidence = await page.evaluate(() => globalThis.batchedInventorySmoke);
  assert.equal(evidence.requests, 20, 'Synthetic 482-version inventory reads twenty public pages, not 482 single versions');
  assert.equal(evidence.maxActive, 3);
  assert.equal(evidence.active, 0);
  assert.equal(evidence.writes, 0);
  assert.match(await page.locator('[data-result]').innerText(), /FUTBIN/);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('Total card value'));
  assert.equal(await page.evaluate(() => globalThis.batchedInventorySmoke.requests), 20, 'A second solve reuses exact quote cache');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-batched-inventory-result.png' });
}

async function exerciseStreamlinedRollingExpiry(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, evidence = { reads: 0, writes: 0, refreshes: [], active: 0, maximum: 0 };
    globalThis.rollingExpirySmoke = evidence;
    let time = 1000000;
    const root = { APP_YEAR_SHORT: 27, APP_YEAR: 2027, GAME_NAME: 'fc27', UTSearchCriteriaDTO: class {},
      SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' },
      services: { User: { currentUserId: 1, repository: { _collection: {
        1: { id: 1, selectedPersona: 2, _personas: { _collection: {
          2: { id: 2, _sku: 'fixture', clubs: { _collection: { fixture: { sku: 'fixture', year: 2027, platform: 'pc' } } } },
        } } },
      } } } } };
    const context = a.readFc27Context(root), c = { ...a.challenge({ scoreRequirement: 12000 }), context };
    const ids = Array.from({ length: 166 }, (_, index) => index + 101), cache = new Map();
    const entities = ids.map(definitionId => ({ definitionId, type: 'player', concept: true,
      upgrades: null, cosmetics: [], _hyperCosmeticDTOs: {}, _rareflag: 1, _rating: 84,
      sbsScore: 830, leagueId: 13, nationId: 1, teamId: 1, preferredPosition: 25, name: `Fixture ${definitionId}` }));
    root.services.Item = { searchConceptItems: criteria => ({ observe: (_owner, callback) => callback(null,
      { success: true, status: 200, response: { items: entities.filter(item => criteria.defId.includes(item.definitionId)) } }), unobserve() {} }) };
    for (let index = 0; index < 52; index++) {
      const definitionId = ids[index], remaining = index === 51 ? 87327 : 10000;
      cache.set(`fcat-public-quotes-v2:27:pc:futbin:${definitionId}`, { schema: 2, source: 'futbin',
        season: '27', platform: 'pc', definitionId, price: 200, error: null, sourceUpdatedAt: null,
        fetchedAt: time - 300000 + remaining, expiresAt: time + remaining });
    }
    const shared = a.createGalleryReferencePrices({ now: () => time,
      get: async (key, fallback) => cache.get(key) ?? fallback,
      set: async (key, value) => cache.set(key, structuredClone(value)),
      readFutgg: async () => { throw Error('Unexpected source fallback'); },
      readFutbin: async definitionId => {
        evidence.reads++; time += 626;
        evidence.maximum = Math.max(evidence.maximum, ++evidence.active);
        await new Promise(resolve => setTimeout(resolve, definitionId === 101 ? 250 : 3));
        evidence.active--;
        return { definitionId, price: definitionId === 101 ? 250 : 500 };
      },
    });
    const prices = { load: (ids, options) => shared.load(ids, { ...options, platform: 'pc', sources: ['futbin'],
      policy: { readSources: 'futbin', source: 'futbin', premium: 50 } }) };
    const input = { context, challenge: c, policy: a.policy, eligibility: a.eligibility,
      inventory: [], assertCurrent() {}, registerMarketEntity() {} };
    const market = a.createFc27StreamlinedMarket(root, { prices, catalog: { load: async () => ({ ids }) },
      now: () => time, diagnosticLog: { record: row => { evidence.refreshes.push(row); } } });
    const session = a.createFc27StreamlinedSession({ prices, readMarketCandidates: market,
      inspect: () => ({ context, challenge: c }), readInputs: () => input, now: () => time,
      get: async (_key, fallback) => fallback, set: async () => { evidence.writes++; } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.getByText(/Refreshing expired market quotes \d+ \/ 52 · FUTBIN · Waiting \d+ s/, { exact: true }).waitFor();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /To buy 3,750 coins/);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 144, 'One quote round stops launching reads at its shared 90-second deadline');
  assert.match(await page.locator('[data-result]').innerText(), /Market quote coverage: valid 144 \/ 166/);
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0, 'Quote coverage is accepted by the trusted execution action, not an extra checkbox');
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.maximum), 3);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.active), 0);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.writes), 0);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-futbin-rolling-expiry.png' });
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 166, 'Regeneration reads only the remaining 22 unresolved versions');
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0, 'Complete fresh coverage removes the partial-quote confirmation requirement');
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 166, 'A complete recovered cache is reused without new network reads');
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.writes), 0);
}

async function exerciseStreamlinedOwnedRecipe(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    const inventory = Array.from({ length: 8 }, (_, i) => a.safeItem({ id: 100 + i, definitionId: 100 + i,
      points: 830, rating: 84, name: `Owned 84 ${i + 1}`, pile: i < 3 ? 'storage' : 'club' }));
    const quote = (definitionId, price) => ({ definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => {}, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, inventory, eligibility: a.eligibility, assertCurrent() {},
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97], onlyUntradeable: false,
          protectFsuLockedPlayers: true, protectActiveSquad: true } }),
      prices: { load: async ids => ({ policy: { source: 'futgg' },
        references: Object.fromEntries(ids.map(id => [id, { quotes: { futgg: quote(id, 800) } }])) }) },
      readMarketCandidates: async () => ({ market: [[901, 830, 800, 84], [902, 5500, 5200, 87]]
        .map(([definitionId, points, price, rating]) => a.safeItem({ source: 'market', definitionId,
          points, price, rating, quote: quote(definitionId, price) })) }) });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /Total value 11,600.*To buy 5,200.*Inventory 8 \/ To buy 1/);
  assert.match(await page.locator('[data-result]').innerText(), /Inventory value 6,400/);
  assert.equal(await page.locator('.player-row').count(), 9);
  assert.equal(await page.locator('.inventory-row').count(), 8);
  assert.match(await page.locator('[data-inventory-review]').innerText(), /Owned 84 1/);
  assert.match(await page.locator('[data-inventory-review]').innerText(), /SBC Storage/);
  assert.match(await page.locator('[data-result]').innerText(), /Card locks: enabled.*Active squad protection: enabled/);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true, 'Preview cannot spend or contribute');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const size = await page.getByRole('dialog').evaluate(dialog => ({ scroll: dialog.scrollWidth, client: dialog.clientWidth }));
    assert.ok(size.scroll <= size.client + 1);
    await page.locator('[data-review-stock]').click();
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-owned-recipe-${width}.png` });
  }
}

async function exerciseStreamlinedDistinctRecipe(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.distinctRecipeSmoke = { writes: 0 };
    const inventory = [a.safeItem({ id: 901, definitionId: 901, rating: 85, points: 2100 }),
      ...Array.from({ length: 3 }, (_, i) => a.safeItem({ id: 902 + i, definitionId: 902 + i, rating: 84, points: 830 }))];
    const quote = (definitionId, price) => ({ definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => { globalThis.distinctRecipeSmoke.writes++; }, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, inventory, eligibility: a.eligibility, assertCurrent() {},
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97], onlyUntradeable: false } }),
      prices: { load: async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(id =>
        [id, { quotes: { futgg: quote(id, id === 901 ? 2700 : 1000) } }])) }) },
      readMarketCandidates: async () => ({ market: Array.from({ length: 9 }, (_, i) => {
        const definitionId = 101 + i, price = i === 0 ? 1000 : 1050;
        return a.safeItem({ source: 'market', definitionId, points: 830, rating: 84, price,
          name: `Distinct ${definitionId}`, quote: quote(definitionId, price) });
      }) }) });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /Total value 14,700.*at least 9 batches/);
  const alternative = page.locator('.route-list button').filter({ hasText: 'To buy 9,400' });
  assert.equal(await alternative.count(), 1);
  await alternative.click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('To buy 9,400'));
  assert.match(await alternative.innerText(), /Inventory 4 \/ To buy 9.*at least 1 batch/);
  assert.equal(await page.locator('.player-row').count(), 13);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.distinctRecipeSmoke.writes), 0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-distinct-recipe-${width}.png` });
  }
}

async function exerciseStreamlinedQuoteWait(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.quoteWaitSmoke = { writes: 0, loads: 0, fail: false, heartbeats: 0 };
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 830 })], assertCurrent() {} }),
      get: async (_key, fallback) => fallback, set: async () => { globalThis.quoteWaitSmoke.writes++; },
      prices: { load: async (_ids, { onProgress }) => {
        globalThis.quoteWaitSmoke.loads++;
        onProgress({ source: 'futbin', index: 0, total: 1 });
        if (!globalThis.quoteWaitSmoke.fail) await new Promise(resolve => { globalThis.quoteWaitSmoke.resolve = resolve; });
        return { policy: { source: 'futbin' }, references: { 2: { quotes: { futbin: {
          source: 'futbin', definitionId: 2, price: null, error: 'FC27_BUY_REFERENCE_TIMEOUT' } } } } };
      } },
      readMarketCandidates: async () => ({ market: [], pricePolicy: { source: 'futbin' },
        quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT', quoteCoverage: { requested: 1, valid: 0, failed: 1, missing: 0 } }),
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
    globalThis.quoteWaitSmoke.timer = setInterval(() => { globalThis.quoteWaitSmoke.heartbeats++; }, 50);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.getByText('Inventory quotes 0 / 1 · FUTBIN · Waiting 1 s', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => globalThis.quoteWaitSmoke.heartbeats >= 10), 'Read wait does not block the UI thread');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-wait-desktop.png' });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-wait-mobile.png' });
  assert.ok((await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox()).y < 600, 'Stop remains visible');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText('Stopped.', { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await page.getByRole('button', { name: 'Generate plan', exact: true }).isEnabled(), true);
  await page.evaluate(() => { globalThis.quoteWaitSmoke.resolve(); globalThis.quoteWaitSmoke.fail = true; });
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.getByText('Quotes are unavailable or expired. No plan was generated. Check the selected price source and try again.', { exact: true }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /FUTBIN · FC27_BUY_REFERENCE_TIMEOUT/);
  assert.equal(await page.locator('.route-list button').count(), 0, 'An outage cannot approve costly cached routes');
  assert.equal(await page.evaluate(() => globalThis.quoteWaitSmoke.writes), 0);
  await page.evaluate(() => clearInterval(globalThis.quoteWaitSmoke.timer));
}

async function exerciseStreamlinedQuoteExpiry(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.quoteExpirySmoke = { fail: true, writes: 0 };
    const quote = definitionId => ({ source: 'futbin', definitionId, price: 800, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }), now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 830 })], assertCurrent() {} }),
      get: async (_key, fallback) => fallback, set: async () => { globalThis.quoteExpirySmoke.writes++; },
      prices: { load: async () => ({ policy: { source: 'futbin' },
        references: { 2: { quotes: { futbin: quote(2) } } } }) },
      readMarketCandidates: async ({ onProgress }) => {
        onProgress({ phase: 'market-quotes', source: 'futbin', completed: 0, total: 1, refresh: true });
        await new Promise(resolve => setTimeout(resolve, 500));
        if (globalThis.quoteExpirySmoke.fail) throw Error('FC27_STREAMLINED_QUOTES_EXPIRED');
        return { pricePolicy: { source: 'futbin' }, market: [a.safeItem({ source: 'market', definitionId: 901,
          points: 830, price: 800, quote: quote(901) })] };
      },
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.getByText('Refreshing expired market quotes 0 / 1 · FUTBIN · Waiting 0 s', { exact: true }).waitFor();
  await page.getByText('FUTBIN market quotes expired while waiting and could not be refreshed. Generate a new plan. Expired quotes and other price sources are not used.', { exact: true }).waitFor();
  assert.equal((await page.locator('[data-result]').innerText()).includes('FUT.GG'), false);
  assert.equal(await page.locator('[data-contribute]').isVisible(), false);
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-futbin-expiry.png' });
  await page.evaluate(() => { globalThis.quoteExpirySmoke.fail = false; });
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /FUTBIN/);
  assert.equal(await page.evaluate(() => globalThis.quoteExpirySmoke.writes), 0);
}

async function exerciseStreamlinedValue(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 100 });
    const evidence = { quotes: 0, market: 0 };
    globalThis.valueSmoke = evidence;
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => {}, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 100 })], assertCurrent() {} }),
      prices: { load: async () => { evidence.quotes++; return { policy: { source: 'futgg' }, references: {
        2: { quotes: { futgg: { source: 'futgg', definitionId: 2, price: 30000, fetchedAt: 1, expiresAt: 1000 } } },
      } }; } },
      readMarketCandidates: async () => { evidence.market++; return { market: [a.safeItem({ source: 'market',
        definitionId: 901, points: 25, price: 2000,
        quote: { source: 'futgg', definitionId: 901, price: 2000, fetchedAt: 1, expiresAt: 1000 } })] }; },
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  assert.equal(await page.locator('[data-objective]').inputValue(), 'lowest-value');
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /Total value 8,000.*To buy 8,000.*4 cards/);
  assert.match(await page.locator('[data-result]').innerText(), /Total card value 8,000 coins/);
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button:last-child').getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('[data-result]').innerText(), /Total card value 30,000 coins · To buy 0 coins/);
  assert.deepEqual(await page.evaluate(() => globalThis.valueSmoke), { quotes: 1, market: 1 });
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true, 'Route selection never grants contribution authority');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const dimensions = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width,
      scroll: node.scrollWidth, client: node.clientWidth }));
    assert.ok(dimensions.width <= width && dimensions.scroll <= dimensions.client + 1, 'Cost summaries fit desktop and mobile');
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-value-${width}.png` });
  }
}

async function exerciseStreamlinedMarket(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // This is a separate synthetic session. Trusted clicks exercise the real
  // panel/session, while every execution effect stays in this fixture.
  let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 100 });
    const saved = new Map(), evidence = { calls: 0, mode: 'stopped', saved: [], record: null, now: 1000, holdPreflight: true };
    globalThis.marketSmoke = evidence;
    let finish;
    const transaction = { recover: async () => ({ status: 'absent' }) };
    const execution = {
      prepare() {}, transaction,
      stop() { finish?.(); },
      recoverPurchase: async () => ({ status: 'recovered', record: evidence.record }),
      async purchase(plan, approval, { onProgress }) {
        evidence.calls++; evidence.execution = plan.execution;
        if (evidence.holdPreflight) await new Promise(resolve => { evidence.preflight = resolve; });
        evidence.approval = approval;
        evidence.record = { context: c.context, plan, submittedScore: 0, spent: 300, budget: approval.budget,
          completed: false, consumedIds: [], entries: [{ state: 'club' }, { state: 'club' }] };
        if (evidence.mode === 'stopped') {
          await new Promise(resolve => {
            finish = resolve;
            onProgress({ phase: 'partial-ready', batchNumber: 1, purchased: 2, purchaseTarget: 10,
              spent: 300, budget: 1500, contributed: 0, submittedScore: 0, targetScore: 100,
              readyCount: 2, selectionLimit: 30, readyPoints: 20, waitMs: 12000 });
          });
          finish = null;
          return { status: 'stopped', reason: 'FC27_STREAMLINED_STOPPED', record: evidence.record };
        }
        if (evidence.mode === 'no-supply') return { status: 'paused',
          reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: evidence.record };
        evidence.record = { ...evidence.record, completed: true, submittedScore: 100 };
        return { status: 'completed', record: evidence.record };
      },
    };
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }), now: () => 100,
      get: async (key, fallback) => saved.get(key) ?? fallback,
      set: async (key, value) => { saved.set(key, value); evidence.saved.push(value); },
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [], assertCurrent() {} }),
      readMarketCandidates: async () => ({ pricePolicy: { source: 'futgg', purchaseAttempts: 7 },
        ...(evidence.quoteLimited ? { quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT',
          quoteCoverage: { requested: 3, valid: 2, failed: 1, missing: 0 } } : {}),
        market: [[101, 10, 150], [102, 100, 2000]].map(([definitionId, points, price]) => ({ ...a.safeItem({
          source: 'market', definitionId, points, price,
          quote: { definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 },
        }), purchaseMaxBuy: price })) }),
      createExecution: async () => execution,
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session, now: () => evidence.now,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  assert.equal(await page.locator('[data-wait]').inputValue(), '60');
  await page.locator('[data-wait]').fill('12');
  await page.locator('[data-mode]').selectOption('market');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved for this SBC.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.saved[0].settings.partialWaitMs), 12000);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'FCAT Points Solver', exact: true }).click();
  assert.equal(await page.locator('[data-wait]').inputValue(), '12');
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.locator('.route-list button').count(), 2);
  assert.match(await page.locator('.route-list').innerText(), /1,500.*100 points.*10 cards/);
  const routeLabels = await page.locator('.route-list button').allTextContents();
  assert.match(routeLabels[0], /at least 10 batches.*Repeat purchases 9/,
    'Repeated market versions require separate purchase waves in the compact route summary');
  assert.equal(routeLabels.some(label => /OVR|Version|Purchase estimate|Inventory value/.test(label)), false,
    'Route choices stay compact and do not repeat per-card details');
  assert.equal(routeLabels.some(label => /82|83|84/.test(label)), false,
    'Route choices do not expose individual ratings');
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button:last-child').getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('[data-result]').innerText(), /2,000 coins/);
  assert.match(await page.locator('[data-result]').innerText(), /Batch 1/);
  assert.match(await page.locator('[data-result]').innerText(), /Market concept card/);
  await page.locator('.route-list button').first().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.getByRole('checkbox', { name: 'Select batch 1' }).count(), 0);
  assert.match(await page.locator('[data-selection]').innerText(), /execution button approves this scope/);
  assert.equal(await page.locator('[data-purchase-budget]').inputValue(), '1500');
  assert.match(await page.locator('[data-result]').innerText(), /Approved market substitution pool: 2 versions/);
  assert.match(await page.locator('[data-result]').innerText(), /Attempts per card: 7 · Partial batch wait: 12 s/);
  const run = page.getByRole('button', { name: 'Buy & contribute', exact: true });
  assert.equal(await run.isEnabled(), true);
  assert.equal(await page.locator('[data-status]').evaluate(node => !!node.closest('footer')), true,
    'Execution progress stays beside the action buttons, not above a long result list');
  await run.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 0);
  await run.click();
  await page.getByText('Preparing execution: checking the plan and records', { exact: false }).waitFor();
  await page.evaluate(() => { globalThis.marketSmoke.now += 2300; });
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-clock]').textContent.includes('Elapsed 2 s'));
  await page.evaluate(() => { globalThis.marketSmoke.holdPreflight = false; globalThis.marketSmoke.preflight(); });
  await page.getByText('Ready in this batch 2 / 30 cards · 20 points', { exact: false }).waitFor();
  assert.match(await page.locator('[data-status]').innerText(), /Purchased 2 \/ 10 cards/);
  assert.match(await page.locator('[data-clock]').innerText(), /Estimated batch wait remaining/);
  await page.locator('.panel-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const bounds = await page.locator('[data-status]').evaluate(node => {
    const rect = node.getBoundingClientRect(), dialog = node.closest('dialog').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, dialogTop: dialog.top, dialogBottom: dialog.bottom };
  });
  assert.ok(bounds.top >= bounds.dialogTop && bounds.bottom <= bounds.dialogBottom, 'Progress remains in view after scrolling to the buttons');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-execution-progress-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  const narrow = await page.getByRole('dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(narrow.scroll <= narrow.width + 1, 'Execution footer has no narrow-screen horizontal overflow');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-execution-progress-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.locator('[data-mode]').isDisabled(), true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText('Stopped. Confirmed purchases are retained. Resume with the execution button; unresolved receipts are checked first.', { exact: true }).waitFor();
  assert.match(await page.locator('[data-selection]').innerText(), /Ready 2 cards/);
  const stoppedTime = await page.locator('[data-clock]').innerText();
  await page.evaluate(() => { globalThis.marketSmoke.now += 5000; });
  assert.equal(await page.locator('[data-clock]').innerText(), stoppedTime, 'Elapsed time freezes after stopping');
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.purchaseAttempts), 7);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.partialWaitMs), 12000);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.purchaseScope.groups.length), 2);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.approval.budget), 1500);
  await page.getByRole('button', { name: 'Check & recover', exact: true }).click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
  assert.equal(await run.isEnabled(), true);
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'no-supply'; });
  await run.click();
  await page.getByText('Paused after bounded retries: no approved candidate was available within the frozen price caps. Purchases are retained. Retry later or generate a new plan; no receipt recovery is needed for a normal shortage.', { exact: true }).waitFor();
  assert.equal(await run.isEnabled(), true, 'Normal scarcity can be retried without a recovery click');
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'completed'; });
  await run.click();
  await page.getByText('Target reached. Check the reward status separately.', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 3);
  await page.evaluate(() => { globalThis.marketSmoke.quoteLimited = true; });
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click();
  await page.locator('[data-result] section.inventory-warning').waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /Quote coverage is incomplete.*cheapest/);
  assert.match(await page.locator('[data-result]').innerText(), /Market quote coverage: valid 2 \/ 3 · failed 1/);
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0);
  await run.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 3, 'Only a trusted execution click approves quote coverage');
  assert.equal(await run.isEnabled(), true);
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-solve]').disabled);
  assert.equal(await run.isEnabled(), true, 'Changed route requires a new trusted execution click, not another checkbox');
  await page.locator('[data-result] section.inventory-warning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-coverage-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.locator('[data-result] section.inventory-warning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-coverage-mobile.png' });
  const coverageBounds = await page.getByRole('dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(coverageBounds.scroll <= coverageBounds.width + 1, 'Quote coverage warning has no narrow-screen horizontal overflow');
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 3, 'Quote-limited previews have not executed');
  await run.click();
  await page.getByText('Target reached. Check the reward status separately.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 4);
  assert.equal(requests, 0, 'The synthetic market UI must never make network requests');
}
