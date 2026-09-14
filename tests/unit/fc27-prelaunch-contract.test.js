import { describe, expect, it, vi } from 'vitest';
import {
  createRunnerBridgeDescriptor,
  createSeasonContext,
  contextKey,
  projectInspectionReport,
} from '../../src/fc27/prelaunch-contract.js';

describe('FC27 prelaunch contracts', () => {
  it('requires an explicit season/account/platform context', () => {
    expect(createSeasonContext({ season: '27', accountScope: 'account-a', platform: 'pc' }))
      .toEqual({ schema: 1, season: '27', accountScope: 'account-a', platform: 'pc' });
    expect(() => createSeasonContext({ season: '26', platform: 'pc' })).toThrow(/accountScope/);
    expect(() => createSeasonContext({ season: '2027', accountScope: 'a', platform: 'pc' }))
      .toThrow(/two-digit/);
  });

  it('does not claim bridge readiness when capabilities are absent', () => {
    expect(createRunnerBridgeDescriptor({ season: '27', accountScope: 'a', platform: 'pc' }))
      .toMatchObject({ bridgeSchema: 1, status: 'not-ready', capabilities: {
        policy: false, locks: false, club: false, targetedValidation: false,
      } });
  });

  it.each([false, {}, 'default', 'unknown', '', ' a '])('rejects ambiguous account scope %j', (accountScope) => {
    expect(() => createSeasonContext({ season: '27', accountScope, platform: 'pc' })).toThrow();
  });

  it('uses unambiguous keys and separates seasons, accounts, platforms and schemas', () => {
    const a = { season: '27', accountScope: 'a:b', platform: 'pc' };
    expect(contextKey(a, 'preferences')).not.toBe(contextKey({ ...a, season: '26' }, 'preferences'));
    expect(contextKey(a, 'preferences')).not.toBe(contextKey({ ...a, platform: 'ps' }, 'preferences'));
    expect(contextKey(a, 'preferences')).not.toBe(contextKey({ ...a, accountScope: 'b' }, 'preferences'));
    expect(contextKey(a, 'preferences', 1)).not.toBe(contextKey(a, 'preferences', 2));
  });

  it('rejects false readiness and non-boolean capabilities', () => {
    const context = { season: '27', accountScope: 'a', platform: 'pc' };
    expect(() => createRunnerBridgeDescriptor({ ...context, status: 'ready' })).toThrow();
    expect(() => createRunnerBridgeDescriptor({ ...context, capabilities: { policy: 'false' } })).toThrow();
  });

  it('projects only fixed fields, never invokes getters or exports identity/free text', () => {
    const getter = vi.fn(() => { throw new Error('must not execute'); });
    const record = { season: '27', accountScope: 'secret', token: 'secret', status: 'secret', pageKind: 'web-app' };
    Object.defineProperty(record, 'observed', { get: getter });
    expect(projectInspectionReport(record)).toMatchObject({ schema: 1, season: '27', pageKind: 'web-app' });
    expect(JSON.stringify(projectInspectionReport(record))).not.toContain('secret');
    expect(getter).not.toHaveBeenCalled();
  });
});
