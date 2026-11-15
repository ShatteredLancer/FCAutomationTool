import { it, expect, vi } from 'vitest';
import { createMarketTaskRuntime } from '../../src/trading/market-task-runtime.js';

const context = { scope: 'synthetic', season: '27', platform: 'console' };
function fixture() {
  let account = context, release;
  const make = () => ({ inspect: () => ({ available: true, busy: false }), subscribe: () => () => {},
    dispose: vi.fn(), pauseAll: vi.fn(), pause: vi.fn(), stop: vi.fn(),
    run: vi.fn(), enqueue: vi.fn(), recover: vi.fn(), acknowledgeStop: vi.fn() });
  const created = [], factory = vi.fn(async () => { await new Promise(resolve => { release = resolve; }); const result = make(); created.push(result); return result; });
  const runtime = createMarketTaskRuntime({ context: () => account, enabled: true, createScheduler: factory });
  return { runtime, factory, created, release: () => release(), account: value => { account = value; } };
}
it('does no initialization on inspect/subscribe or missing approval and never resumes on readonly recovery', async () => {
  const f = fixture(); f.runtime.inspect(); f.runtime.subscribe(() => {});
  await expect(f.runtime.run()).rejects.toThrow('APPROVAL_REQUIRED'); expect(f.factory).not.toHaveBeenCalled();
  const pending = f.runtime.recover(); f.release(); await pending;
  expect(f.created[0].recover).toHaveBeenCalledTimes(1); expect(f.created[0].run).not.toHaveBeenCalled();
  await f.runtime.run({ approved: true }); expect(f.factory).toHaveBeenCalledTimes(1);
  expect(f.created[0].run).toHaveBeenCalledTimes(1);
});
it.each(['pauseAll', 'pause', 'stop', 'dispose'])('revokes delayed initialization on %s with no late run', async action => {
  const f = fixture(), pending = f.runtime.run({ approved: true });
  expect(f.runtime.inspect()).toMatchObject({ busy: true, phase: 'initialize' });
  f.runtime[action]('one'); f.release(); await expect(pending).rejects.toThrow();
  expect(f.created[0].run).not.toHaveBeenCalled(); expect(f.created[0].dispose).toHaveBeenCalledTimes(1);
});
it('rejects concurrent starts and changed accounts without reusing the old scheduler', async () => {
  const f = fixture(), pending = f.runtime.run({ approved: true });
  await expect(f.runtime.run({ approved: true })).rejects.toThrow('MARKET_BUSY');
  f.account({ ...context, scope: 'other' }); f.release(); await expect(pending).rejects.toThrow('CONTEXT_CHANGED');
  expect(f.created[0].run).not.toHaveBeenCalled();
  const fresh = f.runtime.run({ approved: true }); f.release(); await fresh;
  expect(f.created[1].run).toHaveBeenCalledTimes(1);
});

it('page teardown is idempotent and a restored page cannot resume its disposed runtime', async () => {
  const f = fixture(), first = f.runtime.run({ approved: true });
  f.release(); await first;
  f.runtime.dispose(); f.runtime.dispose();
  expect(f.created[0].dispose).toHaveBeenCalledTimes(1);
  await expect(f.runtime.run({ approved: true })).rejects.toThrow('TASKS_EXECUTION_UNAVAILABLE');
  expect(f.created[0].run).toHaveBeenCalledTimes(1);
});

it('publishes a bounded initialization failure even when the task panel is hidden', async () => {
  const createScheduler = vi.fn(async () => { throw Error('MARKET_AUTHENTICATION'); });
  const runtime = createMarketTaskRuntime({ context: () => context, enabled: true, createScheduler });
  const states = []; runtime.subscribe(state => states.push(state));
  await expect(runtime.run({ approved: true })).rejects.toThrow('MARKET_AUTHENTICATION');
  expect(states.at(-1)).toMatchObject({ busy: false, reason: 'MARKET_AUTHENTICATION', tasks: [] });
  expect(createScheduler).toHaveBeenCalledTimes(1);
});
