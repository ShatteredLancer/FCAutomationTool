import { afterEach, expect, it, vi } from 'vitest';
import { createFc27GalleryNativeRenderer } from '../../src/adapters/ea/fc27-gallery-card.js';
import { sanitizeGalleryNativeCard } from '../../src/adapters/ea/fc27-gallery-progress.js';

const rawCard = () => ({ resourceId: 50559326, assetId: 227678, itemType: 'player', dream: true,
  rareflag: 22, rating: 86, attributeArray: [80,70,60,50,40,30], guidAssetId: 'special-version-guid', hyperCosmetics: { 1: 0 } });
function fixture() {
  const element = () => ({ nodeType: 1, style: {}, children: [], setAttribute: vi.fn(),
    append(child) { this.children.push(child); child.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); } });
  const document = { createElement: element }, parent = element();
  const entity = { concept: true, definitionId: 50559326, guidAssetId: 'special-version-guid' };
  const view = { init: vi.fn(), dealloc: vi.fn(), getRootElement: () => element(),
    assetsLoaded: new Map([['main',true],['shell',true],['rank',false]]), renderComplete: vi.fn(),
    render: vi.fn(function () { this.renderComplete(); }) };
  const root = { UTItemEntity: class {}, factories: { Item: { createItem: vi.fn(raw => { raw.rating = 1; return entity; }) } },
    UTItemViewFactory: { createLargeItem: vi.fn(() => view) } };
  return { root, entity, view, parent, renderer: createFc27GalleryNativeRenderer(root,{document}) };
}
afterEach(() => vi.useRealTimers());
it('renders an exact-version native display copy without mutating concept/DTO or requiring optional rank artwork', () => {
  const f = fixture(), raw = rawCard(), unavailable = vi.fn();
  const wrapper = f.renderer.render({parent:f.parent,raw,onUnavailable:unavailable});
  expect(wrapper).toBeTruthy(); expect(unavailable).not.toHaveBeenCalled();
  expect(raw.rating).toBe(86); expect(f.entity.concept).toBe(true);
  expect(f.view.render.mock.calls[0][0]).toMatchObject({concept:false,definitionId:50559326,guidAssetId:'special-version-guid'});
  expect(f.view.render.mock.calls[0][0]).not.toBe(f.entity);
  wrapper.__fcatDealloc(); wrapper.__fcatDealloc();
  expect(f.view.dealloc).toHaveBeenCalledTimes(1); expect(f.parent.children).toHaveLength(0);
});
it.each(['main','shell'])('missing %s artwork releases the view and reports text fallback once', asset => {
  const f=fixture(), fallback=vi.fn(); f.view.assetsLoaded.set(asset,false);
  expect(f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback})).toBeNull();
  expect(fallback).toHaveBeenCalledTimes(1); expect(f.view.dealloc).toHaveBeenCalledTimes(1);
  expect(f.parent.children).toHaveLength(0);
});
it('times out stalled artwork, while disposal cancels late callbacks', () => {
  vi.useFakeTimers(); const f=fixture(), fallback=vi.fn(); f.view.render=vi.fn();
  const wrapper=f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback});
  vi.advanceTimersByTime(15001); expect(fallback).toHaveBeenCalledTimes(1);
  f.view.renderComplete(); wrapper.__fcatDealloc(); expect(fallback).toHaveBeenCalledTimes(1);
  expect(f.view.dealloc).toHaveBeenCalledTimes(1);
});
it.each(['onLoadDynamicPortraitError','onLoadAssetError'])('suppresses EA basic/silhouette fallback on %s for this view only', method => {
  const f=fixture(), fallback=vi.fn(), nativeFallback=vi.fn(); f.view[method]=nativeFallback;
  f.view.render=vi.fn(function(){this[method]('main',{});});
  expect(f.renderer.render({parent:f.parent,raw:rawCard(),onUnavailable:fallback})).toBeNull();
  expect(fallback).toHaveBeenCalledTimes(1);expect(nativeFallback).not.toHaveBeenCalled();
});
it('releases the view when native render throws', () => {
  const f=fixture();f.view.render=()=>{throw Error('render failed');};
  expect(f.renderer.render({parent:f.parent,raw:rawCard()})).toBeNull();
  expect(f.view.dealloc).toHaveBeenCalledTimes(1);expect(f.parent.children).toHaveLength(0);
});
it('does not display a different definition or a non-player item', () => {
  const f=fixture(); f.entity.definitionId=227678;
  expect(f.renderer.render({parent:f.parent,raw:rawCard()})).toBeNull();
  expect(f.root.UTItemViewFactory.createLargeItem).not.toHaveBeenCalled();
  expect(f.renderer.render({parent:f.parent,raw:{...rawCard(),itemType:'manager'}})).toBeNull();
  expect(f.root.factories.Item.createItem).toHaveBeenCalledTimes(1);
});
it('keeps version artwork/foil metadata in a bounded DTO, excluding unrelated account data', () => {
  const raw={...rawCard(), secret:'private', owners:1}; const safe=sanitizeGalleryNativeCard(raw);
  expect(safe).toMatchObject({resourceId:50559326,rareflag:22,hyperCosmetics:{1:0},guidAssetId:'special-version-guid'});
  expect(safe.secret).toBeUndefined(); expect(safe.attributeArray).not.toBe(raw.attributeArray);
  expect(sanitizeGalleryNativeCard({...raw,attributeArray:[null,1,2,3,4,5]})).toBeNull();
  expect(sanitizeGalleryNativeCard({...raw,attributeArray:undefined})).toBeNull();
  expect(sanitizeGalleryNativeCard({...raw,guidAssetId:undefined})).toBeTruthy();
});
