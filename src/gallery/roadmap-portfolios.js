import { selectGalleryRoadmapSteps } from './roadmap-selection.js';
const profiles=[['tokens','多拿 token'],['loss','省损耗'],['capital','少占本金']];

// These are alternatives over ONE shared catalogue candidate pool. Never sum
// independent club shopping lists or count a shared exact version twice.
export function* planGalleryPortfoliosSteps(input) {
  const portfolios=[]; let stopped=false;
  for(const [profile,label] of profiles) {
    const iterator=selectGalleryRoadmapSteps({ ...input, previousSelection:[],profile });let next,signal;
    try{for(;;){
      next=iterator.next(signal);if(next.done)break;
      signal=yield {...next.value,...(next.value?.portfolio?{portfolio:{...next.value.portfolio,profile,label}}:{})};
    }}finally{iterator.return();}
    const value=next.value;
    portfolios.push({ ...value, profile,label });
    stopped ||= value.selectionStopped;
    if(stopped) break;
    if(yield {phase:'route',completed:value.route.length,total:input.rows.length,portfolio:{...value,profile,label}}){stopped=true;break;}
  }
  const selected=portfolios.find(value=>value.profile===(input.selectedProfile ?? 'tokens')) ?? portfolios[0];
  return { ...selected, portfolios, selectionStopped:stopped, selectedProfile:selected.profile };
}

export function chooseGalleryPortfolio(result,profile) {
  const selected=result.portfolios?.find(value=>value.profile===profile);
  return selected ? { ...result,...selected,selectedProfile:profile } : result;
}

// Retain the global comparison cursor as well as per-collection work. A tiny
// deadline must not restart the same global comparisons on every Continue.
export function createGalleryPortfolioWork(){
  let key=null,optionsKey=null,steps=null,value=null;
  const shown=new Map();
  const clear=()=>{steps?.return();steps=null;key=null;optionsKey=null;value=null;shown.clear();};
  const projectOne=(input,source)=>{
    const iterator=selectGalleryRoadmapSteps({...input,profile:source.profile,resumeOnly:true,previousSelection:source.selectedOptions});
    return {...iterator.next().value,profile:source.profile,label:source.label,comparisons:source.comparisons ?? 0};
  };
  const accept=(input,candidate)=>{
    const next=projectOne(input,candidate),before=shown.has(candidate.profile)?projectOne(input,shown.get(candidate.profile)):null;
    const priority=value=>Math.max(0,...value.route.map(row=>({S:5,A:4,B:3,C:2,D:1}[row.targetGrade] ?? 0)));
    const metric=value=>candidate.profile==='tokens'?-value.addedTokens:candidate.profile==='loss'?value.funding?.expectedNetLoss:value.funding?.requiredCapital;
    const better=!before?.route.length || next.route.length>0 && (priority(next)>priority(before)
      || priority(next)===priority(before) && (metric(next)<metric(before) || metric(next)===metric(before) && next.addedTokens>=before.addedTokens));
    shown.set(candidate.profile,better?next:before);
  };
  const project=(input,pending)=>{
    let portfolios=profiles.filter(([profile])=>shown.has(profile)).map(([profile])=>projectOne(input,shown.get(profile)));
    const baseline=portfolios.find(value=>value.route.length>0);
    if(pending && baseline)portfolios=profiles.map(([profile,label])=>{
      const existing=portfolios.find(value=>value.profile===profile);
      return existing?.route.length ? existing : {...baseline,profile,label,objective:`grade-first-${profile}`,comparisonPending:true};
    });
    const fallback=selectGalleryRoadmapSteps({...input,rows:[],resumeOnly:true}).next().value;
    const selected=portfolios.find(value=>value.profile===(input.selectedProfile ?? 'tokens')) ?? portfolios[0] ?? fallback;
    return {...selected,portfolios,selectedProfile:selected.profile ?? 'tokens',selectionStopped:pending,comparisonPending:pending};
  };
  return {clear,*run(input){
    const nextKey=JSON.stringify(input),nextOptions=JSON.stringify({...input,rows:undefined});
    if(optionsKey!==null && optionsKey!==nextOptions)clear();optionsKey=nextOptions;
    if(!steps && key!==nextKey){key=nextKey;steps=planGalleryPortfoliosSteps(structuredClone(input));}
    if(!steps)return {complete:true,result:project(input,false)};
    for(;;){
      const next=steps.next();
      if(next.done){
        for(const portfolio of next.value.portfolios)accept(input,portfolio);
        steps=null;const complete=key===nextKey;
        value=project(input,!complete);return {complete,result:structuredClone(value)};
      }
      if(next.value?.portfolio)accept(input,next.value.portfolio);
      if(yield next.value){
        return {complete:false,result:project(input,true)};
      }
    }
  }};
}
