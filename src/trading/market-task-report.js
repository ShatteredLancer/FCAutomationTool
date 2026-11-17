import { galleryNetSale } from '../gallery/net-cost.js';

// Presentation projection only. Never infer a sale from an accepted listing.
export function marketTaskReport(ledger, taskId) {
  const holdings = ledger.holdings.filter(h => h.taskId === taskId);
  const events = ledger.intents.filter(i => i.taskId === taskId);
  const sold = holdings.filter(h => h.phase === 'sold');
  const unknownSoldCosts = sold.filter(h => h.cost === null).length;
  const auctions=(ledger.auctions??[]).filter(a=>a.taskId===taskId);
  return { holdings: structuredClone(holdings), events: structuredClone(events), auctions:structuredClone(auctions),
    handoffs: structuredClone((ledger.handoffs ?? []).filter(h => h.fromTaskId === taskId || h.toTaskId === taskId)),
    elapsedMs: ledger.clocks?.find(c => c.taskId === taskId)?.elapsedMs ?? 0,
    purchased: events.filter(i => i.kind === 'buy' && i.phase === 'confirmed').length+auctions.filter(a=>a.state==='won').length,
    listed: events.filter(i => i.kind === 'list' && i.phase === 'confirmed').length, sold: sold.length,
    heldCost: holdings.filter(h => h.phase !== 'sold').some(h => h.cost === null) ? null
      : holdings.filter(h => h.phase !== 'sold').reduce((sum, h) => sum + h.cost, 0),
    netRevenue: sold.reduce((sum, h) => sum + galleryNetSale(h.salePrice), 0),
    realizedProfit: unknownSoldCosts ? null : sold.reduce((sum, h) => sum + galleryNetSale(h.salePrice) - h.cost, 0),
    unknownSoldCosts };
}
