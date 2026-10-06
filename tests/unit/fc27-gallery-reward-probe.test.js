import { expect, it, vi } from 'vitest';
import { inspectGalleryRewardCapabilities } from '../../scripts/browser-inspection/gallery-reward-probe.mjs';

it('discovers capabilities without invoking getters, methods or exporting account/reward payloads', () => {
  const invoked = vi.fn(() => { throw Error('must not invoke'); });
  const root = { services: { Gallery: { requestProgress: invoked, claimReward: invoked, token: 'secret' } },
    repositories: { EventToken: { account: 'private', definitions: [123] } },
    privateAccount: 'private', UTGalleryController: class { redeem() { invoked(); } } };
  Object.defineProperty(root.services, 'Collection', { get: invoked });
  Object.defineProperty(root, 'Gallery', { get: invoked });
  const result = inspectGalleryRewardCapabilities(root);
  expect(result).toMatchObject({ mode: 'descriptors-only', claimState: 'unverified', liveExecutionEnabled: false });
  expect(result.capabilities).toContainEqual({ path: 'services.Gallery', kind: 'object', methods: [
    { name: 'requestProgress', kind: 'function' }, { name: 'claimReward', kind: 'function' }] });
  expect(result.capabilities).toContainEqual({ path: 'Gallery', kind: 'accessor', methods: [] });
  expect(invoked).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/secret|private|123/);
});

it('bounds output and keeps presence distinct from claim eligibility', () => {
  const root = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`UTGallery${i}`, {}]));
  expect(inspectGalleryRewardCapabilities(root).capabilities).toHaveLength(64);
  expect(inspectGalleryRewardCapabilities({})).toMatchObject({ capabilities: [], rewardSemantics: 'unverified' });
});

it('prioritizes Gallery over unrelated rewards and explicitly reports a capped discovery', () => {
  const root = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`UTReward${i}`, {}]));
  root.UTGalleryService = { requestGrades() {} };
  root.HTMLCollection = class {};
  const result = inspectGalleryRewardCapabilities(root);
  expect(result.capped).toBe(true);
  expect(result.capabilities[0].path).toBe('UTGalleryService');
  expect(result.capabilities.some(value => value.path === 'HTMLCollection')).toBe(false);
});
