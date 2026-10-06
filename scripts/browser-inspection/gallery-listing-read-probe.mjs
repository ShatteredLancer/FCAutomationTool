import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { pageKind } from './probe.mjs';

// Read-only diagnosis: public method source and, when requested, one Club page
// plus one player's two native price-limit routes. No journal edits or trades.
export async function probeGalleryListingReads(page, { readClub = false } = {}) {
  if (pageKind(page.url()) !== 'web-app') throw Error('WEB_APP_REQUIRED');
  const methods = await page.evaluate(() => {
    const constructorSource = Function.prototype.toString.call(globalThis.UTHttpRequest);
    const defaultDecoder = globalThis[constructorSource.match(/=(a0_0x[\da-f]+)/)?.[1]];
    return ['UTItemService.prototype.requestMarketData', 'services.Item.transfersDao.getItemMarketData',
      'services.Item.transfersDao.getItemMarketDataByDefId', 'services.Item.transfersDao.getItemMarketDataById',
      'services.UTUtasRequestQueue.send', 'services.UTUtasRequestQueue.next',
      'services.Item.transfersDao.requestDelegate.send', 'UTHttpRequest.prototype._setDefaultHeaders',
      'UTHttpRequest.prototype.handleTelemetry', 'UTHttpRequest.prototype._handleFail', 'UTHttpRequest.prototype._handleReauth',
      'FCAuthenticationService.prototype.getIdentifier', 'Identification.prototype.handleRequest',
      'Identification.prototype.handleResponse', 'services.Club.clubDao.getClubItems',
      'services.Club.clubDao.getStats', 'UTHttpRequest.prototype.send', 'UTHttpRequest', 'EAHttpRequest.prototype.send'].map(path => {
      const fn = path.split('.').reduce((value, key) => value?.[key], globalThis);
      if (typeof fn !== 'function') return { path, missing: true };
      const source = Function.prototype.toString.call(fn);
      if (source.length > 30000) return { path, oversized: true };
      const aliases = new Map([...source.matchAll(/(_0x[\da-f]+)=(a0_0x[\da-f]+)/g)].map(match => [match[1], match[2]]));
      const decoded = source.replace(/(_0x[\da-f]+|a0_0x[\da-f]+)\((0x[\da-f]+)\)/g, (call, name, number) => {
        const decoder = globalThis[aliases.get(name) ?? name] ?? defaultDecoder;
        return typeof decoder === 'function' ? JSON.stringify(decoder(Number(number))) : call;
      });
      return { path, source, decoded };
    });
  });
  const requests = [];
  const listener = response => {
    try {
      const url = new URL(response.url());
      if (url.hostname.endsWith('.ea.com') && /\/(club|marketdata)(\/|$)/.test(url.pathname) && requests.length < 20) {
        requests.push({ method: response.request().method(), path: url.pathname.replace(/\d{5,}/g, ':id'), status: response.status() });
      }
    } catch { /* Do not export URLs, headers, request bodies or credentials. */ }
  };
  page.on('response', listener);
  let club, nativeStats = null;
  try {
    const bundle = await build({ stdin: { contents: "export { createFc27ClubReadTransport } from './src/adapters/ea/fc27-club-read.js';",
      resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'ListingReadProbe' });
    club = readClub ? await page.evaluate(`(async () => { ${bundle.outputFiles[0].text}
      let stage = 'create';
      try {
        const entities = [];
        const transport = await ListingReadProbe.createFc27ClubReadTransport(globalThis, { nativeReauth: true, onEntity:item=>entities.push(item) });
        stage = 'stats'; const count = await transport.readCount();
        stage = 'page'; const rows = count ? await transport.readPage({start:0,count:Math.min(count,90),definitionIds:[]}) : [];
        const item = entities.find(item=>item.isTradeable?.() && !item.concept);
        const observe = reply => new Promise(resolve=>{
          const owner={}, timer=setTimeout(()=>{reply.unobserve(owner);resolve({timeout:true});},20000);
          reply.observe(owner,(_sender,dto)=>{clearTimeout(timer);reply.unobserve(owner);
            resolve({success:dto.success===true,status:dto.status,code:Number(dto.response?.code)||null,
              rows:dto.response?.marketData?.length??0});});
        });
        const limits = item ? {cached:item.hasPriceLimits(),
          byItem:await observe(globalThis.services.Item.requestMarketData(item)),
          byDefinition:await observe(globalThis.services.Item.transfersDao.getItemMarketDataByDefId([item.definitionId]))} : null;
        return {status:'observed', count, rows:rows.length, limits};
      } catch(error) { return {status:'blocked', stage, reason:/^FC27_[A-Z0-9_]+$/.test(error.message)?error.message:'READ_FAILED'}; }
    })()`) : { status: 'not-requested' };
    if (readClub && club.status === 'blocked') nativeStats = await page.evaluate(async () => {
      const request = new globalThis.UTHttpRequest(globalThis.services.Club.clubDao.authDelegate);
      request.setPath(`/ut/game/${globalThis.GAME_NAME}/club/stats/club`);
      return new Promise(resolve => {
        const owner = {}, timer = setTimeout(() => { request.unobserve(owner); request.abort(); resolve({ status: 'timeout' }); }, 20000);
        request.observe(owner, (_sender, dto) => {
          clearTimeout(timer); request.unobserve(owner);
          resolve({ success: dto.success === true, status: dto.status,
            count: dto.response?.stat?.find(row => row.type === 'players')?.typeValue ?? null,
            code: Number(dto.response?.code) || null });
        });
        globalThis.services.UTUtasRequestQueue.send(request);
      });
    });
  } finally { page.off('response', listener); }
  const report = { observedAt: new Date().toISOString(), executable: false, methods, club, nativeStats, requests };
  await mkdir('artifacts/fc27-browser', { recursive: true });
  const destination = 'artifacts/fc27-browser/gallery-listing-read-probe.json';
  await writeFile(destination, JSON.stringify(report, null, 2));
  return { status: 'observed', executable: false, saved: destination, club, requests };
}
