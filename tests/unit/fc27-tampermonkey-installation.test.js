import { describe, expect, it, vi } from 'vitest';
import { confirmVerifiedInstaller } from '../../scripts/browser-inspection/tampermonkey-installation.mjs';

const source = live => `// ==UserScript==\n// @name FC Automation Tool\n// ==/UserScript==\nconst options = { liveEnabled: ${live} };`;
function installerFor(installedSource) {
  let closed = false;
  const click = vi.fn(async () => { closed = true; });
  const editor = { count: async () => 1, first: () => editor, waitFor: async () => {},
    evaluateAll: async () => [installedSource] };
  return { click, waitForLoadState: vi.fn(async () => {}), locator: () => editor,
    getByRole: () => ({ count: async () => 1, click }), isClosed: () => closed };
}

describe('verified userscript installation', () => {
  it.each([true, false])('installs the exact approved source with liveEnabled %s', async live => {
    const script = source(live), installer = installerFor(script);
    await confirmVerifiedInstaller(installer, { source: script });
    expect(installer.click).toHaveBeenCalledTimes(1);
  });
  it('rejects an installer displaying a different execution mode before clicking', async () => {
    const installer = installerFor(source(true));
    await expect(confirmVerifiedInstaller(installer, { source: source(false) })).rejects.toThrow('INSTALLER_SOURCE_MISMATCH');
    expect(installer.click).not.toHaveBeenCalled();
  });
  it('rejects source without a userscript header or build-bound execution mode', async () => {
    for (const script of ['const options = { liveEnabled: true };', '// ==UserScript==\nconst options = {};']) {
      const installer = installerFor(script);
      await expect(confirmVerifiedInstaller(installer, { source: script })).rejects.toThrow('INSTALLATION_SOURCE_UNSAFE');
      expect(installer.waitForLoadState).not.toHaveBeenCalled();
      expect(installer.click).not.toHaveBeenCalled();
    }
  });
});
