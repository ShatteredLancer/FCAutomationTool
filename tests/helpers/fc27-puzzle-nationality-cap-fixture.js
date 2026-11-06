import {puzzleFillFixture} from './fc27-puzzle-fill-fixture.js';
import {marketRow} from './fc27-market-fixture.js';

// Screenshot-shaped 11-player/75-rating/26-chemistry control. All entities,
// positions, prices and account data are synthetic, not the user's inventory.
export function nationalityCapFixture(){
  const input=puzzleFillFixture(),base=input.inventory.items[0];
  input.policy.onlyUntradeable=false;input.policy.maxRating=82;input.inventory.items=[];
  input.challenge.setId=108;input.challenge.id=162;
  input.challenge.formation.positions=[5,7,9,11,12,13,14,15,16,17,18];
  const identity=marketRow(12,240,2);identity.pairs[0].values=[240,241];
  input.challenge.rawRequirements=[identity,marketRow(4,3,-1,1),marketRow(6,4),marketRow(8,3),marketRow(19,75),marketRow(35,26)];
  input.marketPolicy={budget:50000,maxPurchases:11,maxUnitPrice:5000,minimumRetainedCoins:1000,availableCoins:100000};
  const card=(definitionId,slot,teamId,leagueId,nationId)=>({definitionId,rating:75,rarity:0,nationId,teamId,leagueId,
    positions:[input.challenge.formation.positions[slot]],groups:[],special:false,evolution:false,cosmetic:false});
  const nations=[52,18,45,21];
  const a=Array.from({length:4},(_,i)=>card(2001+i,i,240,13,nations[i]));
  const b=Array.from({length:4},(_,i)=>card(2101+i,4+i,70,19,nations[i]));
  const c=Array.from({length:3},(_,i)=>card(2201+i,8+i,80,53,[18,45,52][i]));
  const pages=[
    {query:{start:0,count:20,level:'gold',team:240},entries:[...a,...Array.from({length:15},(_,i)=>card(3001+i,i%4,240,13,52))]},
    {query:{start:0,count:20,level:'gold'},entries:[...b,c[0],...Array.from({length:15},(_,i)=>card(4001+i,i%4,100+i,13,52))]},
    {query:{start:0,count:20,level:'gold',league:53},entries:c},
  ];
  return {input,base,pages,known:[...a,...b,...c],card};
}
