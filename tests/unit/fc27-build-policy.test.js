import { expect, it } from 'vitest';
import { assertFc27BrowserInputs, assertFc27ProductionMetadata } from '../../scripts/fc27-build-policy.mjs';

it('accepts new browser modules without a per-file build allowlist', () => {
  expect(() => assertFc27BrowserInputs(['src/fc27/production-entry.js', 'src/fc27/new-feature.js',
    'src/trade/new-plan.js', 'src/config/new-settings.js', 'src/adapters/ea/new-feature.js'])).not.toThrow();
});

it.each(['scripts/inspect.mjs', 'tests/unit/mock.js', 'FSU_mod/bundle.js', '../secret.js',
  'src/../secret.js', 'src/userscript-entry.js', 'node:fs'])('keeps non-browser sources out: %s', file => {
  expect(() => assertFc27BrowserInputs(['src/fc27/production-entry.js', file])).toThrow('FC27_BROWSER_DEPENDENCY_INVALID');
});

it('permits explicit production network features without a blanket @connect ban', () => {
  expect(() => assertFc27ProductionMetadata('// @grant unsafeWindow\n')).not.toThrow();
  expect(() => assertFc27ProductionMetadata('// @grant GM_xmlhttpRequest\n// @connect api.example.com\n')).not.toThrow();
});

it.each(['*', '*.example.com', 'localhost', '127.0.0.1', 'https://example.com', 'private.local'])
('rejects broad or local production network permissions: %s', host => {
  expect(() => assertFc27ProductionMetadata(`// @grant GM_xmlhttpRequest\n// @connect ${host}\n`))
    .toThrow('FC27_NETWORK_PERMISSION_INVALID');
});

it('requires the network API grant when a connect host is declared', () => {
  expect(() => assertFc27ProductionMetadata('// @connect api.example.com\n')).toThrow('FC27_NETWORK_GRANT_MISSING');
});
