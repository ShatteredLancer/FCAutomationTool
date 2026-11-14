import { describe, it, expect, vi } from 'vitest';
import { createMarketTaskCatalog, taskCandidatePage } from '../../src/trading/market-task-catalog.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';

const context = () => ({ scope: 'A', season: '27', platform: 'console' });
const card = id => Object.defineProperty({ definitionId: id, playerId: id, name: `Player ${id}`, rating: 84, rarity: 1, leagueId: 13,
  nationId: 1, teamId: 2, preferredPosition: 'GK' }, 'price', { get() { throw Error('no quote reads'); } });
const task = () => ({ settings: defaultTradingTaskSettings(), excluded: [] });

describe('market task immutable catalog and bounded candidates', () => {
  it('does nothing on construction; batches wide 50k input and pages without a giant match list', async () => {
    const rows = Array.from({ length: 50000 }, (_, i) => card(i + 1)), readRows = vi.fn(() => rows), yieldControl = vi.fn(async () => {});
    const catalog = createMarketTaskCatalog({ readRows, context, yieldControl }); expect(readRows).not.toHaveBeenCalled();
    const snapshot = await catalog.read(); expect(snapshot.complete).toBe(false); expect(yieldControl.mock.calls.length).toBeGreaterThan(300);
    expect(snapshot.rows).toHaveLength(50000); expect(Object.isFrozen(snapshot.rows[0])).toBe(true);
    const first = await taskCandidatePage(snapshot, task()); expect(first.rows.map(r => r.definitionId)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const next = await taskCandidatePage(snapshot, task(), { cursor: first.next }); expect(next.rows[0].definitionId).toBe(21);
    expect(await catalog.lookup([50000])).toHaveLength(1); expect(readRows).toHaveBeenCalledTimes(1);
  });
  it('changes revision for equal-length metadata changes but leaves the running snapshot frozen', async () => {
    let rows = [card(1)], account = context();
    const catalog = createMarketTaskCatalog({ readRows: () => rows, context: () => account });
    const a = await catalog.read(); expect(await catalog.read()).toBe(a);
    rows = [{ ...card(1), rating: 85 }]; const b = await catalog.read();
    expect(b.revision).not.toBe(a.revision); expect(a.rows[0].rating).toBe(84);
    account = { ...account, scope: 'B' }; expect((await catalog.read()).revision).not.toBe(b.revision);
  });
  it('merges missing facts but drops contradictory exact definitions and modified cards', async () => {
    const rows = [card(1), { ...card(1), playerId: null, rarity: null, name: 'Localized' }, card(2), { ...card(2), rating: 85 },
      { ...card(3), evolution: true }, { ...card(4), cosmetic: true }];
    const snapshot = await createMarketTaskCatalog({ readRows: () => rows, context }).read();
    expect(snapshot.rows.map(r => r.definitionId)).toEqual([1]); expect(snapshot.rows[0]).toMatchObject({ quality: 'gold', preferredPosition: 0 });
  });
  it('requires known requested fields and applies shared version/all-person exclusions before quoting', async () => {
    const rows = [card(1), { ...card(2), playerId: 1 }, { ...card(3), playerId: null }, { ...card(4), leagueId: null }, card(5)];
    const snapshot = await createMarketTaskCatalog({ readRows: () => rows, context }).read(), t = task();
    t.settings.league = 13; t.excluded = [{ type: 'player', id: 1 }];
    expect((await taskCandidatePage(snapshot, t)).rows.map(r => r.definitionId)).toEqual([5]);
    t.excluded = [{ type: 'version', id: 5 }];
    expect((await taskCandidatePage(snapshot, t)).rows.map(r => r.definitionId)).toEqual([1, 2, 3]);
  });
  it('cancels normalization and sparse matching cooperatively', async () => {
    let current = true; const rows = Array.from({ length: 1000 }, (_, i) => card(i + 1));
    const catalog = createMarketTaskCatalog({ readRows: () => rows, context, yieldControl: async () => { current = false; } });
    await expect(catalog.read({ isCurrent: () => current })).rejects.toThrow('CONTEXT_CHANGED');
    const snapshot = await createMarketTaskCatalog({ readRows: () => rows, context, yieldControl: async () => {} }).read();
    current = true; const t = task(); t.settings.league = 99;
    await expect(taskCandidatePage(snapshot, t, { isCurrent: () => current, yieldControl: async () => { current = false; } })).rejects.toThrow('USER_STOP');
  });
});
