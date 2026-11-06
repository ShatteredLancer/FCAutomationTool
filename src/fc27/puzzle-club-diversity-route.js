const id=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function nationalPositionSupport(items,slots,nationCap){
  items=items.filter(item=>slots.some(position=>item.positions?.includes(position)));
  const nations=new Map();for(const item of items)if(!nations.has(item.nationId))nations.set(item.nationId,nations.size+2);
  const itemStart=nations.size+2,slotStart=itemStart+items.length,graph=Array.from({length:slotStart+slots.length},()=>[]);
  const add=(from,to,capacity)=>{const forward={to,capacity,reverse:graph[to].length},back={to:from,capacity:0,reverse:graph[from].length};
    graph[from].push(forward);graph[to].push(back);};
  for(const node of nations.values())add(0,node,nationCap);
  items.forEach((item,index)=>{add(nations.get(item.nationId),itemStart+index,1);
    slots.forEach((position,slot)=>{if(item.positions.includes(position))add(itemStart+index,slotStart+slot,1);});});
  slots.forEach((_position,slot)=>add(slotStart+slot,1,1));
  let flow=0;
  for(;;){const path=Array(graph.length).fill(null),queue=[0];path[0]=[-1,-1];
    for(let head=0;head<queue.length&&!path[1];head++)for(let edge=0;edge<graph[queue[head]].length;edge++){
      const next=graph[queue[head]][edge];if(next.capacity>0&&!path[next.to]){path[next.to]=[queue[head],edge];queue.push(next.to);}}
    if(!path[1])return flow;
    for(let node=1;node!==0;){const [from,index]=path[node],edge=graph[from][index];edge.capacity--;graph[node][edge.reverse].capacity++;node=from;}
    flow++;
  }
}

// Query ordering only. All candidates remain subject to the original safety,
// price and complete native squad checks; this never proves market shortage.
export function planPuzzleCappedNationClubFillers({rules,required,candidates,level,usedQueries=[],pendingQueries=[],resolveClub,formation,brickIndices}){
  const nationCap=Math.min(required,...rules.filter(r=>r.kind==='same-nation'&&r.mode!=='min').map(r=>r.value));
  const clubMinimum=Math.max(0,...rules.filter(r=>r.kind==='same-club'&&r.mode!=='max').map(r=>r.value));
  const leagueMinimum=Math.max(0,...rules.filter(r=>r.kind==='distinct-leagues'&&r.mode!=='max').map(r=>r.value));
  if(nationCap>=required||clubMinimum<2||leagueMinimum<2||typeof resolveClub!=='function'
      ||!Array.isArray(formation?.positions)||!Array.isArray(brickIndices))return null;
  const slots=formation.positions.filter((_p,index)=>!brickIndices.includes(index));
  const unused=query=>![...usedQueries,...pendingQueries].some(old=>same(old,query));
  const broad={start:0,count:20,level};
  const clubs=new Map();
  for(const item of candidates){const club=resolveClub(item.teamId);if(!id(club))continue;
    if(!clubs.has(club))clubs.set(club,new Map());clubs.get(club).set(item.definitionId,item);}
  // A separate national capacity and position matching are only upper bounds:
  // the foreign cards may all be off-position. Couple both in the same flow.
  const support=items=>nationalPositionSupport(items,slots,nationCap);
  const compulsory=new Set(rules.filter(r=>r.kind==='from-clubs'&&r.mode==='min').flatMap(r=>r.ids.map(resolveClub)));
  const spines=[...clubs].map(([club,byId])=>{const items=[...byId.values()];return {club,items,
    support:support(items),compulsory:compulsory.has(club)};})
    .filter(group=>group.support>=clubMinimum)
    .sort((a,b)=>Number(b.compulsory)-Number(a.compulsory)||b.support-a.support||a.club-b.club);
  const spine=spines[0],result=[];
  if(!spine){
    // A full page from one country can satisfy the OR identity but still
    // cannot supply a four-player club under a three-player national cap.
    const alternative=rules.filter(r=>r.kind==='from-clubs'&&r.mode==='min').flatMap(r=>r.ids)
      .map(team=>({start:0,count:20,level,team})).find(unused);
    if(alternative)result.push(alternative);
  }
  if(!usedQueries.some(q=>same(q,broad))){if(unused(broad))result.push(broad);return result;}
  if(spine){
    const spineLeagues=new Set(spine.items.map(item=>item.leagueId)),nationalities=new Map();
    for(const item of spine.items)nationalities.set(item.nationId,(nationalities.get(item.nationId)??0)+1);
    const dominant=[...nationalities].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
    const leagues=new Map();
    for(const item of candidates){if(!id(item.leagueId)||spineLeagues.has(item.leagueId))continue;
      if(!leagues.has(item.leagueId))leagues.set(item.leagueId,new Map());leagues.get(item.leagueId).set(item.definitionId,item);}
    const target=Math.ceil(required/leagueMinimum);
    const ranked=[...leagues].map(([league,byId])=>{const items=[...byId.values()];return {league,items,
      support:support(items),foreign:items.filter(item=>item.nationId!==dominant).length/items.length};})
      .filter(group=>group.support>0).sort((a,b)=>Number(b.support<target)-Number(a.support<target)
        ||b.foreign-a.foreign||b.support-a.support||a.league-b.league);
    const next=ranked.map(group=>({start:0,count:20,level,league:group.league})).find(unused);
    if(next)result.push(next);
  }
  const deeper={...broad,start:20};if(unused(deeper))result.push(deeper);
  return result;
}
