// Sell-only tasks always list their explicitly selected holdings. Legacy buy
// tasks omit afterBuy and retain automatic listing.
export const marketTaskAutoLists = task => task.mode === 'sell' || task.settings?.afterBuy !== 'hold';
