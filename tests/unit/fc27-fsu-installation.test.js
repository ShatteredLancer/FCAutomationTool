import { expect, it, vi } from 'vitest';
import { checkFsuInstallation } from '../../FSU_mod/src/installation.js';
import observed from '../fixtures/fc27-fsu-installation-observation.json';

const info = { scriptHandler: 'Tampermonkey', version: '5.5.0', script: {
  name: '\u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668', namespace: 'https://futcd.com/', version: '26.09.6.27.2',
} };
function fixture() {
  const stored = new Map([['build', 'untouched'], ['set', 'untouched'], ['lock_26', 'untouched']]);
  const get = vi.fn((key, fallback) => stored.has(key) ? stored.get(key) : fallback);
  const set = vi.fn((key, value) => stored.set(key, value));
  return { stored, args: { get, set, info, version: info.script.version, bootId: 'a'.repeat(32) } };
}
it('checks only its owned GM key and confirms a distinct later page load', () => {
  const { stored, args } = fixture();
  expect(checkFsuInstallation(args)).toMatchObject({ manager: 'Tampermonkey', gmWriteRead: true, previousLoad: false });
  const second = checkFsuInstallation({ ...args, bootId: 'b'.repeat(32) });
  expect(second).toEqual(observed.installation);
  expect(second).toMatchObject({ gmWriteRead: true, previousLoad: true, scriptVersion: info.script.version });
  expect(stored.get('build')).toBe('untouched');
  expect(stored.get('set')).toBe('untouched');
  expect(stored.get('lock_26')).toBe('untouched');
  expect(new Set(args.set.mock.calls.map(([key]) => key))).toEqual(new Set(['fsu_fc27_preview_installation_v1']));
  expect(JSON.stringify(second)).not.toContain('bbbb');
});
it('does not claim reload persistence from the same boot or a different preview version', () => {
  const { args } = fixture();
  checkFsuInstallation(args);
  expect(checkFsuInstallation(args).previousLoad).toBe(false);
  const version = '26.09.6.27.3';
  expect(checkFsuInstallation({ ...args, version, info: { ...info, script: { ...info.script, version } }, bootId: 'c'.repeat(32) })
    .previousLoad).toBe(false);
});
it('does not write when the manager or exact script identity is unverified', () => {
  const { args } = fixture();
  for (const changed of [null, {}, { ...info, scriptHandler: 'other' }, { ...info, script: { ...info.script, namespace: 'other' } },
    { ...info, script: { ...info.script, version: '26.09.6' } }]) {
    expect(checkFsuInstallation({ ...args, info: changed }).gmWriteRead).toBe(false);
  }
  expect(args.set).not.toHaveBeenCalled();
});
it('preserves an unexpected existing diagnostic value and tolerates GM failure without throwing', () => {
  const { stored, args } = fixture();
  stored.set('fsu_fc27_preview_installation_v1', { unexpected: true });
  expect(checkFsuInstallation(args)).toMatchObject({ reason: 'FSU_INSTALLATION_RECORD_INVALID', gmWriteRead: false });
  expect(args.set).not.toHaveBeenCalled();
  expect(checkFsuInstallation({ ...args, get: () => { throw new Error('secret'); } }).reason).toBe('FSU_INSTALLATION_CHECK_FAILED');
  expect(checkFsuInstallation({ ...args, get: async () => null }).gmWriteRead).toBe(false);
});
it('requires matching write readback and keeps the record bounded', () => {
  const { stored, args } = fixture();
  expect(checkFsuInstallation({ ...args, set: () => {} }).gmWriteRead).toBe(false);
  for (let index = 0; index < 5; index++) checkFsuInstallation({ ...args, bootId: String(index).repeat(32) });
  expect(JSON.stringify(stored.get('fsu_fc27_preview_installation_v1')).length).toBeLessThan(200);
});
