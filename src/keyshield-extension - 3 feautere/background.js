// Combined background.js with both authentication and keystroke obfuscation
let loggedIn = false;
let lastActivity = Date.now();
const TIMEOUT = 30 * 60 * 1000; // 30 minutes
const LOGIN_RULE_ID = 100;
const loginUrl = chrome.runtime.getURL('popup.html');

// Track if user has completed initial login this session
let initialLoginCompleted = false;

// Keystroke Obfuscation Variables
const sessions = {}; // tabId -> {mapRealToObf, mapObfToReal, createdAt}

// --- Helper Functions for Authentication ---
async function enableRedirect() {
  try {
    // First remove any existing rule with this ID, then add the new one
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [LOGIN_RULE_ID],
      addRules: [
        {
          id: LOGIN_RULE_ID,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { extensionPath: "/popup.html" }
          },
          condition: {
            urlFilter: "*://*/*",
            resourceTypes: ["main_frame"]
          }
        }
      ]
    });
    console.log("[Background] Redirect rule ENABLED");
  } catch (error) {
    // If rule doesn't exist, just add it without removing
    if (error.message.includes('does not have a unique ID')) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [
          {
            id: LOGIN_RULE_ID,
            priority: 1,
            action: {
              type: "redirect",
              redirect: { extensionPath: "/popup.html" }
            },
            condition: {
              urlFilter: "*://*/*",
              resourceTypes: ["main_frame"]
            }
          }
        ]
      });
      console.log("[Background] Redirect rule ENABLED (after error recovery)");
    } else {
      console.error("[Background] Error enabling redirect:", error);
    }
  }
}

async function disableRedirect() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [LOGIN_RULE_ID]
  });
  console.log("[Background] Redirect rule DISABLED");
}

// --- Auto-show login on first website visit ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only trigger when page is fully loaded and it's a website (not extension page)
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    chrome.storage.local.get(['loggedIn', 'initialLoginCompleted'], (result) => {
      // If user is not logged in AND hasn't completed initial login this session
      if (!result.loggedIn && !result.initialLoginCompleted) {
        console.log("[Background] First website visit detected, redirecting to login");
        
        // Redirect this tab to login page
        chrome.tabs.update(tabId, { url: loginUrl });
        
        // Mark that we've triggered the initial login
        chrome.storage.local.set({ initialLoginCompleted: true });
      }
    });
  }
});

// --- Refresh only active tab (same tab) ---
async function refreshActiveTabOrNavigateDefault() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    // Only reload non-login pages, don't redirect login page
    if (tab.id && !tab.url.includes("popup.html")) {
      chrome.tabs.reload(tab.id);
    }
    // If it's the login page, just leave it as is - don't redirect
  } catch (e) {
    console.warn("[Background] refreshActiveTabOrNavigateDefault error:", e);
  }
}

// --- Keystroke Obfuscation Helper Functions ---
function generateMapping() {
  const chars = [];
  for (let i = 32; i < 127; i++) chars.push(String.fromCharCode(i));
  const poolBase = '▮▯■□◆◇○●◎✦✧✩✪✫★☆♠♣♥♦♪♫✶✷✸✹✺✻✼✽✾✿❀❁';
  const pool = poolBase.split('');
  let idx = 0;
  while (pool.length < chars.length) {
    pool.push(String.fromCharCode(0x2500 + (idx++ % 0x80)));
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const mapRealToObf = Object.create(null);
  const mapObfToReal = Object.create(null);
  for (let i = 0; i < chars.length; i++) {
    mapRealToObf[chars[i]] = pool[i];
    mapObfToReal[pool[i]] = chars[i];
  }
  return { mapRealToObf, mapObfToReal, createdAt: Date.now() };
}

function ensureMappingForTab(tabId) {
  const TTL = 30 * 60 * 1000; // 30 minutes
  const ses = sessions[tabId];
  if (!ses || (Date.now() - ses.createdAt) > TTL) {
    sessions[tabId] = generateMapping();
    console.log('KeyShield: mapping generated for tab', tabId);
  }
  return sessions[tabId];
}

// --- Keystroke Reporting Helper Function ---
async function handleKeystrokeReport(count, domain, tabId) {
  try {
    // Get user token from storage
    const result = await chrome.storage.local.get(['keyshield_jwt']);
    const token = result.keyshield_jwt;
    
    if (token) {
      const response = await fetch('https://web-production-75759.up.railway.app/api/track-keystrokes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          domain: domain,
          count: count
        })
      });
      
      if (response.ok) {
        console.log(`KeyShield: Successfully reported ${count} keystrokes for ${domain}`);
      } else {
        console.warn(`KeyShield: Failed to report keystrokes, status: ${response.status}`);
      }
    } else {
      console.log('KeyShield: No JWT token found, skipping keystroke report');
    }
  } catch (error) {
    console.error('KeyShield: Failed to report keystrokes:', error);
  }
}

// --- PHISHING DETECTION INITIALIZATION ---
chrome.runtime.onInstalled.addListener(() => {
  console.log("bg_phish service worker installed and running.");
  
  // Reset initial login state on installation/update
  chrome.storage.local.set({ 
    initialLoginCompleted: false,
    loggedIn: false 
  });
  
  // Enable redirect rules immediately after installation
  enableRedirect();
});

// --- On Chrome startup ---
chrome.runtime.onStartup.addListener(() => {
  loggedIn = false;
  // Reset initial login state on browser startup
  chrome.storage.local.set({ 
    loggedIn: false, 
    initialLoginCompleted: false 
  });
  enableRedirect();
  console.log("[Background] Reset login state on Chrome startup");
});

// --- Use alarms instead of setInterval (service worker safe) ---
chrome.alarms.create("checkInactivity", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "checkInactivity") return;
  if (loggedIn && Date.now() - lastActivity > TIMEOUT) {
    loggedIn = false;
    chrome.storage.local.set({ loggedIn: false });
    enableRedirect();
    console.log("[Background] Auto-logged out due to inactivity");
  }
});

// --- Combined Message Handling ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // Authentication Messages
    switch (msg.type) {
      case "get-login-state":
        console.log("[Background] Sending login state:", loggedIn);
        sendResponse({ loggedIn });
        break;

      case "login-success":
        console.log("[Background] Processing login-success");
        loggedIn = true;
        lastActivity = Date.now();
        chrome.storage.local.set({ 
          loggedIn: true,
          initialLoginCompleted: true 
        });
        // disable redirect, then refresh active tab (same tab navigation)
        await disableRedirect();
        // small delay to ensure rule removed before navigating/reloading
        setTimeout(() => {
          refreshActiveTabOrNavigateDefault();
        }, 200);
        sendResponse({ ok: true });
        break;

      case "logout":
        loggedIn = false;
        chrome.storage.local.set({ 
          loggedIn: false,
          initialLoginCompleted: false 
        });
        await enableRedirect();
        sendResponse({ ok: true });
        break;

      case "user-active":
        lastActivity = Date.now();
        sendResponse({ ok: true });
        break;

      case "open-login":
        chrome.tabs.create({ url: loginUrl }, () => sendResponse({ ok: true }));
        return; // sendResponse will be called asynchronously by tabs.create callback

      // Keystroke Obfuscation Messages
      case "init":
        const tabId = (typeof msg.tabId !== 'undefined') ? msg.tabId : (sender.tab?.id || 'global');
        if (tabId === 'global') {
          sendResponse({ ok: false, error: 'no_tab' });
          return;
        }
        ensureMappingForTab(tabId);
        sendResponse({ ok: true });
        break;

      case "getMap":
        const mapTabId = (typeof msg.tabId !== 'undefined') ? msg.tabId : (sender.tab?.id || 'global');
        if (mapTabId === 'global') {
          sendResponse({ ok: false, error: 'no_tab' });
          return;
        }
        const s = ensureMappingForTab(mapTabId);
        sendResponse({ ok: true, map: s.mapRealToObf });
        break;

      case "reverse":
        // use provided tabId or sender tab
        const askedTab = (typeof msg.tabId !== 'undefined') ? msg.tabId : sender.tab?.id;
        if (!askedTab) {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const session = sessions[askedTab];
        if (!session) {
          sendResponse({ ok: false, error: 'no_mapping', detail: `no mapping for tab ${askedTab}` });
          return;
        }
        try {
          const out = Array.from(msg.text || '').map(ch => session.mapObfToReal[ch] || '?').join('');
          sendResponse({ ok: true, text: out });
        } catch (e) {
          sendResponse({ ok: false, error: 'reverse_error', detail: e.message });
        }
        break;

      case "clear":
        const clearTabId = (typeof msg.tabId !== 'undefined') ? msg.tabId : (sender.tab?.id || 'global');
        if (clearTabId !== 'global') delete sessions[clearTabId];
        sendResponse({ ok: true });
        break;

      case "getWhitelist":
        chrome.storage.local.get({ keyshield_whitelist: [] }, (r) => {
          sendResponse({ ok: true, whitelist: r.keyshield_whitelist || [] });
        });
        return;

      case "setWhitelist":
        chrome.storage.local.set({ keyshield_whitelist: Array.isArray(msg.list) ? msg.list : [] }, () => {
          sendResponse({ ok: true });
        });
        return;

      // Keystroke Reporting Messages
      case "reportKeystrokes":
        console.log(`[Background] Received ${msg.count} keystrokes for domain ${msg.domain}`);
        // Forward to backend if user is authenticated
        handleKeystrokeReport(msg.count, msg.domain, sender.tab?.id);
        sendResponse({ ok: true });
        break;

      case "protection_started":
        console.log(`[Background] Protection started on ${msg.domain}`);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, message: "unknown message" });
    }
  })();

  // Return true to indicate we will call sendResponse asynchronously
  return true;
});