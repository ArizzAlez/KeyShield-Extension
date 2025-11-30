// popupp.js - defensive, crash-resistant version
(function () {
  // small helper for safe logging (useful in popup console)
  function safeLog(...args) {
    try { console.log(...args); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', async () => {
    safeLog('KeyShield popup: DOMContentLoaded');

    // DOM refs
    const hostEl = document.getElementById('host');
    const toggle = document.getElementById('toggle');
    const hint = document.getElementById('hint');
    const revertBtn = document.getElementById('revertBtn');
    const openSettings = document.getElementById('openSettings');

    if (!toggle) {
      safeLog('KeyShield popup: toggle element not found. Check popup.html IDs.');
      return;
    }

    // helper to get current active tab (guarded)
    async function getActiveTab() {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || !tabs.length) return null;
        return tabs[0];
      } catch (err) {
        safeLog('KeyShield popup: chrome.tabs.query failed', err);
        return null;
      }
    }

    // initialize UI to disabled while we compute state
    toggle.classList.remove('on');
    toggle.setAttribute('aria-checked', 'false');
    toggle.style.pointerEvents = 'auto'; // ensure clickable

    // load whitelist
    let whitelist = [];
    try {
      const got = await new Promise(resolve => chrome.storage.local.get({ keyshield_whitelist: [] }, resolve));
      whitelist = got.keyshield_whitelist || [];
      safeLog('KeyShield popup: loaded whitelist', whitelist);
    } catch (err) {
      safeLog('KeyShield popup: storage.get failed', err);
    }

    // get host string
    const tab = await getActiveTab();
    let host = '(no active tab)';
    if (tab && tab.url) {
      try {
        host = new URL(tab.url).host;
      } catch (err) {
        host = tab.url || '(unknown)';
      }
    }
    hostEl.textContent = host;

    // determine initial state: whitelisted => obfuscation disabled
    let isWhitelisted = whitelist.includes(host);

    function render() {
      if (isWhitelisted) {
        toggle.classList.remove('on');
        toggle.setAttribute('aria-checked', 'false');
        hint.textContent = `Obfuscation is disabled on ${host}`;
      } else {
        toggle.classList.add('on');
        toggle.setAttribute('aria-checked', 'true');
        hint.textContent = `Obfuscation is enabled on ${host}`;
      }
    }

    // click handler for toggle
    toggle.addEventListener('click', async () => {
      safeLog('KeyShield popup: toggle clicked');
      // reload whitelist fresh
      let cur = [];
      try {
        const got = await new Promise(resolve => chrome.storage.local.get({ keyshield_whitelist: [] }, resolve));
        cur = got.keyshield_whitelist || [];
      } catch (err) {
        safeLog('KeyShield popup: storage.get failed on click', err);
      }

      if (!host || host === '(no active tab)') {
        alert('Open a normal webpage tab and reopen this popup to toggle obfuscation for a site.');
        return;
      }

      if (cur.includes(host)) {
        // remove from whitelist -> enable obfuscation
        cur = cur.filter(h => h !== host);
        isWhitelisted = false;
      } else {
        // add to whitelist -> disable obfuscation
        cur.push(host);
        isWhitelisted = true;
      }

      try {
        await new Promise(resolve => chrome.storage.local.set({ keyshield_whitelist: cur }, resolve));
        safeLog('KeyShield popup: whitelist updated', cur);
      } catch (err) {
        safeLog('KeyShield popup: storage.set failed', err);
      }

      // notify the content script on the active tab if possible
      try {
        const t = await getActiveTab();
        if (t && typeof t.id !== 'undefined') {
          chrome.tabs.sendMessage(t.id, { type: 'whitelistUpdated' }, (resp) => {
            // note: runtime.lastError may appear if the content script is not injected on the tab
            if (chrome.runtime.lastError) {
              safeLog('KeyShield popup: message error (contentScript may not be present)', chrome.runtime.lastError.message);
            } else {
              safeLog('KeyShield popup: whitelistUpdated message sent', resp);
            }
          });
        } else {
          safeLog('KeyShield popup: no active tab to message (reloading tab might be needed)');
        }
      } catch (err) {
        safeLog('KeyShield popup: failed to send message', err);
      }

      render();
    });

    // reverse button (calls background)
    revertBtn && revertBtn.addEventListener('click', async () => {
      const obf = prompt('Paste obfuscated text to reverse (demo)');
      if (!obf) return;
      try {
        chrome.runtime.sendMessage({ type: 'reverse', text: obf }, (resp) => {
          if (!resp) {
            alert('No response from background (service worker may be inactive).');
            return;
          }
          if (resp.ok) alert('Reversed: ' + resp.text);
          else alert('Reverse failed: ' + (resp.error || 'unknown'));
        });
      } catch (err) {
        safeLog('KeyShield popup: reverse error', err);
        alert('Reverse failed (see console).');
      }
    });

    // settings button (open options page if any)
    openSettings && openSettings.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open('options.html');
    });

    // final render
    render();
    safeLog('KeyShield popup: ready');
  }); // DOMContentLoaded
})();
