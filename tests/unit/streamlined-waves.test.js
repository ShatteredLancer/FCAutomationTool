import { expect, it } from 'vitest';
import { nextStreamlinedWave, streamlinedWaveDisposition } from '../../src/streamlined/waves.js';
import { safeItem } from '../helpers/streamlined.js';
const group = (quantity, versions = 30, source = 'market') => ({ source, quantity,
  item: safeItem({ points: 830 }), items: Array.from({ length: versions }, (_, n) => safeItem({ id: n + 1,
    definitionId: n + 100, points: 830, source })) });
const state = { limit: 30, submittedScore: 0, targetScore: 1124650, freeSlots: 100 };

it('allocates 1355 copies as distinct-version waves and never buys the whole demand upfront', () => {
  const route = { groups: [group(1355)] }; let fulfilled = 0, waves = 0;
  while (fulfilled < 1355) {
    const wave = nextStreamlinedWave(route, { ...state, submittedScore: fulfilled * 830, fulfilled: [fulfilled] });
    expect(new Set(wave.purchases.map(row => row.item.definitionId)).size).toBe(wave.purchases.length);
    expect(wave.purchases.length).toBeLessThanOrEqual(30);
    fulfilled += wave.purchases.length; waves++;
  }
  expect(fulfilled).toBe(1355); expect(waves).toBe(46);
});
it('can release a full Club by contributing inventory before procurement', () => {
  const wave = nextStreamlinedWave({ groups: [group(1, 1, 'inventory'), group(10)] }, { ...state, freeSlots: 0 });
  expect(wave).toMatchObject({ status: 'ready', reason: 'inventory-first', purchases: [] });
  expect(wave.material).toHaveLength(1);
});
it('skips held/protected definitions and already consumed exact inventory', () => {
  const wave = nextStreamlinedWave({ groups: [group(1, 1, 'inventory'), group(3, 3)] },
    { ...state, consumedIds: [1], heldDefinitions: [100], blockedDefinitions: [101] });
  expect(wave.material).toHaveLength(0); expect(wave.purchases.map(r => r.item.definitionId)).toEqual([102]);
});
it('reserves already bought material and stops purchasing when its points suffice', () => {
  const g = group(30), item = safeItem({ definitionId: 100, points: 830 });
  const wave = nextStreamlinedWave({ groups: [g] }, { ...state, targetScore: 800, ready: [{ groupIndex: 0, item }] });
  expect(wave.material).toHaveLength(1); expect(wave.purchases).toHaveLength(0);
});
it('contributes 18 after bounded scarcity, never zero, and never after Stop/unknown outcome', () => {
  const base = { readyCount: 18, readyPoints: 180, remainingScore: 1000, limit: 30, searchedAll: true, noProgressMs: 60000 };
  expect(streamlinedWaveDisposition(base)).toBe('contribute');
  expect(streamlinedWaveDisposition({ ...base, noProgressMs: 100 })).toBe('search');
  expect(streamlinedWaveDisposition({ ...base, readyCount: 0, readyPoints: 0 })).toBe('pause');
  expect(streamlinedWaveDisposition({ ...base, uncertain: true })).toBe('recover');
  expect(streamlinedWaveDisposition({ ...base, stopped: true })).toBe('stop');
  expect(streamlinedWaveDisposition({ ...base, interrupted: true })).toBe('stop');
});
