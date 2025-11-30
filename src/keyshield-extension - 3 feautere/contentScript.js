// contentScript.js
(async () => {
  // small debug flag
  try { window.__keyshield_present = true; } catch(e){}

  // helpers to talk to background
  const sendBg = (msg) => new Promise(resolve => chrome.runtime.sendMessage(msg, (r) => resolve(r)));

  // state
  let ks_active = false;
  let map = null;
  const INTERNAL_FLAG = Symbol('ks_internal');
  const compositionActive = new WeakMap();
  const registeredHandlers = [];
  
  // Keystroke tracking - FIXED VERSION
  let protectedKeystrokeCount = 0;
  let reportInterval = null;
  let lastReportTime = Date.now();

  // --- UTILITY: Keystroke Reporting ---
  
  async function sendKeystrokeReport() {
      // Capture the count IMMEDIATELY at the start of this function
      const countToReport = protectedKeystrokeCount;
      
      console.log(`📤 KeyShield: sendKeystrokeReport called, current count: ${countToReport}`);
      
      if (countToReport === 0) {
          console.log('⚠️ KeyShield: No keystrokes to report');
          return;
      }

      // Reset the counter BEFORE sending (so we don't lose keystrokes that happen during the request)
      protectedKeystrokeCount = 0;
      lastReportTime = Date.now();

      console.log(`📤 KeyShield: Reporting ${countToReport} keystrokes to background`);
      
      try {
          const response = await new Promise((resolve) => 
              chrome.runtime.sendMessage({
                  type: "reportKeystrokes",
                  count: countToReport,  // Use the captured count
                  domain: window.location.hostname,
                  timestamp: new Date().toISOString()
              }, resolve)
          );

          console.log('📤 KeyShield: Background response:', response);
          
          if (response && response.ok) {
              console.log(`🎉 KeyShield: Successfully reported ${countToReport} keystrokes`);
          } else {
              console.warn('⚠️ KeyShield: Failed to report keystrokes, response:', response);
              // Add the count back if the report failed
              protectedKeystrokeCount += countToReport;
          }
      } catch (error) {
          console.error('❌ KeyShield: Error reporting keystrokes:', error);
          // Add the count back if there was an error
          protectedKeystrokeCount += countToReport;
      }
  }

  function startKeystrokeReporting() {
      if (reportInterval) clearInterval(reportInterval);
      // Send initial report immediately
      sendKeystrokeReport();
      // Then send every 30 seconds
      reportInterval = setInterval(sendKeystrokeReport, 30000);
      console.log('KeyShield: Keystroke reporting started');
  }

  function stopKeystrokeReporting() {
      if (reportInterval) {
          clearInterval(reportInterval);
          reportInterval = null;
      }
      // Send any remaining keystrokes before stopping
      if (protectedKeystrokeCount > 0) {
          sendKeystrokeReport();
      }
  }

  // utility: determine if element is a text input
  function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const t = (el.type || '').toLowerCase();
      return ['text','search','url','tel','email','password',''].includes(t);
    }
    return el.isContentEditable === true;
  }

  // heuristic: detect rich editors to avoid breaking them
  function isRichEditor(el) {
    if (!el) return false;
    try {
      const node = el.closest && el.closest('[contenteditable="true"], .ProseMirror, .ql-editor, .CodeMirror, .monaco-editor, .tox, .editable');
      return !!node;
    } catch (e) {
      return false;
    }
  }

  // IME composition tracking
  window.addEventListener('compositionstart', (e) => {
    compositionActive.set(e.target, true);
  }, true);
  window.addEventListener('compositionend', (e) => {
    compositionActive.set(e.target, false);
  }, true);

  // Insert a real char into the target (caret-aware)
  function insertRealChar(target, ch) {
    try {
      if (!target) return;
      if (target.isContentEditable) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) {
          target.appendChild(document.createTextNode(ch));
        } else {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(ch);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        target.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return;
      }
      // inputs / textareas
      if (typeof target.setRangeText === 'function' && typeof target.selectionStart === 'number') {
        const start = target.selectionStart;
        target.setRangeText(ch, start, target.selectionEnd, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      // fallback
      target.value = (target.value || '') + ch;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      console.error('KeyShield insertRealChar error', err);
    }
  }

  // dispatch obfuscated keyboard events to the document (so page-level keyloggers see junk)
  function dispatchObfEvents(obfChar, originalEvent) {
    const base = {
      key: obfChar,
      code: originalEvent.code || 'KeyA',
      keyCode: obfChar.charCodeAt(0) || 0,
      which: obfChar.charCodeAt(0) || 0,
      bubbles: true,
      cancelable: true
    };
    try {
      const kd = new KeyboardEvent('keydown', base);
      Object.defineProperty(kd, INTERNAL_FLAG, { value: true, configurable: false });
      document.dispatchEvent(kd);

      const kp = new KeyboardEvent('keypress', base);
      Object.defineProperty(kp, INTERNAL_FLAG, { value: true, configurable: false });
      document.dispatchEvent(kp);

      const ku = new KeyboardEvent('keyup', base);
      Object.defineProperty(ku, INTERNAL_FLAG, { value: true, configurable: false });
      document.dispatchEvent(ku);
    } catch (e) {
      // fallback (still dispatch)
      document.dispatchEvent(new KeyboardEvent('keydown', base));
      document.dispatchEvent(new KeyboardEvent('keypress', base));
      document.dispatchEvent(new KeyboardEvent('keyup', base));
    }
  }

  // paste handler (real text inserted; obf events dispatched)
  function pasteHandler(ev) {
    if (!ks_active) return;
    const target = ev.target;
    if (!isTextInput(target)) return;
    if (isRichEditor(target)) return; // skip editors
    ev.preventDefault();
    const text = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
    if (!text) return;
    if (target.isContentEditable) document.execCommand('insertText', false, text);
    else {
      const start = target.selectionStart;
      target.setRangeText(text, start, target.selectionEnd, 'end');
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      dispatchObfEvents((map && map[ch]) || ch, ev);
    }
  }

  // keydown handler (capture phase) - FIXED VERSION
  function keydownHandler(ev) {
    try {
        if (!ks_active) return;
        if (ev[INTERNAL_FLAG]) return;
        const target = document.activeElement;
        if (!isTextInput(target)) return;
        if (isRichEditor(target)) return;
        if (compositionActive.get(target)) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

        const key = ev.key;
        if (!key || key.length !== 1) return;

        // Stop propagation BEFORE incrementing
        ev.preventDefault();
        ev.stopImmediatePropagation();

        // Insert the real character
        insertRealChar(target, key);

        // Send obfuscated events
        const obf = (map && map[key]) || key;
        dispatchObfEvents(obf, ev);

        // 🎯 INCREMENT COUNTER - This happens for EVERY printable keystroke
        protectedKeystrokeCount++;
        console.log(`✅ KeyShield: Keystroke #${protectedKeystrokeCount} protected on ${window.location.hostname}`);
        
        // Start reporting interval on first keystroke
        if (protectedKeystrokeCount === 1 && !reportInterval) {
            console.log('🚀 KeyShield: First keystroke detected, starting reporting interval');
            startKeystrokeReporting();
        }
    } catch (err) {
        console.error('❌ KeyShield keydown error:', err);
    }
  }

  // attach handlers and track registered handlers for later removal
  function attachHandlers() {
    if (registeredHandlers.length > 0) return; // already attached
    window.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('paste', pasteHandler, true);
    registeredHandlers.push({ type: 'keydown', fn: keydownHandler });
    registeredHandlers.push({ type: 'paste', fn: pasteHandler });
    
    // Start keystroke reporting when handlers are attached
    startKeystrokeReporting();
  }

  function detachHandlers() {
    while (registeredHandlers.length) {
      const h = registeredHandlers.pop();
      window.removeEventListener(h.type, h.fn, true);
    }
    
    // Stop keystroke reporting when handlers are detached
    stopKeystrokeReporting();
  }

  // enable / disable functions
  function enableObfuscation(newMap) {
    map = newMap || map;
    if (!map) {
      // no map -> try to fetch again
      sendBg({ type: 'getMap' }).then(resp => {
        if (resp && resp.ok && resp.map) {
          map = resp.map;
          ks_active = true;
          attachHandlers();
          console.log('KeyShield: obfuscation enabled (map fetched)');
        } else {
          console.warn('KeyShield: enable requested but no mapping available', resp && resp.error);
        }
      }).catch(e => console.error('KeyShield getMap error', e));
      return;
    }
    ks_active = true;
    attachHandlers();
    console.log('KeyShield: obfuscation enabled');
  }

  function disableObfuscation() {
    ks_active = false;
    detachHandlers();
    console.log('KeyShield: obfuscation disabled');
  }

  // read whitelist and set initial enabled state
  async function init() {
    try {
      // tell background to ensure mapping exists for this tab
      await sendBg({ type: 'init' });
    } catch (e) { /* ignore */ }

    const mapResp = await sendBg({ type: 'getMap' });
    if (mapResp && mapResp.ok && mapResp.map) map = mapResp.map;

    const wlRes = await sendBg({ type: 'getWhitelist' });
    const whitelist = (wlRes && wlRes.ok && wlRes.whitelist) ? wlRes.whitelist : [];
    const host = location.host || '';

    if (whitelist.includes(host)) {
      disableObfuscation();
    } else {
      enableObfuscation(map);
    }
  }

  // message listener: react to whitelistUpdated and other messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'whitelistUpdated') {
      // refresh whitelist and toggle live
      chrome.storage.local.get({ keyshield_whitelist: [] }, (r) => {
        const wl = r.keyshield_whitelist || [];
        if (wl.includes(location.host)) {
          disableObfuscation();
          console.log('KeyShield: host whitelisted; disabled without reload');
        } else {
          // if no map, request one
          sendBg({ type: 'getMap' }).then(resp => {
            const newMap = (resp && resp.ok && resp.map) ? resp.map : null;
            enableObfuscation(newMap);
          }).catch(e => {
            console.error('KeyShield error fetching map on whitelist update', e);
            enableObfuscation(); // try enable; background may create map on demand
          });
        }
      });
      return true;
    }
    // optionally support other runtime messages
  });

  // initialize at load
  try {
    await init();
    console.log('KeyShield content script initialized; active=', ks_active);
  } catch (e) {
    console.error('KeyShield init failed', e);
  }

})();