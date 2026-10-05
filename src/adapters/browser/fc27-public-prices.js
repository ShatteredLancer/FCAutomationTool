import { createGalleryReferencePrices } from '../../gallery/reference-prices.js';
import { createPublicPricePolicyStore, publicPriceSourceEnabled } from '../../gallery/public-price-policy.js';
import { createFsuReferencePrice } from '../../fc27/fsu-reference-price.js';
import { parsePublicFutbinPrice, parsePublicFutggPrices } from '../../fc27/public-price-responses.js';
import { createFc27FutbinHttp } from './fc27-futbin-http.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { createPurchasePriceApproval } from '../../fc27/purchase-price-approval.js';

const positions = ['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
export function createFc27PublicPrices({ root, get, set, gmRequest, transport, diagnosticLog = null, now = () => Date.now() }) {
  const rows = new Map();
  const policyStore = createPublicPricePolicyStore({ get, set });
  const capture = () => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const platform = /^pc:/i.test(context.platform) ? 'pc' : /^(psn|xbox):/i.test(context.platform) ? 'console' : null;
    if (!platform) throw Error('FC27_PUBLIC_PRICE_PLATFORM_UNVERIFIED');
    const assert = () => { if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED'); };
    return { context, scope, platform, assert };
  };
  const readSettings = async () => { const captured = capture(); const policy = await policyStore.read(captured.scope); captured.assert(); return policy; };
  const request = createFc27FutbinHttp(gmRequest);
  const service = createGalleryReferencePrices({ get, set, now, diagnosticLog,
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
    readFutbin: async (definitionId, row, { season, platform }) => {
      const captured = capture();
      const position = row?.preferredPosition ?? row?.positions?.[0];
      const player = { definitionId, rating: row?.rating ?? row?.overall ?? row?._rating,
        nationId: row?.nationId ?? row?.nationEaId, leagueId: row?.leagueId ?? row?.leagueEaId,
        teamId: row?.teamId ?? row?.clubEaId, preferredPosition: typeof position === 'string' ? positions.indexOf(position) : position };
      let result;
      // Retain FSU's exact ID/filter route and ID mapping. Create a fresh
      // reader for this response so an omitted version cannot refresh old data.
      const reader = createFsuReferencePrice({ season, platform: platform === 'pc' ? 'pc' : 'ps', get, set,
        request: async url => {
          const currentPolicy = await policyStore.read(captured.scope); captured.assert();
          if (!publicPriceSourceEnabled(currentPolicy, 'futbin')) throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
          const minimal = new URL(url).pathname.endsWith('fetchPlayerInformationMinimal');
          if (!minimal && (![player.rating, player.nationId, player.leagueId, player.teamId].every(value => Number.isSafeInteger(value) && value > 0)
              || !Number.isSafeInteger(player.preferredPosition) || !positions[player.preferredPosition])) throw Error('FC27_PUBLIC_PRICE_PLAYER_INVALID');
          const response = await request(url);
          result = parsePublicFutbinPrice(response, definitionId, platform, minimal);
          return response;
        } });
      await reader(player);
      return result;
    },
  });
  const load = async (ids, options = {}) => {
    const captured = capture(), settings = await policyStore.read(captured.scope); captured.assert();
    const purpose = options.purpose ?? 'gallery';
    const policy = options.policy ?? (purpose === 'listing' ? { ...settings, source: settings.listingSource } : settings);
    // Frozen purchase policies retain their caps, but cannot re-enable a
    // source the account has disabled since the plan was approved.
    if (!publicPriceSourceEnabled(settings, policy.source)) throw Error(`FC27_PUBLIC_PRICE_${policy.source.toUpperCase()}_DISABLED`);
    const sources = (options.sources ?? (purpose === 'puzzle' || purpose === 'purchase' ? [policy.source] : ['futgg', 'futbin']))
      .filter(source => publicPriceSourceEnabled(settings, source));
    if (!sources.length) throw Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
    const snapshot = await service.load(ids, { ...options, sources, purpose,
      season: captured.context.season, platform: captured.platform, policy,
      rows: options.rows ?? ids.map(id => rows.get(id)).filter(Boolean),
      isCurrent: () => { captured.assert(); return options.isCurrent?.() ?? true; } });
    return purpose === 'listing' ? { ...snapshot, listingPriceSource: policy.source } : snapshot;
  };
  return Object.freeze({
    scope: () => capture().scope,
    readSettings,
    async saveSettings(value) {
      const captured = capture();
      const policy = await policyStore.save(captured.scope, value); captured.assert(); return policy;
    },
    remember(items) {
      for (const row of items ?? []) {
        const definitionId = row.eaId ?? row.definitionId;
        rows.set(definitionId, { definitionId, rating: row.rating ?? row.overall ?? row._rating,
          nationId: row.nationId ?? row.nationEaId, leagueId: row.leagueId ?? row.leagueEaId,
          teamId: row.teamId ?? row.clubEaId, preferredPosition: row.preferredPosition ?? row.positions?.[0] });
      }
    },
    load,
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
