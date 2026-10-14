import { expect, it, vi } from 'vitest';
import { runStreamlinedRoutes } from '../../src/streamlined/routes.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { yieldStreamlinedTask, runStreamlinedSteps } from '../../src/streamlined/scheduling.js';

const input = () => ({ challenge: challenge({ scoreRequirement: 35 }), policy, eligibility, inventory: [],
  quoteSource: 'futgg', quoteAt: 10, market: [[5, 150], [8, 300], [13, 600]].map(([points, price], index) =>
    safeItem({ source: 'market', definitionId: index + 10, points, price,
      quote: { definitionId: index + 10, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 } })) });

it('uses an available native task yield rather than a timer for default cooperative planning', async () => {
  const yieldTask = vi.fn(async () => {});
  vi.stubGlobal('scheduler', { yield: yieldTask });
  vi.stubGlobal('setTimeout', () => { throw Error('timer was throttled'); });
  try {
    const result = await runStreamlinedRoutes(input());
    expect(result).toMatchObject({ status: 'ready', searchComplete: true });
    expect(result.routes[0].purchaseCost).toBe(1050); expect(yieldTask).toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it('reports scheduling delay separately without extending the original search deadline', async () => {
  let clock = 0;
  const result = await runStreamlinedRoutes(input(), { now: () => clock, metricsNow: () => clock, maxMs: 100,
    schedule: async () => { clock += 200; } });
  expect(result.reason).toBe('FC27_STREAMLINED_SEARCH_TIME');
  expect(result).toMatchObject({ schedulingMs: 200, processingMs: 0, wallElapsedMs: 200, searchComplete: false });
});

it('closes both owned message ports after fallback yield or failed posting', async () => {
  for (const rejected of [false, true]) {
    const ports = [0, 1].map(() => ({ close: vi.fn() }));
    ports[1].postMessage = () => { if (rejected) throw Error('post failed'); queueMicrotask(() => ports[0].onmessage()); };
    const host = { MessageChannel: class { port1 = ports[0]; port2 = ports[1]; } };
    const yielded = yieldStreamlinedTask(host);
    if (rejected) await expect(yielded).rejects.toThrow('post failed'); else await yielded;
    for (const port of ports) expect(port.close).toHaveBeenCalledOnce();
  }
});

it('retains timer fallback on unsupported hosts and closes an iterator on cancellation or scheduler error', async () => {
  const timer = vi.fn(resolve => resolve()); await yieldStreamlinedTask({ setTimeout: timer });
  expect(timer).toHaveBeenCalledWith(expect.any(Function), 0);
  for (const rejected of [false, true]) {
    let closed = false;
    function* steps() { try { const stopped = yield { nodes: 1 }; return { status: stopped ? 'cancelled' : 'ready' }; } finally { closed = true; } }
    const result = runStreamlinedSteps(steps(), { stopped: () => true, metricsNow: () => 0,
      schedule: async () => { if (rejected) throw Error('yield failed'); } });
    if (rejected) await expect(result).rejects.toThrow('yield failed'); else expect((await result).status).toBe('cancelled');
    expect(closed).toBe(true);
  }
});

it('does not let an unavailable diagnostic clock alter the planning outcome', async () => {
  function* steps() { yield { nodes: 1 }; return { status: 'ready', nodes: 1 }; }
  const result = await runStreamlinedSteps(steps(), { schedule: async () => {}, metricsNow: () => { throw Error('clock unavailable'); } });
  expect(result).toMatchObject({ status: 'ready', nodes: 1 });
  expect(result.wallElapsedMs).toBeUndefined(); expect(result.processingMs).toBeUndefined(); expect(result.schedulingMs).toBeUndefined();
});
