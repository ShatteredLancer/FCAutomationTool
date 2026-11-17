import { build } from 'esbuild';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { observeMarketSessionEvidence } from './market-session-evidence.mjs';

const active = new WeakMap();
// Local inspector opt-in only. Not imported by any userscript. Start once by
// writing {"start":true} to the request file, then run market-tasks-check.
export async function startRequestedSessionMonitor(page, directory) {
  if (active.has(page)) return { status: 'already-observing' };
  const request = path.join(directory, 'market-session-monitor-request.json');
  let options;
  try { options = JSON.parse(await readFile(request, 'utf8')); } catch { return null; }
  await unlink(request);
  if (options?.start !== true) return null;
  const bundle = await build({ stdin: { resolveDir: path.resolve(import.meta.dirname, '../..'), contents: `
    export { createFc27MarketReadTransport } from './src/adapters/ea/fc27-market-read.js';
    export { renewFc27MarketSession } from './src/adapters/ea/fc27-market-session-renewal.js';
    export { readFc27Context } from './src/adapters/ea/fc27-local-read.js';
    export { FC27_TRADITIONAL_WEB_LOCK } from './src/fc27/traditional-lock.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'SessionInvestigation' });
  await page.evaluate(`(() => { ${bundle.outputFiles[0].text}
    const binding=JSON.stringify(SessionInvestigation.readFc27Context(globalThis));
    let stopped=false;
    const assert=()=>{if(stopped||binding!==JSON.stringify(SessionInvestigation.readFc27Context(globalThis)))throw Error('INSPECTION_SCOPE_CHANGED');};
    globalThis.__fcatSessionInvestigation={stop:()=>{stopped=true;},check:async()=>{
      const stages=[];let reads=0;
      const read=async()=>{assert();const reader=await SessionInvestigation.createFc27MarketReadTransport(globalThis,{quotesOnly:true,maxRequests:1});
        assert();reads++;return reader.readSessionHealth({beforeDispatch:assert});};
      const failure=error=>({dtoStatus:error.marketFailure?.httpStatus??null,eaCode:error.marketFailure?.eaCode??error.code??null,
        reason:/^(FC27|MARKET|INSPECTION)_[A-Z0-9_]+$/.test(error.message)?error.message:'UNVERIFIED'});
      try{return await navigator.locks.request(SessionInvestigation.FC27_TRADITIONAL_WEB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock)return {status:'busy',reads:0};
        assert();
        try{await read();return {status:'online',reads,stages};}
        catch(error){stages.push({at:Date.now(),phase:'plain-read',...failure(error)});
          if(error.marketFailure?.httpStatus!==401||(error.marketFailure.eaCode!=null&&error.marketFailure.eaCode!==401))return {status:'blocked',reads,stages};}
        // One bounded native renewal only after observing the old failing path.
        // This does not clear any task pause or start a trading task.
        try{await SessionInvestigation.renewFc27MarketSession(globalThis,{beforeDispatch:assert,
          onPhase:row=>stages.push({at:Date.now(),...row})});
          assert();await read();return {status:'renewed',reads,stages};}
        catch(error){stages.push({at:Date.now(),phase:'renew-verify',...failure(error)});return {status:'renewal-failed',reads,stages};}
      });}catch(error){return {status:'blocked',reads,stages:[...stages,{at:Date.now(),...failure(error)}]};}
    }};
  })()`);
  const evidence = observeMarketSessionEvidence(page, directory);
  const state = { schema: 1, startedAt: Date.now(), deadline: Date.now() + 60 * 60000,
    intervalMs: 180000, status: 'observing', taskStarts: 0, eaTrades: 0, samples: [] };
  let timer, running = false;
  const save = () => writeFile(path.join(directory, 'market-session-monitor.json'), JSON.stringify({ ...state, httpEvidence: evidence.snapshot() }, null, 2));
  const stop = async status => {
    state.status = status; clearTimeout(timer); active.delete(page);
    await page.evaluate(() => globalThis.__fcatSessionInvestigation?.stop()).catch(() => {});
    await save(); console.log(JSON.stringify({ sessionMonitor: status, samples: state.samples.length }));
  };
  const tick = async () => {
    if (running || state.status !== 'observing') return;
    if (Date.now() >= state.deadline) { await stop('completed-no-failure'); return; }
    running = true;
    try {
      const result = await page.evaluate(() => globalThis.__fcatSessionInvestigation?.check() ?? { status: 'page-changed' });
      state.samples.push({ at: Date.now(), ...result }); await save();
      if (!['online','busy'].includes(result.status)) { await stop(result.status); return; }
      timer = setTimeout(() => { void tick().catch(() => stop('inspection-error').catch(() => {})); }, state.intervalMs);
    } catch { await stop('inspection-error'); } finally { running = false; }
  };
  active.set(page, state);
  page.once('close', () => { if (state.status === 'observing') void stop('page-closed').catch(() => {}); });
  await save(); timer = setTimeout(() => { void tick().catch(() => stop('inspection-error').catch(() => {})); }, state.intervalMs);
  return { status: 'observing', minutes: 60, intervalSeconds: 180, taskStarts: 0, eaTrades: 0 };
}
