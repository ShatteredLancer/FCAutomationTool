import { createNativeRunnerSupport } from './runner-support/native-provider.js';
import { installRunnerSupportBridge } from './runner-support/core.js';
import { createFsuSettingsStore } from './runner-support/settings.js';
import { createFc27Prices } from './enhancements/prices.js';
import { prepareTraditionalPreview } from './enhancements/traditional-fill.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { listFc27InProgressChallenges, readFc27TraditionalChallenge } from '../../src/adapters/ea/fc27-traditional-read.js';
import { contextKey, ownData } from '../../src/fc27/prelaunch-contract.js';
import { mountFc27FsuPanel } from './fc27-panel.js';

export function installFc27Fsu({ root, document, get, set, request, inspectInstallation, mount = mountFc27FsuPanel }) {
  if (![27, '27'].includes(ownData(root, 'APP_YEAR_SHORT'))) throw new Error('FSU_UNSUPPORTED_SEASON');
  if (ownData(root, 'info') || ownData(root, 'events') || document.getElementById('fsu-fc27-local')) {
    throw new Error('FSU_LEGACY_OR_DUPLICATE_INSTANCE');
  }
  const readContext = () => readFc27Context(root);
  const native = createNativeRunnerSupport({ root, gmGetValue: get });
  const settings = createFsuSettingsStore({ readContext, get, set });
  const prices = createFc27Prices({ request });
  let installation = null;
  const bridge = Object.freeze({ ...native.bridge,
    describe: () => Object.freeze({ ...native.bridge.describe(), installation }),
  });
  const removeBridge = installRunnerSupportBridge(root, bridge);
  try { installation = inspectInstallation?.() ?? null; } catch { /* Diagnostics cannot gate the bridge. */ }
  let removePanel;
  try {
    removePanel = mount({ document, actions: {
      readContext, getPolicy: native.bridge.getPolicy, getLocks: native.bridge.getLocks,
      savePolicy: settings.savePolicy, setItemLock: settings.setItemLock,
      readClub: native.readFreshClub,
      prices: async (context, ids) => {
        const signature = contextKey(context, 'scope');
        if (contextKey(readContext(), 'scope') !== signature) throw new Error('FSU_SCOPE_CHANGED');
        const result = await prices.load(ids, context.platform);
        if (contextKey(readContext(), 'scope') !== signature) throw new Error('FSU_SCOPE_CHANGED');
        return result;
      },
      targets: () => listFc27InProgressChallenges(root),
      preview: target => prepareTraditionalPreview({ readContext, bridge: native.bridge, getSnapshot: native.getFreshClub,
        readChallenge: () => readFc27TraditionalChallenge(root, target) }),
    } });
  } catch (error) { removeBridge(); throw error; }
  return () => { removePanel(); removeBridge(); };
}
