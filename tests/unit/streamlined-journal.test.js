import { describe, expect, it, vi } from 'vitest';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
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
