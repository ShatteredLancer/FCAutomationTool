// ==UserScript==
// @name         FC26 Daily Loop Runner - Hot Reload
// @namespace    https://github.com/ShatteredLancer/DailyLoopRunner/dev
// @version      0.1.2
// @description  Reloads the local Daily Loop Runner userscript without refreshing the Web App page.
// @license      MIT
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.easports.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// @connect      ntfy.sh
// @connect      www.fut.gg
// @connect      enhancer-api.futnext.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_URL = 'http://127.0.0.1:8765/FCAutomationTool.user.js';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  function log(message) {
    console.log(`[LoopHotReload] ${message}`);
    const status = document.querySelector('#loop-hot-reload-status');
    if (status) status.textContent = message;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        nocache: true,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error('request failed')),
        ontimeout: () => reject(new Error('request timed out')),
        timeout: 10000,
      });
    });
  }

  W.__FCLoopRunnerRequestText = requestText;
  async function reloadLoopRunner() {
    try {
      log('Loading local script...');
      const code = await requestText(`${SCRIPT_URL}?t=${Date.now()}`);
      W.__FCLoopRunner?.destroy?.();
      W.__FCLoopRunnerUserscriptApi = Object.freeze({
        request: (details) => GM_xmlhttpRequest(details),
        notify: (details) => GM_notification(details),
        getValue: (key, fallback) => GM_getValue(key, fallback),
        setValue: (key, value) => GM_setValue(key, value),
        deleteValue: (key) => GM_deleteValue(key),
      });
      try {
        W.eval(`${code}\n//# sourceURL=${SCRIPT_URL}`);
      } finally {
        delete W.__FCLoopRunnerUserscriptApi;
      }
      log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      log(`Reload failed: ${e.message || e}`);
      console.error('[LoopHotReload]', e);
    }
  }

  function installButton() {
    if (document.querySelector('#loop-hot-reload')) return;

    const style = document.createElement('style');
    style.textContent = `
      #loop-hot-reload {
        position: fixed;
        left: 84px;
        bottom: 10px;
        z-index: 1000000;
        display: flex;
        align-items: center;
        gap: 8px;
        background: #10141a;
        border: 1px solid #687890;
        color: #f4f6f8;
        font: 11px Arial, sans-serif;
        padding: 6px;
        box-shadow: 0 6px 20px rgba(0,0,0,.35);
      }
      #loop-hot-reload button {
        height: 24px;
        cursor: pointer;
        font-size: 11px;
      }
      #loop-hot-reload-status {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'loop-hot-reload';
    panel.innerHTML = `
      <button id="loop-hot-reload-btn">Reload Loop</button>
      <span id="loop-hot-reload-status">ready</span>
    `;
    document.body.appendChild(panel);
    document.querySelector('#loop-hot-reload-btn').addEventListener('click', reloadLoopRunner);
  }

  const boot = setInterval(() => {
    if (document.body) {
      clearInterval(boot);
      installButton();
    }
  }, 500);
})();
