// Read-only accounting for Gallery purchases.  This module deliberately has
// no EA or market calls: sale facts must come from an exact listing receipt.
export const GALLERY_NET_COST_SCHEMA = 1;
export const GALLERY_MARKET_TAX_BPS = 500;

const STATES = new Set(['held', 'listed', 'sold', 'unsold', 'unknown']);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const id = value => integer(value, 1);
const price = value => integer(value, 150, 15000000);

function normalizePurchase(value) {
  if (!value || !id(value.itemId) || !id(value.definitionId) || !price(value.purchasePrice)) return null;
  const state = STATES.has(value.state) ? value.state : 'held';
  if (value.listedPrice != null && !price(value.listedPrice)) return null;
  if (state === 'sold' && !price(value.soldPrice)) return null;
  if (state !== 'sold' && value.soldPrice != null) return null;
  return {
    itemId: value.itemId,
    definitionId: value.definitionId,
    purchasePrice: value.purchasePrice,
    tradeId: typeof value.tradeId === 'string' && /^[1-9]\d{0,19}$/.test(value.tradeId) ? value.tradeId : null,
    purchasedAt: integer(value.purchasedAt) ? value.purchasedAt : null,
    state,
    listedPrice: price(value.listedPrice) ? value.listedPrice : null,
    soldPrice: price(value.soldPrice) ? value.soldPrice : null,
    soldAt: integer(value.soldAt) ? value.soldAt : null,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 160) : null,
  };
}

export function normalizeGalleryNetCostLedger(input = {}) {
  if (!input || typeof input !== 'object' || input.schema !== GALLERY_NET_COST_SCHEMA) return null;
  const entries = Array.isArray(input.entries) ? input.entries.map(normalizePurchase) : [];
  if (entries.some(entry => !entry) || new Set(entries.map(entry => entry.itemId)).size !== entries.length) return null;
  const taxBps = input.taxBps ?? GALLERY_MARKET_TAX_BPS;
  if (!integer(taxBps, 0, 10000)) return null;
  return { schema: GALLERY_NET_COST_SCHEMA, scope: typeof input.scope === 'string' ? input.scope.slice(0, 160) : null,
    taxBps, entries };
}

export function createGalleryNetCostLedger({ scope = null, taxBps = GALLERY_MARKET_TAX_BPS, entries = [] } = {}) {
  const ledger = normalizeGalleryNetCostLedger({ schema: GALLERY_NET_COST_SCHEMA, scope, taxBps, entries });
  if (!ledger) throw new Error('FC27_GALLERY_NET_COST_LEDGER_INVALID');
  return ledger;
}

function nextLedger(ledger, entries) {
  const normalized = normalizeGalleryNetCostLedger({ ...ledger, entries });
  if (!normalized) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_LEDGER_INVALID' };
  return { status: 'recorded', ledger: normalized };
}

// A purchase receipt is idempotent.  A second receipt for the same item with
// different identity or price is a hard conflict and must be investigated.
export function recordGalleryPurchase(ledger, receipt = {}) {
  const current = normalizeGalleryNetCostLedger(ledger);
  const purchase = normalizePurchase({ ...receipt, state: receipt.state ?? 'held' });
  if (!current || !purchase) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_RECEIPT_INVALID' };
  const existing = current.entries.find(entry => entry.itemId === purchase.itemId);
  if (existing) {
    if (existing.definitionId !== purchase.definitionId || existing.purchasePrice !== purchase.purchasePrice
        || existing.tradeId && purchase.tradeId && existing.tradeId !== purchase.tradeId) {
      return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_IDENTITY_CONFLICT' };
    }
    return { status: 'unchanged', ledger: current };
  }
  return nextLedger(current, [...current.entries, purchase]);
}

// Sale updates require the exact purchased item.  A listing without a sold
// receipt remains a cost, and is never counted as revenue.
export function recordGallerySale(ledger, sale = {}) {
  const current = normalizeGalleryNetCostLedger(ledger);
  if (!current || !id(sale.itemId)) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_SALE_INVALID' };
  const index = current.entries.findIndex(entry => entry.itemId === sale.itemId);
  if (index < 0) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_IDENTITY_UNKNOWN' };
  const state = String(sale.state || 'unknown');
  if (!STATES.has(state) || state === 'held') return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_SALE_INVALID' };
  if (state === 'sold' && !price(sale.soldPrice)) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_SALE_INVALID' };
  if (state === 'listed' && !price(sale.listedPrice)) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_SALE_INVALID' };
  if (['listed', 'unsold'].includes(state) && sale.soldPrice != null) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_SALE_INVALID' };
  const updated = { ...current.entries[index], state,
    listedPrice: price(sale.listedPrice) ? sale.listedPrice : current.entries[index].listedPrice,
    soldPrice: state === 'sold' ? sale.soldPrice : null,
    soldAt: state === 'sold' && integer(sale.soldAt) ? sale.soldAt : null,
    reason: typeof sale.reason === 'string' ? sale.reason.slice(0, 160) : null };
  const entries = [...current.entries]; entries[index] = updated;
  return nextLedger(current, entries);
}

export function galleryNetSale(priceValue, taxBps = GALLERY_MARKET_TAX_BPS) {
  if (!price(priceValue) || !integer(taxBps, 0, 10000)) return null;
  return Math.floor(priceValue * (10000 - taxBps) / 10000);
}

export function summarizeGalleryNetCost(ledger) {
  const current = normalizeGalleryNetCostLedger(ledger);
  if (!current) return { status: 'blocked', reason: 'FC27_GALLERY_NET_COST_LEDGER_INVALID' };
  const spent = current.entries.reduce((sum, entry) => sum + entry.purchasePrice, 0);
  const sold = current.entries.filter(entry => entry.state === 'sold' && price(entry.soldPrice));
  const grossRevenue = sold.reduce((sum, entry) => sum + entry.soldPrice, 0);
  const tax = sold.reduce((sum, entry) => sum + (entry.soldPrice - galleryNetSale(entry.soldPrice, current.taxBps)), 0);
  const netRevenue = grossRevenue - tax;
  const heldCost = current.entries.filter(entry => entry.state !== 'sold').reduce((sum, entry) => sum + entry.purchasePrice, 0);
  return { status: 'observed', entries: current.entries.length, sold: sold.length, held: current.entries.length - sold.length,
    spent, grossRevenue, tax, netRevenue, netCost: spent - netRevenue, heldCost, taxBps: current.taxBps };
}
