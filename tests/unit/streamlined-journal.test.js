import { describe, expect, it, vi } from 'vitest';
import { createStreamlinedJournal, streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { testPlan, safeItem, challenge } from '../helpers/streamlined.js';

describe('Streamlined Journal', () => {
  it('writes and restores exact plan batches', async () => {
    const store = new Map(), journal = createStreamlinedJournal({ get: async key => store.get(key), set: async (key, value) => store.set(key, structuredClone(value)), now: () => 100 });
    const plan = testPlan(), written = await journal.begin(plan);
    expect(written).toMatchObject({ revision: 1, updatedAt: 100, submittedScore: 0 });
    expect((await journal.read(plan.context)).plan).toEqual(plan);
    await expect(journal.write(plan.context, written, 0)).rejects.toThrow('JOURNAL_CHANGED');
    expect((await journal.begin(plan)).revision).toBe(2);
  });
  it('replaces an untouched waiting journal when its captured score is stale', async () => {
    const store = new Map(), journal = createStreamlinedJournal({ get: async key => store.get(key),
      set: async (key, value) => store.set(key, structuredClone(value)) });
    const old = testPlan(), first = await journal.begin(old);
    const next = testPlan({ challenge: challenge({ scoreRequirement: 40, submittedScore: 20, selectionLimit: 1 }),
      inventory: [safeItem({ id: 7, definitionId: 8, points: 40 })] });
    const replaced = await journal.begin(next);
    expect(replaced.revision).toBe(first.revision + 1);
    expect(replaced.plan.fingerprint).toBe(next.fingerprint);
  });
  it('fails closed on corrupt storage and write errors', async () => {
    const journal = createStreamlinedJournal({ get: async () => ({ bad: true }), set: vi.fn(async () => { throw Error('disk'); }) });
    const plan = testPlan();
    await expect(journal.read(plan.context)).rejects.toThrow('JOURNAL_INVALID');
    for (const set of [async () => { throw Error('disk'); }, async () => {}]) {
      await expect(createStreamlinedJournal({ get: async () => null, set }).begin(plan)).rejects.toThrow('JOURNAL_WRITE_FAILED');
    }
    await expect(createStreamlinedJournal({ get: async () => { throw Error('disk'); } }).read(plan.context)).rejects.toThrow('JOURNAL_READ_FAILED');
  });
  it('isolates accounts and rejects cross-account records', async () => {
    const store = new Map(), journal = createStreamlinedJournal({ get: async key => store.get(key), set: async (key, value) => store.set(key, structuredClone(value)) });
    const plan = testPlan(), other = { ...plan.context, accountScope: 'fixture:other' };
    const record = await journal.begin(plan);
    expect(await journal.read(other)).toBeNull();
    await expect(journal.write(other, record)).rejects.toThrow('JOURNAL_INVALID');
  });
});

async function rejectedWave() {
  const store = new Map(); let archiveMode = null;
  const journal = createStreamlinedJournal({ get: async key => store.get(key), now: () => 100,
    set: async (key, value) => {
      if (key.includes(':history:')) {
        if (archiveMode === 'throw') throw Error('synthetic storage error');
        if (archiveMode === 'drop') return;
      }
      store.set(key, structuredClone(value));
    } });
  const plan = testPlan({ challenge: challenge({ scoreRequirement: 40, selectionLimit: 30 }) });
  const first = await journal.begin(plan);
  Object.assign(first.batches[0], { state: 'rejected', startingScore: 0 });
  const prior = await journal.write(plan.context, first, first.revision);
  return { store, journal, plan, prior, setArchiveMode: value => { archiveMode = value; } };
}

it('archives an exact rejected single wave before beginning its explicit retry', async () => {
  const f = await rejectedWave();
  const next = await f.journal.begin(f.plan, { restartRejected: true, expectedRevision: f.prior.revision });
  expect(next).toMatchObject({ submittedScore: 0, revision: f.prior.revision + 1, batches: [{ state: 'waiting' }] });
  expect(next.batches[0].startingScore).toBeUndefined();
  expect(f.store.get(`${streamlinedJournalKey(f.plan.context)}:history:${f.prior.revision}`)).toEqual(f.prior);
});

it.each(['waiting', 'pending', 'unknown', 'confirmed', 'no-start', 'progress-changed'])('never rearms an inner %s record', async state => {
  const f = await rejectedWave(), row = structuredClone(f.prior);
  if (state === 'no-start') delete row.batches[0].startingScore;
  else if (state === 'progress-changed') row.batches[0].progressChanged = true;
  else {
    row.batches[0].state = state;
    if (state === 'waiting') delete row.batches[0].startingScore;
    if (state === 'confirmed') row.submittedScore = 40;
  }
  const before = await f.journal.write(f.plan.context, row, f.prior.revision);
  await expect(f.journal.begin(f.plan, { restartRejected: true, expectedRevision: before.revision })).rejects.toThrow('RECOVERY_REQUIRED');
  expect(await f.journal.read(f.plan.context)).toEqual(before);
});

it.each(['throw', 'drop', 'conflict'])('leaves the rejection active if archival %s prevents a verified checkpoint', async mode => {
  const f = await rejectedWave(); f.setArchiveMode(mode);
  if (mode === 'conflict') f.store.set(`${streamlinedJournalKey(f.plan.context)}:history:${f.prior.revision}`, { unrelated: true });
  await expect(f.journal.begin(f.plan, { restartRejected: true, expectedRevision: f.prior.revision })).rejects.toThrow('JOURNAL_ARCHIVE_FAILED');
  expect(await f.journal.read(f.plan.context)).toEqual(f.prior);
});

it('requires the same frozen plan and journal revision to restart a rejection', async () => {
  const f = await rejectedWave();
  const other = testPlan({ challenge: f.plan.challenge, inventory: [safeItem({ id: 99, definitionId: 199, points: 40 })] });
  for (const [plan, expectedRevision] of [[other, f.prior.revision], [f.plan, f.prior.revision - 1]]) {
    await expect(f.journal.begin(plan, { restartRejected: true, expectedRevision })).rejects.toThrow('RECOVERY_REQUIRED');
    expect(await f.journal.read(f.plan.context)).toEqual(f.prior);
  }
});

it('archives a rejected wave when the same approved target replaces its material composition', async () => {
  const f = await rejectedWave();
  const nextPlan = testPlan({ challenge: f.plan.challenge, inventory: [safeItem({ id: 99, definitionId: 199, points: 40 })] });
  const next = await f.journal.begin(nextPlan, { replaceRejected: true, expectedRevision: f.prior.revision });
  expect(next.plan.fingerprint).toBe(nextPlan.fingerprint);
  expect(next.batches[0].state).toBe('waiting');
  expect(f.store.get(`${streamlinedJournalKey(f.plan.context)}:history:${f.prior.revision}`)).toEqual(f.prior);
});

it.each(['pending', 'unknown', 'confirmed', 'target', 'policy', 'revision'])(
  'does not replace a rejected wave across a %s boundary', async kind => {
    const f = await rejectedWave(), row = structuredClone(f.prior);
    if (['pending', 'unknown', 'confirmed'].includes(kind)) {
      row.batches[0].state = kind; if (kind === 'confirmed') row.submittedScore = 40;
      f.prior = await f.journal.write(f.plan.context, row, f.prior.revision);
    }
    const nextPlan = testPlan({ challenge: kind === 'target' ? challenge({ scoreRequirement: 50, selectionLimit: 30 }) : f.plan.challenge,
      policy: kind === 'policy' ? { ...f.plan.policy, protectFsuLockedPlayers: true } : f.plan.policy,
      inventory: [safeItem({ id: 99, definitionId: 199, points: kind === 'target' ? 50 : 40 })] });
    await expect(f.journal.begin(nextPlan, { replaceRejected: true, expectedRevision: f.prior.revision - Number(kind === 'revision') }))
      .rejects.toThrow('RECOVERY_REQUIRED');
    expect(await f.journal.read(f.plan.context)).toEqual(f.prior);
  });
