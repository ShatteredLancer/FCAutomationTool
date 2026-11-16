import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exerciseStreamlinedDeadline(context) {
  const page = await context.newPage(); let requests = 0;
  try {
    await page.route('**/*', route => { requests++; return route.abort(); });
    await page.setContent('<!doctype html><title>Offline Streamlined reload deadline</title>');
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ stdin: { resolveDir: root, contents: `
      export {createFc27StreamlinedPurchaseAdapter} from './src/adapters/ea/fc27-streamlined-purchase.js';
      export {readFc27Context} from './src/adapters/ea/fc27-local-read.js';
      export {projectFc27StreamlinedChallenge} from './src/adapters/ea/fc27-streamlined-read.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'DeadlineFixture', target: 'chrome120' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const results = await page.evaluate(async () => {
      const api = globalThis.DeadlineFixture, results = [];
      for (const delta of [-2, -1, 0, 1, 2]) {
        const challenge = { id: 61, setId: 31, status: 'IN_PROGRESS', name: 'Offline points', scoreRequirement: 200, submittedScore: 0,
          isOneClickChallenge: () => true, eligibilityOperation: 'AND',
          eligibilityRequirements: [{ count: -1, scope: 0, kvPairs: { _collection: { 40: [45], 41: [1] } } }] };
        const set = { id: 31, repeats: 1, repeatabilityMode: 'REFRESH', endTime: 100 };
        const vm = { getChallenge: () => challenge, getSet: () => set, getSelectionLimit: () => 30 };
        class Split { workAreaController = { viewModel: vm, getView: () => ({ getRootElement: () => globalThis.document.body }) }; }
        const controller = new Split(), root = { document: globalThis.document, APP_YEAR_SHORT: 27, APP_YEAR: 2027,
          UTOneClickSBCWorkAreaSplitViewController: Split, getAppMain: () => ({ getRootViewController: () => controller }),
          services: { User: { currentUserId: 1, repository: { _collection: { 1: { id: 1, selectedPersona: 2,
            _personas: { _collection: { 2: { id: 2, _sku: 'fixture', clubs: { _collection: { fixture: { sku: 'fixture', year: 2027, platform: 'PC' } } } } } } } } } } } };
        const context = api.readFc27Context(root), frozen = api.projectFc27StreamlinedChallenge({ challenge, set, vm }, context);
        const item = { source: 'market', definitionId: 101, rating: 84, points: 830, price: 200 };
        const plan = { context, challenge: frozen, route: { groups: [{ source: 'market', item, items: [item], quantity: 1 }] } };
        const before = JSON.stringify(plan); set.endTime += delta;
        let time = 1000, writes = 0, callbacks;
        const adapter = await api.createFc27StreamlinedPurchaseAdapter(root, { plan, persistence: {}, canWrite: () => false, now: () => time,
          createBuyer: async (_root, options) => { callbacks = options; return { verifySquad: async () => options.verifySquad(), buy: async () => { writes++; } }; } });
        let reason = null; try { await adapter.assertCurrent({}); } catch (error) { reason = error.message; }
        let movedReason = null, expiredReason = null;
        if (Math.abs(delta) <= 1) {
          set.endTime++;
          try { await adapter.assertCurrent({}); } catch (error) { movedReason = error.message; }
          set.endTime--; time = Math.min(frozen.endTime, set.endTime) * 1000;
          try { await adapter.buy({}); } catch (error) { expiredReason = error.message; }
          await callbacks.verifySquad();
        }
        results.push({ delta, reason, movedReason, expiredReason, writes, unchanged: JSON.stringify(plan) === before });
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.reason, Math.abs(result.delta) <= 1 ? null : 'FC27_STREAMLINED_CONTEXT_CHANGED');
      assert.equal(result.unchanged, true); assert.equal(result.writes, 0);
      if (Math.abs(result.delta) <= 1) {
        assert.equal(result.movedReason, 'FC27_STREAMLINED_CONTEXT_CHANGED');
        assert.equal(result.expiredReason, 'FC27_STREAMLINED_CHALLENGE_EXPIRED');
      }
    }
    assert.equal(requests, 0);
    console.log('Streamlined reload deadline Chrome passed: +/-1s loaded projection only, strict later changes, earlier deadline blocks writes, frozen plan unchanged; synthetic, zero requests.');
  } finally { await page.close(); }
}
