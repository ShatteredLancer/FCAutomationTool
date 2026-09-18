import { expect, it, vi } from 'vitest';
import { previewInstallerMatches, runFsuSetupAction, loadLocalFsuBaseline } from '../../scripts/browser-inspection/fsu-setup-actions.mjs';
import { fileURLToPath } from 'node:url';
import observedBaseline from '../fixtures/fc27-fsu-local-baseline-observation.json';
import fsuConfig from '../../FSU_mod/fsu-mod.config.json';
const input = { url: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/ask.html',
  installUrl: 'http://127.0.0.1:54321/FSU-FC27-Preview.user.js', version: '26.09.6.27.2' };
input.text = `${input.installUrl}\n// @name         \u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668\n// @namespace    https://futcd.com/\n// @version      ${input.version}\n`;
it('only confirms the exact local preview identity in the official installer', () => {
  expect(previewInstallerMatches(input)).toBe(true);
  for (const changed of [{ url: 'https://example.com/ask.html' }, { version: '26.09.6.27.3' }, { text: 'Install anything' },
    { installUrl: 'http://127.0.0.1:54322/FSU-FC27-Preview.user.js' }, { installUrl: 'http://example.com/script.user.js' },
    { url: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html' }]) {
    expect(previewInstallerMatches({ ...input, ...changed })).toBe(false);
  }
});
it('loads the existing mod byte-for-byte against its manifest and checks the baseline installer identity', async () => {
  const artifact = await loadLocalFsuBaseline(fileURLToPath(new URL('../..', import.meta.url)));
  expect(artifact.version).toBe(fsuConfig.localVersion);
  expect(artifact.source).toContain('function futweb()');
  expect(artifact.source).not.toContain('FSU FC27 Local Preview');
  const installUrl = 'http://127.0.0.1:54321/FSU-Local.user.js';
  expect(previewInstallerMatches({ ...input, version: artifact.version, userFile: artifact.userFile, installUrl,
    text: `${installUrl}\n${artifact.source.slice(0, 500)}` })).toBe(true);
  expect(previewInstallerMatches({ ...input, userFile: artifact.userFile })).toBe(false);
});
it('does not treat a local artifact version as verified browser installation evidence', () => {
  expect(observedBaseline.scriptVersion).toBeNull();
  expect(observedBaseline.provenance.installedVersionVerified).toBe(false);
  expect(observedBaseline.runtime.clubReady).toBe(true);
  expect(observedBaseline.fillExecuted).toBe(false);
  expect(observedBaseline.priceSuccessVerified).toBe(false);
  expect(observedBaseline.submissionExecuted).toBe(false);
});
it('rejects absent or ambiguous installers without clicking', async () => {
  const click = vi.fn();
  const page = { url: () => input.url, getByRole: () => ({ click }) };
  for (const pages of [[], [page, page]]) {
    await expect(runFsuSetupAction({ context: { pages: () => pages }, command: 'confirm-install', ...input }))
      .rejects.toThrow('FSU_INSTALLER_AMBIGUOUS');
  }
  expect(click).not.toHaveBeenCalled();
});
it('has no command for account, protection policy or arbitrary browser writes', async () => {
  const pages = vi.fn();
  for (const command of ['save-policy', 'lock', 'submit', 'fill', 'eval', 'startup-init', 'close-login-notice', 'home-cycle']) {
    expect(await runFsuSetupAction({ context: { pages }, command })).toEqual({ unsupported: true });
  }
  expect(pages).not.toHaveBeenCalled();
});
it('reads the existing runtime and bounded UI without installing or changing settings', async () => {
  const snapshot = { schema: 1, liveExecutionEnabled: false };
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async () => snapshot),
    locator: () => ({ count: async () => 0, evaluateAll: async () => [] }) };
  const result = await runFsuSetupAction({ context: { pages: () => [page] }, command: 'runtime' });
  expect(result.runtime).toEqual(snapshot);
  expect(result.ui).toMatchObject({ home: false, login: false, modal: false });
  expect(page.evaluate).toHaveBeenCalledOnce();
});

it.each(['runner', 'runner-support', 'runner-settings', 'runner-validate', 'runner-catalog 4', 'runner-preview 4', 'runner-preview 6 83'])('builds the current bounded diagnostic for %s without installing scripts', async command => {
  const snapshot = { status: 'blocked', reason: 'TEST_NO_EA', liveExecutionEnabled: false };
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', evaluate: vi.fn(async () => snapshot) };
  expect(await runFsuSetupAction({ context: { pages: () => [page] }, command })).toEqual(snapshot);
  expect(page.evaluate).toHaveBeenCalledOnce();
  expect(page.evaluate.mock.calls[0][0]).toContain('FC27RunnerReadOnly');
  if (command.endsWith(' 83')) expect(page.evaluate.mock.calls[0][0]).toContain('maxRating: 83');
});
