import { expect, it } from 'vitest';
import { createStreamlinedJournal, streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import { testPlan } from '../helpers/streamlined.js';

async function fixture() {
  const memory = new Map(), plan = testPlan();
  const journal = createStreamlinedJournal({ get: async key => memory.get(key),
    set: async (key, value) => memory.set(key, structuredClone(value)), now: () => 100 });
  const record = await journal.begin(plan), batch = record.batches[0];
  batch.state = 'confirmed'; batch.startingScore = 0;
  batch.receipt = normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
    setId: plan.challenge.setId, challengeId: plan.challenge.id, submittedScore: 20,
  } }, { setId: plan.challenge.setId, challengeId: plan.challenge.id, previousScore: 0, itemIds: batch.refs.map(ref => ref.id) });
  record.submittedScore = 20;
  return { journal, memory, plan, saved: await journal.write(plan.context, record, record.revision) };
}

it('explicitly retires only unsent stock remainder and keeps exact confirmed receipts in history', async () => {
  const f = await fixture(), key = streamlinedJournalKey(f.plan.context);
  await f.journal.retire(f.saved);
  expect(await f.journal.read(f.plan.context)).toBeNull();
  expect(f.memory.get(`${key}:history:${f.saved.revision}`)).toEqual(f.saved);
  await expect(f.journal.write(f.plan.context, f.saved, f.saved.revision)).rejects.toThrow('JOURNAL_CHANGED');
  expect((await f.journal.begin(f.plan)).revision).toBeGreaterThan(f.saved.revision);
  expect(f.memory.get(`${key}:history:${f.saved.revision}`)).toEqual(f.saved);
});

it.each(['pending', 'unknown', 'receipt-missing', 'progress-changed', 'stale', 'archive-conflict'])
('does not retire %s history', async kind => {
  const f = await fixture(), key = streamlinedJournalKey(f.plan.context);
  if (['pending', 'unknown'].includes(kind)) f.saved.batches[1].state = kind;
  if (kind === 'receipt-missing') delete f.saved.batches[0].receipt;
  if (kind === 'progress-changed') f.saved.batches[0].progressChanged = true;
  if (kind === 'archive-conflict') f.memory.set(`${key}:history:${f.saved.revision}`, { conflict: true });
  f.memory.set(key, structuredClone(f.saved));
  const expected = structuredClone(f.saved);
  if (kind === 'stale') expected.revision--;
  await expect(f.journal.retire(expected)).rejects.toThrow();
  expect(f.memory.get(key)).toEqual(f.saved);
});

it('keeps the old record after a retirement write failure and safely retries without replacing its history', async () => {
  const f = await fixture(), key = streamlinedJournalKey(f.plan.context);
  let failed = false;
  const journal = createStreamlinedJournal({ get: async key => f.memory.get(key),
    set: async (storedKey, value) => {
      if (storedKey === key && value.retired && !failed) { failed = true; throw Error('disk'); }
      f.memory.set(storedKey, structuredClone(value));
    }, now: () => 100 });
  await expect(journal.retire(f.saved)).rejects.toThrow('JOURNAL_WRITE_FAILED');
  expect(await journal.read(f.plan.context)).toEqual(f.saved);
  expect(f.memory.get(`${key}:history:${f.saved.revision}`)).toEqual(f.saved);
  await journal.retire(f.saved);
  expect(await journal.read(f.plan.context)).toBeNull();
  expect(f.memory.get(`${key}:history:${f.saved.revision}`)).toEqual(f.saved);
});
