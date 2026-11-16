import { expect, it } from 'vitest';
import { createPuzzleClubQualityCapacity } from '../../src/fc27/puzzle-club-quality-capacity.js';
const resolveClub = id => id===101 ? 1 : id;
const make = (candidates, minimum=3, clubLimit=2) => createPuzzleClubQualityCapacity({ candidates,
  matches: candidates.map(card=>card.rating>=65&&card.rating<75), minimum, clubLimit, resolveClub });
const row = (id, teamId, silver=true, definitionId=id) => ({id, definitionId, teamId, rating:silver?65:78});
function combinations(indices, count) {
  if (!count) return [[]];
  return indices.flatMap((index, offset)=>combinations(indices.slice(offset+1),count-1).map(tail=>[index,...tail]));
}
it('couples silver and total headcount to the same five clubs instead of mixing independent best capacities',()=>{
  const silver=[...Array.from({length:6},(_,i)=>row(i+1,1)),...Array.from({length:4},(_,i)=>row(10+i,2+i))];
  const gold=Array.from({length:12},(_,i)=>row(30+i,10+Math.floor(i/4),false));
  const candidates=[...silver,...gold];
  expect(make(candidates,10,5).canReach([],0,11,0)).toBe(false);
  candidates.push(row(99,2,false));
  expect(make(candidates,10,5).canReach([],0,11,0)).toBe(true);
  candidates.pop(); candidates.push(row(100,101,false));
  expect(make(candidates,10,5).canReach([],0,11,0)).toBe(true);
});
it('retains a legal eleven-silver composition instead of forcing a bronze filler',()=>{
  const candidates=Array.from({length:11},(_,i)=>row(i+1,1+Math.floor(i/6)));
  expect(make(candidates,10,5).canReach([],0,11,0)).toBe(true);
});
it('rejects the captured aggregate shape: five available silvers in one club and nineteen isolated silvers',()=>{
  const silver=[...Array.from({length:5},(_,i)=>row(i+1,1)),...Array.from({length:19},(_,i)=>row(10+i,2+i))];
  const gold=Array.from({length:28},(_,i)=>row(100+i,100+Math.floor(i/4),false));
  expect(make([...silver,...gold],10,5).canReach([],0,11,0)).toBe(false);
});
it('does not count a newly used club as a free club slot',()=>{
  const candidates=[row(1,1),row(2,2),row(3,2),row(4,3),row(5,3),row(6,4,false)];
  expect(make(candidates,3,2).canReach([candidates[0]],1,3,1)).toBe(false);
  expect(make(candidates,3,3).canReach([candidates[0]],1,3,1)).toBe(true);
});
it.each([false,true])('never removes a brute-force valid suffix completion (duplicate definitions=%s)', duplicates=>{
  let validCases=0, tested=0;
  for(let seed=0;seed<32;seed++){
    let state=seed+1;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state>>>16)%n;};
    const candidates=Array.from({length:8},(_,i)=>row(i+1,[1,101,2,3][random(4)],random(3)!==0,duplicates?1+random(6):i+1));
    const bound=make(candidates), all=candidates.map((_,i)=>i);
    for(let start=0;start<=8;start++)for(let chosenCount=0;chosenCount<=Math.min(3,start);chosenCount++){
      for(const prefix of combinations(all.slice(0,start),chosenCount)){
        const chosen=prefix.map(i=>candidates[i]), remaining=4-chosen.length;
        const usedMatches=chosen.filter(c=>c.rating<75).length;
        const witness=combinations(all.slice(start),remaining).some(indices=>{
          const squad=[...chosen,...indices.map(i=>candidates[i])];
          return new Set(squad.map(c=>c.definitionId)).size===4&&new Set(squad.map(c=>resolveClub(c.teamId))).size<=2
            &&squad.filter(c=>c.rating<75).length>=3;
        });
        tested++;
        if(!duplicates)expect(bound.canReach(chosen,start,remaining,usedMatches)).toBe(witness);
        if(witness){validCases++;expect(bound.canReach(chosen,start,remaining,usedMatches),JSON.stringify({seed,start,prefix,duplicates})).toBe(true);}
      }
    }
  }
  expect(tested).toBeGreaterThan(1000);expect(validCases).toBeGreaterThan(0);
});
