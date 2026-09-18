import { buildFsuCore } from '../build-fc27-fsu-core.mjs';
import { pageKind } from './probe.mjs';

export async function inspectNativeProvider(page, { fresh = false } = {}) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const { source } = await buildFsuCore();
  // Source comes only from the reviewed build allowlist, never stdin or the EA page.
  // The IIFE does not install a page global or expose GM APIs.
  const method = fresh ? 'inspectFreshNativeClub' : 'inspectNativeRunnerSupport';
  return page.evaluate(`(() => { ${source}\nreturn FSURunnerSupportCore.${method}(globalThis); })()`);
}
