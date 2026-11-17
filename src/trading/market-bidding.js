import { moveGalleryListingPrice } from '../gallery/listing-candidates.js';
import { validMarketRatingPrice } from './market-rating-prices.js';

export const marketBuyMode = task => task.settings.buyMode ?? 'bin';

// Enhancer 99611/83847: starting bid or the native next tier; optional exact
// cap. Approved FCAT difference: BIN-over-cap does not discard a valid bid.
export function chooseMarketOffer({ offer, buyMode='bin', buyCap=null, bidCap=null,
  bidExact='step', bidExpires=3600, priceTiers }) {
  if(!offer||!Number.isFinite(offer.seconds)||offer.seconds<=0)return null;
  if(buyMode!=='bid'&&validMarketRatingPrice(offer.buyNow)&&offer.buyNow<=buyCap)return {kind:'buy',coins:offer.buyNow};
  if(buyMode==='bin'||offer.seconds>bidExpires||!validMarketRatingPrice(bidCap)
    ||!Number.isSafeInteger(offer.currentBid)||offer.currentBid<0)return null;
  const next=offer.currentBid?moveGalleryListingPrice(offer.currentBid,1,priceTiers):offer.startingBid;
  const coins=bidExact==='cap'?bidCap:next;
  if(!validMarketRatingPrice(next)||!validMarketRatingPrice(coins)||coins<next||coins>bidCap
    ||offer.buyNow>0&&coins>=offer.buyNow)return null;
  return {kind:'bid',coins};
}
