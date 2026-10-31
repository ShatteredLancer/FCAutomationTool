import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleInvalidation(context) {
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { puzzleFillFixture } from './tests/helpers/fc27-puzzle-fill-fixture.js';
      export { prepareFc27PuzzleConceptDraft } from './src/fc27/puzzle-concept-draft.js';
      export { createFc27PuzzleConceptSession, fc27ConceptDraftKey, readFc27ConceptReservation }
        from './src/fc27/puzzle-concept-session.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'PuzzleInvalidationSmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Puzzle invalidation offline regression</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const api = globalThis.PuzzleInvalidationSmoke, input = api.puzzleFillFixture();
      const missing = input.inventory.items.pop(), target = { setId: input.challenge.setId, challengeId: input.challenge.id };
      const scope = 'offline-puzzle', now = 1000000;
      const plan = api.prepareFc27PuzzleConceptDraft(input, {
        selectedOwned: input.inventory.items.map((item, slot) => ({ id: item.id, definitionId: item.definitionId,
          rating: item.rating, pile: 'club', slot })),
        purchases: [{ definitionId: 901, catalogRef: 'fc27:901', rating: missing.rating, rarity: missing.rarity,
          nationId: missing.nationId, leagueId: missing.leagueId, teamId: missing.teamId, positions: missing.positions,
          groups: missing.groups, special: false, evolution: false, cosmetic: false, type: 'player', concept: false,
          academyEnrolled: false, slot: 10, quantity: 1, observedBuyNow: 500 }], purchaseCount: 1,
      });
      if (plan.status !== 'prepared') throw Error('Offline draft must pass native validation');
      const key = api.fc27ConceptDraftKey(scope, target), store = new Map();
      const record = { schema: 1, scope, operationId: 'offline-original', phase: 'saved',
        plan, updatedAt: now - 10, submitted: false };
      store.set(key, structuredClone(record));
      // Clear must not become a cache-wide cleanup that drops unresolved buys.
      const receiptKey = 'fcat-fc27-puzzle-buy:offline:other', receipt = { phase: 'ready', entries: [{ state: 'buy-pending' }] };
      store.set(receiptKey, structuredClone(receipt));
      let pageEmpty = true, providerReads = 0, stores = 0;
      const get = async (name, fallback) => structuredClone(store.get(name) ?? fallback);
      const create = () => api.createFc27PuzzleConceptSession({ scope, context: input.context, get,
        set: async (name, value) => { stores++; store.set(name, structuredClone(value)); },
        exclusive: async (_scope, task) => task(), assertCurrent: () => true, checkOtherTransactions: async () => true,
        readCurrent: async () => ({ squadEmpty: pageEmpty }), now: () => now,
        createProvider: async () => { providerReads++; throw Error('No provider read expected'); },
      });
      const first = await create().recover(target, { restartIfEmpty: true });
      pageEmpty = false;
      const resumed = await create().recover(target, { restartIfEmpty: true });
      const reservations = await api.readFc27ConceptReservation(get, scope, target, input.context);
      const { invalidation, ...retained } = store.get(key);
      return { first: first.status, resumed: resumed.status, providerReads, stores, reservations,
        retained: JSON.stringify(retained) === JSON.stringify(record), reason: invalidation?.reason,
        receiptRetained: JSON.stringify(store.get(receiptKey)) === JSON.stringify(receipt) };
    });
    assert.deepEqual(result, { first: 'reset', resumed: 'reset', providerReads: 0, stores: 1, reservations: null,
      retained: true, reason: 'local-squad-cleared', receiptRetained: true });
    console.log('Puzzle invalidation offline Chrome passed: clear, failed re-solve/restart, no stale restoration or reservation; receipts retained, no EA access.');
  } finally { await page.close(); }
}
