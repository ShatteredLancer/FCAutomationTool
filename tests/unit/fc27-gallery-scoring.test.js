import { describe, expect, it } from 'vitest';
import { compileGalleryScoringRules, evaluateGalleryLineup, summarizeGalleryScore, createGalleryScoreSummarizer } from '../../src/gallery/scoring.js';

const tag = (id, attribute, type = 'COUNT', values = ['1'], tiers = [{ minItems: 2, bonus: 10 }]) => ({
  id, name: `Tag ${id}`, bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
  rules: [{ attribute, type, target: attribute === 'BASE_DEF_ID' ? 'BASE_DEF_ID' : 'ATTRIBUTE', values }], tiers,
});
const card = (eaId, extra = {}) => ({ eaId, playerEaId: eaId, gradingScore: 100, overall: 80,
  collected: true, firstOwned: false, holographic: false, positions: ['ST'], skillMoves: 3, weakFoot: 3,
  nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1, ...extra });
const rules = tags => compileGalleryScoringRules({ source: 'futgg', tags });
const set = { id: 'futgg:30', requiredCards: 2, grades: [
  {name:'D',threshold:10},{name:'C',threshold:220},{name:'B',threshold:500},
  {name:'A',threshold:1000},{name:'S',threshold:2000},
] };
const summary = (rows, tags = [tag(99,'RARE','COUNT',['999'])], target = set) => summarizeGalleryScore({ set: target,
  catalog: {source:'futgg',tags}, progress: {season:'27',setId:30,complete:true,rows} });

describe('Gallery scoring from public rules and exact EA base scores', () => {
  it('reuses scoring work across candidate pools without changing lineups, bonuses or FO semantics', () => {
    const catalog = { source: 'futgg', tags: [tag(1, 'FIRST_OWNED'),
      tag(2, 'NATION', 'COUNT_DIFF', ['0']), tag(3, 'BASE_DEF_ID', 'MAX_COUNT_ALL_SAME', ['0'])] };
    const cached = createGalleryScoreSummarizer(catalog);
    const rows = [card(1), card(2, { firstOwned: true }), card(3, { playerEaId: 2 }), card(4, { nationEaId: 2 })];
    for (const selection of [rows, rows.slice(0, 3), [...rows].reverse(), structuredClone(rows)]) {
      const input = { set, catalog, progress: { season: '27', setId: 30, complete: true, rows: selection } };
      expect(cached(input)).toEqual(summarizeGalleryScore(input));
    }
    rows[0].firstOwned = true; rows[0].gradingScore = 210;
    const changed = { set, catalog, progress: { season: '27', setId: 30, complete: true, rows } };
    expect(cached(changed)).toEqual(summarizeGalleryScore(changed));
    const otherRules = { source: 'futgg', tags: [tag(1, 'FIRST_OWNED', 'COUNT', ['1'], [{ minItems: 2, bonus: 80 }])] };
    expect(createGalleryScoreSummarizer(otherRules)({ ...changed, catalog: otherRules }))
      .toEqual(summarizeGalleryScore({ ...changed, catalog: otherRules }));
  });
  it('rounds each bonus down and only counts the ten largest', () => {
    const tags = Array.from({length:12}, (_, i) => tag(i+1,'RARE','COUNT',['1'],[{minItems:2,bonus:i+1}]));
    const result = evaluateGalleryLineup([card(1,{gradingScore:101}),card(2)], rules(tags));
    expect(result.base).toBe(201);
    expect(result.bonus).toBe(150);
    expect(result.tags.filter(t=>t.counted)).toHaveLength(10);
    expect(result.tags.filter(t=>!t.counted).map(t=>t.bonus)).toEqual([2,4]);
  });
  it('normalizes the public zero-based skill condition and counts multi-position cards once', () => {
    const result = evaluateGalleryLineup([card(1,{skillMoves:4,positions:['ST','CF']}),card(2,{skillMoves:5})],
      rules([tag(1,'SKILL_MOVES','MIN_COUNT',['4'],[{minItems:1,bonus:10}]),
        tag(2,'POSSIBLE_POSITIONS','COUNT_ANY',['ST','CF'])]));
    expect(result.tags.map(t=>t.count)).toEqual([1,2]);
    expect(result.bonus).toBe(30);
  });
  it('uses highest-bonus same group, and highest score representative for different groups', () => {
    const cards = [card(1),card(2),card(3),card(4,{nationEaId:2,gradingScore:1000}),card(5,{nationEaId:2,gradingScore:900})];
    const result = evaluateGalleryLineup(cards,rules([tag(1,'NATION','MAX_COUNT_ALL_SAME',['0']),tag(2,'NATION','COUNT_DIFF',['0'])]));
    expect(result.tags.map(t=>[t.count,t.matched,t.bonus])).toEqual([[2,1900,190],[2,1100,110]]);
    const alternate = evaluateGalleryLineup(cards,rules([tag(1,'NATION','MAX_COUNT_ALL_SAME',['0'])]),{groupMode:'futgg'});
    expect(alternate.tags[0].matched).toBe(300);
  });
  it('includes all qualifying footballer groups without duplicating exact versions', () => {
    const cards = [card(1,{playerEaId:10}),card(2,{playerEaId:10}),card(3,{playerEaId:20}),card(4,{playerEaId:20}),card(5)];
    expect(evaluateGalleryLineup(cards,rules([tag(1,'BASE_DEF_ID','MAX_COUNT_ALL_SAME',['0'])])).bonus).toBe(40);
    expect(()=>evaluateGalleryLineup([card(1),card(1)],rules([]))).toThrow(/INPUT/);
  });
  it('keeps unknown rules unavailable, including changed targets or nonmonotonic tiers', () => {
    for (const raw of [tag(1,'NEW_FIELD'), {...tag(1,'RARE'),rules:[]},
      {...tag(1,'RARE'),rules:[{...tag(1,'RARE').rules[0],target:'NEW_TARGET'}]},
      tag(1,'RARE','COUNT',['1'],[{minItems:1,bonus:50},{minItems:2,bonus:10}])]) {
      expect(summary([card(1),card(2)],[raw]).status).toBe('unavailable');
    }
  });
  it('separates incomplete membership and missing EA score from real zero', () => {
    expect(summary([card(1),card(2,{gradingScore:null,galleryScore:99999})]).status).toBe('partial');
    expect(summary([card(1),card(2,{collected:null})]).grade).toBeNull();
    const zero = summary([card(1,{gradingScore:0}),card(2,{gradingScore:0})]);
    expect(zero.status).toBe('calculated'); expect(zero.low.total).toBe(0); expect(zero.grade).toBeNull();
    expect(zero.full).toBe(false); expect(zero.zeroScoreCards).toBe(2);
    expect(summary([card(1)]).full).toBe(false);
    expect(summary([card(1)]).grade).toBeNull();
  });
  it('uses the full-lineup threshold, and reports the next grade gap', () => {
    const result = summary([card(1),card(2)],[tag(1,'RARE')]);
    expect(result.grade).toBe('C'); expect(result.nextGrade).toBe('B'); expect(result.pointsToNext).toBe(280);
    expect(summary([card(1,{gradingScore:3000})]).grade).toBeNull();
  });
  it('shows FO/optional-data scenarios for the SAME lineup; unknown is never silently false', () => {
    const result = summary([card(1,{firstOwned:true}),card(2,{firstOwned:null})],
      [tag(1,'FIRST_OWNED','COUNT',['1'],[{minItems:2,bonus:500}])]);
    expect(result.status).toBe('uncertain');
    expect([result.low.total,result.high.total]).toEqual([200,1200]);
    expect(result.unknownFields).toContain('firstOwned');
    expect(result.grade).toBeNull(); expect(result.lowGrade).toBe('D'); expect(result.highGrade).toBe('A');
    expect(result.low.lineupIds).toEqual(result.high.lineupIds);
  });
  it('replaces a higher base card when a group bonus makes a lower base card better', () => {
    const result = summary([card(1,{gradingScore:300,nationEaId:2}),card(2),card(3)],
      [tag(1,'NATION','MAX_COUNT_ALL_SAME',['0'],[{minItems:2,bonus:500}])]);
    expect(result.lineup.map(row=>row.eaId)).toEqual([2,3]); expect(result.low.total).toBe(1200);
  });
  it('does not mutate input, mix collections or silently claim a global optimum', () => {
    const rows=[card(1),card(2),card(3)]; const before=JSON.stringify(rows);
    expect(summary(rows).selection).toBe('bounded-search'); expect(JSON.stringify(rows)).toBe(before);
    expect(summary(rows,[],{...set,id:'futgg:31'}).status).toBe('unavailable');
  });
  it('recomputes on updated public bonus tiers and distinguishes unknown optional fields', () => {
    const rows=[card(1,{holographic:null}),card(2,{holographic:true})];
    const old=[tag(1,'HYPER_COSMETIC_TYPE','COUNT_ANY',['0','1'])];
    const current=[tag(1,'HYPER_COSMETIC_TYPE','COUNT_ANY',['0','1'],[{minItems:2,bonus:500}])];
    expect(summary(rows,old).high.total).toBe(220);
    expect(summary(rows,current).high.total).toBe(1200);
    expect(summary(rows,current).low.total).toBe(200);
    expect(summary(rows,current).unknownFields).toEqual(['holographic']);
  });
  it('surfaces reference-source discrepancies instead of claiming one confirmed grade', () => {
    const rows=[card(1,{playerEaId:10}),card(2,{playerEaId:10}),card(3,{playerEaId:20}),card(4,{playerEaId:20})];
    const result=summary(rows,[tag(1,'BASE_DEF_ID','MAX_COUNT_ALL_SAME',['0'])],{...set,requiredCards:4});
    expect(result.ruleDifference).toBe(true); expect(result.grade).toBeNull();
    expect(result.low.total).toBe(440); expect(result.comparison.low.total).toBe(420);
  });
});
