import { createFc27StreamlinedPersistence } from './fc27-streamlined-persistence.js';
import { createFc27StreamlinedProvider } from '../ea/fc27-streamlined-provider.js';
import { createFc27StreamlinedPageMaintenance } from '../ea/fc27-streamlined-page.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { createStreamlinedTransaction } from '../../streamlined/transaction.js';
import { fail, same } from '../../streamlined/contract.js';
import { traditionalJournalScope, normalizeTraditionalJournal, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { assertPuzzleBuyTargetAvailable } from '../../fc27/puzzle-buy-lifecycle.js';
import { maintainFc27PuzzlePurchases } from './fc27-puzzle-buy-lifecycle.js';
import { galleryPurchasePendingKey } from '../../gallery/purchase-session.js';
import { assertGalleryRelistSettled } from '../../gallery/relist-recovery.js';

export async function assertStreamlinedOtherTransactions(get, context) {
  const scope = traditionalJournalScope(context), raw = await get(scope, null);
  if (raw !== null && !isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, raw))) throw Error('FC27_RECOVERY_REQUIRED');
  await assertPuzzleBuyTargetAvailable(get, scope, null, context);
  if (await get(galleryPurchasePendingKey(scope), null) !== null) throw Error('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  await assertGalleryRelistSettled(get, scope);
}

export async function createFc27StreamlinedExecution(root, { context, get, set, lockManager,
  canWrite = () => false, now = () => Date.now(), createMaintenance = createFc27StreamlinedPageMaintenance,
  createProvider = createFc27StreamlinedProvider } = {}) {
  await maintainFc27PuzzlePurchases(root, { get, set });
  await assertStreamlinedOtherTransactions(get, context);
  if (!same(readFc27Context(root), context)) fail('CONTEXT_CHANGED');
  const persistence = createFc27StreamlinedPersistence({ context, get, set, lockManager,
    readContext: () => readFc27Context(root), now });
  const maintenance = await createMaintenance(root, { now });
  const adapter = createProvider(root, { journal: persistence.journal, canWrite, now, maintenance,
    checkOtherTransactions: () => assertStreamlinedOtherTransactions(get, context) });
  const transaction = createStreamlinedTransaction({ adapter, ...persistence, now });
  return Object.freeze({ transaction, journal: persistence.journal,
    prepare(plan) {
      if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
      if (!persistence.inspect().supported) fail('EXCLUSIVE_ACCESS_REQUIRED');
      if (plan.challenge.status !== 'IN_PROGRESS') fail('INITIATION_UNVERIFIED');
      if (plan.items.some(item => item.source !== 'inventory')) fail('PURCHASE_PENDING');
      if (plan.items.some(item => !['club', 'storage'].includes(item.pile))) fail('PILE_UNVERIFIED');
      maintenance.prepare(plan.items);
      return true;
    },
  });
}
