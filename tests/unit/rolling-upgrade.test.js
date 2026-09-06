import { describe, expect, it } from 'vitest';
import { buildActivityBindingSession } from '../../src/config/activity-discovery.js';
import { validateLoopDef } from '../../src/config/loop-schema.js';
import { parsePlayerPickSbcSnapshot } from '../../src/config/player-pick-discovery.js';
import {
  applyRollingAutomaticUseFodderPolicy,
  bindRollingPlayerPickCapabilities,
  buildRollingStorageSinkCatalog,
  parseRollingStorageSinkSnapshot,
  parseRollingStorageSinkPickSnapshot,
  resolveRollingPlayerPickCapability,
  resolveRollingStorageSinkPickCapability,
  resolveRollingStorageSinkCapability,
  resolveRollingAutomaticUseMaxRating,
  ROLLING_PROVISIONS_RECOVERY_MODES,
  ROLLING_STORAGE_FIRST_RECOVERY_PILES,
  ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES,
  resolveRollingProvisionsRecoveryMode,
  evaluateRollingPrimaryRunway,
  resolveRollingRecoveryPriorityPiles,
  shouldQueueRollingProvisionsReward,
} from '../../src/config/rolling-upgrade.js';
import {
  buildUpgradeDiscoverySession,
  collectScannedUpgradeActivities,
} from '../../src/config/upgrade-discovery.js';
import { loadFixture } from '../helpers/fixtures.js';

function totwSet() {
  return {
    id: 20841,
    name: '84+ TOTW Upgrade',
    inUpgradesCategory: true,
    timesCompleted: 0,
    repeats: null,
    rewards: [{ type: 'PACK', packId: 30841, name: '84+ TOTW Pack' }],
    challenges: [{
      id: 21841,
      requiredPlayerCount: 11,
      eligibilityRequirements: [{ key: 'TEAM_RATING', values: [84], count: -1 }],
    }],
  };
}

function provisionsSet() {
  return {
    id: 20987,
    name: 'Repeatable FUTTIES Provisions Upgrade',
    inUpgradesCategory: true,
    timesCompleted: 0,
    repeats: null,
    rewards: [{ type: 'PACK', packId: 30987, name: 'FUTTIES Provisions Pack' }],
    challenges: [{
      id: 21987,
      requiredPlayerCount: 4,
      eligibilityRequirements: [{ key: 'PLAYER_MIN_OVR', values: [87], count: -1 }],
    }],
  };
}

function goldSinkSet() {
  return {
    id: 20805,
    name: '5x 80+ Upgrade',
    inUpgradesCategory: true,
    timesCompleted: 0,
    repeats: null,
    rewards: [{ type: 'PACK', packId: 30805, name: '5x 80+ Rare Gold Players Pack' }],
    challenges: [{
      id: 21805,
      requiredPlayerCount: 9,
      eligibilityRequirements: [{ key: 'PLAYER_QUALITY', values: [3], count: -1 }],
    }],
  };
}

function rareGoldPickSet(options = {}) {
  const id = Number(options.id || 20853);
  const rating = Number(options.rating || 84);
  const requiredPlayerCount = Number(options.requiredPlayerCount || 4);
  const rareGoldCount = Number(options.rareGoldCount || requiredPlayerCount);
  const candidateCount = Number(options.candidateCount || 3);
  const selectionCount = Number(options.selectionCount || 1);
  const name = `${selectionCount} of ${candidateCount} ${rating}+ Player Pick`;
  return {
    id,
    name,
    timesCompleted: 0,
    repeats: Object.hasOwn(options, 'repeats') ? options.repeats : 0,
    rewards: [{
      type: 'PLAYER_PICK',
      name,
      resourceId: id + 10000,
      candidateCount,
      selectionCount,
    }],
    challenges: [{
      id: id + 1000,
      requiredPlayerCount,
      eligibilityRequirements: [
        { key: 'PLAYER_QUALITY', values: [3], count: -1 },
        {
          key: 'PLAYER_RARITY',
          values: [1],
          count: rareGoldCount === requiredPlayerCount ? -1 : rareGoldCount,
        },
      ],
    }],
  };
}

function storageSinkPickSet(overrides = {}) {
  const base = {
    id: 20995,
    name: '1 of 3 95+ FOF or FUTTIES T1-T3 Player Pick',
    timesCompleted: 0,
    repeats: null,
    rewards: [{
      type: 'PLAYER_PICK',
      name: '1 of 3 95+ FOF or FUTTIES T1-T3 Player Pick',
      resourceId: 30995,
      candidateCount: 3,
      selectionCount: 1,
    }],
    challenges: [
      {
        id: 21995,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [88], count: -1 }],
      },
      {
        id: 21996,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [89], count: -1 }],
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    rewards: overrides.rewards || base.rewards,
    challenges: overrides.challenges || base.challenges,
  };
}

function storageSinkPlayerSet(overrides = {}) {
  const base = {
    id: 20994,
    name: '94 Rated Campaign Player',
    timesCompleted: 0,
    repeats: 1,
    rewards: [{
      type: 'PLAYER',
      name: '94 Rated Campaign Player',
      resourceId: 30994,
      definitionId: 30994,
      count: 1,
    }],
    challenges: [
      {
        id: 21993,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [87], count: -1 }],
      },
      {
        id: 21994,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [89], count: -1 }],
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    rewards: overrides.rewards || base.rewards,
    challenges: overrides.challenges || base.challenges,
  };
}

describe('Rolling Upgrade configuration contracts', () => {
  it('keeps normal recovery Unassigned-first unless Storage-first is enabled', () => {
    expect(ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES).toEqual([
      'unassigned', 'storage', 'transfer', 'club',
    ]);
    expect(resolveRollingRecoveryPriorityPiles({})).toEqual(ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES);
    expect(resolveRollingRecoveryPriorityPiles({ runtimeRecoveryStorageFirst: true }))
      .toEqual(ROLLING_STORAGE_FIRST_RECOVERY_PILES);
    expect(resolveRollingRecoveryPriorityPiles({}, { recoveryMode: 'storage-pressure' }))
      .toEqual(ROLLING_STORAGE_FIRST_RECOVERY_PILES);
    expect(resolveRollingRecoveryPriorityPiles({ runtimeRecoveryStorageFirst: true }, { recoveryMode: 'pending-unassigned' }))
      .toEqual(ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES);
    expect(resolveRollingRecoveryPriorityPiles({}, { recoveryMode: 'pending-unassigned' }))
      .toEqual(ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES);
  });

  it.each(['SQUAD_RATING_EXCESS', 'PROVISIONS_LAST_BATCH_AT_RISK'])('reserves Provisions Storage headroom for %s', (reasonCode) => {
    expect(resolveRollingProvisionsRecoveryMode({
      trigger: 'primary-fodder-shortage',
      reasonCode,
      storageFree: 1,
      requiredCount: 4,
    })).toBe(ROLLING_PROVISIONS_RECOVERY_MODES.RATING_EXCESS_STORAGE_PRESSURE);
    expect(resolveRollingProvisionsRecoveryMode({
      trigger: 'primary-fodder-shortage',
      reasonCode,
      storageFree: 4,
      requiredCount: 4,
    })).toBe(ROLLING_PROVISIONS_RECOVERY_MODES.NORMAL);
    expect(resolveRollingProvisionsRecoveryMode({
      trigger: 'primary-fodder-shortage',
      reasonCode: 'PLAYER_COUNT_SHORTAGE',
      storageFree: 1,
      requiredCount: 4,
    })).toBe(ROLLING_PROVISIONS_RECOVERY_MODES.NORMAL);
    expect(resolveRollingProvisionsRecoveryMode({
      trigger: 'primary-fodder-shortage',
      reasonCode: 'SQUAD_RATING_EXCESS',
      storageFree: null,
      requiredCount: 4,
    })).toBe(ROLLING_PROVISIONS_RECOVERY_MODES.NORMAL);
    expect(resolveRollingProvisionsRecoveryMode({ trigger: 'storage-pressure' }))
      .toBe(ROLLING_PROVISIONS_RECOVERY_MODES.STORAGE_PRESSURE);
    expect(resolveRollingProvisionsRecoveryMode({ trigger: 'duplicate-reserve' }))
      .toBe(ROLLING_PROVISIONS_RECOVERY_MODES.PENDING_UNASSIGNED);
  });

  it('uses the shared automatic-use rating for Rolling instead of the standard Rating SBC cap', () => {
    expect(resolveRollingAutomaticUseMaxRating({ runtimePickOptions: { protectionRating: 90 } })).toBe(90);
    expect(applyRollingAutomaticUseFodderPolicy({
      runtimeSbcFodderPolicy: { ratingSbcMaxCardRating: 88 },
    }, {
      runtimePickOptions: { protectionRating: 90 },
    })).toMatchObject({
      runtimeSbcFodderPolicy: {
        mode: 'rating-constrained',
        ratingSbcMaxCardRating: 90,
      },
    });
  });

  it('binds every recovery capability from the current scan without configured SBC IDs', async () => {
    const fixture = await loadFixture('challenges/rolling-10x85-baseline.json');
    const sets = [fixture.set, totwSet(), provisionsSet(), goldSinkSet(), storageSinkPickSet()];
    const upgradeSession = buildUpgradeDiscoverySession({ sets, configuredLoops: [] });
    expect(upgradeSession.rollingLoops).toHaveLength(1);

    const activitySession = buildActivityBindingSession({
      sets,
      configuredLoops: upgradeSession.rollingLoops,
      additionalActivities: collectScannedUpgradeActivities(upgradeSession.results),
    });
    const pick = parsePlayerPickSbcSnapshot({ set: rareGoldPickSet() });
    expect(pick.status).toBe('supported');
    const [rolling] = bindRollingPlayerPickCapabilities([
      activitySession.loopOverrides[upgradeSession.rollingLoops[0].id],
    ], [pick.loop], { storageSinkSets: sets });

    expect(rolling).toMatchObject({
      strategy: 'rollingUpgrade',
      sbcSetIds: [1085],
      rollingTotwUpgrade: {
        activityResolved: true,
        sbcSetIds: [20841],
        dynamicSbcFamily: 'totw-upgrade',
        ratingSbcFill: {
          priorityPiles: ['unassigned', 'storage', 'transfer', 'club'],
        },
      },
      rollingProvisionsUpgrade: {
        activityResolved: true,
        sbcSetIds: [20987],
        dynamicSbcFamily: 'provisions-upgrade',
        ratingSbcFill: {
          priorityPiles: ['unassigned', 'storage', 'transfer', 'club'],
        },
        requirements: [expect.objectContaining({ minRating: 87, maxRating: 88, count: 4 })],
      },
      rollingPlayerPick: {
        status: 'resolved',
        selection: {
          minimumRareGoldCost: 4,
          totalGoldCost: 4,
          flexibleGoldCost: 0,
          rewardMinRating: 84,
          candidateCount: 3,
          selectionCount: 1,
        },
        loop: expect.objectContaining({
          sbcSetIds: [20853],
          dynamicRewardMinRating: 84,
          repeatability: 'unlimited',
          pickCandidateCount: 3,
          pickCount: 1,
        }),
      },
      rollingStorageSinkPick: {
        status: 'resolved',
        required: false,
        loop: expect.objectContaining({
          sbcSetIds: [20995],
          dynamicRewardMinRating: 95,
          pickCandidateCount: 3,
          pickCount: 1,
          challengesPerPick: 2,
        }),
      },
      rollingStorageSink: {
        status: 'resolved',
        mode: 'automatic',
        capability: {
          setId: 20995,
          rewardKind: 'player-pick',
          legacy95: true,
        },
      },
      rollingGoldSinkUpgrade: {
        activityResolved: true,
        sbcSetIds: [20805],
        dynamicSbcFamily: '5x80-upgrade',
        requirements: [expect.objectContaining({ tier: 'gold', count: 9 })],
      },
    });
    expect(validateLoopDef(rolling, 'Rolling Upgrade')).toEqual([]);
  });

  it('opens Provisions rewards only for explicit fodder shortages or the duplicate-reserve opt-in', () => {
    expect(shouldQueueRollingProvisionsReward('duplicate-reserve', {})).toBe(false);
    expect(shouldQueueRollingProvisionsReward('duplicate-reserve', {
      rollingOpenDuplicateProvisionsRewards: true,
    })).toBe(true);
    expect(shouldQueueRollingProvisionsReward('storage-maintenance', {})).toBe(false);
    expect(shouldQueueRollingProvisionsReward('storage-pressure', {})).toBe(false);
    expect(shouldQueueRollingProvisionsReward('primary-fodder-shortage', {})).toBe(true);
    expect(shouldQueueRollingProvisionsReward('required-special-fodder-shortage', {})).toBe(true);
    expect(shouldQueueRollingProvisionsReward('unknown', {})).toBe(false);
  });

  it('requests proactive Provisions only when the projected next squad exceeds the bounded fallback', () => {
    expect(evaluateRollingPrimaryRunway({ ok: true, rating: 85 }, {
      targetRating: 84,
      maxAboveTarget: 1,
    })).toMatchObject({
      status: 'ready',
      targetRating: 84,
      projectedRating: 85,
    });
    expect(evaluateRollingPrimaryRunway({ ok: true, rating: 86 }, {
      targetRating: 84,
      maxAboveTarget: 1,
    })).toMatchObject({
      status: 'recover',
      reasonCode: 'SQUAD_RATING_EXCESS',
      targetRating: 84,
      projectedRating: 86,
    });
    expect(evaluateRollingPrimaryRunway({
      ok: false,
      missing: { code: 'PLAYER_COUNT_SHORTAGE' },
    }, {
      targetRating: 84,
      maxAboveTarget: 1,
    })).toMatchObject({
      status: 'diagnostic',
      reasonCode: 'PLAYER_COUNT_SHORTAGE',
    });
  });

  it('keeps an unresolved or exactly tied Rare Gold Pick capability fail-closed', async () => {
    const fixture = await loadFixture('challenges/rolling-10x85-baseline.json');
    const rolling = buildUpgradeDiscoverySession({ sets: [fixture.set], configuredLoops: [] }).rollingLoops[0];
    expect(bindRollingPlayerPickCapabilities([rolling], [])[0].rollingPlayerPick.status)
      .toBe('unavailable');

    const pick = parsePlayerPickSbcSnapshot({ set: rareGoldPickSet() }).loop;
    const ambiguous = bindRollingPlayerPickCapabilities([rolling], [
      pick,
      { ...structuredClone(pick), id: 'second-85-pick', sbcSetIds: [99999] },
    ])[0];
    expect(ambiguous.rollingPlayerPick).toMatchObject({ status: 'ambiguous' });
    expect(ambiguous.rollingPlayerPick).not.toHaveProperty('loop');
  });

  it('ranks unlimited Gold Picks by minimum Rare cost before total cost and reward', () => {
    const pureFour = parsePlayerPickSbcSnapshot({
      set: rareGoldPickSet({ id: 20844, rating: 84, requiredPlayerCount: 4, rareGoldCount: 4 }),
    }).loop;
    const mixedFourOfSix = parsePlayerPickSbcSnapshot({
      set: rareGoldPickSet({ id: 20846, rating: 84, requiredPlayerCount: 6, rareGoldCount: 4 }),
    }).loop;
    const pureSix = parsePlayerPickSbcSnapshot({
      set: rareGoldPickSet({ id: 20856, rating: 85, requiredPlayerCount: 6, rareGoldCount: 6 }),
    }).loop;
    const limited = parsePlayerPickSbcSnapshot({
      set: rareGoldPickSet({ id: 20999, rating: 99, requiredPlayerCount: 2, rareGoldCount: 2, repeats: 1 }),
    }).loop;
    const unknown = parsePlayerPickSbcSnapshot({
      set: rareGoldPickSet({ id: 20998, rating: 98, requiredPlayerCount: 2, rareGoldCount: 2, repeats: null }),
    }).loop;

    const resolution = resolveRollingPlayerPickCapability([
      pureSix,
      unknown,
      mixedFourOfSix,
      limited,
      pureFour,
    ]);

    expect(resolution).toMatchObject({
      status: 'resolved',
      loop: { sbcSetIds: [20844] },
      selection: {
        minimumRareGoldCost: 4,
        totalGoldCost: 4,
        flexibleGoldCost: 0,
        rewardMinRating: 84,
      },
      alternatives: [
        { sbcSetIds: [20846] },
        { sbcSetIds: [20856] },
      ],
    });
    expect(resolution.candidates.map(({ selection }) => selection)).toEqual([
      expect.objectContaining({ minimumRareGoldCost: 4, totalGoldCost: 4 }),
      expect.objectContaining({ minimumRareGoldCost: 4, totalGoldCost: 6 }),
      expect.objectContaining({ minimumRareGoldCost: 6, totalGoldCost: 6 }),
    ]);
    expect(resolution.matches).not.toContain(limited);
    expect(resolution.matches).not.toContain(unknown);
  });

  it('parses only the exact dynamic 95+ FOF/FUTTIES 88+89 Storage sink contract', () => {
    const parsed = parseRollingStorageSinkPickSnapshot({ set: storageSinkPickSet() });
    expect(parsed).toMatchObject({
      status: 'supported',
      loop: {
        strategy: 'playerPickSbc',
        rollingStorageSink: true,
        sbcSetIds: [20995],
        pickItemResourceIds: ['30995'],
        dynamicChallenges: [
          expect.objectContaining({ challengeId: 21995, targetRating: 88, requiredPlayerCount: 11 }),
          expect.objectContaining({ challengeId: 21996, targetRating: 89, requiredPlayerCount: 11 }),
        ],
      },
    });

    expect(parseRollingStorageSinkPickSnapshot({
      set: storageSinkPickSet({
        name: '1 of 3 95+ Player Pick',
        rewards: [{ ...storageSinkPickSet().rewards[0], name: '1 of 3 95+ Player Pick' }],
      }),
    }).status).toBe('ignored');
    expect(parseRollingStorageSinkPickSnapshot({
      set: storageSinkPickSet({
        rewards: [{ ...storageSinkPickSet().rewards[0], candidateCount: 4 }],
      }),
    }).status).toBe('ignored');
    expect(parseRollingStorageSinkPickSnapshot({
      set: storageSinkPickSet({
        challenges: storageSinkPickSet().challenges.map((challenge) => ({
          ...challenge,
          eligibilityRequirements: [{ key: 'TEAM_RATING', values: [88], count: -1 }],
        })),
      }),
    }).status).toBe('unsupported');
    expect(parseRollingStorageSinkPickSnapshot({
      set: storageSinkPickSet({
        challenges: storageSinkPickSet().challenges.map((challenge, index) => (
          index ? { ...challenge, id: null } : challenge
        )),
      }),
    }).status).toBe('unsupported');
  });

  it('keeps missing and ambiguous Storage sink capabilities optional and fail-closed', async () => {
    const fixture = await loadFixture('challenges/rolling-10x85-baseline.json');
    const rolling = buildUpgradeDiscoverySession({ sets: [fixture.set], configuredLoops: [] }).rollingLoops[0];
    expect(bindRollingPlayerPickCapabilities([rolling], [], { storageSinkSets: [] })[0])
      .toMatchObject({ rollingStorageSinkPick: { status: 'unavailable', required: false } });

    const first = storageSinkPickSet();
    const second = storageSinkPickSet({ id: 20996 });
    expect(resolveRollingStorageSinkPickCapability([first, second]).status).toBe('ambiguous');
    const ambiguous = bindRollingPlayerPickCapabilities([rolling], [], {
      storageSinkSets: [first, second],
    })[0];
    expect(ambiguous.rollingStorageSinkPick).toMatchObject({ status: 'ambiguous', required: false });
    expect(ambiguous.rollingStorageSinkPick).not.toHaveProperty('loop');
    expect(validateLoopDef(ambiguous, 'Rolling Upgrade')).toEqual([]);
  });

  it('parses generic high-rated Player Pick and direct Player Storage sinks', () => {
    const pick = parseRollingStorageSinkSnapshot({
      set: storageSinkPickSet({
        id: 20993,
        name: '1 of 4 94+ Player Pick',
        rewards: [{
          type: 'PLAYER_PICK',
          name: '1 of 4 94+ Player Pick',
          resourceId: 30993,
          candidateCount: 4,
          selectionCount: 1,
        }],
      }),
    });
    expect(pick).toMatchObject({
      status: 'supported',
      capability: {
        setId: 20993,
        rewardKind: 'player-pick',
        challengeRatings: [88, 89],
        loop: {
          strategy: 'playerPickSbc',
          pickCandidateCount: 4,
          pickCount: 1,
        },
      },
    });

    const player = parseRollingStorageSinkSnapshot({ set: storageSinkPlayerSet() });
    expect(player).toMatchObject({
      status: 'supported',
      capability: {
        setId: 20994,
        rewardKind: 'player',
        challengeRatings: [87, 89],
        rewardReserveSlots: 1,
        loop: {
          strategy: 'storagePressureSbc',
          sbcSetIds: [20994],
        },
      },
    });
  });

  it('normalizes Required Special metadata for an automatically discovered Storage sink', () => {
    const result = parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({
        challenges: [{
          id: 21994,
          requiredPlayerCount: 11,
          eligibilityRequirements: [
            { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
            { key: 'TEAM_RATING', values: [89], count: -1 },
          ],
        }],
      }),
    });

    expect(result).toMatchObject({
      status: 'supported',
      capability: {
        loop: {
          dynamicChallenges: [{
            challengeId: 21994,
            requiredPlayerCount: 11,
            targetRating: 89,
            specialCount: 1,
            requiredSpecialAllowanceMode: 'required-only',
            requiredSpecialAllowanceDecisionSource: 'fail-closed',
            eligibilityRequirements: [
              { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
              { key: 'TEAM_RATING', values: [89], count: 11 },
            ],
          }],
        },
      },
    });
  });

  it('binds the live Maxwel Cornet 86/87 challenge structure by its selected Set identity', () => {
    const cornet = storageSinkPlayerSet({
      id: 1382,
      name: 'Maxwel Cornet',
      complete: false,
      timesCompleted: 0,
      repeats: 0,
      rewards: [{
        type: 'PLAYER',
        name: 'Cornet',
        resourceId: 67324662,
        definitionId: 67324662,
        count: 1,
      }],
      challenges: [{
        id: 3938,
        status: 'NOT_STARTED',
        completed: false,
        requiredPlayerCount: 11,
        eligibilityRequirements: [
          { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
          { key: 'TEAM_RATING', values: [86], count: -1 },
        ],
      }, {
        id: 3939,
        status: 'IN_PROGRESS',
        completed: false,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [87], count: -1 }],
      }],
    });

    expect(resolveRollingStorageSinkCapability([cornet], {
      mode: 'selected',
      setId: 1382,
      setName: 'Maxwel Cornet',
    })).toMatchObject({
      status: 'resolved',
      mode: 'selected',
      selectedSetId: 1382,
      selectedSetName: 'Maxwel Cornet',
      capability: {
        setId: 1382,
        setName: 'Maxwel Cornet',
        challengeRatings: [86, 87],
        challenges: [
          { challengeId: 3938, completed: false, targetRating: 86 },
          { challengeId: 3939, completed: false, targetRating: 87 },
        ],
      },
    });
  });

  it('keeps a selected Storage sink actionable when its 87 squad is complete but its 86 squad remains', () => {
    const cornet = storageSinkPlayerSet({
      id: 1382,
      name: 'Maxwel Cornet',
      complete: false,
      rewards: [{
        type: 'PLAYER',
        name: 'Cornet',
        resourceId: 67324662,
        definitionId: 67324662,
        count: 1,
      }],
      challenges: [{
        id: 3938,
        status: 'IN_PROGRESS',
        completed: false,
        requiredPlayerCount: 11,
        eligibilityRequirements: [
          { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
          { key: 'TEAM_RATING', values: [86], count: -1 },
        ],
      }, {
        id: 3939,
        status: 'COMPLETED',
        completed: true,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [87], count: -1 }],
      }],
    });

    expect(parseRollingStorageSinkSnapshot({ set: cornet })).toMatchObject({
      status: 'supported',
      capability: {
        setId: 1382,
        challengeRatings: [86, 87],
        challenges: [
          { challengeId: 3938, completed: false, targetRating: 86 },
          { challengeId: 3939, completed: true, targetRating: 87 },
        ],
      },
    });
  });

  it('keeps a Storage sink resolved when only a completed challenge has unavailable squad metadata', () => {
    const set = storageSinkPickSet({
      challenges: [
        {
          id: 21995,
          requiredPlayerCount: 11,
          eligibilityRequirements: [
            { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
            { key: 'TEAM_RATING', values: [88], count: -1 },
          ],
        },
        {
          id: 21996,
          completed: true,
          requiredPlayerCount: null,
          eligibilityRequirements: [{ key: 'TEAM_RATING', values: [90], count: -1 }],
        },
      ],
    });

    expect(parseRollingStorageSinkSnapshot({ set })).toMatchObject({
      status: 'supported',
      capability: {
        setId: set.id,
        challengeRatings: [88, 90],
        challenges: [
          expect.objectContaining({ challengeId: 21995, requiredPlayerCount: 11 }),
          expect.objectContaining({ challengeId: 21996, completed: true, requiredPlayerCount: null }),
        ],
      },
    });
    expect(resolveRollingStorageSinkCapability([set], {
      mode: 'selected',
      setId: set.id,
    })).toMatchObject({
      status: 'resolved',
      capability: { setId: set.id },
    });
  });

  it('rejects Pack-only, low-rated, completed, and incomplete Storage sink metadata', () => {
    expect(parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({ rewards: [{ type: 'PACK', packId: 30001 }] }),
    }).status).toBe('ignored');
    expect(parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({
        challenges: storageSinkPlayerSet().challenges.map((challenge) => ({
          ...challenge,
          eligibilityRequirements: [{ key: 'TEAM_RATING', values: [86], count: -1 }],
        })),
      }),
    }).status).toBe('ignored');
    expect(parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({ complete: true }),
    }).status).toBe('ignored');
    expect(parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({
        challenges: [{
          id: 21994,
          requiredPlayerCount: null,
          eligibilityRequirements: [{ key: 'TEAM_RATING', values: [89], count: -1 }],
        }],
      }),
    }).status).toBe('unsupported');
    expect(parseRollingStorageSinkSnapshot({
      set: storageSinkPlayerSet({
        challenges: [{
          id: 21994,
          requiredPlayerCount: 11,
          eligibilityRequirements: [
            { key: 'TEAM_RATING', values: [89], count: -1 },
            { key: 'CHEMISTRY_POINTS', values: [30], count: -1 },
          ],
        }],
      }),
    })).toMatchObject({
      status: 'unsupported',
      diagnostics: [expect.stringContaining('CHEMISTRY_POINTS')],
    });
  });

  it('resolves an explicit Set without silently falling back and keeps legacy 95+ first in automatic mode', () => {
    const legacy = storageSinkPickSet();
    const selected = storageSinkPlayerSet();
    const explicit = resolveRollingStorageSinkCapability([legacy, selected], {
      mode: 'selected',
      setId: selected.id,
    });
    expect(explicit).toMatchObject({
      status: 'resolved',
      mode: 'selected',
      capability: { setId: selected.id, rewardKind: 'player' },
    });

    const missing = resolveRollingStorageSinkCapability([legacy], {
      mode: 'selected',
      setId: selected.id,
      setName: selected.name,
    });
    expect(missing).toMatchObject({
      status: 'unavailable',
      mode: 'selected',
      selectedSetId: selected.id,
      selectedSetName: selected.name,
    });
    expect(missing).not.toHaveProperty('capability');

    const automatic = resolveRollingStorageSinkCapability([selected, legacy], {
      mode: 'automatic',
    });
    expect(automatic).toMatchObject({
      status: 'resolved',
      mode: 'automatic',
      capability: { setId: legacy.id, legacy95: true },
      alternatives: [expect.objectContaining({ setId: selected.id })],
    });
  });

  it('builds a lightweight UI catalog and marks only deep-scanned contracts validated', () => {
    const pick = storageSinkPickSet();
    const player = storageSinkPlayerSet();
    const lowPick = storageSinkPickSet({
      id: 20884,
      name: '1 of 3 84+ Player Pick',
      rewards: [{
        type: 'PLAYER_PICK',
        name: '1 of 3 84+ Player Pick',
        resourceId: 30884,
        candidateCount: 3,
        selectionCount: 1,
      }],
      challenges: [{
        id: 21884,
        requiredPlayerCount: 11,
        eligibilityRequirements: [{ key: 'TEAM_RATING', values: [84], count: -1 }],
      }],
    });
    const unscannedPick = storageSinkPickSet({
      id: 20887,
      name: '1 of 3 87+ Player Pick',
    });
    const catalog = buildRollingStorageSinkCatalog([
      { ...pick, challenges: [] },
      { ...player, challenges: [] },
      { ...lowPick, challenges: [] },
      { ...unscannedPick, challenges: [] },
      { id: 20001, name: '89 Rated Pack', rewards: [{ type: 'PACK', packId: 30001 }] },
    ], [pick, lowPick]);
    expect(catalog).toEqual([
      expect.objectContaining({ setId: pick.id, rewardKind: 'player-pick', status: 'validated', challengeRatings: [88, 89] }),
      expect.objectContaining({ setId: player.id, rewardKind: 'player', status: 'indexed', challengeRatings: [] }),
    ].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''))));
    expect(catalog.map((candidate) => candidate.setId)).not.toEqual(expect.arrayContaining([
      lowPick.id,
      unscannedPick.id,
    ]));
  });
});
