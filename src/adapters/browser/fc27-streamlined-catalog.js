import { integer, fail } from '../../streamlined/contract.js';

// Public FUT.GG routes discovered by EA set id. Only anonymous catalogue
// requests; these prices are never purchase authority or EA score evidence.
export function createFc27StreamlinedCatalog({ gmRequest, now = () => Date.now() }) {
  const cache = new Map(), pending = new Map();
  const read = path => {
    const old = cache.get(path);
    if (old && now() - old.at < 300000) return Promise.resolve(old.value);
    if (pending.has(path)) return pending.get(path);
    const url = `https://www.fut.gg/api/fut/sbc/27/${path}`;
    const promise = new Promise((resolve, reject) => {
      const error = code => reject(Error(`FC27_STREAMLINED_CATALOG_${code}`));
      if (typeof gmRequest !== 'function') return error('UNAVAILABLE');
      gmRequest({ method: 'GET', url, anonymous: true, timeout: 15000,
        onload: response => {
          if (response.finalUrl && response.finalUrl !== url) return error('REDIRECT');
          if (response.status !== 200) return error(integer(response.status, 100, 599) ? `HTTP_${response.status}` : 'RESPONSE_INVALID');
          try {
            if (typeof response.responseText !== 'string' || response.responseText.length > 3000000) return error('RESPONSE_INVALID');
            const value = JSON.parse(response.responseText).data;
            if (!value || typeof value !== 'object') return error('RESPONSE_INVALID');
            cache.set(path, { at: now(), value }); resolve(value);
          } catch { error('RESPONSE_INVALID'); }
        }, onerror: () => error('NETWORK'), ontimeout: () => error('TIMEOUT') });
    }).finally(() => pending.delete(path));
    pending.set(path, promise); return promise;
  };
  return Object.freeze({ async load({ challenge, context, policy, check = () => {}, onProgress = () => {} }) {
    if (context?.season !== '27' || !integer(challenge?.setId, 1) || !integer(challenge.id, 1)) fail('CATALOG_INPUT_INVALID');
    const platform = /^pc:/i.test(context.platform) ? 'pc' : /^(psn|xbox):/i.test(context.platform) ? 'ps5' : null;
    if (!platform) fail('CATALOG_PLATFORM_INVALID');
    check(); const set = await read(`set/${challenge.setId}/`); check();
    if (set.game !== '27' || set.eaId !== challenge.setId || !set.challengeEaIds?.includes(challenge.id)
        || typeof set.slug !== 'string' || !/^27-[a-z0-9-]{1,150}$/.test(set.slug)) fail('CATALOG_TARGET_CHANGED');
    const base = `${set.slug}/streamlined-solutions/`;
    const data = await read(`${base}?challenge=${challenge.id}&pool=${platform}`); check();
    const target = data.challenges?.find(row => row.challengeEaId === challenge.id);
    const solution = target?.[platform];
    if (data.setEaId !== challenge.setId || target?.scoreRequirement !== challenge.targetScore
        || !Array.isArray(solution?.rates) || solution.rates.length > 100) fail('CATALOG_RULES_CHANGED');
    // Inventory protection and market discovery have separate ceilings. The
    // stock limit must never hide a cheaper 84/85/86 market route.
    const marketMaxRating = policy.marketMaxRating ?? policy.maxRating;
    const rates = solution.rates.filter(row => integer(row.overall, 1, marketMaxRating)
      && integer(row.rarityEaId, 0, 10000) && integer(row.score, 1)).sort((a,b) => a.overall - b.overall);
    const ids = new Set(); let completed = 0;
    for (const rate of rates) {
      check(); onProgress({ phase: 'catalog', completed, total: rates.length });
      const group = await read(`${base}?challenge=${challenge.id}&overall=${rate.overall}&rarity=${rate.rarityEaId}&limit=30&platform=${platform}`);
      check(); completed++;
      if (group.challengeEaId !== challenge.id || group.overall !== rate.overall || group.rarityEaId !== rate.rarityEaId
          || group.platform !== platform || !Array.isArray(group.players) || group.players.length > 30) fail('CATALOG_GROUP_INVALID');
      for (const row of group.players) {
        if (!integer(row.player?.eaId, 1) || row.player.overall !== rate.overall) fail('CATALOG_PLAYER_INVALID');
        ids.add(row.player.eaId);
      }
    }
    onProgress({ phase: 'catalog', completed, total: rates.length });
    return { ids: [...ids], complete: false, source: 'futgg-streamlined', observedAt: now() };
  } });
}
