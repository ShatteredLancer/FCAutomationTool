import { it, expect, vi } from 'vitest';
import { createFc27MarketPlayerPicker } from '../../src/adapters/ea/fc27-market-player-picker.js';
function fixture(){
 let account='A';const data=[{id:101,rating:88,commonName:'David Raya'},{id:202,rating:79,commonName:'Rayan'}];
 const search=vi.fn(()=>data),root={ItemIdMask:{DATABASE:0xffffff},repositories:{Item:{getStaticData:()=>data}},UTPlayerSearchEngine:class{getEntriesForString(...args){return search(...args);}}};
 const entries=[{definitionId:101,rating:88,rarity:1,evolution:false,cosmetic:false},{definitionId:0x1000065,rating:89,rarity:3,evolution:false,cosmetic:false}];
 const read=vi.fn(async()=>({entries,pageEndObserved:true})),transport=vi.fn(async()=>({readPlayerVersions:read}));
 const picker=createFc27MarketPlayerPicker({root,context:()=>({scope:account}),createTransport:transport});
 return {picker,search,transport,read,entries,switchAccount:()=>{account='B';}};
}
it('uses EA names without requests and only materializes exact versions after selection',async()=>{
 const f=fixture();expect(f.picker.search('Raya')[0]).toEqual({playerId:101,name:'David Raya',rating:88});expect(f.search).toHaveBeenCalledWith('Raya',5);expect(f.transport).not.toHaveBeenCalled();
 const result=await f.picker.versions(101);expect(result.rows.map(r=>r.definitionId)).toEqual([101,0x1000065]);expect(result.rows.map(r=>r.rating)).toEqual([88,89]);expect(f.read).toHaveBeenCalledWith({playerId:101,start:0,count:20});
 await f.picker.versions(101);expect(f.read).toHaveBeenCalledTimes(1);expect(f.picker.known()).toHaveLength(2);
 f.switchAccount();expect(f.picker.known()).toEqual([]);
});
it('drops late/cancelled responses and refuses another player or an arbitrary ID',async()=>{
 const f=fixture();await expect(f.picker.versions(303)).rejects.toThrow('QUERY_INVALID');expect(f.transport).not.toHaveBeenCalled();
 f.entries[0].definitionId=202;await expect(f.picker.versions(101)).rejects.toThrow('VERSIONS_INVALID');expect(f.picker.known()).toEqual([]);
 f.entries[0].definitionId=101;f.read.mockImplementation(async()=>{f.switchAccount();return {entries:f.entries,pageEndObserved:true};});
 await expect(f.picker.versions(101)).rejects.toThrow('CONTEXT_CHANGED');expect(f.picker.known()).toEqual([]);
});
it('checks cancellation after preparing the transport, before sending',async()=>{
 const f=fixture();let active=true;f.transport.mockImplementation(async()=>{active=false;return {readPlayerVersions:f.read};});
 await expect(f.picker.versions(101,{isCurrent:()=>active})).rejects.toThrow('CONTEXT_CHANGED');expect(f.read).not.toHaveBeenCalled();
});
it('keeps pages bounded and excludes evolution/cosmetic rows',async()=>{
 const f=fixture();f.entries[0].evolution=true;expect((await f.picker.versions(101)).rows).toHaveLength(1);
 await expect(f.picker.versions(101,{start:100})).rejects.toThrow('QUERY_INVALID');
});
