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
      export { testPlan, challenge, safeItem } from './tests/helpers/streamlined.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'RejectedWave', target: 'chrome120' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const a = globalThis.RejectedWave;
      const run = async (unknown, expanded = false) => {
        const memory = new Map(), target = a.challenge({ scoreRequirement: expanded ? 60 : 40, selectionLimit: 30 });
        const plan = a.testPlan({ challenge: target });
        const journal = a.createStreamlinedJournal({ now: () => 100,
          get: async key => memory.get(key), set: async (key, value) => memory.set(key, structuredClone(value)) });
        let calls = 0, checks = 0, authenticated = false;
        const writer = { capabilities: { contributionVerified: true }, verify: async () => { checks++; return true; },
          contribute: async (plan, batch) => {
            calls++;
            if (unknown) return { status: 'unknown' };
            return a.normalizeStreamlinedContributionReply(authenticated
              ? { success: true, status: 200, response: { setId: plan.challenge.setId, challengeId: plan.challenge.id, submittedScore: plan.score } }
              : { success: false, status: 401 },
            { setId: plan.challenge.setId, challengeId: plan.challenge.id, previousScore: 0, itemIds: batch.refs.map(ref => ref.id) });
          },
          reconcile: async (record, batch) => {
            if (unknown) throw Error('FC27_STREAMLINED_RECONCILIATION_REQUIRED');
            return { fresh: true, context: record.context, setId: plan.challenge.setId, challengeId: plan.challenge.id,
              observedAt: 100, submittedScore: record.plan.score, operationConfirmed: true, absent: batch.refs };
          } };
        const tx = a.createStreamlinedTransaction({ journal, adapter: writer, now: () => 100,
          lock: { acquire: async () => () => {} } });
        const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0], allowPartial: true };
        await tx.execute(plan, approval, { restartRejected: true });
        const rejected = await journal.read(plan.context);
        await tx.recover(plan.context); authenticated = true;
        const readonlyCalls = calls;
        const nextPlan = expanded ? a.testPlan({ challenge: target,
          inventory: [...plan.items, a.safeItem({ id: 99, definitionId: 199 })] }) : plan;
        const nextApproval = { ...approval, fingerprint: nextPlan.fingerprint };
        const next = await tx.execute(nextPlan, nextApproval, { restartRejected: true });
        const after = await journal.read(plan.context);
        await tx.execute(nextPlan, nextApproval, { restartRejected: true });
        return { first: rejected.batches[0].state, readonlyCalls, status: next.status, checks, calls,
          after: after.batches[0].state, score: after.submittedScore,
          archived: JSON.stringify(memory.get(`${a.streamlinedJournalKey(plan.context)}:history:${rejected.revision}`)) === JSON.stringify(rejected),
          ...(expanded ? { selected: after.plan.items.length } : {}) };
      };
      return { rejected: await run(false), unknown: await run(true), expanded: await run(false, true) };
    });
    assert.deepEqual(result.rejected, { first: 'rejected', readonlyCalls: 1, status: 'completed', checks: 2,
      calls: 2, after: 'confirmed', score: 40, archived: true });
    assert.equal(result.unknown.first, 'unknown'); assert.equal(result.unknown.after, 'unknown');
    assert.equal(result.unknown.calls, 1); assert.equal(result.unknown.archived, false);
    assert.deepEqual(result.expanded, { first: 'rejected', readonlyCalls: 1, status: 'completed', checks: 2,
      calls: 2, after: 'confirmed', score: 60, archived: true, selected: 3 });
    assert.equal(requests, 0);
    console.log('Streamlined rejected-wave Chrome passed: definitive401 -> read-only recovery -> explicit fresh validation -> one contribution, same/expanded batch with archived rejection; unknown/confirmed never resent; no EA/network.');
  } finally { await page.close(); }
}
