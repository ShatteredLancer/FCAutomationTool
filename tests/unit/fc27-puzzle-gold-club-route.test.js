import { expect, it, vi } from 'vitest';
import { goldClubFixture } from '../helpers/fc27-puzzle-gold-club-fixture.js';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from '../../src/fc27/puzzle-concept-draft.js';

it('has a native-valid 7-gold/8-player witness under the simultaneous league and club caps', () => {
  const { input, known } = goldClubFixture();
  const squad = Array.from({ length:11 }, (_, slot) => slot < 8 ? { ...input.inventory.items[0], ...known[slot], slot } : null);
  const facts = evaluateFc27PuzzleSquad({ squad,
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(facts).toMatchObject({ status: 'observed', chemistry: 24 });
  expect(facts.teamRating).toBeGreaterThanOrEqual(70);
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements,8).rules,
    squad: known, chemistry: facts.chemistry, teamRating: facts.teamRating, clubLinks:input.clubLinks }).status).toBe('satisfied');
});

it('widens gold into a second league instead of spending both remaining pages on low-tier club cards', () => {
  const { input, pages } = goldClubFixture();
  const result = planFc27PuzzleShortageQueries(input, pages[0].entries, { usedQueries: [pages[0].query] });
  expect(result.status).toBe('ready');
  expect(result.queries[0]).toEqual(pages[1].query);
  expect(result.queries).not.toContainEqual(pages[0].query);
});

it('rejects a locally impossible gold/league-cap pool before enumerating 50000 combinations', () => {
  const { input, pages } = goldClubFixture(), entries=pages[0].entries;
  const result=suggestFc27PuzzleJointPurchases(input,entries,{ prices:new Map(entries.map(item => [item.definitionId,200])) });
  expect(result.status).toBe('blocked');
  expect(result.reason).not.toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(result.nodes).toBeLessThan(500);
  expect(result.marketWideInfeasibilityProven).not.toBe(true);
});

it.each([1,2].flatMap(capScope => [0,2].flatMap(qualityScope => [false,true].map(linked =>
  [capScope,qualityScope,linked]))))('keeps a feasible witness with cap scope %s, quality scope %s, linked clubs %s and duplicate copies',
  (capScope,qualityScope,linked) => {
    const { input, known } = goldClubFixture(), base=input.inventory.items[0];
    input.challenge.rawRequirements[0].scope=capScope;
    input.challenge.rawRequirements[3].scope=qualityScope;
    input.inventory.items=known.map((item,index) => ({ ...base,...item,id:index+1 }));
    input.inventory.items.push({ ...input.inventory.items[0],id:101 },{ ...input.inventory.items[7],id:102 });
    if (linked) {
      input.clubLinks.links=[[240,1240]];
      input.inventory.items[0].teamId=1240; input.inventory.items[1].teamId=1240;
    }
    const result=previewFc27PuzzleSquad(input);
    expect(result.status,JSON.stringify(result)).toBe('preview');
    expect(new Set(result.selected.map(item => item.definitionId)).size).toBe(8);
    expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(22);
    expect(result.selected.filter(item => item.rating >= 75)).toHaveLength(7);
    expect(result.nodes).toBeLessThan(50000);
  });

it('does not use locked lower-tier club cards as query-direction anchors', () => {
  const { input, pages } = goldClubFixture();
  for(const item of input.inventory.items) if(item.teamId===70) item.locked=true;
  const result=planFc27PuzzleShortageQueries(input,pages[0].entries,{usedQueries:[pages[0].query]});
  expect(result.queries).not.toContainEqual(pages[1].query);
});

it('keeps a broad dominant-tier discovery lane when every known club is already in a saturated league', () => {
  const { input, pages } = goldClubFixture();
  for(const item of input.inventory.items) item.leagueId=1;
  const result=planFc27PuzzleShortageQueries(input,pages[0].entries,{usedQueries:[pages[0].query]});
  expect(result.queries[0]).toEqual({start:0,count:20,level:'gold'});
});

it('solves through actual procurement, public price approval and concept revalidation within the same three-page/50k limits', async () => {
  const { input, pages } = goldClubFixture(), cache = new Map();
  const readCatalogPage = vi.fn(async query => ({ status:'observed', season:'27',source:'ea-defid',
    query, observedAt: input.now, entries: pages.find(page => JSON.stringify(page.query) === JSON.stringify(query))?.entries ?? [] }));
  const readQuotePage = vi.fn();
  const session = createFc27PuzzleProcurementSession({ now: () => input.now,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => { cache.set(key,structuredClone(value)); },
    createTransport: async () => ({ readCatalogPage, readQuotePage }),
    loadPublicPrices: async ids => ({ policy:{source:'futbin'},references:Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId,season:'27',platform:'pc',quotes:Object.fromEntries(['futgg','futbin'].map(source => [source,
        {schema:2,source,definitionId,season:'27',platform:'pc',price:source==='futbin'?200:null,
          fetchedAt:input.now,expiresAt:input.now+300000,sourceUpdatedAt:null,error:source==='futbin'?null:'FC27_PUBLIC_PRICE_NOT_REQUESTED'}])) }])) }),
  });
  const result=await session.plan(input,{ optimizeMaterialValue:true });
  expect(result,JSON.stringify(result)).toMatchObject({ status:'suggested',plans:[{conceptPlan:{status:'prepared'}}] });
  const plan=result.plans[0];
  expect([...plan.selectedOwned,...plan.purchases].filter(item => item.rating >= 75).length).toBeGreaterThanOrEqual(7);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  const draft=prepareFc27PuzzleConceptDraft(input,plan);
  expect(draft.status).toBe('prepared');
  const freshOwned=plan.selectedOwned.map(ref => input.inventory.items.find(item => item.id===ref.id));
  expect(validateFc27PuzzleConceptDraft(draft,input,freshOwned).status).toBe('verified');
  expect(validateFc27PuzzleConceptDraft(draft,input,[]).status).toBe('blocked');
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  expect(readQuotePage).not.toHaveBeenCalled();
  const reads=readCatalogPage.mock.calls.length;
  const repeated=await session.plan(input,{ optimizeMaterialValue:true });
  expect(repeated.status).toBe('suggested');
  expect(repeated.requests).toBe(0);
  expect(readCatalogPage).toHaveBeenCalledTimes(reads);
},30000);
