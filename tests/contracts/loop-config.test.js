import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadUserscript } from '../helpers/load-userscript.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function loadDefinitions() {
  const { api } = await loadUserscript();
  const externalConfig = JSON.parse(await readFile(path.join(root, 'FCAutomationTool.loops.json'), 'utf8'));
  return { api, builtIn: api.LOOP_DEFS, external: externalConfig.loops, externalConfig };
}

function byId(loops, id) {
  const loop = loops.find((entry) => entry.id === id);
  expect(loop, `loop ${id}`).toBeTruthy();
  return loop;
}

describe('loop configuration contracts', () => {
  it('validates all built-in and external loop definitions', async () => {
    const { api, builtIn, externalConfig } = await loadDefinitions();
    expect(() => api.validateLoopConfig({
      loops: builtIn,
      recoveryRecipes: api.RECOVERY_RECIPES,
      unassignedRecoveryPolicies: api.UNASSIGNED_RECOVERY_POLICIES,
      defaultUnassignedRecoveryPolicyIds: api.DEFAULT_UNASSIGNED_RECOVERY_POLICY_IDS,
    }, 'built-in')).not.toThrow();
    expect(() => api.validateLoopConfig(externalConfig, 'external')).not.toThrow();
  });

  it('keeps built-in and external loop ids and strategies aligned', async () => {
    const { builtIn, external } = await loadDefinitions();
    expect(external.map(({ id, strategy }) => ({ id, strategy })))
      .toEqual(builtIn.map(({ id, strategy }) => ({ id, strategy })));
  });

  it('keeps dynamic activity bindings aligned across built-ins, nested upgrades and recovery recipes', async () => {
    const { api, builtIn, external, externalConfig } = await loadDefinitions();
    const expectedFamilies = {
      'daily-bronze': 'daily-bronze-upgrade',
      'daily-silver': 'daily-silver-upgrade',
      'daily-common': 'daily-common-gold-upgrade',
      'daily-rare': 'daily-rare-gold-upgrade',
    };
    for (const [id, family] of Object.entries(expectedFamilies)) {
      expect(byId(builtIn, id).activityBinding).toMatchObject({ family, category: 'Upgrades' });
      expect(byId(external, id).activityBinding).toEqual(byId(builtIn, id).activityBinding);
    }
    expect(byId(builtIn, 'inventory-fodder-exhaustion').stages.map((stage) => stage.activityBinding.family))
      .toEqual(['bronze-upgrade', 'silver-upgrade', 'common-gold-material-upgrade']);
    expect(byId(builtIn, 'provision-crafting').craftingUpgrades.map((upgrade) => upgrade.activityBinding.family))
      .toEqual(['common-gold-material-upgrade', 'rare-gold-material-upgrade']);
    expect(byId(builtIn, 'provision-crafting').craftingUpgrades.map((upgrade) => upgrade.activityBinding.classes))
      .toEqual([['premium'], ['premium', 'baseline']]);
    expect(externalConfig.recoveryRecipes.map((recipe) => recipe.activityBinding))
      .toEqual(api.RECOVERY_RECIPES.map((recipe) => recipe.activityBinding));
  });

  it('locks the One-click Daily stage order', async () => {
    const { builtIn, external } = await loadDefinitions();
    const builtInLoop = byId(builtIn, 'one-click-daily');
    const externalLoop = byId(external, 'one-click-daily');
    expect(builtInLoop.name).toBe('One-click Daily Loop');
    expect(externalLoop.name).toBe('One-click Daily Loop');
    expect(builtInLoop.steps).toEqual([
      'daily-bronze',
      'daily-silver',
      'daily-common',
      'daily-rare',
    ]);
    expect(builtInLoop.stepOverrides).toBeUndefined();
    expect(externalLoop.stepOverrides).toEqual(builtInLoop.stepOverrides);
  });

  it('locks Daily Bronze and Silver recycle contracts', async () => {
    const { builtIn } = await loadDefinitions();
    const bronze = byId(builtIn, 'daily-bronze');
    const silver = byId(builtIn, 'daily-silver');
    expect(bronze).toMatchObject({
      strategy: 'dailySingleCardRecycle',
      rewardPackIds: [105],
      targetDuplicate: { tier: 'bronze', playerOnly: true, allowSpecial: false },
      dailyCompletionLimit: 7,
    });
    expect(silver).toMatchObject({
      strategy: 'dailySingleCardRecycle',
      rewardPackIds: [205],
      targetDuplicate: { tier: 'silver', playerOnly: true, allowSpecial: false },
      dailyCompletionLimit: 7,
    });
    expect([bronze, silver, byId(builtIn, 'daily-bronze-mvp'), byId(builtIn, 'daily-silver-mvp')])
      .toEqual(expect.not.arrayContaining([expect.objectContaining({ overflowRecovery: expect.anything() })]));
  });

  it('keeps Bronze Upgrade Validation in the hidden MVP list', async () => {
    const { builtIn, external } = await loadDefinitions();
    expect(byId(builtIn, 'bronze-upgrade-validation')).toMatchObject({
      hidden: true,
      mvp: true,
      strategy: 'validationBronzeUpgrade',
    });
    expect(byId(external, 'bronze-upgrade-validation')).toMatchObject({
      hidden: true,
      mvp: true,
      strategy: 'validationBronzeUpgrade',
    });
  });

  it('locks Common Gold Premium exhaustion materials and deferred reward opening', async () => {
    const { builtIn, external } = await loadDefinitions();
    for (const loop of [byId(builtIn, 'fof-glory-hunters-exhaustion'), byId(external, 'fof-glory-hunters-exhaustion')]) {
      expect(loop.strategy).toBe('inventoryExhaustion');
      expect(loop.openRewardPacksAtEnd).toBe(true);
      expect(loop.forceOpenRewardPacksAtEnd).toBeUndefined();
      expect(loop.stages).toHaveLength(1);
      expect(loop.stages[0]).toMatchObject({
        id: 'fof-glory-hunters',
        name: 'Common Gold Premium Upgrade',
        sbcNames: ['5x 80+ Upgrade'],
        maxCompletions: 1000,
      });
      expect(loop.stages[0].requirements[0]).toMatchObject({
        tier: 'gold',
        rarity: 'common',
        count: 9,
        allowSpecial: false,
      });
      expect(loop.stages[0].requirements[0]).not.toHaveProperty('protectHighGold');
      expect(loop.stages[0].requirements[0]).not.toHaveProperty('maxRating');
      expect(loop.rewardPackNames.some((name) => /5x\s*80\+/i.test(name))).toBe(true);
    }
  });

  it('adds an opt-in low-rated Gold exhaustion Loop without changing Common-only consumers', async () => {
    const { builtIn, external } = await loadDefinitions();
    for (const loops of [builtIn, external]) {
      const loop = byId(loops, 'low-rated-gold-premium-exhaustion');
      expect(loop).toMatchObject({
        name: 'Low-rated Gold Premium Exhaustion Loop',
        strategy: 'inventoryExhaustion',
        sbcFodderPolicy: { mode: 'low-gold' },
        openRewardPacksAtEnd: true,
      });
      expect(loop).not.toHaveProperty('sourcePackIds');
      expect(loop).not.toHaveProperty('sourcePackNames');
      expect(loop.stages).toHaveLength(1);
      expect(loop.stages[0]).toMatchObject({
        id: 'low-rated-gold-premium',
        activityBinding: {
          family: 'common-gold-material-upgrade',
          classes: ['premium'],
          preference: 'reward-first',
          required: true,
        },
        requirements: [{
          tier: 'gold',
          count: 9,
          goldConsumption: 'common-first',
          playerOnly: true,
          allowSpecial: false,
          priorityPiles: ['unassigned', 'storage', 'transfer', 'club'],
        }],
        priorityPiles: ['unassigned', 'storage', 'transfer', 'club'],
        maxCompletions: 1000,
      });
      expect(loop.stages[0].requirements[0]).not.toHaveProperty('rarity');
      expect(loop.stages[0]).not.toHaveProperty('shortagePacks');
    }

    expect(byId(builtIn, 'fof-glory-hunters-exhaustion').stages[0].requirements[0])
      .toMatchObject({ tier: 'gold', rarity: 'common', count: 9 });
    expect(byId(builtIn, 'provision-crafting').craftingUpgrades[0].requirements[0])
      .toMatchObject({ tier: 'gold', rarity: 'common', count: 9 });
  });

  it('locks the ordered inventory exhaustion stages and strict card types', async () => {
    const { builtIn, external } = await loadDefinitions();
    for (const loop of [byId(builtIn, 'inventory-fodder-exhaustion'), byId(external, 'inventory-fodder-exhaustion')]) {
      expect(loop.strategy).toBe('inventoryExhaustion');
      expect(loop.stages.map((stage) => stage.id)).toEqual(['bronze-upgrade', 'silver-upgrade', 'fof-glory-hunters']);
      expect(loop.stages[0]).toMatchObject({ openRewardPacks: true, forceOpenRewardPacks: true });
      expect(loop.stages[1]).toMatchObject({ openRewardPacks: true, forceOpenRewardPacks: true });
      expect(loop.stages[2].openRewardPacks === true).toBe(false);
      expect(loop.openRewardPacksAtEnd).toBe(true);
      expect(loop.forceOpenRewardPacksAtEnd).toBeUndefined();
      expect(loop.stages.map((stage) => stage.requirements[0])).toEqual([
        expect.objectContaining({ tier: 'bronze', count: 11, allowSpecial: false }),
        expect.objectContaining({ tier: 'silver', count: 11, allowSpecial: false }),
        expect.objectContaining({ tier: 'gold', rarity: 'common', count: 9, allowSpecial: false }),
      ]);
      expect(loop.stages[2]).toMatchObject({
        name: 'Common Gold Premium Upgrade',
        sbcNames: ['5x 80+ Upgrade'],
        activityBinding: {
          family: 'common-gold-material-upgrade',
          classes: ['premium'],
          preference: 'reward-first',
        },
      });
    }
  });

  it('locks configurable Unassigned recovery routes without legacy protection fields', async () => {
    const { api, externalConfig } = await loadDefinitions();
    const builtInPolicies = Object.fromEntries(api.UNASSIGNED_RECOVERY_POLICIES.map((policy) => [policy.id, policy]));
    expect(builtInPolicies['bronze-duplicate-overflow'].steps.map((step) => step.recipeId)).toEqual([
      'daily-bronze-upgrade',
      'daily-common-gold-upgrade',
      'bronze-upgrade',
    ]);
    expect(builtInPolicies['silver-duplicate-overflow'].steps.map((step) => step.recipeId)).toEqual([
      'daily-silver-upgrade',
      'daily-common-gold-upgrade',
      'silver-upgrade',
    ]);
    expect(builtInPolicies['common-gold-duplicate-overflow'].steps.map((step) => step.recipeId)).toEqual([
      'daily-rare-gold-upgrade',
      'fof-glory-hunters-crafting-upgrade',
      'gold-upgrade',
    ]);
    expect(builtInPolicies['rare-gold-duplicate-overflow'].steps.map((step) => step.recipeId)).toEqual([
      'rare-gold-player-pick',
      '2x84-upgrade',
    ]);

    expect(api.RECOVERY_RECIPES.find((recipe) => recipe.id === 'rare-gold-player-pick'))
      .toMatchObject({
        playerPickSelector: {
          material: 'rare-gold',
          minRewardRating: 85,
          maxChallenges: 1,
          minRareGoldCost: 1,
          repeatabilityOrder: ['bounded', 'unlimited'],
        },
      });

    const protectedRecipes = api.RECOVERY_RECIPES.filter((recipe) =>
      recipe.requirements.some((requirement) => requirement.tier === 'gold')
    );
    protectedRecipes.forEach((recipe) => {
      expect(recipe.sbcFodderPolicy).toEqual({ mode: 'low-gold' });
      recipe.requirements.forEach((requirement) => {
        expect(requirement).toMatchObject({ allowSpecial: false });
        expect(requirement).not.toHaveProperty('maxRating');
        expect(requirement).not.toHaveProperty('protectHighGold');
      });
    });
    expect(externalConfig.recoveryRecipes.map((recipe) => recipe.id))
      .toEqual(api.RECOVERY_RECIPES.map((recipe) => recipe.id));
    expect(externalConfig.recoveryRecipes.every(
      (recipe) => recipe.sbcFodderPolicy?.mode === 'low-gold',
    )).toBe(true);
    expect(externalConfig.unassignedRecoveryPolicies.map((policy) => policy.id))
      .toEqual(api.UNASSIGNED_RECOVERY_POLICIES.map((policy) => policy.id));
  });

  it('rejects missing recovery recipe and policy references', async () => {
    const { api } = await loadDefinitions();
    const base = {
      loops: api.LOOP_DEFS,
      recoveryRecipes: api.RECOVERY_RECIPES,
      unassignedRecoveryPolicies: [{
        id: 'broken-policy',
        match: { tier: 'bronze', playerOnly: true, allowSpecial: false },
        steps: [{ recipeId: 'missing-recipe' }],
      }],
      defaultUnassignedRecoveryPolicyIds: ['broken-policy'],
    };
    expect(() => api.validateLoopConfig(base, 'broken')).toThrow(/recipeId not found/);
    expect(() => api.validateLoopConfig({
      ...base,
      unassignedRecoveryPolicies: api.UNASSIGNED_RECOVERY_POLICIES,
      defaultUnassignedRecoveryPolicyIds: ['missing-policy'],
    }, 'broken')).toThrow(/not found: missing-policy/);
  });

  it('keeps legacy loop containers compatible while rejecting obsolete per-loop recovery', async () => {
    const { api } = await loadDefinitions();
    const fromArray = api.parseLoopConfig(JSON.stringify(api.LOOP_DEFS));
    const fromObject = api.parseLoopConfig(JSON.stringify({ loops: api.LOOP_DEFS }));
    for (const normalized of [fromArray, fromObject]) {
      expect(normalized.loops).toHaveLength(api.LOOP_DEFS.length);
      expect(normalized.recoveryRecipes.map((recipe) => recipe.id))
        .toEqual(api.RECOVERY_RECIPES.map((recipe) => recipe.id));
    }
    expect(() => api.validateLoopConfig({
      loops: [{ ...api.LOOP_DEFS[0], overflowRecovery: {} }],
    }, 'legacy')).toThrow(/overflowRecovery is obsolete/);
  });

  it('locks Daily Common material ratio and shortage pack order', async () => {
    const { builtIn } = await loadDefinitions();
    const loop = byId(builtIn, 'daily-common');
    expect(loop.strategy).toBe('supplyAndCraft');
    expect(loop.requirements.map(({ tier, count }) => ({ tier, count }))).toEqual([
      { tier: 'silver', count: 5 },
      { tier: 'bronze', count: 5 },
    ]);
    expect(loop.shortagePacks.map((source) => ({
      tier: source.requirement.tier,
      packIds: source.packIds,
      maxOpensPerAttempt: source.maxOpensPerAttempt,
      routingPolicy: source.routingPolicy,
    }))).toEqual([
      { tier: 'bronze', packIds: [105], maxOpensPerAttempt: 1, routingPolicy: 'reserveMatchingDuplicates' },
      { tier: 'silver', packIds: [205], maxOpensPerAttempt: 1, routingPolicy: 'reserveMatchingDuplicates' },
    ]);
    expect(byId(builtIn, 'daily-common-mvp').shortagePacks.every(
      (source) => source.routingPolicy === 'reserveMatchingDuplicates',
    )).toBe(true);
    expect(loop.primaryPiles).toEqual(['unassigned', 'storage', 'transfer']);
    expect(loop.clubFallbackPiles).toEqual(['unassigned', 'storage', 'transfer', 'club']);
    expect(loop.preSelectionCleanup).not.toBe(false);
  });

  it('locks low-gold crafting contracts under the shared runtime policy', async () => {
    const { builtIn } = await loadDefinitions();
    const rare = byId(builtIn, 'daily-rare');
    const rarePack = byId(builtIn, 'daily-rare-pack-84');
    const provision = byId(builtIn, 'provision-crafting');

    expect(rare.requirements[0]).toMatchObject({
      tier: 'gold', rarity: 'common', count: 5,
    });
    expect(rare).toMatchObject({
      strategy: 'supplyAndCraft',
      sourcePackRef: { rewardOfLoopId: 'daily-common' },
      sourcePackIds: [20060],
      rewardPackIds: [20059],
      deferChallengeLoad: true,
      preSelectionCleanup: false,
      priorityPiles: ['unassigned', 'storage', 'transfer'],
      clubFallbackPiles: ['unassigned', 'storage', 'transfer', 'club'],
    });
    expect(rare.shortagePacks).toEqual([
      expect.objectContaining({
        sourcePackRef: { rewardOfLoopId: 'daily-common' },
        repeatUntilSatisfied: true,
        routingPolicy: 'reserveMatchingDuplicates',
        packIds: [20060],
        packNames: ['11x Gold Players Pack', '11 x Gold Players Pack'],
        requirement: expect.objectContaining({ rarity: 'common' }),
      }),
    ]);
    expect(rarePack.rareUpgrade.requirements[0]).toMatchObject({
      tier: 'gold', rarity: 'rare', count: 6,
    });
    expect(rarePack).toMatchObject({
      sourcePackRef: { rewardOfLoopId: 'daily-rare' },
      sourcePackIds: [20059],
      maxPacks: 100,
      maxCompletions: 1,
      useRoundsAsCompletions: true,
      consumeAllSourcePacks: true,
      sourceExhaustedFallbackActivityFamily: 'rare-gold-material-upgrade',
    });
    expect(rarePack.sourceExhaustedFallbackMaxCompletions).toBeUndefined();
    expect(byId(builtIn, 'daily-rare-mvp')).toMatchObject({
      sourcePackRef: { rewardOfLoopId: 'daily-common-mvp' },
      shortagePacks: [expect.objectContaining({
        sourcePackRef: { rewardOfLoopId: 'daily-common-mvp' },
      })],
    });
    expect(provision.preCraftPlayerPick).toBeUndefined();
    expect(provision.preCraftPlayerPickSelector).toEqual({ material: 'common-gold' });
    expect(provision.preCraftPlayerPickLoopId).toBeUndefined();
    expect(provision.craftingUpgrades.map((upgrade) => upgrade.name))
      .toEqual(['Common Gold Premium Upgrade', 'Rare Gold Recycling Upgrade']);
    expect(provision.craftingUpgrades.map((upgrade) => upgrade.sbcNames))
      .toEqual([['5x 80+ Upgrade'], ['2x 84+ Upgrade', '2 x 84+ Upgrade']]);
    expect(provision.craftingUpgrades.map((upgrade) => upgrade.requirements[0].rarity))
      .toEqual(['common', 'rare']);
    provision.craftingUpgrades.forEach((upgrade) => {
      expect(upgrade.requirements[0]).not.toHaveProperty('protectHighGold');
      expect(upgrade.requirements[0]).not.toHaveProperty('maxRating');
    });
  });

  it('removes the expired 82+ Pick and keeps current activities discovery-only', async () => {
    const { builtIn, external } = await loadDefinitions();

    expect(builtIn.some((loop) => loop.id === '82-plus-player-pick-5of10')).toBe(false);
    expect(external.some((loop) => loop.id === '82-plus-player-pick-5of10')).toBe(false);
    expect(builtIn.some((loop) => loop.id === '83-plus-player-pick-1of5')).toBe(false);
    expect(builtIn.some((loop) => loop.id === '84-plus-summer-tournament-nations-pick-1of3')).toBe(false);
    expect(external.some((loop) => loop.id === '83-plus-player-pick-1of5')).toBe(false);
    expect(external.some((loop) => loop.id === '84-plus-summer-tournament-nations-pick-1of3')).toBe(false);
  });

  it('keeps rating SBC entry points discovery-only', async () => {
    const { builtIn, external } = await loadDefinitions();
    const removedIds = ['2x84-fodder', 'auto-totw-upgrade', '84x10-mvp', '84x10'];
    expect(builtIn.filter((loop) => removedIds.includes(loop.id))).toEqual([]);
    expect(external.filter((loop) => removedIds.includes(loop.id))).toEqual([]);
  });
});
