import { createGalleryReferencePrices } from '../../gallery/reference-prices.js';
import { createPublicPricePolicyStore, publicPriceSourceEnabled } from '../../gallery/public-price-policy.js';
import { createFsuReferencePrice } from '../../fc27/fsu-reference-price.js';
import { parsePublicFutbinPrice, parsePublicFutggPrices } from '../../fc27/public-price-responses.js';
import { createFc27FutbinHttp } from './fc27-futbin-http.js';
import { readFutbinBatchPrices } from '../../fc27/futbin-batch-prices.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { createPurchasePriceApproval } from '../../fc27/purchase-price-approval.js';
import {readTradingCandidatePool,tradingMentionNames} from '../../trading/shortlist.js';

const positions = ['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
export function createFc27PublicPrices({ root, get, set, gmRequest, transport, diagnosticLog = null, now = () => Date.now() }) {
  const rows = new Map();
  const futbinPages = new Map();
  const record = fields => {
    try { Promise.resolve(diagnosticLog?.record?.({ area: 'pricing', ...fields })).catch(() => {}); }
    catch { /* Optional diagnostics must not occupy quote workers. */ }
  };
  let mappingQueue = Promise.resolve();
  const tradingPools=new Map(),tradingReads=new Map(),tradingCooldowns=new Map();
  const updateIds = (key, learned, removed = {}) => {
    // Fresh per-version readers can finish together. Merge only their delta,
    // and remove a stale ID only if it has not already been replaced.
    const task = mappingQueue.catch(() => {}).then(async () => {
      const ids = { ...await get(key, {}) };
      for (const [id, previous] of Object.entries(removed)) if (ids[id] === previous) delete ids[id];
      Object.assign(ids, learned);
      await set(key, ids);
    });
    mappingQueue = task.catch(() => {});
    return task;
  };
  const policyStore = createPublicPricePolicyStore({ get, set });
  const capture = () => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const platform = /^pc:/i.test(context.platform) ? 'pc' : /^(psn|xbox):/i.test(context.platform) ? 'console' : null;
    if (!platform) throw Error('FC27_PUBLIC_PRICE_PLATFORM_UNVERIFIED');
    const assert = () => { if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED'); };
    return { context, scope, platform, assert };
  };
  const readSettings = async () => { const captured = capture(); const policy = await policyStore.read(captured.scope); captured.assert(); return policy; };
  const request = createFc27FutbinHttp(gmRequest, {
    onEvent: fields => {
      try { Promise.resolve(diagnosticLog?.record?.({ area: 'pricing', event: 'transport-request', ...fields })).catch(() => undefined); }
      catch { /* Diagnostics are optional. */ }
    },
  });
  const service = createGalleryReferencePrices({ get, set, now, diagnosticLog,
    readFutbinBatch: async (ids, players, options) => {
      const captured = capture();
      const result = await readFutbinBatchPrices(ids, players, { ...options,
        platform: options.futbinPlatform ? (options.futbinPlatform === 'pc' ? 'pc' : 'console') : options.platform,
        request, now, cache: futbinPages, check: async () => {
        options.check(); captured.assert();
        const policy = await policyStore.read(captured.scope); captured.assert(); options.check();
        if (!publicPriceSourceEnabled(policy, 'futbin')) throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
      } });
      record({ event: 'futbin-batch-result', status: 'success', requestedCount: ids.length,
        count: result.rows.length, requests: result.requests });
      return result;
    },
    readFutgg: async (ids, { platform }) => {
      if (!publicPriceSourceEnabled(await readSettings(), 'futgg')) throw Error('FC27_PUBLIC_PRICE_FUTGG_DISABLED');
      const reply = await transport.getPrices(ids, { platform });
      if (reply.status !== 200) {
        const retry = reply.headers?.['retry-after'];
        const duration = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now();
        throw Object.assign(Error(`FC27_PUBLIC_PRICE_HTTP_${Number(reply.status) || 0}`), { retryAt: Number.isFinite(duration) ? now() + Math.max(0, duration) : null });
      }
      return parsePublicFutggPrices(reply.text, ids, platform);
    },
    readFutbin: async (definitionId, row, { season, platform, futbinPlatform, deadlineAt = null, check = () => {} }) => {
      const referencePlatform = futbinPlatform ? (futbinPlatform === 'pc' ? 'pc' : 'console') : platform;
      const captured = capture();
      const position = row?.preferredPosition ?? row?.positions?.[0];
      const player = { definitionId, rating: row?.rating ?? row?.overall ?? row?._rating,
        nationId: row?.nationId ?? row?.nationEaId, leagueId: row?.leagueId ?? row?.leagueEaId,
        teamId: row?.teamId ?? row?.clubEaId, preferredPosition: typeof position === 'string' ? positions.indexOf(position) : position };
      let result;
      // Retain FSU's exact ID/filter route and ID mapping. Create a fresh
      // reader for this response so an omitted version cannot refresh old data.
      const reader = createFsuReferencePrice({ season, platform: referencePlatform === 'pc' ? 'pc' : 'ps', get, set, updateIds,
        request: async url => {
          const currentPolicy = await policyStore.read(captured.scope); captured.assert();
          check();
          if (!publicPriceSourceEnabled(currentPolicy, 'futbin')) throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
          if (deadlineAt !== null && now() >= deadlineAt) throw Error('FC27_STREAMLINED_QUOTE_BUDGET');
          const minimal = new URL(url).pathname.endsWith('fetchPlayerInformationMinimal');
          if (!minimal && (![player.rating, player.nationId, player.leagueId, player.teamId].every(value => Number.isSafeInteger(value) && value > 0)
              || !Number.isSafeInteger(player.preferredPosition) || !positions[player.preferredPosition])) throw Error('FC27_PUBLIC_PRICE_PLAYER_INVALID');
          const response = await request(url);
          result = parsePublicFutbinPrice(response, definitionId, referencePlatform, minimal);
          return response;
        } });
      try {
        await reader(player);
        const quote = result ?? { definitionId, price: null, sourceUpdatedAt: null };
        record({ event: 'futbin-quote-result', definitionId,
          status: quote.price === null ? 'missing' : 'success', price: quote.price,
          exactVersion: quote.price !== null, endpoint: 'fc27-public-price' });
        return quote;
      } catch (error) {
        record({ event: 'futbin-quote-result', definitionId,
          status: 'failed', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_PUBLIC_PRICE_UNAVAILABLE',
          exactVersion: false, endpoint: 'fc27-public-price' });
        throw error;
      }
    },
  });
  const load = async (ids, options = {}) => {
    const captured = capture(), settings = await policyStore.read(captured.scope); captured.assert();
    const purpose = options.purpose ?? 'gallery';
    const policy = options.policy ?? (purpose === 'listing' ? { ...settings, source: settings.listingSource } : settings);
    // Frozen purchase policies retain their caps, but cannot re-enable a
    // source the account has disabled since the plan was approved.
    if (!publicPriceSourceEnabled(settings, policy.source)) throw Error(`FC27_PUBLIC_PRICE_${policy.source.toUpperCase()}_DISABLED`);
    const sources = (options.sources ?? (['puzzle', 'purchase', 'roadmap', 'gallery-plan'].includes(purpose) ? [policy.source]
      : [policy.source, policy.source === 'futbin' ? 'futgg' : 'futbin']))
      .filter(source => publicPriceSourceEnabled(settings, source));
    if (!sources.length) throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
    const snapshot = await service.load(ids, { ...options, sources, purpose,
      quoteTtlMs: settings.quoteValidityMinutes * 60000,
      season: captured.context.season, platform: captured.platform, policy,
      rows: options.rows ?? ids.map(id => rows.get(id)).filter(Boolean),
      isCurrent: () => { captured.assert(); return options.isCurrent?.() ?? true; } });
    return purpose === 'listing' ? { ...snapshot, listingPriceSource: policy.source } : snapshot;
  };
  return Object.freeze({
    scope: () => capture().scope,
    context: () => {const value=capture();return {scope:value.scope,season:value.context.season,platform:value.platform};},
    knownPlayers: () => [...rows.values()].map(row=>({...row})).slice(0,1000),
    async tradingCandidates({isCurrent=()=>true,onProgress=()=>{},names=[]}={}){
      const captured=capture(),market=captured.platform,queries=tradingMentionNames(names),key=JSON.stringify([market,queries]);
      const check=async()=>{captured.assert();if(!isCurrent())throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
        if(!publicPriceSourceEnabled(await policyStore.read(captured.scope),'futbin'))throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');captured.assert();};
      await check();const cached=tradingPools.get(key);
      if(cached?.expiresAt>now()){if(cached.error)throw Error(cached.error);return structuredClone(cached.value);}
      const cooldown=tradingCooldowns.get(market);if(cooldown?.expiresAt>now())throw Error(cooldown.error);
      if(!tradingReads.has(key)){
        const task=(async()=>{try{const value=await readTradingCandidatePool({request,platform:market,names:queries,now,check,onProgress});await check();
          await updateIds('fcat-futbin-ids:27',Object.fromEntries(value.rows.map(row=>[row.definitionId,row.futbinId])));await check();
          tradingPools.set(key,{value,expiresAt:now()+300000});while(tradingPools.size>8)tradingPools.delete(tradingPools.keys().next().value);return value;
        }catch(error){const reason=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DESK_DISCOVERY_UNAVAILABLE';
          if(!/CONTEXT_CHANGED|DISABLED/.test(reason)){const blocked={error:reason,expiresAt:now()+(reason.endsWith('_429')?300000:30000)};
            tradingPools.set(key,blocked);tradingCooldowns.set(market,blocked);while(tradingPools.size>8)tradingPools.delete(tradingPools.keys().next().value);}throw error;
        }finally{tradingReads.delete(key);}})();tradingReads.set(key,task);
      }
      const value=await tradingReads.get(key);await check();return structuredClone(value);
    },
    async resolveTradingPlayer(input){
      let url;try{url=new URL(input);}catch{throw Error('DESK_PLAYER_LINK_INVALID');}
      const match=/^\/27\/player\/([1-9]\d{0,8})(?:\/([^/]*))?\/?$/.exec(url.pathname);
      if(url.protocol!=='https:'||!['www.futbin.com','futbin.com'].includes(url.hostname)||url.username||url.password||!match)throw Error('DESK_PLAYER_LINK_INVALID');
      const captured=capture(),policy=await policyStore.read(captured.scope);captured.assert();
      if(!publicPriceSourceEnabled(policy,'futbin'))throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
      const payload=JSON.parse(await request(`https://www.futbin.org/futbin/api/27/fetchPlayerInformationMinimal?ID=${match[1]}&platform=${captured.platform==='pc'?'PC':'PS'}`));captured.assert();
      const values=Object.values(payload?.data??{});if(values.length!==1||Number(values[0].ID)!==Number(match[1])||!Number.isSafeInteger(Number(values[0].Player_Resource))||Number(values[0].Player_Resource)<1)throw Error('DESK_PLAYER_LINK_INVALID');
      const definitionId=Number(values[0].Player_Resource);parsePublicFutbinPrice(payload,definitionId,captured.platform,true);
      if(!publicPriceSourceEnabled(await policyStore.read(captured.scope),'futbin'))throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');captured.assert();
      await updateIds(`fcat-futbin-ids:27`,{[definitionId]:Number(match[1])});captured.assert();
      return {definitionId,name:decodeURIComponent(match[2]??'').replaceAll('-',' ').slice(0,100)||`EA ${definitionId}`};
    },
    readSettings,
    async saveSettings(value) {
      const captured = capture();
      const policy = await policyStore.save(captured.scope, value); captured.assert(); return policy;
    },
    remember(items) {
      for (const row of items ?? []) {
        const definitionId = row.eaId ?? row.definitionId;
        rows.set(definitionId, { definitionId, rating: row.rating ?? row.overall ?? row._rating,
          name:String(row.name??row.cardName??row.definitionId??row.eaId??'').slice(0,100),version:String(row.version??row.rarityName??'').slice(0,60),
          nationId: row.nationId ?? row.nationEaId, leagueId: row.leagueId ?? row.leagueEaId,
          teamId: row.teamId ?? row.clubEaId, preferredPosition: row.preferredPosition ?? row.positions?.[0] });
      }
    },
    load,
    async cachedEstimates(ids, options = {}) {
      const captured = capture(), settings = await policyStore.read(captured.scope); captured.assert();
      const policy = options.policy ?? settings;
      if (!publicPriceSourceEnabled(settings, policy.source)) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
      return service.cachedEstimates(ids, { season: captured.context.season, platform: captured.platform, policy,
        isCurrent: () => { captured.assert(); return options.isCurrent?.() ?? true; } });
    },
    async preparePurchase(record, options = {}) {
      const captured = capture();
      if (record.scope !== captured.scope) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
      const ids = record.entries.filter(entry => entry.state === 'waiting').map(entry => entry.definitionId);
      const planned = record.plan?.filter(item => ids.includes(item.definitionId)) ?? [];
      if (planned.some(item => item.priceReference)) {
        if (planned.length !== ids.length || planned.some(item => !item.priceReference || !item.pricePolicy
            || JSON.stringify(item.pricePolicy) !== JSON.stringify(planned[0].pricePolicy))) throw Error('FC27_BUY_PRICE_APPROVAL_INVALID');
        return createPurchasePriceApproval({ scope: captured.scope, season: captured.context.season, platform: captured.platform,
          definitionIds: ids, references: Object.fromEntries(planned.map(item => [item.definitionId, item.priceReference])),
          policy: planned[0].pricePolicy, now: now() });
      }
      const policy = await policyStore.read(captured.scope), references = {};
      const players = options.rows ?? record.base?.purchases ?? ids.map(id => rows.get(id)).filter(Boolean);
      for (let start = 0; start < ids.length; start += 250) {
        const snapshot = await load(ids.slice(start, start + 250), { ...options, purpose: 'purchase', rows: players, policy });
        Object.assign(references, snapshot.references);
      }
      captured.assert();
      return createPurchasePriceApproval({ scope: captured.scope, season: captured.context.season, platform: captured.platform,
        definitionIds: ids, references, policy, now: now() });
  },
  async quote(player, options) {
      const snapshot = await load([player.definitionId], { ...options, rows: [player] });
      return snapshot.references[player.definitionId];
    },
  });
}
