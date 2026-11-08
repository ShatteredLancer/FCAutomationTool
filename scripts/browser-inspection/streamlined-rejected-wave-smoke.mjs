import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exerciseStreamlinedRejectedWave(context) {
  const page = await context.newPage(); let requests = 0;
  try {
    await page.route('**/*', route => { requests++; return route.abort(); });
    await page.setContent('<!doctype html><title>Offline rejected wave</title>');
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { createStreamlinedTransaction } from './src/streamlined/transaction.js';
      export { createStreamlinedJournal, streamlinedJournalKey } from './src/streamlined/journal.js';
      export { normalizeStreamlinedContributionReply } from './src/streamlined/contribution.js';
      export { testPlan, challenge } from './tests/helpers/streamlined.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'RejectedWave', target: 'chrome120' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const a = globalThis.RejectedWave;
      const run = async unknown => {
        const memory = new Map(), plan = a.testPlan({ challenge: a.challenge({ scoreRequirement: 40, selectionLimit: 30 }) });
        const journal = a.createStreamlinedJournal({ now: () => 100,
          get: async key => memory.get(key), set: async (key, value) => memory.set(key, structuredClone(value)) });
        let calls = 0, checks = 0, authenticated = false;
        const writer = { capabilities: { contributionVerified: true }, verify: async () => { checks++; return true; },
          contribute: async (plan, batch) => {
            calls++;
            if (unknown) return { status: 'unknown' };
            return a.normalizeStreamlinedContributionReply(authenticated
              ? { success: true, status: 200, response: { setId: plan.challenge.setId, challengeId: plan.challenge.id, submittedScore: 40 } }
              : { success: false, status: 401 },
            { setId: plan.challenge.setId, challengeId: plan.challenge.id, previousScore: 0, itemIds: batch.refs.map(ref => ref.id) });
          },
          reconcile: async (record, batch) => {
            if (unknown) throw Error('FC27_STREAMLINED_RECONCILIATION_REQUIRED');
            return { fresh: true, context: record.context, setId: plan.challenge.setId, challengeId: plan.challenge.id,
              observedAt: 100, submittedScore: 40, operationConfirmed: true, absent: batch.refs };
          } };
        const tx = a.createStreamlinedTransaction({ journal, adapter: writer, now: () => 100,
          lock: { acquire: async () => () => {} } });
        const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0] };
        await tx.execute(plan, approval, { restartRejected: true });
        const rejected = await journal.read(plan.context);
        await tx.recover(plan.context); authenticated = true;
        const readonlyCalls = calls;
        const next = await tx.execute(plan, approval, { restartRejected: true });
        const after = await journal.read(plan.context);
        await tx.execute(plan, approval, { restartRejected: true });
        return { first: rejected.batches[0].state, readonlyCalls, status: next.status, checks, calls,
          after: after.batches[0].state, score: after.submittedScore,
          archived: JSON.stringify(memory.get(`${a.streamlinedJournalKey(plan.context)}:history:${rejected.revision}`)) === JSON.stringify(rejected) };
      };
      return { rejected: await run(false), unknown: await run(true) };
    });
    assert.deepEqual(result.rejected, { first: 'rejected', readonlyCalls: 1, status: 'completed', checks: 2,
      calls: 2, after: 'confirmed', score: 40, archived: true });
    assert.equal(result.unknown.first, 'unknown'); assert.equal(result.unknown.after, 'unknown');
    assert.equal(result.unknown.calls, 1); assert.equal(result.unknown.archived, false);
    assert.equal(requests, 0);
    console.log('Streamlined rejected-wave Chrome passed: definitive401 -> read-only recovery -> explicit fresh validation -> one contribution, archived rejection; unknown/confirmed never resent; no EA/network.');
  } finally { await page.close(); }
}
