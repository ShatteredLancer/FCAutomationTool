import { describe, expect, it, vi } from 'vitest';
import {
  chooseRollingRequiredSpecialRecoveryAction,
  ROLLING_UPGRADE_PHASES,
  runRollingUpgradeWorkflow,
} from '../../src/workflows/rolling-upgrade.js';
import { releaseRollingRoutingItemsAfterConsumption } from '../../src/inventory/rolling-policy.js';

describe('Rolling Required Special recovery decision', () => {
  it('opens an existing TOTW reward before crafting another Storage pressure recovery', () => {
    expect(chooseRollingRequiredSpecialRecoveryAction({
      hasExistingPack: true,
      trigger: 'storage-sink-required-special-shortage',
    })).toBe('open-existing-pack');
    expect(chooseRollingRequiredSpecialRecoveryAction({
      hasExistingPack: false,
      trigger: 'storage-sink-required-special-shortage',
    })).toBe('craft-storage-pressure');
  });

  it('consumes pending Unassigned primary duplicates before creating or opening a TOTW reward', () => {
    expect(chooseRollingRequiredSpecialRecoveryAction({
      hasExistingPack: true,
      hasPendingUnassignedPrimaryDuplicates: true,
      trigger: 'storage-sink-required-special-shortage',
    })).toBe('craft-with-pending-duplicates');
    expect(chooseRollingRequiredSpecialRecoveryAction({
      hasExistingPack: false,
      hasPendingUnassignedPrimaryDuplicates: true,
      trigger: 'primary-required-special-shortage',
    })).toBe('craft-with-pending-duplicates');
    expect(chooseRollingRequiredSpecialRecoveryAction({
      hasExistingPack: true,
      hasPendingUnassignedPrimaryDuplicates: true,
      trigger: 'primary-required-special-shortage',
    })).toBe('craft-with-pending-duplicates');
  });
});

function harness(overrides = {}) {
  let packNo = 0;
  return {
    maxCompletions: 1,
    provisionsShortageRecoveryEnabled: true,
    requiredSpecialRecoveryEnabled: true,
    preflight: vi.fn(async () => ({ status: 'ready' })),
    initializeInventory: vi.fn(async () => ({ status: 'ready' })),
    findPrimaryPack: vi.fn(async () => ({ id: ++packNo, name: '10x85+' })),
    openPrimaryPack: vi.fn(async ({ pack }) => ({
      status: 'opened',
      packRef: { id: pack.id },
      openedItems: [{ id: 100 + pack.id }],
    })),
    classifyOpenedItems: vi.fn(async () => ({ status: 'ready', requiredSpecial: 1 })),
    resolveProtectedStorage: vi.fn(async () => ({ status: 'ready' })),
    planPrimarySquad: vi.fn(async () => ({ ok: true, itemRefs: [{ id: 1 }] })),
    submitPrimary: vi.fn(async () => ({ status: 'submitted', submitted: true })),
    reconcile: vi.fn(async () => ({ status: 'ready' })),
    shouldStop: vi.fn(async () => false),
    onEvent: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('10x85+ Rolling workflow', () => {
  it.each(['SQUAD_RATING_EXCESS', 'PROVISIONS_LAST_BATCH_AT_RISK'])('crafts Provisions before the safe current squad for %s', async (forecastReason) => {
    let inventoryVersion = 1;
    let forecastCalls = 0;
    const calls = [];
    const options = harness({
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return { ok: true, itemRefs: [{ id: 1 }] };
      }),
      forecastPrimaryRunway: vi.fn(async ({ recoveryAttempted }) => {
        calls.push(`forecast:${recoveryAttempted}`);
        forecastCalls++;
        return forecastCalls === 1
          ? {
              status: 'recover',
              reasonCode: forecastReason,
              projectedRating: 86,
              targetRating: 84,
            }
          : { status: 'ready' };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        calls.push('existing-provisions');
        return { status: 'skipped' };
      }),
      shouldRunStorageRecovery: vi.fn(async () => ({ run: false })),
      recoverProvisions: vi.fn(async ({ context }) => {
        calls.push('craft-provisions');
        expect(context.trigger).toBe('primary-fodder-shortage');
        expect(context.plan).toMatchObject({ reasonCode: forecastReason });
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      submitPrimary: vi.fn(async () => {
        calls.push('submit-primary');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { provisions: 1 },
    });
    expect(calls).toEqual([
      'plan',
      'forecast:false',
      'existing-provisions',
      'craft-provisions',
      'plan',
      'forecast:true',
      'submit-primary',
    ]);
  });

  it('opens an existing Provisions reward before crafting for a projected runway shortage', async () => {
    let inventoryVersion = 1;
    let rewardOpened = false;
    const calls = [];
    const options = harness({
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      forecastPrimaryRunway: vi.fn(async () => rewardOpened
        ? { status: 'ready', projectedRating: 84, targetRating: 84 }
        : {
            status: 'recover',
            reasonCode: 'SQUAD_RATING_EXCESS',
            projectedRating: 86,
            targetRating: 84,
          }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        calls.push('open-existing');
        rewardOpened = true;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('craft-provisions');
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1, provisions: 0 },
    });
    expect(calls).toEqual(['open-existing']);
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
  });

  it('submits the current safe squad once when forecast Provisions material is unavailable', async () => {
    const events = [];
    const options = harness({
      forecastPrimaryRunway: vi.fn(async () => ({
        status: 'recover',
        reasonCode: 'SQUAD_RATING_EXCESS',
        projectedRating: 86,
        targetRating: 84,
      })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'skipped' })),
      shouldRunStorageRecovery: vi.fn(async () => ({ run: false })),
      recoverProvisions: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'four unique eligible Provisions definitions are unavailable',
        reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      })),
      onEvent: vi.fn(async (event, payload) => events.push([event, payload])),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 1,
      details: {
        primaryRunway: {
          projectedRating: 86,
          targetRating: 84,
          recoveryReasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
        },
      },
    });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
    expect(options.submitPrimary).toHaveBeenCalledOnce();
    expect(events.some(([event]) => event === 'primary-runway-unavailable')).toBe(true);
  });

  it('submits the current safe squad once when one Provisions recovery does not restore the forecast window', async () => {
    let inventoryVersion = 1;
    const options = harness({
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      forecastPrimaryRunway: vi.fn(async () => ({
        status: 'recover',
        reasonCode: 'SQUAD_RATING_EXCESS',
        forecastDepth: 3,
        triggerDepth: 3,
        projectedRating: 86,
        projectedSquadRatings: [84, 85, 86],
        targetRating: 84,
      })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'skipped' })),
      shouldRunStorageRecovery: vi.fn(async () => ({ run: false })),
      recoverProvisions: vi.fn(async () => {
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 1,
      details: {
        primaryRunway: {
          recoveryReasonCode: 'PROVISIONS_PREFLIGHT_RUNWAY_EXHAUSTED',
        },
      },
    });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
    expect(options.submitPrimary).toHaveBeenCalledOnce();
  });

  it('does not carry a forecast-only submission allowance into an actually infeasible next squad', async () => {
    let planCalls = 0;
    const options = harness({
      maxCompletions: 2,
      planPrimarySquad: vi.fn(async () => {
        planCalls++;
        return planCalls === 1
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : {
              ok: false,
              reason: 'the current squad would exceed the rating fallback cap',
              reasonCode: 'SQUAD_RATING_EXCESS',
            };
      }),
      forecastPrimaryRunway: vi.fn(async () => ({
        status: 'recover',
        reasonCode: 'SQUAD_RATING_EXCESS',
        forecastDepth: 3,
        triggerDepth: 3,
        projectedRating: 86,
        projectedSquadRatings: [84, 85, 86],
        targetRating: 84,
      })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'skipped' })),
      shouldRunStorageRecovery: vi.fn(async () => ({ run: false })),
      recoverProvisions: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'four unique eligible Provisions definitions are unavailable',
        reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      completions: 1,
      reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
    });
    expect(options.submitPrimary).toHaveBeenCalledOnce();
    expect(options.forecastPrimaryRunway).toHaveBeenCalledOnce();
  });

  it('recomputes the forecast from the next opened primary reward after a forecast-only shortage', async () => {
    let forecastCalls = 0;
    const options = harness({
      maxCompletions: 2,
      forecastPrimaryRunway: vi.fn(async () => {
        forecastCalls++;
        return forecastCalls === 1
          ? {
              status: 'recover',
              reasonCode: 'SQUAD_RATING_EXCESS',
              forecastDepth: 3,
              triggerDepth: 3,
              projectedRating: 86,
              projectedSquadRatings: [84, 85, 86],
              targetRating: 84,
            }
          : {
              status: 'ready',
              forecastDepth: 3,
              projectedSquadRatings: [84, 84, 85],
              targetRating: 84,
            };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'skipped' })),
      shouldRunStorageRecovery: vi.fn(async () => ({ run: false })),
      recoverProvisions: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'four unique eligible Provisions definitions are unavailable',
        reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 2,
      packsOpened: 2,
    });
    expect(options.openPrimaryPack).toHaveBeenCalledTimes(2);
    expect(options.forecastPrimaryRunway).toHaveBeenCalledTimes(2);
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.submitPrimary).toHaveBeenCalledTimes(2);
  });

  it('refreshes the active primary stage before looking up each iteration reward', async () => {
    const calls = [];
    const options = harness({
      maxCompletions: 2,
      refreshPrimaryStage: vi.fn(async ({ iteration }) => {
        calls.push(`stage:${iteration}`);
        return { status: 'ready' };
      }),
      findPrimaryPack: vi.fn(async ({ iteration }) => {
        calls.push(`pack:${iteration}`);
        return { id: iteration, name: 'x10' };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 2,
    });
    expect(calls).toEqual(['stage:1', 'pack:1', 'stage:2', 'pack:2']);
  });

  it('recomputes the primary runway after each newly opened primary reward', async () => {
    let inventoryVersion = 0;
    const forecastVersions = [];
    const options = harness({
      maxCompletions: 2,
      openPrimaryPack: vi.fn(async ({ pack }) => {
        inventoryVersion = pack.id;
        return {
          status: 'opened',
          packRef: { id: pack.id },
          openedItems: [{ id: 100 + pack.id }],
        };
      }),
      forecastPrimaryRunway: vi.fn(async () => {
        forecastVersions.push(inventoryVersion);
        return { status: 'ready', projectedRating: 84, targetRating: 84 };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 2,
      packsOpened: 2,
    });
    expect(forecastVersions).toEqual([1, 2]);
    expect(options.forecastPrimaryRunway).toHaveBeenCalledTimes(2);
  });

  it('stops before reward lookup when the active primary stage is ambiguous', async () => {
    const options = harness({
      refreshPrimaryStage: vi.fn(async () => ({
        status: 'blocked',
        reason: '86x10 repeatability is unknown',
        reasonCode: 'PRIMARY_STAGE_REPEATABILITY_CHANGED',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_STAGE_REPEATABILITY_CHANGED',
    });
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
  });

  it('keeps the workflow on the current stage when a submitted reward has no pack id', async () => {
    const refreshPrimaryStage = vi.fn(async ({ iteration }) => (
      iteration === 1 ? { status: 'ready' } : {
        status: 'blocked',
        reason: 'current stage reward must be confirmed before fallback',
        reasonCode: 'PRIMARY_REWARD_CONFIRMATION_REQUIRED',
      }
    ));
    const options = harness({
      maxCompletions: 2,
      refreshPrimaryStage,
      submitPrimary: vi.fn(async () => ({ status: 'submitted', submitted: true, rewardPackId: null })),
    });
    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_REWARD_CONFIRMATION_REQUIRED',
      completions: 1,
    });
    expect(refreshPrimaryStage).toHaveBeenCalledTimes(2);
  });

  it('preserves a delayed primary reward confirmation block from pack lookup', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => ({
        status: 'blocked',
        reason: 'submitted primary reward is not yet visible',
        reasonCode: 'PRIMARY_REWARD_CONFIRMATION_REQUIRED',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_REWARD_CONFIRMATION_REQUIRED',
      reason: 'submitted primary reward is not yet visible',
    });
    expect(options.openPrimaryPack).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('does not invoke Provisions shortage recovery without explicit permission', async () => {
    const recoverProvisions = vi.fn(async () => ({ status: 'submitted' }));
    const options = harness({
      provisionsShortageRecoveryEnabled: false,
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'PLAYER_COUNT_SHORTAGE' },
      })),
      recoverProvisions,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'Provisions shortage recovery is disabled in Settings',
      reasonCode: 'PROVISIONS_SHORTAGE_RECOVERY_DISABLED',
    });
    expect(recoverProvisions).not.toHaveBeenCalled();
  });

  it('does not invoke Required Special recovery without explicit permission', async () => {
    const recoverRequiredSpecial = vi.fn(async () => ({ status: 'submitted' }));
    const options = harness({
      requiredSpecialRecoveryEnabled: false,
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' },
      })),
      recoverRequiredSpecial,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'Required Special/TOTW recovery is disabled in Settings',
      reasonCode: 'REQUIRED_SPECIAL_RECOVERY_DISABLED',
    });
    expect(recoverRequiredSpecial).not.toHaveBeenCalled();
  });

  it('opens an existing reward, classifies it, routes protected cards, and submits once', async () => {
    const options = harness();
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      packsOpened: 1,
      bootstrapSubmissions: 0,
    });
    expect(options.classifyOpenedItems).toHaveBeenCalledOnce();
    expect(options.resolveProtectedStorage).toHaveBeenCalledOnce();
    expect(options.submitPrimary).toHaveBeenCalledWith(expect.objectContaining({ bootstrap: false }));
  });

  it('cancels a prior-run duplicate transaction before pending Pick, Unassigned, or pack work', async () => {
    const calls = [];
    const options = harness({
      initializeInventory: vi.fn(async () => { calls.push('inventory'); return { status: 'ready' }; }),
      recoverDuplicateTransaction: vi.fn(async () => { calls.push('duplicate-startup-cancellation'); return { status: 'ready' }; }),
      resumePendingPlayerPick: vi.fn(async () => { calls.push('pick'); return { status: 'ready' }; }),
      resumePendingUnassigned: vi.fn(async () => { calls.push('unassigned'); return { status: 'ready' }; }),
      findPrimaryPack: vi.fn(async () => { calls.push('pack'); return null; }),
    });

    await runRollingUpgradeWorkflow(options);

    expect(calls).toEqual(['inventory', 'duplicate-startup-cancellation', 'pick', 'unassigned', 'pack']);
  });

  it('stops before pending inventory or pack work when startup identity classification is untrusted', async () => {
    const resumePendingPlayerPick = vi.fn(async () => ({ status: 'ready' }));
    const resumePendingUnassigned = vi.fn(async () => ({ status: 'ready' }));
    const options = harness({
      recoverDuplicateTransaction: vi.fn(async () => ({
        status: 'blocked',
        reason: 'reconciled Inventory Ledger is unavailable',
        reasonCode: 'DUPLICATE_STARTUP_INVENTORY_UNTRUSTWORTHY',
      })),
      resumePendingPlayerPick,
      resumePendingUnassigned,
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_INVENTORY_UNTRUSTWORTHY',
    });
    expect(resumePendingPlayerPick).not.toHaveBeenCalled();
    expect(resumePendingUnassigned).not.toHaveBeenCalled();
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
  });

  it('replans an Active Squad conflict without counting a completion or reopening a pack', async () => {
    const submitPrimary = vi.fn()
      .mockResolvedValueOnce({
        status: 'replan',
        submitted: false,
        reasonCode: 'ACTIVE_SQUAD_CONFLICT_REPLAN',
        details: { excludedItemIds: [74] },
      })
      .mockResolvedValueOnce({ status: 'submitted', submitted: true });
    const options = harness({ submitPrimary });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', completions: 1, packsOpened: 1, receiptCount: 2 });
    expect(submitPrimary).toHaveBeenCalledTimes(2);
    expect(options.findPrimaryPack).toHaveBeenCalledOnce();
    expect(options.openPrimaryPack).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
    expect(options.onEvent).toHaveBeenCalledWith('replan', expect.objectContaining({
      reasonCode: 'ACTIVE_SQUAD_CONFLICT_REPLAN',
    }));
  });

  it('keeps an active duplicate transaction on the direct primary replan path', async () => {
    let transactionActive = false;
    const calls = [];
    const submitPrimary = vi.fn()
      .mockImplementationOnce(async () => {
        transactionActive = true;
        return { status: 'replan', submitted: false, reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN' };
      })
      .mockImplementationOnce(async () => {
        transactionActive = false;
        return { status: 'submitted', submitted: true };
      });
    const options = harness({
      hasActiveDuplicateTransaction: () => transactionActive,
      findPrimaryPack: vi.fn(async () => { calls.push('pack'); return { id: 1, name: '10x85+' }; }),
      openPrimaryPack: vi.fn(async () => { calls.push('open'); return { status: 'opened' }; }),
      resolveProtectedStorage: vi.fn(async () => { calls.push('storage'); return { status: 'ready' }; }),
      planPrimarySquad: vi.fn(async ({ duplicateTransactionReplan }) => {
        calls.push(duplicateTransactionReplan ? 'transaction-plan' : 'plan');
        return { ok: true, itemRefs: [{ id: 1 }] };
      }),
      submitPrimary,
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', completions: 1, packsOpened: 1 });
    expect(calls).toEqual(['pack', 'open', 'storage', 'plan', 'transaction-plan']);
    expect(submitPrimary).toHaveBeenCalledTimes(2);
  });

  it('compensates an active duplicate transaction instead of entering recovery after replan shortage', async () => {
    let transactionActive = false;
    const recoverProvisions = vi.fn(async () => ({ status: 'submitted', submitted: true }));
    const recoverRequiredSpecial = vi.fn(async () => ({ status: 'submitted', submitted: true }));
    const abortActiveDuplicateTransaction = vi.fn(async ({ plan }) => {
      transactionActive = false;
      return {
        status: 'blocked',
        submitted: false,
        reason: plan.reason,
        reasonCode: plan.reasonCode,
        details: { compensationSucceeded: true },
      };
    });
    const planPrimarySquad = vi.fn()
      .mockResolvedValueOnce({ ok: true, itemRefs: [{ id: 1 }] })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'A prime disappeared after materialization',
        reasonCode: 'PLAYER_COUNT_SHORTAGE',
      });
    const options = harness({
      hasActiveDuplicateTransaction: () => transactionActive,
      abortActiveDuplicateTransaction,
      planPrimarySquad,
      submitPrimary: vi.fn(async () => {
        transactionActive = true;
        return { status: 'replan', submitted: false, reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN' };
      }),
      recoverProvisions,
      recoverRequiredSpecial,
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'PLAYER_COUNT_SHORTAGE',
      details: { compensationSucceeded: true },
    });
    expect(abortActiveDuplicateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'primary-replan-failed',
      plan: expect.objectContaining({ reasonCode: 'PLAYER_COUNT_SHORTAGE' }),
    }));
    expect(recoverProvisions).not.toHaveBeenCalled();
    expect(recoverRequiredSpecial).not.toHaveBeenCalled();
    expect(options.findPrimaryPack).toHaveBeenCalledOnce();
    expect(options.openPrimaryPack).toHaveBeenCalledOnce();
  });

  it('compensates an active duplicate transaction before honoring Stop', async () => {
    let transactionActive = false;
    const abortActiveDuplicateTransaction = vi.fn(async ({ value }) => {
      transactionActive = false;
      return {
        ...value,
        details: { compensationSucceeded: true },
      };
    });
    const options = harness({
      hasActiveDuplicateTransaction: () => transactionActive,
      abortActiveDuplicateTransaction,
      shouldStop: vi.fn(async () => transactionActive),
      submitPrimary: vi.fn(async () => {
        transactionActive = true;
        return { status: 'replan', submitted: false, reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'stopped',
      reasonCode: 'USER_STOPPED',
      details: { compensationSucceeded: true },
    });
    expect(abortActiveDuplicateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'user-stop',
      value: expect.objectContaining({ reasonCode: 'USER_STOPPED' }),
    }));
    expect(options.findPrimaryPack).toHaveBeenCalledOnce();
    expect(options.openPrimaryPack).toHaveBeenCalledOnce();
    expect(options.submitPrimary).toHaveBeenCalledOnce();
  });

  it('bootstraps from inventory when no primary reward exists', async () => {
    const options = harness({ findPrimaryPack: vi.fn(async () => null) });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      packsOpened: 0,
      bootstrapSubmissions: 1,
    });
    expect(options.openPrimaryPack).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).toHaveBeenCalledWith(expect.objectContaining({ bootstrap: true }));
  });

  it('resumes existing Unassigned primary cards before any pack lookup or open', async () => {
    const options = harness({
      resumePendingUnassigned: vi.fn(async () => ({
        status: 'ready',
        primaryPending: true,
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      packsOpened: 0,
      bootstrapSubmissions: 0,
    });
    expect(options.resumePendingUnassigned).toHaveBeenCalledOnce();
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
    expect(options.openPrimaryPack).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).toHaveBeenCalledWith(expect.objectContaining({
      bootstrap: false,
      resumedPrimary: true,
    }));
    expect(options.submitPrimary).toHaveBeenCalledWith(expect.objectContaining({
      bootstrap: false,
      resumedPrimary: true,
    }));
  });

  it('resumes a pending Storage Sink Pick before generic Unassigned recovery', async () => {
    const resumePendingPlayerPick = vi.fn(async () => ({ status: 'selected' }));
    const resumePendingUnassigned = vi.fn(async () => ({ status: 'ready', primaryPending: true }));
    const options = harness({ resumePendingPlayerPick, resumePendingUnassigned });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', completions: 1, packsOpened: 0 });
    expect(resumePendingPlayerPick).toHaveBeenCalledOnce();
    expect(resumePendingUnassigned).toHaveBeenCalledOnce();
    expect(resumePendingPlayerPick.mock.invocationCallOrder[0])
      .toBeLessThan(resumePendingUnassigned.mock.invocationCallOrder[0]);
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
  });

  it('does not run generic Unassigned recovery when pending Pick recovery is blocked', async () => {
    const resumePendingUnassigned = vi.fn(async () => ({ status: 'ready' }));
    const options = harness({
      resumePendingPlayerPick: vi.fn(async () => ({
        status: 'blocked',
        reason: 'pending Storage Sink Pick confirmation failed',
        reasonCode: 'PLAYER_PICK_CONFIRMATION_FAILED',
      })),
      resumePendingUnassigned,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'pending Storage Sink Pick confirmation failed',
      reasonCode: 'PLAYER_PICK_CONFIRMATION_FAILED',
    });
    expect(resumePendingUnassigned).not.toHaveBeenCalled();
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
  });

  it('does not look up a pack when resumed Unassigned routing is blocked', async () => {
    const options = harness({
      resumePendingUnassigned: vi.fn(async () => ({
        status: 'blocked',
        reason: 'existing Unassigned identity is uncertain',
        reasonCode: 'UNASSIGNED_RESUME_BLOCKED',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'existing Unassigned identity is uncertain',
      reasonCode: 'UNASSIGNED_RESUME_BLOCKED',
    });
    expect(options.findPrimaryPack).not.toHaveBeenCalled();
    expect(options.openPrimaryPack).not.toHaveBeenCalled();
  });

  it('counts only primary submissions toward a positive completion limit', async () => {
    const options = harness({ maxCompletions: 3 });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', completions: 3, packsOpened: 3 });
    expect(options.submitPrimary).toHaveBeenCalledTimes(3);
    expect(options.reconcile).toHaveBeenCalledTimes(3);
  });

  it('runs Storage maintenance only after primary submission and replans after each action', async () => {
    let inventoryVersion = 1;
    let maintenanceRuns = 0;
    const options = harness({
      surplusCraftingEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      maintainStorage: vi.fn(async () => {
        maintenanceRuns++;
        if (maintenanceRuns > 2) return { status: 'skipped' };
        inventoryVersion++;
        return { status: 'submitted', details: { action: 'provisions' } };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { storageMaintenance: 2 },
    });
    expect(options.maintainStorage).toHaveBeenCalledTimes(3);
    expect(options.maintainStorage.mock.invocationCallOrder[0])
      .toBeGreaterThan(options.submitPrimary.mock.invocationCallOrder[0]);
  });

  it('does not proactively craft duplicate reserves or maintain Storage by default', async () => {
    const options = harness({
      readRecoveryState: vi.fn(async () => ({ duplicateProvisionBatches: 1 })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
      maintainStorage: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { total: 0 } });
    expect(options.readRecoveryState).not.toHaveBeenCalled();
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.maintainStorage).not.toHaveBeenCalled();
  });

  it('does not invoke Storage maintenance before a failed primary plan', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'PLAYER_COUNT_SHORTAGE' },
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'skipped' })),
      maintainStorage: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result.status).toBe('blocked');
    expect(options.maintainStorage).not.toHaveBeenCalled();
  });

  it('treats zero as unlimited and exits through the Stop boundary', async () => {
    let stopChecks = 0;
    const options = harness({
      maxCompletions: 0,
      shouldStop: vi.fn(async () => ++stopChecks >= 4),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'stopped', reasonCode: 'USER_STOPPED' });
    expect(result.completions).toBeGreaterThan(0);
    expect(result.completions).toBeLessThan(4);
  });

  it('stops Dry Run at an existing pack because its reward is unknown', async () => {
    const options = harness({
      openPrimaryPack: vi.fn(async () => ({ status: 'planned', reason: 'dry run would open 10x85+' })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'planned',
      phase: ROLLING_UPGRADE_PHASES.OPEN_PRIMARY_REWARD,
      completions: 0,
    });
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('uses the same planner for a Dry Run inventory bootstrap', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      submitPrimary: vi.fn(async () => ({ status: 'planned', reason: 'dry-run squad plan complete' })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'planned', completions: 0, bootstrapSubmissions: 0 });
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('passes multiple Required Special cards through classification while the plan consumes one', async () => {
    const options = harness({
      classifyOpenedItems: vi.fn(async () => ({
        status: 'ready',
        requiredSpecialRefs: [{ id: 11 }, { id: 12 }, { id: 13 }],
      })),
      planPrimarySquad: vi.fn(async () => ({
        ok: true,
        details: { roles: [{ id: 'required-special', selected: 1 }] },
      })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result.status).toBe('completed');
    const classified = await options.classifyOpenedItems.mock.results[0].value;
    expect(classified.requiredSpecialRefs).toHaveLength(3);
    expect(result.lastPlan.details.roles[0].selected).toBe(1);
  });

  it('returns PROTECTED_STORAGE_BLOCKED before planning another squad', async () => {
    const options = harness({
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: 'SBC storage has no free slot',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      phase: ROLLING_UPGRADE_PHASES.RESOLVE_PROTECTED_STORAGE,
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
    });
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('recovers Storage headroom before routing duplicates while native swaps are disabled', async () => {
    const recoverProvisions = vi.fn(async () => ({ status: 'skipped' }));
    const recoverStorageSink = vi.fn(async () => ({ status: 'submitted', submitted: true }));
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      recoverProvisions,
      recoverStorageSink,
      resolveProtectedStorage: vi.fn()
        .mockResolvedValueOnce({
          status: 'blocked',
          reason: 'native duplicate swaps are disabled and SBC storage is full',
          reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
        })
        .mockResolvedValue({ status: 'ready' }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', completions: 1 });
    expect(recoverProvisions).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ trigger: 'storage-pressure' }),
    }));
    expect(recoverStorageSink).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ trigger: 'storage-pressure' }),
    }));
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
    expect(options.submitPrimary).toHaveBeenCalledOnce();
  });

  it('keeps disabled-swap duplicates blocked when no Storage pressure sink is enabled', async () => {
    const recoverProvisions = vi.fn(async () => ({ status: 'skipped' }));
    const recoverStorageSink = vi.fn(async () => ({ status: 'submitted', submitted: true }));
    const options = harness({
      storageSinkEnabled: false,
      storageRecoveryPriority: 'provisions-only',
      recoverProvisions,
      recoverStorageSink,
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: 'native duplicate swaps are disabled and SBC storage is full',
        reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      phase: ROLLING_UPGRADE_PHASES.RECOVER_PROVISIONS,
      reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
    });
    expect(recoverProvisions).toHaveBeenCalledOnce();
    expect(recoverStorageSink).not.toHaveBeenCalled();
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('preserves the structured Solver reason when the primary squad is infeasible', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        reason: 'Required Special is unavailable',
        missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' },
      })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      phase: ROLLING_UPGRADE_PHASES.PLAN_PRIMARY_SQUAD,
      reasonCode: 'REQUIRED_SPECIAL_SHORTAGE',
    });
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('blocks an effect that reports no primary submission progress', async () => {
    const options = harness({
      submitPrimary: vi.fn(async () => ({ status: 'ready', reason: 'nothing changed' })),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      phase: ROLLING_UPGRADE_PHASES.SUBMIT_PRIMARY,
      reasonCode: 'PRIMARY_SUBMISSION_BLOCKED',
    });
  });

  it('bounds retained receipts during an unlimited run', async () => {
    let submissions = 0;
    const options = harness({
      maxCompletions: 0,
      maxReceipts: 3,
      shouldStop: vi.fn(async () => submissions >= 4),
      submitPrimary: vi.fn(async () => {
        submissions++;
        return { status: 'submitted', submitted: true, challengeRef: { id: submissions } };
      }),
    });
    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'stopped', completions: 4, receiptCount: 8 });
    expect(result.receipts).toHaveLength(3);
  });

  it('can disable full receipt retention for a streaming recap consumer', async () => {
    const result = await runRollingUpgradeWorkflow(harness({ retainReceipts: false }));

    expect(result.receiptCount).toBe(2);
    expect(result.receipts).toEqual([]);
  });

  it('recovers a missing Required Special and replans through the shared planning point', async () => {
    let inventoryVersion = 1;
    let specialReady = false;
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true, itemRefs: [{ id: 1 }] }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        specialReady = true;
        inventoryVersion++;
        return { status: 'progressed', recoveryKind: 'totw-pack' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { total: 1, requiredSpecial: 1 },
    });
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
    expect(options.recoverRequiredSpecial).toHaveBeenCalledOnce();
  });

  it('opens a newly submitted Required Special reward before planning another primary squad', async () => {
    let inventoryVersion = 1;
    let pendingReward = false;
    let specialReady = false;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push(specialReady ? 'plan-primary-ready' : 'plan-primary-shortage');
        return specialReady
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } };
      }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('submit-totw');
        pendingReward = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true, rewardPackId: 20707 };
      }),
      processPendingRecoveryReward: vi.fn(async () => {
        if (!pendingReward) return { status: 'skipped' };
        calls.push('open-totw-reward');
        pendingReward = false;
        specialReady = true;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      hasPendingRecoveryReward: vi.fn(async () => pendingReward),
      submitPrimary: vi.fn(async () => {
        calls.push('submit-primary');
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { requiredSpecial: 1, reward: 1 },
    });
    expect(calls).toEqual([
      'plan-primary-shortage',
      'submit-totw',
      'open-totw-reward',
      'plan-primary-ready',
      'submit-primary',
    ]);
  });

  it('resumes a persisted recovery reward before finding or opening a primary reward', async () => {
    let inventoryVersion = 1;
    let pendingReward = true;
    const calls = [];
    const options = harness({
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resumePendingUnassigned: vi.fn(async () => {
        calls.push('settle-unassigned');
        return { status: 'ready' };
      }),
      processPendingRecoveryReward: vi.fn(async () => {
        if (!pendingReward) return { status: 'skipped' };
        calls.push('open-totw-reward');
        pendingReward = false;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      hasPendingRecoveryReward: vi.fn(async () => pendingReward),
      findPrimaryPack: vi.fn(async () => {
        calls.push('find-primary-reward');
        return null;
      }),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan-primary');
        return { ok: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1 },
    });
    expect(calls).toEqual([
      'settle-unassigned',
      'open-totw-reward',
      'find-primary-reward',
      'plan-primary',
    ]);
  });

  it('replans after an expired persisted reward journal and performs a fresh Required Special recovery', async () => {
    let inventoryVersion = 1;
    let rewardState = 'stale-journal';
    let specialReady = false;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => {
        calls.push('find-primary-reward');
        return null;
      }),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      hasPendingRecoveryReward: vi.fn(async () => rewardState === 'stale-journal'),
      processPendingRecoveryReward: vi.fn(async () => {
        if (rewardState === 'stale-journal') {
          calls.push('expire-stale-journal');
          rewardState = 'none';
          return {
            status: 'replan',
            reasonCode: 'RECOVERY_REWARD_JOURNAL_EXPIRED',
          };
        }
        if (rewardState === 'new-reward') {
          calls.push('open-new-totw-reward');
          rewardState = 'none';
          specialReady = true;
          inventoryVersion++;
          return { status: 'opened' };
        }
        return { status: 'skipped' };
      }),
      planPrimarySquad: vi.fn(async () => {
        calls.push(specialReady ? 'plan-primary-ready' : 'plan-primary-shortage');
        return specialReady
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } };
      }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('submit-fresh-totw');
        rewardState = 'new-reward';
        inventoryVersion++;
        return { status: 'submitted', submitted: true, rewardPackId: 20707 };
      }),
      submitPrimary: vi.fn(async () => {
        calls.push('submit-primary');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { requiredSpecial: 1, reward: 1 },
    });
    expect(calls).toEqual([
      'expire-stale-journal',
      'find-primary-reward',
      'plan-primary-shortage',
      'submit-fresh-totw',
      'open-new-totw-reward',
      'plan-primary-ready',
      'submit-primary',
    ]);
  });

  it('uses the Storage pressure SBC when a pending Required Special reward cannot open', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    let specialReady = false;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true, itemRefs: [{ id: 1 }] }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('required-special');
        if (!storageReady) {
          return {
            status: 'blocked',
            reason: 'SBC storage has only 6 slot(s), but 8 item(s) need moving',
            reasonCode: 'PROTECTED_STORAGE_BLOCKED',
          };
        }
        specialReady = true;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      recoverStorageSink: vi.fn(async ({ context }) => {
        calls.push('storage-sink');
        expect(context).toMatchObject({
          trigger: 'storage-pressure',
          source: 'required-special-reward-pre-open',
        });
        storageReady = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { total: 2, storageSink: 1, requiredSpecial: 1 },
    });
    expect(calls).toEqual(['required-special', 'storage-sink', 'required-special']);
    expect(options.submitPrimary).toHaveBeenCalledOnce();
  });

  it('uses Provisions when the Required Special recovery squad is short of fodder', async () => {
    let inventoryVersion = 1;
    let fodderReady = false;
    let specialReady = false;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('required-special');
        if (!fodderReady) {
          return {
            status: 'blocked',
            reason: 'TOTW squad rating shortage',
            recoverableByProvisions: true,
          };
        }
        specialReady = true;
        inventoryVersion++;
        return { status: 'progressed' };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        fodderReady = true;
        inventoryVersion++;
        return { status: 'progressed' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { total: 2, provisions: 1, requiredSpecial: 1 },
    });
    expect(calls).toEqual(['required-special', 'provisions', 'required-special']);
  });

  it('opens an existing Provisions reward before crafting one when Required Special recovery lacks fodder', async () => {
    let inventoryVersion = 1;
    let fodderReady = false;
    let specialReady = false;
    let existingProvisions = 1;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('required-special');
        if (!fodderReady) {
          return {
            status: 'blocked',
            reason: 'TOTW squad rating shortage',
            recoverableByProvisions: true,
          };
        }
        specialReady = true;
        inventoryVersion++;
        return { status: 'progressed' };
      }),
      processLeftoverRecoveryReward: vi.fn(async ({ context }) => {
        calls.push('check-existing-provisions');
        expect(context.trigger).toBe('required-special-fodder-shortage');
        if (!existingProvisions) return { status: 'skipped' };
        existingProvisions--;
        fodderReady = true;
        inventoryVersion++;
        calls.push('open-existing-provisions');
        return {
          status: 'opened',
          details: { recoveryFamily: 'provisions-upgrade' },
        };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('craft-provisions');
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1, provisions: 0, requiredSpecial: 1 },
    });
    expect(calls).toEqual([
      'required-special',
      'check-existing-provisions',
      'open-existing-provisions',
      'required-special',
    ]);
    expect(options.recoverProvisions).not.toHaveBeenCalled();
  });

  it('crafts Provisions only after the existing family rewards are exhausted', async () => {
    let inventoryVersion = 1;
    let fodderReady = false;
    let specialReady = false;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('required-special');
        if (!fodderReady) {
          return { status: 'blocked', recoverableByProvisions: true };
        }
        specialReady = true;
        inventoryVersion++;
        return { status: 'progressed' };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        calls.push('check-existing-provisions');
        return { status: 'skipped' };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('craft-provisions');
        fodderReady = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      'required-special',
      'check-existing-provisions',
      'craft-provisions',
      'required-special',
    ]);
  });

  it('opens all existing Provision rewards needed by Required Special before crafting another', async () => {
    let inventoryVersion = 1;
    let specialReady = false;
    let existingProvisions = 3;
    const calls = [];
    const options = harness({
      shortageProvisionsPackLimit: 2,
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => specialReady
        ? { ok: true }
        : { ok: false, missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' } }),
      recoverRequiredSpecial: vi.fn(async () => {
        calls.push('required-special');
        if (existingProvisions > 0) return { status: 'blocked', recoverableByProvisions: true };
        specialReady = true;
        inventoryVersion++;
        return { status: 'progressed' };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        calls.push('open-existing-provisions');
        existingProvisions--;
        inventoryVersion++;
        return { status: 'opened', details: { recoveryFamily: 'provisions-upgrade' } };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('craft-provisions');
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result.status).toBe('completed');
    expect(calls.filter((entry) => entry === 'open-existing-provisions')).toHaveLength(3);
    expect(calls.filter((entry) => entry === 'required-special')).toHaveLength(4);
    expect(calls).not.toContain('craft-provisions');
    expect(options.recoverProvisions).not.toHaveBeenCalled();
  });

  it('runs Provisions, opens its reward, drains Rare through Pick, then Gold through 5x80+', async () => {
    let inventoryVersion = 1;
    let stage = 'shortage';
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => stage === 'ready'
        ? { ok: true }
        : { ok: false, missing: { code: 'PLAYER_COUNT_SHORTAGE' } }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions-submit');
        stage = 'provisions-pack';
        inventoryVersion++;
        return { status: 'submitted' };
      }),
      processPendingRecoveryReward: vi.fn(async () => {
        if (stage === 'provisions-pack') {
          calls.push('provisions-open');
          stage = 'rare-duplicate';
        } else if (stage === 'gold-sink-pack') {
          calls.push('gold-sink-open');
          stage = 'ready';
        } else {
          return { status: 'skipped' };
        }
        inventoryVersion++;
        return { status: 'opened' };
      }),
      drainRecoveryDuplicates: vi.fn(async () => {
        if (stage === 'rare-duplicate') {
          calls.push('85-pick');
          stage = 'gold-duplicate';
        } else if (stage === 'gold-duplicate') {
          calls.push('5x80-submit');
          stage = 'gold-sink-pack';
        } else {
          return { status: 'skipped' };
        }
        inventoryVersion++;
        return { status: 'progressed' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { total: 5, reward: 2, goldDrain: 2, provisions: 1 },
    });
    expect(calls).toEqual([
      'provisions-submit',
      'provisions-open',
      '85-pick',
      '5x80-submit',
      'gold-sink-open',
    ]);
  });

  it('does not let accumulated Provisions reserves preempt a feasible primary bootstrap', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      readRecoveryState: vi.fn(async () => ({
        provisionsBatches: 2,
        duplicateProvisionBatches: 1,
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'opened' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { total: 0, provisions: 0 } });
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.processLeftoverRecoveryReward).not.toHaveBeenCalled();
    expect(options.readRecoveryState).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('fails closed on primary duplicate identity drift without opening or crafting Provisions', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        reason: 'reserved primary duplicate #42 is no longer available',
        reasonCode: 'PRIMARY_DUPLICATE_IDENTITY_CHANGED',
      })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'opened' })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_DUPLICATE_IDENTITY_CHANGED',
    });
    expect(options.processLeftoverRecoveryReward).not.toHaveBeenCalled();
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('does not open Provisions when a mandatory primary item is unavailable', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        reason: 'one or more required items are unavailable or protected',
        reasonCode: 'REQUIRED_ITEM_UNAVAILABLE',
      })),
      processLeftoverRecoveryReward: vi.fn(async () => ({ status: 'opened' })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'REQUIRED_ITEM_UNAVAILABLE',
    });
    expect(options.processLeftoverRecoveryReward).not.toHaveBeenCalled();
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('opens leftover Provisions in batches of two and replans before opening another batch', async () => {
    let inventoryVersion = 1;
    let leftovers = 3;
    let provisionsReady = false;
    const calls = [];
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return provisionsReady
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'PLAYER_COUNT_SHORTAGE' } };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        if (!leftovers) {
          calls.push('leftovers-empty');
          return { status: 'skipped' };
        }
        calls.push(`leftover-${4 - leftovers}`);
        leftovers--;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      drainRecoveryDuplicates: vi.fn(async () => ({ status: 'skipped' })),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions-submit');
        provisionsReady = true;
        inventoryVersion++;
        return { status: 'submitted' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { reward: 3, provisions: 1 },
    });
    expect(calls).toEqual([
      'plan',
      'leftover-1',
      'leftover-2',
      'plan',
      'leftover-3',
      'leftovers-empty',
      'plan',
      'provisions-submit',
      'plan',
    ]);
  });

  it('honors a configured shortage batch and stops opening leftovers once replanning succeeds', async () => {
    let inventoryVersion = 1;
    let ready = false;
    let leftovers = 3;
    const calls = [];
    const options = harness({
      shortageProvisionsPackLimit: 1,
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return ready
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'PLAYER_COUNT_SHORTAGE' } };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        calls.push('leftover');
        leftovers--;
        ready = true;
        inventoryVersion++;
        return {
          status: 'opened',
          details: { recoveryFamily: 'provisions-upgrade' },
        };
      }),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1, provisions: 0 },
    });
    expect(calls).toEqual(['plan', 'leftover', 'plan']);
    expect(leftovers).toBe(2);
    expect(options.recoverProvisions).not.toHaveBeenCalled();
  });

  it('uses the Storage pressure Pick when Unassigned blocks opening a shortage Provisions reward', async () => {
    let inventoryVersion = 1;
    let ready = false;
    let leftoverAttempts = 0;
    const calls = [];
    const options = harness({
      shortageProvisionsPackLimit: 1,
      storageSinkEnabled: true,
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return ready
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      processLeftoverRecoveryReward: vi.fn(async () => {
        leftoverAttempts++;
        if (leftoverAttempts === 1) {
          calls.push('leftover-storage-blocked');
          return {
            status: 'blocked',
            reason: 'SBC storage has only 3 slot(s), but 7 item(s) need moving',
            reasonCode: 'PROTECTED_STORAGE_BLOCKED',
          };
        }
        calls.push('leftover-opened');
        ready = true;
        inventoryVersion++;
        return { status: 'opened', details: { recoveryFamily: 'provisions-upgrade' } };
      }),
      recoverStorageSink: vi.fn(async ({ context }) => {
        calls.push('storage-sink');
        expect(context).toMatchObject({
          trigger: 'storage-pressure',
          source: 'leftover-recovery-pre-open',
        });
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      drainRecoveryDuplicates: vi.fn(async () => ({ status: 'skipped' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1, storageSink: 1 },
    });
    expect(calls).toEqual([
      'plan',
      'leftover-storage-blocked',
      'storage-sink',
      'leftover-opened',
      'plan',
    ]);
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
  });

  it('runs one Provisions batch only after primary planning reports a fodder shortage, then replans', async () => {
    let inventoryVersion = 1;
    let ready = false;
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      readRecoveryState: vi.fn(async () => ({ provisionsBatches: 2 })),
      planPrimarySquad: vi.fn(async () => ready
        ? { ok: true, itemRefs: [{ id: 1 }] }
        : { ok: false, missing: { code: 'PLAYER_COUNT_SHORTAGE' } }),
      recoverProvisions: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('primary-fodder-shortage');
        ready = true;
        inventoryVersion++;
        return { status: 'submitted' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { total: 1, provisions: 1 } });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
  });

  it('passes a rating-excess plan into Provisions recovery before replanning the primary squad', async () => {
    let inventoryVersion = 1;
    let ready = false;
    const excessPlan = {
      ok: false,
      reason: 'primary squad minimum rating is 89 for target 84',
      reasonCode: 'SQUAD_RATING_EXCESS',
      missing: { code: 'SQUAD_RATING_EXCESS' },
    };
    const options = harness({
      storageRecoveryPriority: 'provisions-only',
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => ready
        ? { ok: true, itemRefs: [{ id: 1 }] }
        : excessPlan),
      recoverProvisions: vi.fn(async ({ context }) => {
        expect(context).toMatchObject({
          trigger: 'primary-fodder-shortage',
          plan: excessPlan,
        });
        ready = true;
        inventoryVersion++;
        return { status: 'submitted' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { provisions: 1 } });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledTimes(2);
  });

  it('uses the configured Storage Pressure SBC first when the primary squad exceeds its rating', async () => {
    let inventoryVersion = 1;
    let ready = false;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'storage-pressure-only',
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return ready
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverStorageSink: vi.fn(async ({ context }) => {
        calls.push('storage-pressure');
        expect(context).toMatchObject({
          trigger: 'storage-pressure',
          source: 'primary-rating-excess',
        });
        ready = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { storageSink: 1, provisions: 0 },
    });
    expect(calls).toEqual(['plan', 'storage-pressure', 'plan']);
    expect(options.recoverProvisions).not.toHaveBeenCalled();
  });

  it('does not fall back to Provisions when Storage Pressure-only recovery is unavailable', async () => {
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'storage-pressure-only',
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        return {
          status: 'unavailable',
          reason: 'selected Storage Pressure SBC is unavailable',
          reasonCode: 'STORAGE_SINK_UNAVAILABLE',
        };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      reasonCode: 'STORAGE_SINK_UNAVAILABLE',
      recoveries: { storageSink: 0, provisions: 0 },
    });
    expect(calls).toEqual(['plan', 'storage-pressure']);
    expect(options.recoverProvisions).not.toHaveBeenCalled();
  });

  it('does not use Provisions when Storage Pressure-only recovery is disabled', async () => {
    const options = harness({
      storageSinkEnabled: false,
      storageRecoveryPriority: 'storage-pressure-only',
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'SQUAD_RATING_EXCESS' },
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted', submitted: true })),
      recoverStorageSink: vi.fn(async () => ({ status: 'submitted', submitted: true })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reasonCode: 'SQUAD_RATING_EXCESS',
      recoveries: { provisions: 0, storageSink: 0 },
    });
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('uses only Provisions for repeated pressure when Provisions-only recovery is configured', async () => {
    let inventoryVersion = 1;
    let attempts = 0;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-only',
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return attempts >= 2
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverProvisions: vi.fn(async ({ context }) => {
        calls.push('provisions');
        expect(context).toMatchObject({
          trigger: 'primary-fodder-shortage',
          source: 'primary-rating-excess',
        });
        attempts++;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { storageSink: 0, provisions: 2 },
    });
    expect(calls).toEqual(['plan', 'provisions', 'plan', 'provisions', 'plan']);
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('tries Provisions once, then Storage Pressure when the same pressure remains', async () => {
    let inventoryVersion = 1;
    let pressureChecks = 0;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => {
        calls.push('storage-check');
        pressureChecks++;
        return pressureChecks >= 3
          ? { status: 'ready' }
          : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { provisions: 1, storageSink: 1 },
    });
    expect(calls).toEqual([
      'storage-check',
      'provisions',
      'storage-check',
      'storage-pressure',
      'storage-check',
    ]);
  });

  it('does not run Storage Pressure when one Provisions attempt clears the pressure', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async () => {
        storageReady = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverStorageSink: vi.fn(async () => ({ status: 'submitted', submitted: true })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { provisions: 1, storageSink: 0 },
    });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('keeps a rating-excess pressure event across inventory-ready replans', async () => {
    let inventoryVersion = 1;
    let recoveryCount = 0;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => {
        calls.push('storage-ready');
        return { status: 'ready' };
      }),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return recoveryCount >= 2
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        recoveryCount++;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        recoveryCount++;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { provisions: 1, storageSink: 1 },
    });
    expect(calls).toEqual([
      'storage-ready',
      'plan',
      'provisions',
      'storage-ready',
      'plan',
      'storage-pressure',
      'storage-ready',
      'plan',
    ]);
  });

  it('does not invoke Storage Pressure when rating excess has no actual Storage pressure', async () => {
    const calls = [];
    const recoverStorageSink = vi.fn(async () => {
      calls.push('storage-pressure');
      return { status: 'submitted', submitted: true };
    });
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return {
          status: 'unavailable',
          reason: 'no safe Provisions plan',
          reasonCode: 'PROVISIONS_UNAVAILABLE',
        };
      }),
      shouldRunStorageRecovery: vi.fn(async ({ source }) => {
        expect(source).toBe('primary-rating-excess');
        calls.push('pressure-check');
        return {
          run: false,
          reason: 'primary squad rating exceeds target, but current Storage has no pressure to recover',
          reasonCode: 'STORAGE_PRESSURE_NOT_REQUIRED',
        };
      }),
      recoverStorageSink,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      reasonCode: 'STORAGE_PRESSURE_NOT_REQUIRED',
    });
    expect(calls).toEqual(['plan', 'provisions', 'pressure-check']);
    expect(recoverStorageSink).not.toHaveBeenCalled();
  });

  it('uses enabled Provisions recovery for rating excess without Storage pressure', async () => {
    let ready = false;
    let inventoryVersion = 1;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'storage-pressure-only',
      provisionsShortageRecoveryEnabled: true,
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return ready
          ? { ok: true, itemRefs: [{ id: 1 }] }
          : {
              ok: false,
              reasonCode: 'SQUAD_RATING_EXCESS',
              optimizedRating: 86,
              targetRating: 84,
            };
      }),
      shouldRunStorageRecovery: vi.fn(async () => {
        calls.push('pressure-check');
        return { run: false, reasonCode: 'STORAGE_PRESSURE_NOT_REQUIRED' };
      }),
      recoverProvisions: vi.fn(async ({ context }) => {
        calls.push('provisions');
        expect(context.trigger).toBe('primary-fodder-shortage');
        ready = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { provisions: 1, storageSink: 0 },
    });
    expect(calls).toEqual(['plan', 'pressure-check', 'provisions', 'plan']);
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('preserves a Provisions failure when rating excess has no Storage pressure', async () => {
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'storage-pressure-only',
      provisionsShortageRecoveryEnabled: true,
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        reasonCode: 'SQUAD_RATING_EXCESS',
        reason: 'minimum available squad is 86/84',
      })),
      shouldRunStorageRecovery: vi.fn(async () => ({
        run: false,
        reasonCode: 'STORAGE_PRESSURE_NOT_REQUIRED',
      })),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return {
          status: 'unavailable',
          reason: 'no safe low-rated material is available',
          reasonCode: 'PROVISIONS_UNAVAILABLE',
        };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        return { status: 'submitted', submitted: true };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      reason: 'no safe low-rated material is available',
      reasonCode: 'PROVISIONS_UNAVAILABLE',
    });
    expect(calls).toEqual(['provisions']);
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('stops once without replanning when neither rating-excess recovery is available', async () => {
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'storage-pressure-only',
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => {
        calls.push('plan');
        return { ok: false, missing: { code: 'SQUAD_RATING_EXCESS' } };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-pressure');
        return {
          status: 'unavailable',
          reason: 'selected Storage Pressure SBC is unavailable',
          reasonCode: 'STORAGE_SINK_UNAVAILABLE',
        };
      }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return {
          status: 'unavailable',
          reason: 'Provisions capability is unavailable',
          reasonCode: 'PROVISIONS_UNAVAILABLE',
        };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      reason: 'selected Storage Pressure SBC is unavailable',
      reasonCode: 'STORAGE_SINK_UNAVAILABLE',
      recoveries: { storageSink: 0, provisions: 0 },
    });
    expect(calls).toEqual(['plan', 'storage-pressure']);
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('stops when shortage-driven Provisions is blocked before submission', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'PLAYER_COUNT_SHORTAGE' },
      })),
      recoverProvisions: vi.fn(async () => ({
        status: 'blocked',
        reason: 'inventory validation failed',
        reasonCode: 'INVENTORY_VALIDATION_FAILED',
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inventory validation failed',
      reasonCode: 'INVENTORY_VALIDATION_FAILED',
    });
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('submits one Provisions batch immediately when opened duplicate Reserves form a squad', async () => {
    let inventoryVersion = 1;
    let pendingDuplicateBatch = true;
    const options = harness({
      surplusCraftingEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      readRecoveryState: vi.fn(async () => ({
        provisionsBatches: 1,
        duplicateProvisionBatches: pendingDuplicateBatch ? 1 : 0,
      })),
      recoverProvisions: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('duplicate-reserve');
        pendingDuplicateBatch = false;
        inventoryVersion++;
        return { status: 'submitted' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { total: 1, provisions: 1 } });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('does not reinterpret a recovery reward Reserve as a primary-pack duplicate batch', async () => {
    let inventoryVersion = 1;
    let stage = 'primary-reserve';
    const options = harness({
      surplusCraftingEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      readRecoveryState: vi.fn(async () => ({
        duplicateProvisionBatches: stage === 'primary-reserve' || stage === 'recovery-reserve' ? 1 : 0,
      })),
      recoverProvisions: vi.fn(async () => {
        stage = 'pending-reward';
        inventoryVersion++;
        return { status: 'submitted' };
      }),
      processPendingRecoveryReward: vi.fn(async () => {
        if (stage !== 'pending-reward') return { status: 'skipped' };
        stage = 'recovery-reserve';
        inventoryVersion++;
        return { status: 'opened' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { provisions: 1, reward: 1 } });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.readRecoveryState).toHaveBeenCalledTimes(2);
  });

  it('clears Storage pressure before retrying a newly submitted recovery reward', async () => {
    let inventoryVersion = 1;
    let pendingAttempts = 0;
    let pending = true;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      processPendingRecoveryReward: vi.fn(async () => {
        if (!pending) return { status: 'skipped' };
        pendingAttempts++;
        if (pendingAttempts === 1) {
          calls.push('pending-storage-blocked');
          return {
            status: 'blocked',
            reason: 'existing Unassigned cards cannot enter full Storage',
            reasonCode: 'PROTECTED_STORAGE_BLOCKED',
          };
        }
        calls.push('pending-opened');
        pending = false;
        inventoryVersion++;
        return { status: 'opened' };
      }),
      recoverStorageSink: vi.fn(async ({ context }) => {
        calls.push('storage-sink');
        expect(context).toMatchObject({
          trigger: 'storage-pressure',
          source: 'pending-recovery-pre-open',
        });
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { reward: 1, storageSink: 1 },
    });
    expect(calls).toEqual([
      'pending-storage-blocked',
      'storage-sink',
      'pending-opened',
    ]);
    expect(pendingAttempts).toBe(2);
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
  });

  it('keeps a newly submitted recovery reward unopened when Storage pressure recovery is disabled', async () => {
    const options = harness({
      storageSinkEnabled: false,
      processPendingRecoveryReward: vi.fn(async () => ({
        status: 'blocked',
        reason: 'existing Unassigned cards cannot enter full Storage',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverStorageSink: vi.fn(async () => ({ status: 'submitted', submitted: true })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      recoveries: { reward: 0, storageSink: 0 },
    });
    expect(options.processPendingRecoveryReward).toHaveBeenCalledOnce();
    expect(options.recoverStorageSink).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('uses emergency Provisions to free Storage before retrying protected routing', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const options = harness({
      storageRecoveryPriority: 'provisions-only',
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('storage-pressure');
        storageReady = true;
        inventoryVersion++;
        return { status: 'submitted' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { provisions: 1 } });
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
  });

  it('continues Storage routing after Provisions consumes an already-stored Reserve', async () => {
    const reserve = { id: 101, definitionId: 1001, pile: 'storage' };
    const deferredHigh = { id: 102, definitionId: 1002, pile: 'unassigned' };
    let routing = {
      status: 'blocked',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      storageItems: [reserve, deferredHigh],
      pendingItems: [deferredHigh],
      entries: [
        { item: reserve, classification: { provisionsReserve: true } },
        { item: deferredHigh, classification: { provisionsReserve: false } },
      ],
    };
    let inventoryVersion = 1;
    let storageFree = 0;
    const options = harness({
      storageRecoveryPriority: 'provisions-only',
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => {
        if (routing.pendingItems.length > storageFree) {
          return { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' };
        }
        routing = { ...routing, status: 'ready', reasonCode: null, pendingItems: [] };
        return { status: 'ready' };
      }),
      recoverProvisions: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('storage-pressure');
        routing = releaseRollingRoutingItemsAfterConsumption(routing, [reserve]).routing;
        storageFree += 4;
        inventoryVersion++;
        return { status: 'submitted', consumedItemRefs: [reserve] };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { provisions: 1 } });
    expect(routing.storageItems).toEqual([deferredHigh]);
    expect(routing.pendingItems).toEqual([]);
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
  });

  it('does not reinterpret an opened-item materialization failure as Storage pressure', async () => {
    const options = harness({
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: '10 opened duplicate item(s) did not materialize in Unassigned',
        reasonCode: 'OPENED_DUPLICATE_NOT_MATERIALIZED',
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'submitted' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'OPENED_DUPLICATE_NOT_MATERIALIZED',
    });
    expect(options.recoverProvisions).not.toHaveBeenCalled();
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('uses the Storage sink after emergency Provisions is unavailable', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const options = harness({
      storageSinkEnabled: true,
      storageRecoveryPriority: 'provisions-then-storage-pressure',
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'not enough eligible Provisions material',
      })),
      recoverStorageSink: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('storage-pressure');
        expect(context.provisions.status).toBe('unavailable');
        storageReady = true;
        inventoryVersion++;
        return { status: 'selected' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { storageSink: 1 } });
    expect(options.recoverProvisions).toHaveBeenCalledOnce();
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
  });

  it('skips Provisions and uses an explicitly enabled Storage sink when shortage recovery is off', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const recoverProvisions = vi.fn(async () => ({ status: 'submitted' }));
    const options = harness({
      provisionsShortageRecoveryEnabled: false,
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions,
      recoverStorageSink: vi.fn(async ({ context }) => {
        expect(context.trigger).toBe('storage-pressure');
        storageReady = true;
        inventoryVersion++;
        return { status: 'selected' };
      }),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'completed',
      recoveries: { provisions: 0, storageSink: 1 },
    });
    expect(recoverProvisions).not.toHaveBeenCalled();
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
  });

  it('does not auto-craft a Storage sink Required Special when its permission is off', async () => {
    const recoverRequiredSpecial = vi.fn(async () => ({ status: 'submitted' }));
    const options = harness({
      requiredSpecialRecoveryEnabled: false,
      storageSinkEnabled: true,
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => ({
        status: 'unavailable',
        reasonCode: 'REQUIRED_SPECIAL_SHORTAGE',
      })),
      recoverRequiredSpecial,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'Required Special/TOTW recovery is disabled in Settings',
      reasonCode: 'REQUIRED_SPECIAL_RECOVERY_DISABLED',
    });
    expect(recoverRequiredSpecial).not.toHaveBeenCalled();
  });

  it('recovers a Required Special dependency before retrying a blocked Storage sink', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    let specialReady = false;
    const calls = [];
    const options = harness({
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async () => {
        calls.push('provisions');
        return { status: 'unavailable' };
      }),
      recoverStorageSink: vi.fn(async () => {
        calls.push('storage-sink');
        return specialReady
          ? { status: 'selected' }
          : {
              status: 'unavailable',
              reason: 'Storage sink Required Special has only 0/1 safe candidates',
              reasonCode: 'REQUIRED_SPECIAL_SHORTAGE',
            };
      }),
      recoverRequiredSpecial: vi.fn(async ({ context }) => {
        calls.push('required-special');
        expect(context).toMatchObject({
          trigger: 'storage-sink-required-special-shortage',
          source: 'storage-sink-dependency',
        });
        specialReady = true;
        storageReady = true;
        inventoryVersion++;
        return { status: 'submitted', submitted: true };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      recoveries: { storageSink: 0, requiredSpecial: 1 },
    });
    expect(calls).toEqual(['storage-sink', 'required-special']);
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
  });

  it('reports an unavailable Storage sink Required Special dependency explicitly', async () => {
    const options = harness({
      storageSinkEnabled: true,
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'Storage sink Required Special has only 0/1 safe candidates',
        reasonCode: 'REQUIRED_SPECIAL_SHORTAGE',
      })),
      recoverRequiredSpecial: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'dynamic 84+ TOTW Upgrade capability is unavailable',
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'unavailable',
      reason: 'dynamic 84+ TOTW Upgrade capability is unavailable',
      reasonCode: 'REQUIRED_SPECIAL_RECOVERY_BLOCKED',
    });
    expect(options.recoverRequiredSpecial).toHaveBeenCalledOnce();
  });

  it('continues after the 89 Storage Sink squad is submitted and defers the 88 squad', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const options = harness({
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => {
        storageReady = true;
        inventoryVersion++;
        return {
          status: 'submitted',
          submitted: true,
          reasonCode: 'STORAGE_SINK_88_DEFERRED',
          details: { submittedRatings: [89], remainingRatings: [88] },
        };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({ status: 'completed', recoveries: { storageSink: 1 } });
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
    expect(options.resolveProtectedStorage).toHaveBeenCalledTimes(2);
  });

  it('continues after a submitted Storage Sink Pick has no observable Pick reward', async () => {
    let inventoryVersion = 1;
    let storageReady = false;
    const options = harness({
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      resolveProtectedStorage: vi.fn(async () => storageReady
        ? { status: 'ready' }
        : { status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' }),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => {
        storageReady = true;
        inventoryVersion++;
        return {
          status: 'submitted',
          submitted: true,
          reason: 'Storage Sink challenge submitted; Player Pick reward was not observed',
          reasonCode: 'STORAGE_SINK_REWARD_NOT_FOUND_SKIPPED',
          details: { rewardMissing: true },
        };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'completed',
      completions: 1,
      recoveries: { storageSink: 1 },
    });
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
    expect(options.planPrimarySquad).toHaveBeenCalled();
  });

  it('keeps the Storage sink disabled by default and preserves the Storage block', async () => {
    const recoverStorageSink = vi.fn(async () => ({ status: 'selected' }));
    const options = harness({
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: 'Storage still full',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink,
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: 'Storage still full',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      recoveries: { storageSink: 0 },
    });
    expect(recoverStorageSink).not.toHaveBeenCalled();
  });

  it('preserves the specific Storage Sink failure when both Storage recoveries are unavailable', async () => {
    const options = harness({
      storageSinkEnabled: true,
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: 'Storage still full',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'both squads require more than three Club cards',
        reasonCode: 'STORAGE_SINK_SOURCE_PRIORITY_UNSATISFIED',
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'both squads require more than three Club cards',
      reasonCode: 'STORAGE_SINK_SOURCE_PRIORITY_UNSATISFIED',
      recoveries: { storageSink: 0 },
    });
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('stops for a new Storage Sink selection instead of falling back to Provisions', async () => {
    const recoverProvisions = vi.fn(async () => ({
      status: 'submitted',
      submitted: true,
    }));
    const options = harness({
      storageSinkEnabled: true,
      resolveProtectedStorage: vi.fn(async () => ({
        status: 'blocked',
        reason: 'SBC storage has 0 free slots, but 2 protected cards require storage',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      })),
      recoverProvisions,
      recoverStorageSink: vi.fn(async () => ({
        status: 'blocked',
        reason: '1 of 4 95+ Player Pick is exhausted; choose another Storage pressure SBC in Settings',
        reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
        details: {
          completedCount: 2,
          totalChallengeCount: 2,
          selectedSetId: 1378,
          previousReasonCode: 'STORAGE_SINK_COMPLETED',
        },
      })),
    });

    expect(await runRollingUpgradeWorkflow(options)).toMatchObject({
      status: 'blocked',
      reason: '1 of 4 95+ Player Pick is exhausted; choose another Storage pressure SBC in Settings',
      reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
      details: {
        completedCount: 2,
        totalChallengeCount: 2,
        selectedSetId: 1378,
        previousReasonCode: 'STORAGE_SINK_COMPLETED',
      },
      recoveries: { storageSink: 0 },
    });
    expect(options.recoverStorageSink).toHaveBeenCalledOnce();
    expect(recoverProvisions).not.toHaveBeenCalled();
    expect(options.planPrimarySquad).not.toHaveBeenCalled();
  });

  it('does not call the Storage sink on the normal path or after a hard Provisions failure', async () => {
    const normal = harness({ recoverStorageSink: vi.fn() });
    expect((await runRollingUpgradeWorkflow(normal)).status).toBe('completed');
    expect(normal.recoverStorageSink).not.toHaveBeenCalled();

    const blocked = harness({
      storageRecoveryPriority: 'provisions-only',
      resolveProtectedStorage: vi.fn(async () => ({ status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' })),
      recoverProvisions: vi.fn(async () => ({ status: 'blocked', reason: 'EA submit failed' })),
      recoverStorageSink: vi.fn(),
    });
    expect(await runRollingUpgradeWorkflow(blocked)).toMatchObject({
      status: 'blocked',
      reason: 'EA submit failed',
    });
    expect(blocked.recoverStorageSink).not.toHaveBeenCalled();
  });

  it('enforces Storage sink progress fingerprints and budgets', async () => {
    const noProgress = harness({
      storageSinkEnabled: true,
      getProgressFingerprint: vi.fn(async () => 'inventory:1'),
      resolveProtectedStorage: vi.fn(async () => ({ status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => ({ status: 'selected' })),
    });
    expect(await runRollingUpgradeWorkflow(noProgress)).toMatchObject({
      status: 'blocked',
      reasonCode: 'RECOVERY_NO_PROGRESS',
      recoveries: { storageSink: 0 },
    });

    let version = 0;
    const budgeted = harness({
      storageSinkEnabled: true,
      recoveryBudgets: { storageSink: 1 },
      getProgressFingerprint: vi.fn(async () => `inventory:${version}`),
      resolveProtectedStorage: vi.fn(async () => ({ status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' })),
      recoverProvisions: vi.fn(async () => ({ status: 'unavailable' })),
      recoverStorageSink: vi.fn(async () => {
        version++;
        return { status: 'selected' };
      }),
    });
    expect(await runRollingUpgradeWorkflow(budgeted)).toMatchObject({
      status: 'blocked',
      reasonCode: 'RECOVERY_BUDGET_REACHED',
      recoveries: { storageSink: 1 },
    });
    expect(budgeted.recoverStorageSink).toHaveBeenCalledOnce();
  });

  it('blocks a recovery that reports progress without changing its fingerprint', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => 'inventory:1'),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' },
      })),
      recoverRequiredSpecial: vi.fn(async () => ({ status: 'progressed' })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'RECOVERY_NO_PROGRESS',
      recoveries: { total: 0 },
    });
  });

  it('enforces per-primary recovery budgets', async () => {
    let inventoryVersion = 1;
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      recoveryBudgets: { requiredSpecial: 1 },
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' },
      })),
      recoverRequiredSpecial: vi.fn(async () => {
        inventoryVersion++;
        return { status: 'progressed' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'RECOVERY_BUDGET_REACHED',
      recoveries: { total: 1, requiredSpecial: 1 },
    });
    expect(options.recoverRequiredSpecial).toHaveBeenCalledOnce();
  });

  it('lets a recovery adapter publish a more specific bounded phase', async () => {
    let inventoryVersion = 1;
    let drained = false;
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      getProgressFingerprint: vi.fn(async () => inventoryVersion),
      drainRecoveryDuplicates: vi.fn(async ({ reportPhase }) => {
        if (drained) return { status: 'skipped' };
        drained = true;
        await reportPhase(ROLLING_UPGRADE_PHASES.REDEEM_RARE_GOLD_PICK);
        inventoryVersion++;
        return { status: 'selected' };
      }),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result.status).toBe('completed');
    expect(options.onEvent).toHaveBeenCalledWith('phase', expect.objectContaining({
      phase: ROLLING_UPGRADE_PHASES.REDEEM_RARE_GOLD_PICK,
      recovery: 'goldDrain',
    }));
    expect(options.planPrimarySquad).toHaveBeenCalledOnce();
    expect(options.submitPrimary).toHaveBeenCalledOnce();
  });

  it('reports an unavailable Required Special capability without submitting the primary SBC', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'REQUIRED_SPECIAL_SHORTAGE' },
      })),
      recoverRequiredSpecial: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'dynamic 84+ TOTW Upgrade capability is unavailable',
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'unavailable',
      reasonCode: 'REQUIRED_SPECIAL_RECOVERY_BLOCKED',
      reason: 'dynamic 84+ TOTW Upgrade capability is unavailable',
    });
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });

  it('stops Dry Run at the first unknown Provisions reward boundary', async () => {
    const options = harness({
      findPrimaryPack: vi.fn(async () => null),
      planPrimarySquad: vi.fn(async () => ({
        ok: false,
        missing: { code: 'PLAYER_COUNT_SHORTAGE' },
      })),
      recoverProvisions: vi.fn(async () => ({
        status: 'planned',
        reason: 'dry-run Provisions squad plan complete',
      })),
    });

    const result = await runRollingUpgradeWorkflow(options);

    expect(result).toMatchObject({
      status: 'planned',
      phase: ROLLING_UPGRADE_PHASES.RECOVER_PROVISIONS,
      completions: 0,
    });
    expect(options.submitPrimary).not.toHaveBeenCalled();
  });
});
