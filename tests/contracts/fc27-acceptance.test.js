import { expect, it } from 'vitest';
import { buildFc27Acceptance } from '../../scripts/build-fc27-acceptance.mjs';

it('builds an isolated GM acceptance installation without enabling Live or changing production identity', async () => {
  const result = await buildFc27Acceptance();
  expect(result.manifest).toMatchObject({ releaseEligible: false, liveExecutionEnabled: false });
  expect(result.script).toContain('// @name         FC Automation Tool Acceptance');
  expect(result.script).toContain('// @grant        GM_getValue');
  expect(result.script).toContain('// @grant        GM_setValue');
  expect(result.script).toContain('liveEnabled: false');
  expect(result.script).not.toMatch(/@(?:updateURL|downloadURL|connect)|GM_xmlhttpRequest|localStorage/);
  expect(result.manifest.inputs).toContain('src/adapters/ea/fc27-traditional-provider.js');
  expect(result.manifest.inputs).toContain('src/fc27/traditional-transaction.js');
  expect(result.manifest.inputs.some(name => /src\/userscript-entry|rolling|trade\/|FSU_mod/.test(name))).toBe(false);
  expect(result.manifest.bytes).toBeLessThan(150000);
});
