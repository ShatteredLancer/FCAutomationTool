import { forecastGalleryTurnover } from './turnover-budget.js';

// Select a read-only route from verified grade proposals, not raw web posts.
// The loss-per-added-token heuristic is bounded; no global optimum is claimed.
export function selectGalleryRoadmap(input) {
  const steps = selectGalleryRoadmapSteps(input); let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

export function* selectGalleryRoadmapSteps({ rows = [], capital = null, lossLimit = null, resaleDiscountBps = 0,
  previousSelection = [], profile = null, resumeOnly = false } = {}) {
  if (!Array.isArray(rows) || lossLimit !== null && (!Number.isSafeInteger(lossLimit) || lossLimit < 0)) {
    return { status: 'unavailable', reason: 'input-invalid', route: [] };
  }
  const selected = new Map(), skipped = new Map();
  const priority = option => profile ? ({ S:5, A:4, B:3, C:2, D:1 }[option.grade] ?? 0) : 0;
  const facts=new WeakMap();
  const info=option=>{
    if(!facts.has(option)){
      const solo=forecastGalleryTurnover({steps:[{setId:'forecast',items:option.items}],resaleDiscountBps});
      const byId=new Map(option.items.map(item=>[item.eaId,item]));
      facts.set(option,{weight:(solo.requiredCapital ?? 0)-(solo.expectedNetLoss ?? 0),
        items:solo.steps?.[0]?.cycles.map(cycle=>byId.get(cycle.eaId)) ?? option.items});
    }
    return facts.get(option);
  };
  const forecast = trial => {
    const entries = [...trial];
    if (profile) entries.sort((a,b) => priority(b[1].option) - priority(a[1].option)
      || info(b[1].option).weight-info(a[1].option).weight
      || a[0].localeCompare(b[0]));
    return forecastGalleryTurnover({ capital, resaleDiscountBps, ...(profile ? { optimizeOrder: false } : {}),
      steps: entries.map(([setId,entry]) => ({ setId, items: profile ? info(entry.option).items : entry.option.items })) });
  };
  const singles = resumeOnly ? [] : rows.flatMap(row => {
    const options=profile ? [...new Map((row.options ?? []).map(option=>[JSON.stringify([option.grade,option.projectedTokens,option.score,
      option.items?.map(item=>[item.eaId,item.price]).sort((a,b)=>a[0]-b[0]),option.estimated,option.referenceVerified,option.searchComplete]),option])).values()] : row.options ?? [];
    return options.map(option=>({row,option}));
  });
  const paired = [], seenPairs = new Set(), memberships = new Map();
  if (profile) for (const entry of singles) for (const item of entry.option.items ?? []) {
    const group = memberships.get(item.eaId) ?? []; group.push(entry); memberships.set(item.eaId,group);
  }
  if (profile) for (const group of memberships.values()) {
    const candidates = group.slice().sort((a,b) => priority(b.option)-priority(a.option)
      || b.option.projectedTokens-a.option.projectedTokens || a.row.setId.localeCompare(b.row.setId)).slice(0,12);
    for (let a=0;a<candidates.length;a++) for(let b=a+1;b<candidates.length;b++) {
      const pair=[candidates[a],candidates[b]]; if(pair[0].row.setId===pair[1].row.setId) continue;
      if(priority(pair[0].option)!==priority(pair[1].option))continue;
      const key=pair.map(entry=>`${entry.row.setId}:${entry.option.requestedGrade ?? entry.option.grade}`).sort().join('|');
      if(!seenPairs.has(key)){seenPairs.add(key);paired.push(pair);}
    }
  }
  paired.sort((a,b) => Math.max(...b.map(entry=>priority(entry.option)))-Math.max(...a.map(entry=>priority(entry.option)))
    || b.reduce((n,entry)=>n+entry.option.projectedTokens-entry.row.baselineTokens,0)-a.reduce((n,entry)=>n+entry.option.projectedTokens-entry.row.baselineTokens,0)
    || a.map(entry=>entry.row.setId).join().localeCompare(b.map(entry=>entry.row.setId).join()));
  let pairChecks=0, representative=null;
  let funding = forecastGalleryTurnover({ capital, resaleDiscountBps }), gain = 0;
  if (funding.status !== 'estimated') return { status: 'unavailable', reason: funding.reason, route: [] };
  for (const saved of previousSelection) {
    const row = rows.find(row => row.setId === saved.setId);
    const option = row?.options.find(option => JSON.stringify(option) === JSON.stringify(saved.option));
    if (option && option.projectedTokens > row.baselineTokens) selected.set(row.setId, { row, option });
  }
  if (selected.size) {
    funding = forecast(selected);
    if (funding.status !== 'estimated' || funding.feasible === false || lossLimit !== null && funding.expectedNetLoss > lossLimit) {
      return { status: 'unavailable', reason: 'resume-input-invalid', route: [] };
    }
    gain = [...selected.values()].reduce((sum, entry) => sum + entry.option.projectedTokens - entry.row.baselineTokens, 0);
  }
  let selectionStopped = false, comparisons = 0;
  const snapshot = () => selectionSnapshot({ rows,selected:representative?.selected ?? selected,funding:representative?.funding ?? funding,
    gain:representative?.gain ?? gain,profile,selectionStopped,comparisons,skipped });
  for (;!resumeOnly;) {
    let best = null;
    const choices = [...singles.map(entry=>[entry]), ...(profile && pairChecks<128 ? paired.slice(0,128-pairChecks) : [])];
    search: for (const additions of choices) {
      const {row,option}=additions[0];
      if(additions.length>1) pairChecks++;
      if(additions.some(({row,option})=>!Array.isArray(option.items)
        || option.projectedTokens <= (selected.get(row.setId)?.option.projectedTokens ?? row.baselineTokens))) continue;
      const added=additions.reduce((n,{row,option})=>n+option.projectedTokens-(selected.get(row.setId)?.option.projectedTokens ?? row.baselineTokens),0);
      const trial = new Map(selected); for(const entry of additions) trial.set(entry.row.setId,entry);
      const estimate = forecast(trial);
      if (estimate.status !== 'estimated' || estimate.feasible === false || lossLimit !== null && estimate.expectedNetLoss > lossLimit) {
        skipped.set(row.setId, { setId: row.setId, name: row.name,
          reason: estimate.status !== 'estimated' ? estimate.reason : estimate.feasible === false ? 'capital-gap' : 'loss-limit',
          requiredCapital: estimate.requiredCapital ?? null, capitalShortfall: estimate.capitalShortfall ?? null });
        comparisons++;
        if (yield { phase: 'route', completed: selected.size, total: rows.length, comparisons }) { selectionStopped = true; break search; }
        continue;
      }
      const incrementalLoss = estimate.expectedNetLoss - funding.expectedNetLoss;
      const value = { row, option, trial, estimate, added, ratio: incrementalLoss / added,
        priority: Math.max(...additions.map(entry=>priority(entry.option))) };
      const better = !best || value.priority > best.priority || value.priority === best.priority && (profile === 'capital'
        ? estimate.requiredCapital < best.estimate.requiredCapital || estimate.requiredCapital === best.estimate.requiredCapital && value.ratio < best.ratio
        : profile === 'tokens' ? added > best.added || added === best.added && value.ratio < best.ratio
        : profile === 'loss' ? estimate.expectedNetLoss < best.estimate.expectedNetLoss || estimate.expectedNetLoss === best.estimate.expectedNetLoss && added > best.added
        : value.ratio < best.ratio || value.ratio === best.ratio
          && (estimate.requiredCapital < best.estimate.requiredCapital
            || estimate.requiredCapital === best.estimate.requiredCapital && row.setId.localeCompare(best.row.setId) < 0));
      if (better) best = value;
      comparisons++;
      if (yield { phase: 'route', completed: selected.size, total: rows.length, comparisons }) { selectionStopped = true; break search; }
    }
    if (!best) break;
    selected.clear(); for (const entry of best.trial) selected.set(...entry);
    funding = best.estimate; gain += best.added;
    if(profile && (!representative || (profile==='tokens' ? gain>representative.gain
      : profile==='capital' ? funding.requiredCapital<representative.funding.requiredCapital
      : funding.expectedNetLoss<representative.funding.expectedNetLoss)
      || (profile==='capital' ? funding.requiredCapital===representative.funding.requiredCapital
        : profile==='tokens' ? gain===representative.gain : funding.expectedNetLoss===representative.funding.expectedNetLoss) && gain>representative.gain))
      representative={ selected:new Map(selected),funding,gain };
    if(profile && !selectionStopped && (yield {phase:'route',completed:selected.size,total:rows.length,comparisons,portfolio:snapshot()})) selectionStopped=true;
    if (selectionStopped) break;
  }
  if(representative){selected.clear();for(const entry of representative.selected)selected.set(...entry);funding=representative.funding;gain=representative.gain;}
  return snapshot();
}

function selectionSnapshot({rows,selected,funding,gain,profile,selectionStopped,comparisons,skipped}) {
  const route = funding.steps.map((step, index) => {
    const { row, option } = selected.get(step.setId);
    return { ...step, order: index + 1, name: row.name, categoryId: row.categoryId,
      currentGrade: row.currentGrade, targetGrade: option.grade, currentScore: row.currentScore,
      projectedScore: option.score, baselineTokens: row.baselineTokens, projectedTokens: option.projectedTokens,
      addedTokens: option.projectedTokens - row.baselineTokens, items: option.items,
      claimState: 'unknown', estimated: option.estimated !== false, searchComplete: option.searchComplete === true,
      referenceVerified: option.referenceVerified === true };
  });
  const unavailable = rows.filter(row => !(row.options?.length > 0) && row.reason).map(row => ({ setId: row.setId, name: row.name, reason: row.reason }));
  return { status: route.length ? 'ready' : 'no-route', objective: profile ? `grade-first-${profile}` : 'low-forecast-loss-per-added-token',
    claimState: 'unknown', tokenBasis: 'catalog-increase-not-unclaimed-balance',
    baselineTokens: rows.reduce((sum, row) => sum + (row.baselineTokens ?? 0), 0), addedTokens: gain,
    funding, route, selectedOptions: [...selected].map(([setId, entry]) => ({ setId, option: entry.option })),
    selectionStopped, comparisons, skipped: [...skipped.values()].filter(row => !selected.has(row.setId)), unavailable,
    freeCheck: rows.filter(row => row.currentGrade).map(row => ({ setId: row.setId, name: row.name,
      grade: row.currentGrade, catalogTokens: row.baselineTokens, claimState: 'unknown' })), searchComplete: false };
}
