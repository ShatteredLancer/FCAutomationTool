import fixture from '../fixtures/fc27-player-search-public-methods.json';

// Replay the actual public EA search-control methods. Only its generic widget
// dependencies / localization are synthetic; DOM, input and click events are real.
export function installNativePlayerControlFixture(root,document,window){
 const EventType={CHANGE:'change',INPUT:'input',TAP:'tap',MOUSEUP:'mouseup',TOUCHEND:'touchend'};
 function Base(){this.targets=[];this._generate();}
 Object.assign(Base.prototype,{
  init(){},addTarget(target,fn,type){this.targets.push({target,fn,type});},
  removeTarget(target,fn,type){this.targets=this.targets.filter(t=>t.target!==target||t.fn!==fn||t.type!==type);},
  _triggerActions(type,data){for(const t of this.targets.filter(t=>t.type===type))t.fn.call(t.target,this,type,data);},
  addClass(c){this.__root.classList.add(c);},removeClass(c){this.__root.classList.remove(c);},toggleClass(c,b){this.__root.classList.toggle(c,b);},
  dealloc(){this.targets=[];this.__root.remove();},getRootElement(){return this.__root;},destroy(){this.dealloc();}
 });
 class Button extends Base{
  _generate(){this.__root=document.createElement('button');this.__root.type='button';this.__root.innerHTML='<span class="btn-text"></span><span class="btn-subtext"></span>';this.__root.addEventListener('click',()=>this._triggerActions('tap'));}
  setText(text){this.__root.firstChild.textContent=text;}setSubtext(text){this.__root.lastChild.textContent=text;}
 }
 class Input extends Base{
  _generate(){this.__root=document.createElement('input');this.__root.className='ut-text-input-control';this.__root.addEventListener('input',()=>this._triggerActions('input',{value:this.value}));}
  get value(){return this.__root.value;}set value(text){this.__root.value=text;}
  setPlaceholder(text){this.__root.placeholder=text;}setMaxLength(n){this.__root.maxLength=n;}
 }
 const localize=k=>({'searchauctions.playersearch.inputcaption':'Type Player Name','searchauctions.label.playername':'Player Name','squads.rating':'Rating','searchauctions.playersearch.noresults':'No results'}[k]??k);
 const methods=fixture.methods;
 const create=new Function('t','UTPlayerSearchEngine','repositories','services','DOMKit','JSUtils','UTGroupButtonControl','UTFlatButtonControl','UTTextInputControl','EventType','document','window','requestAnimationFrame',
  `const C=(${methods.constructor});Object.setPrototypeOf(C.prototype,t.prototype);${Object.entries(methods).filter(([k])=>k!=='constructor').map(([k,v])=>`C.prototype[${JSON.stringify(k)}]=(${v});`).join('')}return C;`);
 root.UTPlayerSearchControl=create(Base,root.UTPlayerSearchEngine,root.repositories,{Localization:{localize}},
  {toggleDisplayStyle:(e,show)=>{e.style.display=show?'':'none';},remove:e=>e.remove()},
  {isEmpty:x=>!x,isValid:x=>x!==null&&x!==undefined},Button,Button,Input,EventType,document,window,window.requestAnimationFrame.bind(window));
 root.EventType=EventType;root.clearTimeout=window.clearTimeout.bind(window);
 return root;
}
