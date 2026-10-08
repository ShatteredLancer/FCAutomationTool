import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createFc27GalleryNativeRenderer } from '../../src/adapters/ea/fc27-gallery-card.js';
import { sanitizeGalleryNativeCard } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { GalleryItemEntity, galleryEntityFromDto } from '../helpers/fc27-gallery-entity.js';

// Replay locally captured EA methods, without redistributing EA source or
// making image/network requests. CI without that research artifact skips only
// this differential layer; the portable callback regressions below still run.
const eaSource = await readFile(new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url), 'utf8')
  .catch(error => { if (error.code === 'ENOENT') return null; throw error; });

const rawCard = () => ({ definitionId: 50559326, resourceId: 50559326, assetId: 227678, itemType: 'player', dream: true,
  rareflag: 22, rating: 86, attributeArray: [80,70,60,50,40,30], possiblePositions:['CAM'], iconTraits:[1],
  guidAssetId: 'special-version-guid', hyperCosmetics: { 1: 0 } });
function fixture() {
  const events = [];
  const element = () => ({ nodeType: 1, style: {}, children: [], setAttribute: vi.fn(),
    append(child) { this.children.push(child); child.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); } });
  const document = { createElement: element }, parent = element();
  const entity = galleryEntityFromDto(rawCard());
  const view = { init: vi.fn(), dealloc: vi.fn(), getRootElement: () => element(),
    assetsLoaded: new Map([['main',true],['shell',true],['rank',false]]), renderComplete: vi.fn(),
    render: vi.fn(function () { this.renderComplete(); }) };
  const root = { UTItemEntity: GalleryItemEntity, factories: { Item: { createItem: vi.fn(galleryEntityFromDto) } },
    UTItemViewFactory: { createLargeItem: vi.fn(() => view) } };
  return { root, entity, view, parent, events, renderer: createFc27GalleryNativeRenderer(root,{document,diagnosticLog:{record:entry=>events.push(entry)}}) };
}
afterEach(() => vi.useRealTimers());
it('renders an owned native entity only through the explicit display-only path', () => {
  const f = fixture(); f.entity.concept = false;
  f.root.UTItemViewFactory.createSmallItem = vi.fn(() => f.view);
  expect(f.renderer.render({ parent: f.parent, raw: f.entity })).toBeNull();
  const wrapper = f.renderer.renderOwned({ parent: f.parent, raw: f.entity });
  expect(wrapper).toBeTruthy();
  expect(f.view.render.mock.calls[0][0]).not.toBe(f.entity);
  expect(f.entity.concept).toBe(false);
  expect(f.root.UTItemViewFactory.createSmallItem).toHaveBeenCalledOnce();
  expect(f.root.UTItemViewFactory.createLargeItem).not.toHaveBeenCalled();
  expect(wrapper.className).toContain('owned-card');
  wrapper.__fcatDealloc();
});
it.skipIf(!eaSource).each(['normal','portrait-retry','shell-retry','terminal-failure','stalled'])
('replays captured EA image loading and completion: %s', scenario => {
  vi.useFakeTimers(); const f=fixture(), fallback=vi.fn(), urls=[];
  const table=()=>{const value=new Map();Object.defineProperty(value,'length',{get:()=>value.size});return value;};
  f.view.assets=table(); f.view.assetsLoaded=table();
  f.view._canvas={setAssets:vi.fn(),setState:vi.fn()};
  f.view.getAssetDimensions=()=>({}); f.view.addClass=vi.fn(); f.view.removeClass=vi.fn();
  const context={
    ItemAssetType:{MAIN:'main',SHELL:'shell'},ItemRatingTier:{NONE:0},ItemRarity:{DEFAULT:0},
    UTItemView:{CLASS:{LOADING:'loading',LOADED:'loaded'}},
    enums:{UIItemInfoState:{MAIN:0}},JSUtils:{isString:value=>typeof value==='string'},
    UTItemEntity:{DEFAULT_GOLD_ASSET_ID:'generic'},
    AssetLocationUtils:{getPortraitImageUri:(id,guid)=>guid?'dynamic':id==='generic'?'generic':'portrait',
      getShellUri:()=> 'shell',getLocalShellUri:()=> 'local-shell'},
    Image:class {
      listeners=new Map();addEventListener(type,callback){this.listeners.set(type,callback);}
      removeEventListener(type){this.listeners.delete(type);}
      set src(url){urls.push(url);if(scenario==='stalled')return;
        const fail=scenario==='terminal-failure'||scenario==='portrait-retry'&&url==='dynamic'||scenario==='shell-retry'&&url==='shell';
        setTimeout(()=>this.listeners.get(fail?'error':'load')?.({type:fail?'error':'load'}),5);
      }
    },
  };
  for(const [owner,methods] of [
    ['UTItemView',['setShell','requestResource','loadAsset','onLoadAssetSuccess','areAssetsLoaded','onLoadComplete','renderComplete']],
    ['UTPlayerItemView',['setPortrait','onLoadDynamicPortraitError','onLoadAssetError']],
  ]) for(const name of methods){
    const marker=`${owner}.prototype.${name}=`,start=eaSource.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const body=eaSource.slice(start+marker.length),end=body.indexOf(`},${owner}.prototype.`);
    expect(end).toBeGreaterThan(-1);
    f.view[name]=runInNewContext(`(${body.slice(0,end+1)})`,context);
  }
  f.view.render=function(item){
    // Rendering metadata only; the asset selection/retry/completion methods
    // above are actual EA functions from the captured bundle.
    Object.assign(item,{isValid:()=>true,isPlayer:()=>true,isManager:()=>false,isClubItem:()=>false,
      isSpecial:()=>true,hasQualityTiers:()=>false,isLegend:()=>false,isBronzeRating:()=>false,isSilverRating:()=>false});
    this.setShell(item,'large','rarity-guid');this.setPortrait(item);
  };
  const wrapper=f.renderer.render({parent:f.parent,raw:f.entity,onUnavailable:fallback});
  expect(wrapper).toBeTruthy(); vi.advanceTimersByTime(15001);
  if(scenario==='terminal-failure'||scenario==='stalled'){
    expect(fallback).toHaveBeenCalledOnce();expect(f.parent.children).toHaveLength(0);
  }else{
    expect(fallback).not.toHaveBeenCalled();expect(f.view.addClass).toHaveBeenCalledWith('loaded');
    expect(f.view.assetsLoaded.get('main')).toBe(true);expect(f.view.assetsLoaded.get('shell')).toBe(true);
    if(scenario==='portrait-retry')expect(urls).toEqual(['shell','dynamic','portrait']);
    if(scenario==='shell-retry')expect(urls).toEqual(['shell','dynamic','local-shell']);
  }
  wrapper.__fcatDealloc();expect(f.view.dealloc).toHaveBeenCalledOnce();
});
it('renders an exact-version native display copy without mutating concept/DTO or requiring optional rank artwork', () => {
  const f = fixture(), raw = rawCard(), unavailable = vi.fn();
  const wrapper = f.renderer.render({parent:f.parent,raw:f.entity,onUnavailable:unavailable});
  expect(wrapper).toBeTruthy(); expect(unavailable).not.toHaveBeenCalled();
  expect(raw.rating).toBe(86); expect(f.entity.concept).toBe(true);
  expect(f.root.factories.Item.createItem).not.toHaveBeenCalled();
  expect(f.view.render.mock.calls[0][0]).toMatchObject({concept:false,definitionId:50559326,guidAssetId:'special-version-guid'});
  expect(f.view.render.mock.calls[0][0]).not.toBe(f.entity);
  expect(f.view.render.mock.calls[0][0]).toBeInstanceOf(f.root.UTItemEntity);
  const display = f.view.render.mock.calls[0][0];
  expect(display).toMatchObject({rareflag:22,attributes:[80,70,60,50,40,30],stackCount:1});
  expect(display.getStaticData()).toBe(f.entity.getStaticData());
  expect(display.getStaticData().getName()).toBe('Player');
  expect(display.getPlayStyles()[0].isPlus()).toBe(true);
  expect(display._hyperCosmeticDTOs).toBe(f.entity._hyperCosmeticDTOs);
  expect(display.getFoilSubtype()).toBe(0);
  wrapper.__fcatDealloc(); wrapper.__fcatDealloc();
  expect(f.view.dealloc).toHaveBeenCalledTimes(1); expect(f.parent.children).toHaveLength(0);
});
it('reconstructs a cached network DTO through EA factory before cloning getter-only fields', () => {
  const f = fixture(), raw = rawCard();
  expect(() => Object.assign(new GalleryItemEntity(), raw)).toThrow(TypeError);
  const before = structuredClone(raw), wrapper = f.renderer.render({parent:f.parent,raw});
  expect(wrapper).toBeTruthy(); expect(raw).toEqual(before);
  expect(f.root.factories.Item.createItem).toHaveBeenCalledExactlyOnceWith(raw);
  expect(f.root.factories.Item.createItem.mock.calls[0][0]).not.toBe(raw);
  expect(f.view.render.mock.calls[0][0]).toMatchObject({concept:false,rating:86,rareflag:22,possiblePositions:['CAM']});
  expect(f.view.render.mock.calls[0][0].getFoilSubtype()).toBe(0);
  wrapper.__fcatDealloc();
});
it.each(['main','shell'])('waits for the bounded timeout before falling back from missing %s artwork', asset => {
  vi.useFakeTimers();
  const f=fixture(), fallback=vi.fn(); f.view.assetsLoaded.set(asset,false);
  const wrapper = f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback});
  expect(wrapper).toBeTruthy();
  expect(fallback).not.toHaveBeenCalled();
  vi.advanceTimersByTime(15001);
  expect(fallback).toHaveBeenCalledOnce(); expect(f.view.dealloc).toHaveBeenCalledOnce();
  expect(f.parent.children).toHaveLength(0);
});
it('assigns the requested slot before inserting the native wrapper', () => {
  const f = fixture();
  const order = [];
  const originalAppend = f.parent.append;
  f.parent.append = child => { order.push(child.slot); originalAppend.call(f.parent, child); };
  const wrapper = f.renderer.render({parent:f.parent,raw:f.entity,slot:'gallery-card-7'});
  expect(wrapper.slot).toBe('gallery-card-7');
  expect(order).toEqual(['gallery-card-7']);
  wrapper.__fcatDealloc();
});
it.each(['main','shell'])('allows the asynchronous EA %s retry to finish before disposing the card', asset => {
  vi.useFakeTimers(); const f=fixture(), fallback=vi.fn();
  f.view.assetsLoaded.delete(asset);
  const retry=vi.fn(function(type) {
    setTimeout(()=>{this.assetsLoaded.set(type,true);this.renderComplete();},20);
  });
  f.view.onLoadDynamicPortraitError=retry;
  f.view.loadAsset=vi.fn(function(_url,type,item,onError){setTimeout(()=>onError.call(this,type,item),10);});
  f.view.render=vi.fn(function(item){this.loadAsset('fixture',asset,item,
    asset==='main'?this.onLoadDynamicPortraitError:retry);});
  const wrapper=f.renderer.render({parent:f.parent,raw:f.entity,onUnavailable:fallback});
  vi.advanceTimersByTime(10);
  expect(retry).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  expect(f.view.dealloc).not.toHaveBeenCalled();
  vi.advanceTimersByTime(15000);
  expect(f.view.assetsLoaded.get(asset)).toBe(true);
  expect(fallback).not.toHaveBeenCalled(); expect(f.view.dealloc).not.toHaveBeenCalled();
  wrapper.__fcatDealloc();
});
it('times out stalled artwork, while disposal cancels late callbacks', () => {
  vi.useFakeTimers(); const f=fixture(), fallback=vi.fn(); f.view.render=vi.fn();
  const wrapper=f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback});
  vi.advanceTimersByTime(15001); expect(fallback).toHaveBeenCalledTimes(1);
  f.view.renderComplete(); wrapper.__fcatDealloc(); expect(fallback).toHaveBeenCalledTimes(1);
  expect(f.view.dealloc).toHaveBeenCalledTimes(1);
});
it.each(['onLoadDynamicPortraitError','onLoadAssetError'])('preserves EA fallback behavior via %s', method => {
  const f=fixture(), fallback=vi.fn(), nativeFallback=vi.fn(); f.view[method]=nativeFallback;
  const wrapper = f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback});
  expect(wrapper).toBeTruthy();
  f.view[method]('main',{});
  expect(fallback).not.toHaveBeenCalled(); expect(nativeFallback).toHaveBeenCalledOnce();
  wrapper.__fcatDealloc();
});
it('keeps optional foil and shell fallback callbacks unchanged', () => {
  const f=fixture(), optional=vi.fn(), fallback=vi.fn();
  const original=vi.fn(); f.view.loadAsset=original;
  const wrapper=f.renderer.render({parent:f.parent,raw:f.entity,onUnavailable:fallback});
  f.view.loadAsset('unused', 'foil', f.entity, optional);
  expect(original.mock.calls[0][3]).toBe(optional);
  f.view.loadAsset('unused', 'shell', f.entity, optional);
  expect(original.mock.calls[1][3]).toBe(optional);
  original.mock.calls[1][3]();
  expect(fallback).not.toHaveBeenCalled(); expect(optional).toHaveBeenCalledOnce();
  wrapper.__fcatDealloc();
});
it('logs bounded render outcomes without card data and isolates diagnostic errors', () => {
  const f=fixture();
  for(let i=0;i<3;i++) f.renderer.render({parent:f.parent,raw:f.entity}).__fcatDealloc();
  expect(f.events).toEqual([{area:'gallery',event:'card-render',source:'ea',phase:'native-entity',status:'success'}]);
  const renderer=createFc27GalleryNativeRenderer(f.root,{document:{createElement:()=>f.parent},diagnosticLog:{record(){throw Error('ignored');}}});
  expect(renderer.render({parent:f.parent,raw:f.entity})).toBeTruthy();
});
it('releases the view when native render throws', () => {
  const f=fixture();f.view.render=()=>{throw Error('render failed');};
  expect(f.renderer.render({parent:f.parent,raw:rawCard()})).toBeNull();
  expect(f.view.dealloc).toHaveBeenCalledTimes(1);expect(f.parent.children).toHaveLength(0);
});
it('does not display a different definition or a non-player item', () => {
  const f=fixture();
  expect(f.renderer.render({parent:f.parent,raw:{...rawCard(),definitionId:227678}})).toBeNull();
  expect(f.root.UTItemViewFactory.createLargeItem).not.toHaveBeenCalled();
  expect(f.renderer.render({parent:f.parent,raw:{...rawCard(),itemType:'manager'}})).toBeNull();
  expect(f.root.UTItemViewFactory.createLargeItem).not.toHaveBeenCalled();
});
it('rejects a cached DTO rebuilt as the wrong version or a non-concept entity', () => {
  const f = fixture(); f.root.factories.Item.createItem.mockReturnValue({...f.entity,definitionId:1});
  expect(f.renderer.render({parent:f.parent,raw:rawCard()})).toBeNull();
  f.root.factories.Item.createItem.mockReturnValue({...f.entity,concept:false});
  expect(f.renderer.render({parent:f.parent,raw:rawCard()})).toBeNull();
  expect(f.view.render).not.toHaveBeenCalled();
});
it('keeps version artwork/foil metadata in a bounded DTO, excluding unrelated account data', () => {
  const raw={...rawCard(), secret:'private', owners:1}; const safe=sanitizeGalleryNativeCard(raw);
  expect(safe).toMatchObject({definitionId:50559326,resourceId:50559326,rareflag:22,hyperCosmetics:{1:0},guidAssetId:'special-version-guid'});
  expect(safe.secret).toBeUndefined(); expect(safe.attributeArray).not.toBe(raw.attributeArray);
  expect(sanitizeGalleryNativeCard({...raw,attributeArray:[null,1,2,3,4,5]})).toBeNull();
  expect(sanitizeGalleryNativeCard({...raw,attributeArray:undefined})).toBeNull();
  expect(sanitizeGalleryNativeCard({...raw,guidAssetId:undefined})).toBeTruthy();
  expect(sanitizeGalleryNativeCard({...raw,definitionId:227678})).toBeNull();
});
