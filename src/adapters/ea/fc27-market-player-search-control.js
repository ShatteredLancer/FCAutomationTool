// Enhancer Trader inherits this same EA control. Keep the native input,
// buttons, list rendering and selection; adapt only the shadow-root boundary.
export function mountFc27MarketPlayerSearchControl({root,input,search,onInput,onSelect,onError,isCurrent}) {
 if(typeof root.UTPlayerSearchControl!=='function'||!root.EventType?.CHANGE)return null;
 let control;
 try{
  control=new root.UTPlayerSearchControl();control.init();
  const element=control.getRootElement(),field=element.querySelector('input');
  if(!field)throw Error('MARKET_PLAYER_CONTROL_UNAVAILABLE');
  const nativeUpdate=control.updateList;
  control.updateList=function(query,rows){
   if(!isCurrent())return;
   nativeUpdate.call(this,query,rows);
   this.currentQuery.forEach((button,index)=>{button.getRootElement().dataset.playerIdentity=String(rows[index].id);});
  };
  const nativeEngine=control.searchEngine;
  control.searchEngine={getEntriesForString(query){
   if(!isCurrent())return [];
   try{return search(query).map(p=>({id:p.playerId,commonName:p.name,rating:p.rating}));}
   catch{onError?.();return [];}
  },dealloc(){nativeEngine?.dealloc?.();}};
  control.removeWindowListener();
  const nativeOutside=control.windowListener;
  control.windowListener=event=>{if(event.composedPath?.().includes(element))return;nativeOutside(event);};
  const target={},changed=()=>{
   if(!isCurrent())return;
   if(control.selected){const row=control.selected;onSelect({playerId:row.id,name:row.commonName||`${row.firstName} ${row.lastName}`,rating:row.rating});}
   else onInput('');
  };
  control.addTarget(target,changed,root.EventType.CHANGE);
  field.id=input.id;field.setAttribute('aria-label','搜索球员姓名');field.autocomplete='off';
  field.addEventListener('input',()=>{if(isCurrent())onInput(field.value);});
  const clear=element.querySelector('.exit-btn');if(clear){clear.setAttribute('aria-label','清空球员姓名');clear.setAttribute('type','button');}
  // Native buttons default to submit in a form; the picker itself never saves.
  element.addEventListener('click',event=>{const button=event.target.closest('button');if(button)event.preventDefault();});
  input.replaceWith(element);element.dataset.fcatNativePlayerSearch='true';
  return {input:field,show(query,rows){
   control.setInput(query);control.updateList(query,rows.map(p=>({id:p.playerId,commonName:p.name,rating:p.rating})));
  },close(){
   // close() is deferred by EA. Also cancel a pending input debounce now, so
   // closing the dialog cannot reopen its list half a second later.
   root.clearTimeout(control.timeout);control.close();
  },reset(){root.clearTimeout(control.timeout);control.close();control.clearInput();},
  destroy(){control.removeTarget(target,changed,root.EventType.CHANGE);control.dealloc();}};
 }catch{try{control?.dealloc?.();}catch{/* Incomplete native construction: keep the existing input. */}return null;}
}
