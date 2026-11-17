import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const io = vi.hoisted(() => ({ readFile: vi.fn(), unlink: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:fs/promises', () => io);
vi.mock('esbuild', () => ({ build: async () => ({ outputFiles: [{ text: '' }] }) }));
import { startRequestedSessionMonitor } from '../../scripts/browser-inspection/market-session-monitor.mjs';

function fixture(result = { status: 'online', reads: 1 }) {
  io.readFile.mockReset().mockResolvedValue('{"start":true}'); io.unlink.mockReset().mockResolvedValue(); io.writeFile.mockReset().mockResolvedValue();
  const page = new EventEmitter();
  page.evaluate = vi.fn(async expression => typeof expression === 'string' ? undefined : String(expression).includes('?.check()') ? result : undefined);
  return page;
}
it('requires an explicit local request and never starts from opening the ordinary checker', async () => {
  const page = fixture(); io.readFile.mockRejectedValue(Error('absent'));
  expect(await startRequestedSessionMonitor(page, '/fixture')).toBeNull(); expect(page.evaluate).not.toHaveBeenCalled();
});
it('samples once per three minutes, shares one monitor, and stops after one hour', async () => {
  vi.useFakeTimers();
  try {
    const page = fixture(); await startRequestedSessionMonitor(page, '/fixture');
    expect(await startRequestedSessionMonitor(page, '/fixture')).toEqual({ status: 'already-observing' });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(179999); expect(page.evaluate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(page.evaluate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60000);
    const saved = JSON.parse(io.writeFile.mock.calls.at(-1)[1]);
    expect(saved.status).toBe('completed-no-failure'); expect(saved.samples).toHaveLength(19);
    expect(saved.taskStarts).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it.each(['renewed','renewal-failed','blocked','page-changed'])('stops and retains evidence after %s instead of polling repeatedly', async status => {
  vi.useFakeTimers();
  try {
    const page = fixture({ status, reads: 2 }); await startRequestedSessionMonitor(page, '/fixture');
    await vi.advanceTimersByTimeAsync(180001);
    expect(JSON.parse(io.writeFile.mock.calls.at(-1)[1]).status).toBe(status);
    expect(vi.getTimerCount()).toBe(0); page.emit('close');
    expect(JSON.parse(io.writeFile.mock.calls.at(-1)[1]).status).toBe(status);
  } finally { vi.useRealTimers(); }
});
