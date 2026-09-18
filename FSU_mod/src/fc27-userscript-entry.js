import { installFc27Fsu } from './fc27-bootstrap.js';
import { checkFsuInstallation } from './installation.js';

function request(url) {
  return new Promise(resolve => {
    let handle;
    let finished = false;
    const finish = response => { if (!finished) { finished = true; clearTimeout(timer); resolve(response); } };
    const timer = setTimeout(() => { finish({ status: 0 }); try { handle?.abort(); } catch { /* Own request only. */ } }, 16000);
    try {
      handle = GM_xmlhttpRequest({ method: 'GET', url, anonymous: true, timeout: 15000,
        headers: { Accept: 'application/json' },
        onload: response => {
          // Do not treat a redirected login/challenge response as a quote.
          if (response.finalUrl && response.finalUrl !== url) return finish({ status: 0 });
          finish({ status: response.status, responseText: response.responseText });
        },
        onerror: () => finish({ status: 0 }), ontimeout: () => finish({ status: 0 }), onabort: () => finish({ status: 0 }),
      });
    } catch { finish({ status: 0 }); }
  });
}

let attempts = 0;
function start() {
  const season = Object.getOwnPropertyDescriptor(unsafeWindow, 'APP_YEAR_SHORT')?.value;
  if (season === undefined && attempts++ < 120) { setTimeout(start, 1000); return; }
  if (![27, '27'].includes(season)) return;
  try { installFc27Fsu({ root: unsafeWindow, document, get: GM_getValue, set: GM_setValue, request,
    inspectInstallation: () => checkFsuInstallation({ get: GM_getValue, set: GM_setValue, info: GM_info,
      version: __FSU_PREVIEW_VERSION__, bootId: crypto.randomUUID().replaceAll('-', '') }),
  }); }
  catch { console.warn('[FSU FC27] Initialization blocked; legacy/duplicate instance or unavailable runtime.'); }
}
start();
