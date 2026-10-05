import { expect, it, vi } from 'vitest';
import { startGalleryTradingPoll } from '../../src/adapters/browser/fc27-gallery-trading-poll.js';

it('runs listing before relist and never starts a second tick while busy', async () => {
  const callbacks = [], timers = { setInterval: vi.fn(fn => { callbacks.push(fn); return 1; }), clearInterval: vi.fn() };
  let release; const listing = { pollSchedule: vi.fn(() => new Promise(resolve => { release = resolve; })), stop: vi.fn() };
  const relist = { poll: vi.fn(), stop: vi.fn() }, poll = startGalleryTradingPoll({ timers, listing, relist });
  const first = poll.tick(); const second = poll.tick();
  expect(listing.pollSchedule).toHaveBeenCalledTimes(1); expect(relist.poll).not.toHaveBeenCalled();
  release({ status: 'waiting-time' }); await first; await second;
  expect(relist.poll).toHaveBeenCalledTimes(1);
  poll.dispose(); expect(timers.clearInterval).toHaveBeenCalledWith(1); expect(listing.stop).toHaveBeenCalled(); expect(relist.stop).toHaveBeenCalled();
});

it('keeps service failures isolated and reports durable blocked results', async () => {
  const timers = { setInterval: fn => { timers.fn = fn; return 2; }, clearInterval: vi.fn() }, updates = [];
  const listing = { pollSchedule: vi.fn(async () => { throw Error('listing'); }), stop: vi.fn() };
  const relist = { poll: vi.fn(async () => ({ status: 'blocked', reason: 'FC27_GALLERY_RELIST_RECOVERY_REQUIRED' })), stop: vi.fn() };
  const poll = startGalleryTradingPoll({ timers, listing, relist, onUpdate: value => updates.push(value) });
  await poll.tick();
  expect(relist.poll).toHaveBeenCalledTimes(1); expect(updates).toEqual([{ status: 'blocked', reason: 'FC27_GALLERY_RELIST_RECOVERY_REQUIRED' }]);
  poll.dispose();
});
