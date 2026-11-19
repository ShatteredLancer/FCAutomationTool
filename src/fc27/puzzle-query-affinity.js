const quality = rating => rating < 65 ? 1 : rating < 75 ? 2 : 3;
const level = tier => ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[tier];

// A large national cluster from one league is a poor discovery anchor when
// the same-league cap is below the national minimum. After the native-required
// quality's broad page, seek that quality in a nation already spanning enough
// leagues, not another page of the larger preferred filler tier. This ranks
// bounded queries only; it never forces a nation or proves market absence.
export function planPuzzleNationalMinimumAffinity({ candidates = [], rules = [], required,
  usedQueries = [], allowedLevels = [], excludedLeagueIds = [] } = {}) {
  if (!Number.isSafeInteger(required) || required < 1) return null;
  const minimum = Math.max(0, ...rules.filter(rule => rule.kind === 'same-nation' && rule.mode !== 'max').map(rule => rule.value));
  const cap = Math.min(required, ...rules.filter(rule => rule.kind === 'same-league' && rule.mode !== 'min').map(rule => rule.value));
  if (!(cap > 0 && cap < minimum)) return null;
  const groups = new Map();
  for (const item of candidates) {
    if (!Number.isSafeInteger(item.nationId) || item.nationId <= 0
        || !Number.isSafeInteger(item.leagueId) || item.leagueId <= 0
        || excludedLeagueIds.includes(item.leagueId)) continue;
    if (!groups.has(item.nationId)) groups.set(item.nationId, new Map());
    groups.get(item.nationId).set(item.definitionId, item);
  }
  const nations = [...groups].map(([nation, byId]) => {
    const items = [...byId.values()], leagues = new Map();
    for (const item of items) leagues.set(item.leagueId, (leagues.get(item.leagueId) ?? 0) + 1);
    return { nation, items, capacity: [...leagues.values()].reduce((n, count) => n + Math.min(cap, count), 0),
      leagueCapacity: leagues.size * cap };
  });
  // No national-count gap in this sampled pool: keep the established routes.
  if (nations.some(nation => nation.capacity >= minimum)) return null;
  const qualityRules = rules.filter(rule => rule.kind === 'quality-count' && rule.mode !== 'max'
    && rule.count > 0 && rule.qualities.length === 1).sort((a, b) => b.count - a.count);
  for (const rule of qualityRules) {
    const laneLevel = level(rule.qualities[0]);
    if (!allowedLevels.includes(laneLevel) || !usedQueries.some(query => query.level === laneLevel
        && !query.team && !query.nation && !query.league)) continue;
    const ranked = nations.map(nation => ({ ...nation,
      tierCount: nation.items.filter(item => quality(item.rating) === rule.qualities[0]).length }))
      .filter(nation => nation.tierCount > 0 && nation.leagueCapacity >= minimum)
      .sort((a, b) => b.capacity - a.capacity || b.tierCount - a.tierCount || a.nation - b.nation);
    const query = ranked.map(({ nation }) => ({ start: 0, count: 20, level: laneLevel, nation }))
      .find(next => !usedQueries.some(old => JSON.stringify(old) === JSON.stringify(next)));
    if (query) return query;
  }
  return null;
}

// A positive same-league minimum needs coherent supply, not just one broad
// page of each tier. After the dominant tier's broad read, grow a league with
// in-position support before unrelated filler pages exhaust the read budget.
// This is discovery only: no identity is required in the resulting squad.
export function planPuzzleLeagueMinimumAffinity({candidates=[],material=[],rules=[],formation,brickIndices,usedQueries=[],excludedLeagueIds=[],resolveClub}={}){
  if(!Array.isArray(formation?.positions) || !Array.isArray(brickIndices) || typeof resolveClub!=='function'
      || !rules.some(rule=>rule.kind==='same-league' && rule.mode==='min' && rule.value>1))return null;
  const slots=formation.positions.filter((_position,index)=>!brickIndices.includes(index));
  const dominant=material.filter(rule=>rule.count>slots.length/2).sort((a,b)=>b.count-a.count)[0];
  if(!dominant)return null;
  const tier=dominant.qualities[0],laneLevel=level(tier);
  if(!usedQueries.some(query=>query.level===laneLevel && !query.team && !query.nation && !query.league))return null;
  const clubCap=Math.min(slots.length,...rules.filter(rule=>rule.kind==='same-club' && rule.mode!=='min').map(rule=>rule.value));
  const groups=new Map();
  for(const item of candidates){
    if(quality(item.rating)!==tier || !Number.isSafeInteger(item.leagueId) || item.leagueId<=0 || excludedLeagueIds.includes(item.leagueId)
        || !item.positions?.some(position=>slots.includes(position)))continue;
    const club=resolveClub(item.teamId);if(!Number.isSafeInteger(club) || club<=0)continue;
    if(!groups.has(item.leagueId))groups.set(item.leagueId,new Map());
    const clubs=groups.get(item.leagueId);if(!clubs.has(club))clubs.set(club,new Set());
    clubs.get(club).add(item.definitionId);
  }
  const ranked=[...groups].map(([league,clubs])=>({league,support:[...clubs.values()].reduce((n,ids)=>n+Math.min(clubCap,ids.size),0),clubs:clubs.size}))
    .sort((a,b)=>b.support-a.support || b.clubs-a.clubs || a.league-b.league);
  if(!ranked.length)return null;
  const query={start:0,count:20,level:laneLevel,league:ranked[0].league};
  return usedQueries.some(used=>JSON.stringify(used)===JSON.stringify(query))?null:query;
}

// Maximum in-position support with each club capped and each version used
// once. A multi-position player (or five players for one GK slot) cannot be
// counted more than once. This is a small routing calculation, not SBC search.
function cappedPositionSupport(clubs, slots, clubCap) {
  const slotStart = 2 + clubs.size, graph = Array.from({ length: slotStart + slots.length }, () => []);
  const add = (from, to, remaining) => {
    const arc = { to, back: graph[to].length, remaining };
    graph[to].push({ to: from, back: graph[from].length, remaining: 0 });
    graph[from].push(arc);
  };
  slots.forEach((_, i) => add(slotStart + i, 1, 1));
  let group = 2;
  for (const cards of clubs.values()) {
    add(0, group, Math.min(cards.length, clubCap));
    for (const card of cards) {
      const node = graph.push([]) - 1;
      add(group, node, 1);
      slots.forEach((position, i) => { if (card.positions.includes(position)) add(node, slotStart + i, 1); });
    }
    group++;
  }
  let filled = 0;
  while (filled < slots.length) {
    const previous = Array(graph.length).fill(null), queue = [0]; previous[0] = [];
    for (let i = 0; i < queue.length && !previous[1]; i++) {
      const from = queue[i];
      for (const arc of graph[from]) if (arc.remaining && !previous[arc.to]) {
        previous[arc.to] = [from, arc]; queue.push(arc.to);
      }
    }
    if (!previous[1]) break;
    for (let node = 1; node !== 0;) {
      const [from, arc] = previous[node];
      arc.remaining--; graph[node][arc.back].remaining++; node = from;
    }
    filled++;
  }
  return filled;
}

// Narrow route: a league minimum that exceeds the club cap, plus a total club
// cap. Apply to the ordinary minimum-quality/chemistry shape, not identity,
// exact tier, team-rating or other mixed constraints. No card is made eligible
// by this hint. Even the full-position pool still needs the original solver.
export function planPuzzleCappedLeagueDiscovery({ candidates, rules, slots, levels, usedQueries, resolveClub }) {
  const modes = { 'same-league': 'min', 'same-club': 'max', 'distinct-clubs': 'max', 'distinct-nations': 'min' };
  if (rules.some(rule => Object.hasOwn(modes, rule.kind) ? rule.mode !== modes[rule.kind]
    : !['min-quality', 'min-chemistry'].includes(rule.kind))) return null;
  const leagueMin = Math.max(0, ...rules.filter(rule => rule.kind === 'same-league' && rule.mode === 'min').map(rule => rule.value));
  const clubCap = Math.min(slots.length, ...rules.filter(rule => rule.kind === 'same-club' && rule.mode === 'max').map(rule => rule.value));
  const clubLimit = Math.min(slots.length, ...rules.filter(rule => rule.kind === 'distinct-clubs' && rule.mode === 'max').map(rule => rule.value));
  const nationMin = Math.max(1, ...rules.filter(rule => rule.kind === 'distinct-nations' && rule.mode === 'min').map(rule => rule.value));
  const ratingFloor = Math.max(1, ...rules.filter(rule => rule.kind === 'min-quality').map(rule => rule.minRating));
  if (leagueMin <= clubCap || clubLimit >= slots.length || clubCap * clubLimit < slots.length
      || !rules.some(rule => rule.kind === 'min-chemistry' && rule.value > 0)
      || !usedQueries.some(query => !query.league && !query.nation && !query.team && query.start === 0)) return null;
  const groups = new Map(), seen = new Set();
  for (const card of candidates) {
    if (seen.has(card.definitionId) || card.rating < ratingFloor || !levels.includes(level(quality(card.rating)))
        || !card.positions?.some(position => slots.includes(position))) continue;
    seen.add(card.definitionId);
    const club = resolveClub(card.teamId);
    if (!Number.isSafeInteger(club) || club <= 0) continue;
    if (!groups.has(card.leagueId)) groups.set(card.leagueId, new Map());
    const clubs = groups.get(card.leagueId);
    if (!clubs.has(club)) clubs.set(club, []);
    clubs.get(club).push(card);
  }
  const ranked = [...groups].map(([league, clubs]) => {
    const cards = [...clubs.values()].flat();
    const capacity = [...clubs.values()].map(group => Math.min(group.length, clubCap)).sort((a, b) => b - a)
      .slice(0, clubLimit).reduce((sum, count) => sum + count, 0);
    return { league, cards, clubCount: clubs.size, nationalities: new Set(cards.map(card => card.nationId)).size,
      support: Math.min(capacity, cappedPositionSupport(clubs, slots, clubCap)) };
  }).filter(group => group.support > 0).sort((a, b) =>
    Number(b.clubCount > 1) - Number(a.clubCount > 1) || b.support - a.support || b.clubCount - a.clubCount
    || b.nationalities - a.nationalities || a.league - b.league);
  const query = ranked.flatMap(({ league }) => levels.map(level => ({ start: 0, count: 20, level, league })))
    .find(next => !usedQueries.some(old => old.league === next.league && old.level === next.level && old.start === next.start));
  const focus = ranked.find(group => group.support === slots.length && group.clubCount <= clubLimit && group.nationalities >= nationMin);
  return { query: query ?? null, focus: focus ? new Set(focus.cards.map(card => card.definitionId)) : null };
}

// Rank only a read-only catalog lane, never require these cards in the squad.
// Chemistry comes from in-position players: a populous nation of midfielders
// is a weak anchor when those formation slots are bricks. Maximum matching
// also prevents a flexible card being counted as several covered positions.
export function planPuzzleNationalityAffinity({ candidates, material, formation, brickIndices, usedQueries = [] }) {
  if (!Array.isArray(formation?.positions) || formation.positions.length !== 11
      || !Array.isArray(brickIndices)) return null;
  const required = material.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count);
  if (required.length < 2) return null;
  const slots = formation.positions.filter((_position, index) => !brickIndices.includes(index));
  const groups = new Map();
  for (const item of candidates) {
    if (!required.some(rule => rule.qualities[0] === quality(item.rating))
        || !item.positions.some(position => slots.includes(position))) continue;
    if (!groups.has(item.nationId)) groups.set(item.nationId, new Map());
    groups.get(item.nationId).set(item.definitionId, item);
  }
  const ranked = [];
  for (const [nation, byId] of groups) {
    const items = [...byId.values()];
    // An unrelated single-quality cluster must not displace the existing
    // league fallback. Both the filler and dominant tier need a real anchor.
    if (!required.every(rule => items.some(item => quality(item.rating) === rule.qualities[0]))) continue;
    const assigned = slots.map(() => -1);
    const augment = (index, visited) => {
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot) || !items[index].positions.includes(slots[slot])) continue;
        visited.add(slot);
        if (assigned[slot] === -1 || augment(assigned[slot], visited)) {
          assigned[slot] = index; return true;
        }
      }
      return false;
    };
    items.forEach((_item, index) => augment(index, new Set()));
    ranked.push({ nation, matched: assigned.filter(index => index !== -1).length, count: items.length });
  }
  ranked.sort((a, b) => b.matched - a.matched || b.count - a.count || a.nation - b.nation);
  return ranked.map(({ nation }) => ({ start: 0, count: 20, level: level(required[0].qualities[0]), nation }))
    .find(query => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query))) ?? null;
}
