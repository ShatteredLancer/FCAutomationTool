import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { armStreamlinedReceiptCapture, projectNativeStreamlinedResponse } from '../../scripts/browser-inspection/streamlined-receipt-capture.mjs';

const marker = Symbol.for('fcat.streamlined.receipt-capture');
const response = (path = '/ut/game/fc27/sbs/challenge/61/item/submit', overrides = {}) => ({
  url: () => `https://utas.test.ea.com${path}`, request: () => ({ method: () => 'POST' }), status: () => 200,
  body: async () => Buffer.from(JSON.stringify({ setId: 31, challengeId: 61, submittedScore: 20,
    grantedChallengeAwards: [{ secret: 'never-export' }], grantedSetAwards: [],
    dynamicObjectivesUpdates: { private: 'never-export' }, token: 'never-export' })), ...overrides,
});

it('observes only the exact endpoint, exports counts and installs no duplicate observers', async () => {
  const page = new EventEmitter(), save = vi.fn(), options = { setId: 31, challengeId: 61, destination: 'fixture', save };
  armStreamlinedReceiptCapture(page, options); armStreamlinedReceiptCapture(page, options);
  expect(page.listenerCount('response')).toBe(1);
  page.emit('response', response('/ut/game/fc27/club'));
  page.emit('response', response());
  await page[marker].settled();
  expect(save).toHaveBeenCalledTimes(1);
  const text = save.mock.calls[0][1];
  expect(text).not.toContain('never-export'); expect(text).not.toContain('token');
  expect(JSON.parse(text).observations[0]).toMatchObject({ submittedScore: 20, challengeAwardCount: 1, rewardConfirmed: false });
});

it('limits capture lifetime and count, ignores malformed replies and isolates save errors', async () => {
  const page = new EventEmitter(), save = vi.fn(); let clock = 100;
  armStreamlinedReceiptCapture(page, { setId: 31, challengeId: 61, destination: 'fixture', now: () => clock, save });
  page.emit('response', response(undefined, { body: async () => Buffer.from('invalid') }));
  for (let i = 0; i < 6; i++) page.emit('response', response());
  await page[marker].settled(); expect(save).toHaveBeenCalledTimes(4);
  armStreamlinedReceiptCapture(page, { setId: 31, challengeId: 62, destination: 'fixture', now: () => clock, save });
  clock += 30 * 60 * 1000 + 1;
  page.emit('response', response('/ut/game/fc27/sbs/challenge/62/item/submit'));
  await page[marker].settled(); expect(save).toHaveBeenCalledTimes(4);
  expect(page.listenerCount('response')).toBe(1);
});

it('distinguishes absent, null, empty and malformed award fields without exporting their contents', () => {
  for (const [value, shape] of [[undefined, 'absent'], [null, 'null'], [[], 'array'], [{ private: 'secret' }, 'object']]) {
    const row = projectNativeStreamlinedResponse({ setId: 31, challengeId: 61, submittedScore: 20,
      grantedChallengeAwards: value }, { setId: 31, challengeId: 61, httpStatus: 200 });
    expect(row.challengeAwardShape).toBe(shape);
    expect(JSON.stringify(row)).not.toContain('secret');
  }
});
