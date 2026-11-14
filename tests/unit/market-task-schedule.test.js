import { describe, it, expect } from 'vitest';
import { normalizeMarketSchedule, marketScheduleWindow, advanceMarketSchedule, marketScheduleGate, validateMarketSchedules } from '../../src/trading/market-task-schedule.js';
const at = s => Date.parse(s);
const task = (schedule, mode = 'fixed') => ({ id: 'one', mode, schedule });
const once = { repeat: 'once', zone: 'Asia/Shanghai', start: '2026-11-16T08:00', end: null, sell: '2026-11-16T14:00' };
describe('scheduled market phases', () => {
 it('keeps old tasks immediate and validates exact local dates and optional end', () => {
  expect(normalizeMarketSchedule(undefined, 'fixed')).toBeNull();
  expect(normalizeMarketSchedule(once, 'fixed')).toEqual(once);
  for (const extra of [{ end: '2026-11-16T07:00' }, { start: '2026-02-30T08:00' }, { zone: 'bad' }, { sell: '2026-11-15T14:00' }])
   expect(() => normalizeMarketSchedule({ ...once, ...extra }, 'fixed')).toThrow('MARKET_SCHEDULE_INVALID');
 });
 it('converts a saved timezone independently of machine zone', () => {
  expect(marketScheduleWindow(once, at('2026-11-15T00:00Z'))).toMatchObject({ startAt: at('2026-11-16T00:00Z'), endAt: null, sellAt: at('2026-11-16T06:00Z') });
 });
 it('daily windows use next-day endpoints without ambiguous equal end', () => {
  const s = { repeat: 'daily', zone: 'Asia/Shanghai', start: '22:00', end: '02:00', sell: '08:00' };
  expect(marketScheduleWindow(s, at('2026-11-16T15:00Z'))).toMatchObject({ endAt: at('2026-11-16T18:00Z'), sellAt: at('2026-11-17T00:00Z') });
  expect(() => normalizeMarketSchedule({ ...s, end: '22:00' }, 'fixed')).toThrow();
 });
 it('rejects missing and repeated DST wall times instead of running twice', () => {
  for (const start of ['2026-03-08T02:30','2026-11-01T01:30'])
   expect(() => normalizeMarketSchedule({ ...once, zone: 'America/New_York', start, sell: null }, 'fixed')).toThrow('MARKET_SCHEDULE_TIME_AMBIGUOUS');
 });
 it('waits without buying, closes at deadline, and still allows moving paid cards', () => {
  const t = task({ ...once, end: '2026-11-16T09:00' }), state = {};
  let r = advanceMarketSchedule(state, t, at('2026-11-16T00:00Z'));
  expect(marketScheduleGate(t, r, 'buy', null, at('2026-11-15T23:00Z'))).toBe(false);
  expect(marketScheduleGate(t, r, 'buy', null, at('2026-11-16T00:30Z'))).toBe(true);
  expect(marketScheduleGate(t, r, 'buy', null, at('2026-11-16T01:00Z'))).toBe(false);
  r = advanceMarketSchedule(state, t, at('2026-11-16T01:00Z'));
  expect(r.buyClosed).toBe('deadline');
  expect(marketScheduleGate(t, r, 'move', null, at('2026-11-16T02:00Z'))).toBe(true);
  expect(marketScheduleGate(t, r, 'list', { sellAt: r.sellAt }, at('2026-11-16T02:00Z'))).toBe(false);
  expect(marketScheduleGate(t, r, 'list', { sellAt: r.sellAt }, at('2026-11-16T06:00Z'))).toBe(true);
 });
 it('persists full closure across continuation and never replaces an open daily round', () => {
  const t = task({ ...once, repeat: 'daily', start: '08:00', sell: '14:00' }), state = {};
  const r = advanceMarketSchedule(state, t, at('2026-11-16T00:00Z'));
  expect(advanceMarketSchedule(state, t, at('2026-11-17T00:00Z')).startAt).toBe(r.startAt);
  r.buyClosed = 'full';
  expect(advanceMarketSchedule(state, t, at('2026-11-16T09:00Z')).buyClosed).toBe('full');
  expect(advanceMarketSchedule(state, t, at('2026-11-17T00:00Z')).startAt).toBe(at('2026-11-17T00:00Z'));
  expect(state.schedules).toHaveLength(1);
  expect(() => validateMarketSchedules(state.schedules)).not.toThrow();
 });
 it('old holdings retain their own sale time after the next daily round', () => {
  const t=task(once), r=marketScheduleWindow(once,0);
  expect(marketScheduleGate(t,r,'list',{sellAt:at('2026-11-15T00:00Z')},at('2026-11-16T01:00Z'))).toBe(true);
  expect(marketScheduleGate(t,r,'sales',null,0)).toBe(true);
 });
 it('rejects corrupted or duplicate persisted phases', () => {
  const state={};advanceMarketSchedule(state,task(once),0);
  expect(()=>validateMarketSchedules([...state.schedules,...state.schedules])).toThrow();
  expect(()=>validateMarketSchedules([{...state.schedules[0],buyClosed:'made-up'}])).toThrow();
 });
});
