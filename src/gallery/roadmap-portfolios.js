import { selectGalleryRoadmapSteps } from './roadmap-selection.js';

// These are alternatives over ONE shared catalogue candidate pool. Never sum
// independent club shopping lists or count a shared exact version twice.
export function* planGalleryPortfoliosSteps(input) {
  const portfolios=[]; let stopped=false;
  for(const [profile,label] of [['tokens','多拿 token'],['loss','省损耗'],['capital','少占本金']]) {
    const value=yield* selectGalleryRoadmapSteps({ ...input, previousSelection:[],profile });
    portfolios.push({ ...value, profile,label });
    stopped ||= value.selectionStopped;
    if(stopped) break;
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
  let key=null,steps=null,value=null;
  const clear=()=>{steps?.return();steps=null;key=null;value=null;};
  return {clear,*run(input){
    const nextKey=JSON.stringify(input);
    if(key!==nextKey){clear();key=nextKey;steps=planGalleryPortfoliosSteps(input);}
    if(!steps)return {complete:true,result:structuredClone(value)};
    for(;;){
      const next=steps.next();
      if(next.done){value=next.value;steps=null;return {complete:true,result:structuredClone(value)};}
      if(yield next.value){
        const empty=selectGalleryRoadmapSteps({...input,rows:[],previousSelection:[]}).next().value;
        return {complete:false,result:{...empty,portfolios:[],selectedProfile:'tokens',selectionStopped:true}};
      }
    }
  }};
}
