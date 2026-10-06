import { describe, expect, it } from 'vitest';
import { galleryRewardIdentity, galleryCatalogGrade, galleryRewardOptions, galleryCatalogRewardSnapshot, gallerySetRewardSummary, galleryTierRewardSummary } from '../../src/gallery/catalog-rewards.js';
import { planGalleryGrade } from '../../src/gallery/planner.js';
import { planGalleryGradeOverviewSteps } from '../../src/gallery/preview.js';
import { planGalleryJoint, planGalleryJointSteps } from '../../src/gallery/joint-planner.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';

const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
  tiers: [{ minItems: 1, bonus: 0 }] }] };
const token = value => ({ type: 'event_token_1', value, count: 1, label: `${value} Gallery Tokens` });
const card = (eaId, value, collected = false) => ({ eaId, playerEaId: eaId, gradingScore: value, galleryScore: value,
  collected, firstOwned: false, holographic: false, overall: 80, positions: ['ST'],
  clubEaId: 1, leagueEaId: 1, nationEaId: 1, rarityEaId: 1, skillMoves: 3, weakFoot: 3 });
const target = (id, rows, prices = {}) => ({ set: { id: `futgg:${id}`, name: `Set ${id}`, requiredCards: 2,
  grades: [{ name: 'D', threshold: 100, rewards: [token(5)], rewardsComplete: true },
    { name: 'B', threshold: 250, rewards: [token(10)], rewardsComplete: true },
    { name: 'S', threshold: 400, rewards: [token(20)], rewardsComplete: true }] },
  catalog, progress: { season: '27', setId: id, complete: true, rows }, prices, targetGrade: 'D', scope: 'test' });
const optimize = (targets, extra = {}) => planGalleryJoint({ targets, budget: 200, catalogRewardKey: 'event_token_1', ...extra });

describe('catalogue-only Gallery rewards', () => {
  it('snapshots single-set actual grades, cumulative rewards and zero-cost achieved results', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 });
    const plan = planGalleryGrade({ ...t, targetGrade: 'B' });
    expect(plan.currentRewards).toMatchObject({ grade: 'D', claimState: 'unknown', rewards: [{ quantity: 5 }] });
    expect(plan.plans[0]).toMatchObject({ totalPrice: 200, rewards: { grade: 'S', rewards: [{ quantity: 35 }] } });
    const done = planGalleryGrade(t);
    expect(done).toMatchObject({ status: 'achieved', plans: [], currentRewards: { grade: 'D', rewards: [{ quantity: 5 }] } });
    t.set.grades[0].rewards[0].value = 99;
    expect(plan.currentRewards.rewards[0].quantity).toBe(5);
  });
  it('does not unlock catalogue rewards from an unfilled lineup or invent omitted Fodder rewards', () => {
    const set = target(10, []).set;
    expect(gallerySetRewardSummary(set, { full: false, low: { total: 9999 } }))
      .toMatchObject({ grade: null, rewards: [], claimState: 'unknown' });
    set.grades.forEach(grade => { grade.rewardsComplete = false; });
    expect(gallerySetRewardSummary(set, { full: true, low: { total: 400 } }))
      .toMatchObject({ rewardsComplete: false, rewards: [{ quantity: 35 }] });
  });
  it('retains per-tier and cumulative definitions even when a grade cost cannot be found', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true)]);
    const steps = planGalleryGradeOverviewSteps(t); let next;
    do { next = steps.next(); } while (!next.done);
    expect(next.value.grades[0]).toMatchObject({ status: 'achieved', rewards: {
      tier: { rewards: [{ quantity: 5 }] }, cumulative: { rewards: [{ quantity: 5 }] } } });
    expect(next.value.grades[2].status).not.toBe('ready');
    expect(next.value.grades[2].rewards).toMatchObject({
      tier: { rewards: [{ quantity: 20 }] }, cumulative: { rewards: [{ quantity: 35 }] } });
    const badge = { type: 'item', value: 6000195, count: 2, label: 'Badge' };
    t.set.grades[2].rewards.push(badge);
    expect(galleryTierRewardSummary(t.set, t.set.grades[2]).cumulative.rewards.map(row => row.quantity)).toEqual([35, 2]);
  });
  it('treats tokens as amounts and item values as identities, never as coin income', () => {
    expect(galleryRewardIdentity(token(50))).toMatchObject({ key: 'event_token_1', quantity: 50 });
    const badge = { type: 'item', itemType: 'badge', value: 11023, count: 1, label: 'Badge' };
    expect(galleryRewardIdentity(badge).quantity).toBe(1);
    expect(galleryRewardIdentity({ ...badge, value: 11024 }).key).not.toBe(galleryRewardIdentity(badge).key);
    expect(galleryRewardIdentity({ ...badge, count: Infinity })).toBeNull();
    expect(galleryRewardIdentity({ ...badge, type: 'pack' }).key).not.toBe(galleryRewardIdentity(badge).key);
  });
  it('identifies the displayed highest grade including equal-threshold tie order', () => {
    const set = target(1, []).set;
    expect(galleryCatalogGrade(set, { full: true, low: { total: 450 } }).name).toBe('S');
    expect(galleryCatalogGrade(set, { full: false, low: { total: 450 } })).toBeNull();
    set.grades[2].threshold = 250;
    expect(galleryCatalogGrade(set, { full: true, low: { total: 250 } }).name).toBe('S');
  });
  it('sums each reached tier of each set and keeps badge identity separate from token amounts', () => {
    const t = target(45, []);
    t.set.grades = [
      { name: 'D', threshold: 10, rewardsComplete: true, rewards: [{ type: 'item', value: 6000195, count: 1 }] },
      { name: 'C', threshold: 400, rewardsComplete: true, rewards: [{ type: 'item', value: 6300001, count: 1 }] },
      { name: 'B', threshold: 700, rewardsComplete: true, rewards: [token(8)] },
      { name: 'A', threshold: 1100, rewardsComplete: true, rewards: [token(10)] },
      { name: 'S', threshold: 1500, rewardsComplete: true, rewards: [token(20)] },
    ];
    const snapshot = score => galleryCatalogRewardSnapshot([{ target: t, summary: { full: true, low: { total: score } } }], 'event_token_1');
    expect(snapshot(1100).quantity).toBe(18);
    expect(snapshot(1500).quantity).toBe(38);
    expect(snapshot(1500).targets[0].rewards).toHaveLength(5);
    expect(snapshot(1500).quantity - snapshot(1100).quantity).toBe(20);
    t.set.grades[0].rewardsComplete = false;
    expect(snapshot(1500).targets[0].rewardsComplete).toBe(false);
  });
  it('upgrades under budget, separates baseline from projection and deduplicates shared purchases', () => {
    const rows = [card(1, 100, true), card(2, 100, true), card(3, 300)];
    const input = [target(10, rows, { 3: 200 }), target(11, rows, { 3: 200 })];
    const original = structuredClone(input);
    const result = optimize(input);
    expect(result).toMatchObject({ status: 'ready', searchComplete: false });
    expect(result.plans[0]).toMatchObject({ totalPrice: 200,
      rewardEstimate: { baselineQuantity: 10, projectedQuantity: 70, change: 60,
        gradeRule: 'cumulative-tiers', claimState: 'unknown', status: 'catalog-only' } });
    expect(result.plans[0].items.map(row => row.eaId)).toEqual([3]);
    expect(result.plans[0].targets.map(row => row.targetGrade)).toEqual(['S', 'S']);
    expect(input).toEqual(original);
  });

  it('uses each set own thresholds and rewards instead of sharing a grade schedule', () => {
    const hull = target(45, []), arsenal = target(30, []);
    hull.set.grades = [
      { name: 'B', threshold: 700, rewards: [token(8)], rewardsComplete: true },
      { name: 'A', threshold: 1100, rewards: [token(10)], rewardsComplete: true },
      { name: 'S', threshold: 1500, rewards: [token(20)], rewardsComplete: true },
    ];
    arsenal.set.grades = [
      { name: 'B', threshold: 700000, rewards: [token(50)], rewardsComplete: true },
      { name: 'A', threshold: 1300000, rewards: [token(70)], rewardsComplete: true },
      { name: 'S', threshold: 2500000, rewards: [token(100)], rewardsComplete: true },
    ];
    const result = galleryCatalogRewardSnapshot([
      { target: hull, summary: { full: true, low: { total: 1500 } } },
      { target: arsenal, summary: { full: true, low: { total: 1300000 } } },
    ], 'event_token_1');
    expect(result.quantity).toBe(158);
    expect(result.targets.map(row => [row.setId, row.grade, row.quantity]))
      .toEqual([['futgg:45', 'S', 38], ['futgg:30', 'A', 120]]);
  });
  it('uses purchase total, not average price, and cheaper equal reward plans first', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300), card(4, 300)], { 3: 200, 4: 150 });
    expect(optimize([t]).plans[0].totalPrice).toBe(150);
  });
  it('prefers more aggregate same-type catalogue quantities over an expensive single-set upgrade', () => {
    const a = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300), card(4, 150)], { 3: 200, 4: 50 });
    const b = target(11, [card(5, 100, true), card(6, 100, true), card(7, 300)], { 7: 150 });
    const result = optimize([a, b]);
    expect(result.plans[0].items.map(row => row.eaId).sort()).toEqual([4, 7]);
    expect(result.plans[0].rewardEstimate).toMatchObject({ projectedQuantity: 50, change: 40 });
  });
  it('retains unlocked lower token rewards when a higher tier awards a kit', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 150), card(4, 300)], { 3: 100, 4: 50 });
    t.set.grades[2].rewards = [{ type: 'item', itemType: 'kit', value: 1234, count: 1, label: 'Kit' }];
    const plan = optimize([t]).plans[0];
    expect(plan.items.map(row => row.eaId)).toEqual([4]);
    expect(plan.rewardEstimate.projectedQuantity).toBe(15);
    expect(galleryRewardOptions([t])).toHaveLength(2);
  });
  it('does not fabricate unclaimed rewards for an already reached top grade', () => {
    const result = optimize([target(10, [card(1, 200, true), card(2, 200, true)])], { budget: 0 });
    expect(result).toMatchObject({ status: 'achieved', plans: [], rewardEstimate: {
      baselineQuantity: 35, projectedQuantity: 35, change: 0, claimState: 'unknown' } });
  });
  it.each([0, 199])('does not buy beyond budget %i or falsely prove no improvement', budget => {
    const result = optimize([target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 })], { budget });
    expect(result).toMatchObject({ status: 'partial', searchComplete: false, plans: [] });
  });
  it('requires an explicit budget and valid objective and never treats missing quotes as free', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)]);
    expect(optimize([t])).toMatchObject({ status: 'partial', reason: 'price-unknown', plans: [] });
    expect(optimize([t], { budget: null })).toMatchObject({ status: 'unavailable', reason: 'reward-budget-required' });
    expect(optimize([t], { catalogRewardKey: 'unknown' })).toMatchObject({ status: 'unavailable', reason: 'reward-type-unknown' });
  });
  it('retains incomplete Fodder reward disclosure and does not grant purchased FO', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 });
    t.set.id = 'fodder:clubs/test'; t.catalog = { source: 'fodder', engine: { version: 1, bonusMinusOne: true },
      tags: [{ id: 1, match: { by: 'rarity', how: 'is', values: ['999'] }, steps: [{ at: 1, pct: 0 }] }] }; t.progress.setId = t.set.id;
    t.set.grades.forEach(grade => { grade.rewardsComplete = false; });
    const result = optimize([t]);
    expect(result.plans[0].rewardEstimate.projectedTargets[0].rewardsComplete).toBe(false);
    const fo = target(11, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 });
    fo.catalog = { source: 'futgg', tags: [{ id: 2, name: 'FO', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'FIRST_OWNED', type: 'COUNT', target: 'ATTRIBUTE', values: ['1'] }],
      tiers: [{ minItems: 1, bonus: 1000 }] }] };
    fo.set.grades[1].threshold = 1000; fo.set.grades[2].threshold = 2000;
    expect(optimize([fo]).plans).toEqual([]);
  });
  it('honors account/rules/context validation and total evaluation limits', () => {
    const t = target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 });
    expect(optimize([t], { maxEvaluations: 1 })).toMatchObject({ evaluations: 1, plans: [], searchComplete: false });
    expect(optimize([t, { ...target(11, t.progress.rows, t.prices), scope: 'other' }])).toMatchObject({ reason: 'target-context-mismatch' });
    expect(optimize([{ ...t, catalog: { source: 'futgg', tags: [{ id: 1, bonusType: 'UNKNOWN' }] } }]).status).toBe('unavailable');
  });
  it('yields scoring progress and discards cancelled results without any provider actions', async () => {
    const steps = planGalleryJointSteps({ targets: [target(10, [card(1, 100, true), card(2, 100, true), card(3, 300)], { 3: 200 })],
      budget: 200, catalogRewardKey: 'event_token_1' });
    let current = true, ticks = 0;
    expect(await runGalleryPlan(steps, { current: () => current, now: () => ++ticks * 20,
      schedule: async () => { current = false; } })).toBeNull();
    expect(steps.next().done).toBe(true);
  });
});
