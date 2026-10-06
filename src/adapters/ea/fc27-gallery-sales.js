import { createEaTradeAdapter } from './trade.js';

const predicate = (auction, name) => {
  try { return typeof auction?.[name] === 'function' ? auction[name]() === true : null; }
  catch { return null; }
};

// Enhancer _fe.getTransferListItems: transfer list, then auction refresh.
// Kept FC27-only so this read cannot change the frozen FC26 adapter/bundle.
export function createFc27GallerySaleReader(runtime) {
  const trade = createEaTradeAdapter(runtime);
  return Object.freeze({ async refreshGallerySaleReceipts(options = {}) {
    const refreshed = await trade.refreshTransferItems(options);
    if (refreshed.status !== 'completed') return { ...refreshed, receipts: [] };
    const service = runtime?.services?.Item;
    try {
      if (typeof runtime?.repositories?.Item?.getTransferItems !== 'function') return { status: 'unsupported', receipts: [] };
      const items = Array.from(runtime.repositories.Item.getTransferItems() ?? []);
      if (items.length && typeof service?.refreshAuctions !== 'function') return { status: 'unsupported', receipts: [] };
      if (items.length) {
        const reply = service.refreshAuctions(items);
        const value = await new Promise((resolve, reject) => {
          const owner = {}, timer = setTimeout(() => {
            try { reply?.unobserve?.(owner); } catch { }
            reject(Error('FC27_GALLERY_SALES_TIMEOUT'));
          }, 20000);
          const done = value => { clearTimeout(timer); try { reply?.unobserve?.(owner); } catch { } resolve(value); };
          if (typeof reply?.observe === 'function') {
            try { reply.observe(owner, (_sender, value) => done(value)); }
            catch (error) { clearTimeout(timer); reject(error); }
          } else if (reply?.then) reply.then(done, error => { clearTimeout(timer); reject(error); });
          else done(reply);
        });
        if (value?.success !== true) return { status: 'rejected', receipts: [] };
      }
      const receipts = items.map(item => {
        const auction = item.getAuctionData?.();
        const tradeId = auction?.tradeId ?? auction?.id;
        return { itemId: Number(item.id), definitionId: Number(item.definitionId),
          listingTradeId: tradeId == null ? null : String(tradeId),
          sold: predicate(auction, 'isSold'), expired: predicate(auction, 'isExpired'),
          state: predicate(auction, 'isActiveTrade') === true ? 'active' : 'unknown',
          soldPrice: auction?.currentBid ?? null, listedPrice: auction?.buyNowPrice ?? null };
      });
      return { status: 'observed', receipts, capturedAt: Date.now() };
    } catch { return { status: 'error', receipts: [] }; }
  } });
}
