import {it,expect} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import current from '../fixtures/fc27-trading-support-methods-2026-11-19.json';
import oldSession from '../fixtures/fc27-market-session-public-methods.json';
import oldWatch from '../fixtures/fc27-market-bid-public-methods.json';
import {FC27_MARKET_SESSION_METHODS,FC27_MARKET_SESSION_COMPATIBLE_HASHES} from '../../src/adapters/ea/fc27-market-session-renewal.js';
import {MARKET_AUCTION_METHODS,MARKET_AUCTION_COMPATIBLE_HASHES} from '../../src/adapters/ea/fc27-market-auctions.js';
import {verifyFc27Methods} from '../../src/adapters/ea/fc27-transaction-transport.js';

const normalize=source=>{const names=new Map();return source.replace(/(?:_0x|a0_0x)[0-9a-f]+/g,name=>{
  if(!names.has(name))names.set(name,`v${names.size}`);return names.get(name);
});};
it.each(Object.entries(current.methods))('reviews the complete public body and digest of %s', (path,row)=>{
  const baseline=oldSession.methods[path]??oldWatch.methods.find(r=>r.path===path);
  expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
  expect(normalize(row.decoded)).toBe(normalize(baseline.decoded));
});
it('accepts captured authentication/watch functions at their own paths and rejects runtime replacement',async()=>{
  const root={crypto:webcrypto,FCAuthenticationService:{prototype:{}},service:{},dao:{},repository:{}};
  for(const [path,row] of Object.entries(current.methods)){
    const name=path.split('.').at(-1);
    const owner=path.startsWith('FCAuthenticationService.')?root.FCAuthenticationService.prototype:path.startsWith('UTItemService.')?root.service:root.dao;
    owner[name]=vm.runInNewContext(`(${row.source})`);
  }
  root.repository.getWatchedItems=vm.runInNewContext(`(${oldWatch.methods[2].source})`);
  const auth=await verifyFc27Methods(root,FC27_MARKET_SESSION_METHODS,FC27_MARKET_SESSION_COMPATIBLE_HASHES);
  const watch=await verifyFc27Methods(root,MARKET_AUCTION_METHODS,MARKET_AUCTION_COMPATIBLE_HASHES);
  expect(()=>auth()).not.toThrow();expect(()=>watch()).not.toThrow();
  await expect(verifyFc27Methods({other:root.dao,crypto:webcrypto},[['other.getWatchPile','0'.repeat(64)]],MARKET_AUCTION_COMPATIBLE_HASHES)).rejects.toThrow('METHOD_UNREVIEWED');
  root.service.requestWatchedItems=()=>{};expect(()=>watch()).toThrow('RUNTIME_CHANGED');
  root.FCAuthenticationService.prototype.authenticate=()=>{};expect(()=>auth()).toThrow('RUNTIME_CHANGED');
});
