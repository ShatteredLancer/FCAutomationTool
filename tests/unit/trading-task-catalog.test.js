import {it,expect,vi} from 'vitest';
import {readTaskCatalogPage,taskExclusion} from '../../src/trading/task-catalog.js';
import {defaultTradingTaskSettings} from '../../src/trading/task-model.js';

const card=id=>({definitionId:id,playerId:id,name:`Player ${id}`,rating:84,quality:'gold',leagueId:13});
it('pages a wide 50k catalog without reading prices or materializing a full match list',async()=>{
 let reads=0;const rows=Array.from({length:50000},(_,i)=>({...card(i+1),get price(){throw Error('price-read');},get rating(){reads++;return 84;}}));
 const first=await readTaskCatalogPage({rows,settings:defaultTradingTaskSettings()});expect(first.rows.map(c=>c.definitionId)).toEqual([1,2,3,4,5]);expect(first.more).toBe(true);expect(first.scanned).toBe(6);expect(reads).toBeLessThan(40);
 const second=await readTaskCatalogPage({rows,settings:defaultTradingTaskSettings(),cursor:first.next});expect(second.rows.map(c=>c.definitionId)).toEqual([6,7,8,9,10]);expect(second.scanned).toBe(6);
});
it('yields sparse searches and cancels stale results before traversing the remainder',async()=>{
 let current=true;const pause=vi.fn(async()=>{current=false;});await expect(readTaskCatalogPage({rows:Array.from({length:50000},(_,i)=>card(i+1)),query:'absent',yieldControl:pause,isCurrent:()=>current})).rejects.toThrow('TASKS_CONTEXT_CHANGED');expect(pause).toHaveBeenCalledTimes(1);
});
it('unknown catalog metadata never satisfies a specific quality or league filter',async()=>{
 const result=await readTaskCatalogPage({rows:[{...card(1),quality:undefined},card(2),{...card(3),leagueId:14}],settings:{...defaultTradingTaskSettings(),quality:'gold',league:13}});expect(result.rows.map(c=>c.definitionId)).toEqual([2]);
});
it('uses exact identity for exclusions, never matching a same-name different person',()=>{
 const a=card(1),b={...card(2),name:a.name},special={...card(3),playerId:1,name:a.name};expect(taskExclusion(b,[{type:'player',id:1}])).toBeUndefined();expect(taskExclusion(special,[{type:'player',id:1}])).toBeDefined();expect(taskExclusion(special,[{type:'version',id:1}])).toBeUndefined();
});
