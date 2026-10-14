import { expect, it } from 'vitest';
import { streamlinedPurchaseAudit } from '../../src/streamlined/purchase-journal.js';

it('shows a completed market run as settled only when its actual receipt states are settled', () => {
  const record = { completed: true, contribution: null, confirmedBatches: 2, consumedIds: [1, 2],
    entries: [{ source: 'market', state: 'consumed' }, { source: 'market', state: 'consumed' },
      { source: 'market', state: 'rejected' }, { source: 'inventory', state: 'ready' }] };
  expect(streamlinedPurchaseAudit(record)).toEqual({ pendingWriteCount: 0, unconsumedPurchaseCount: 0,
    contributedCount: 2, confirmedBatches: 2, purchasesSettled: true });
  expect(streamlinedPurchaseAudit({ ...record, contribution: {}, entries: [...record.entries, { source: 'market', state: 'move-pending' }] }))
    .toMatchObject({ pendingWriteCount: 2, unconsumedPurchaseCount: 1, purchasesSettled: false });
});

it('does not manufacture an all-clear audit from missing records or expose item/trade identities', () => {
  for (const value of [null, {}, { entries: [] }, { entries: [{ state: 'unknown' }], consumedIds: [] }])
    expect(streamlinedPurchaseAudit(value)).toEqual({});
  const audit = streamlinedPurchaseAudit({ entries: [{ source: 'market', state: 'club', itemId: 123456, tradeId: '987654' }], consumedIds: [] });
  expect(audit).toMatchObject({ pendingWriteCount: 0, unconsumedPurchaseCount: 1, purchasesSettled: false });
  expect(JSON.stringify(audit)).not.toMatch(/123456|987654|itemId|tradeId/);
});
