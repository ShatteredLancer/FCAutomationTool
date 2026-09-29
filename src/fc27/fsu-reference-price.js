// Adapted from FSU 26.09 futbinId.getId/getPrice/setPrice (Futcd_kcka, MIT).
// See fsu-auction-search.js and THIRD_PARTY_NOTICES.md for the retained license.
const positions = ['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
export function createFsuReferencePrice({ season, platform, request, get, set }) {
  // Runtime context carries platform:SKU; FSU's price API uses only pc/ps.
  platform = platform.split(':')[0].toLowerCase();
  const apiPlatform = platform === 'pc' ? 'PC' : 'PS';
  const prefix = platform === 'pc' ? 'pc_' : 'ps_';
  const key = `fcat-futbin-ids:${season}`;
  const prices = new Map();
  return async player => {
    const ids = await get(key, {});
    const recordPrice = (data, definitionId) => {
      prices.set(Number(definitionId), data.LCPrice ?? data[`${prefix}LCPrice`] ?? data.price ?? 0);
    };
    const base = `https://www.futbin.org/futbin/api/${season}/`;
    let url;
    if (Object.hasOwn(ids, player.definitionId)) {
      url = `${base}fetchPlayerInformationMinimal?ID=${ids[player.definitionId]}&platform=${apiPlatform}`;
    } else {
      const position = positions[player.preferredPosition];
      url = `${base}getFilteredPlayers?platform=${apiPlatform}&nation=${player.nationId}&league=${player.leagueId}&rating=${player.rating}-${player.rating}&club=${player.teamId}&sort=rating&position=${position}&order=desc&page=1`;
    }
    const response = await request(url);
    const data = JSON.parse(response);
    // FSU _.forEach accepts both array and keyed-object collections.
    for (const row of Object.values(data.data ?? {})) {
      if (url.includes('getFilteredPlayers?')) {
        recordPrice(row, row.resource_id);
        ids[row.resource_id] = row.ID;
      } else recordPrice(row, row.Player_Resource);
    }
    if (url.includes('getFilteredPlayers?')) await set(key, ids);
    // FSU's cache reader yields 0 if the requested version has no returned price.
    // Never substitute EA average price, the user's balance or a purchase budget.
    return prices.get(player.definitionId) ?? 0;
  };
}
