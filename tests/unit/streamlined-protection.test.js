import { expect, it, vi } from 'vitest';
import { normalizeStreamlinedProtectionFailure } from '../../src/streamlined/protection.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';

it('accepts fixed protection phases and bounded facts only, without invoking accessors', () => {
  const getter = vi.fn(() => 'private-value'), value = { phase: 'protection-slot-id',
    count: 23, unknownCount: 1, offset: 22, mismatch: 'undefined', cached: true,
    requiredSlots: Infinity, itemId: 123456, raw: {}, account: 'private-account' };
  Object.defineProperty(value, 'token', { get: getter });
  expect(normalizeStreamlinedProtectionFailure(value)).toEqual({ phase: 'protection-slot-id',
    count: 23, unknownCount: 1, offset: 22, mismatch: 'undefined', cached: true });
  const accessorPhase = {}; Object.defineProperty(accessorPhase, 'phase', { get: getter });
  expect(normalizeStreamlinedProtectionFailure(accessorPhase)).toBeNull();
  expect(normalizeStreamlinedProtectionFailure({ phase: 'arbitrary-input' })).toBeNull();
  expect(normalizeStreamlinedProtectionFailure({ phase: 'protection-active-state', mismatch: 'inactive' }))
    .toEqual({ phase: 'protection-active-state', mismatch: 'inactive' });
  expect(normalizeStreamlinedProtectionFailure({ phase: 'protection-cache', count: 20001, offset: -1, cached: 'true', mismatch: 'private-account' }))
    .toEqual({ phase: 'protection-cache' });
  expect(getter).not.toHaveBeenCalled();
});

it('persists the failed stage in exported diagnostics without physical or account identities', async () => {
  const store = new Map(), get = async key => store.get(key), set = async (key, value) => store.set(key, value);
  const log = createFcatDiagnosticLog({ gmGetValue: get, gmSetValue: set, version: '27.0.21', now: () => 1000 });
  await log.record({ area: 'streamlined', event: 'plan', status: 'blocked', reason: 'FC27_STREAMLINED_PROTECTION_UNVERIFIED',
    ...normalizeStreamlinedProtectionFailure({ phase: 'protection-slot-list', count: 11, requiredSlots: 23, mismatch: 'length' }),
    account: 'private-account', itemId: 123456, raw: [1, 2, 3] });
  const payload = await log.exportPayload();
  for (const key of ['entries', 'criticalEntries', 'performanceEntries']) expect(payload[key][0])
    .toMatchObject({ phase: 'protection-slot-list', count: 11, requiredSlots: 23, mismatch: 'length' });
  expect(JSON.stringify(payload)).not.toMatch(/private-account|itemId|123456|"raw"/);
});
