// phishpopup.js
// Handles "Check This Website" and "Report This Website" button logic.
// Receives OWASP scan results from contentt.js (injected when Check is clicked).

const API_BASE_URL = "https://web-production-75759.up.railway.app"; // Use the standard API base URL

document.addEventListener("DOMContentLoaded", () => {
  const checkBtn = document.getElementById("checkBtn");
  const reportBtn = document.getElementById("reportBtn");
  const statusDiv = document.getElementById("status");
  const owaspDiv = document.getElementById("owaspResults");

  // Disable report button by default
  reportBtn.disabled = true;

  function setStatus(text, cssClass = "") {
    statusDiv.textContent = text;
    statusDiv.className = cssClass || "";
  }

  // Helper to get the JWT token
  async function getAuthToken() {
    return new Promise(resolve => {
      // @ts-ignore: chrome is globally available in the extension environment
      chrome.storage.local.get(['keyshield_jwt'], (result) => {
        resolve(result.keyshield_jwt || null);
      });
    });
  }

  // Add this function to track user activities
  async function trackUserActivity(activityType, details = {}) {
      const token = await getAuthToken();
      if (!token) {
          console.log('KeyShield: Not authenticated, skipping activity tracking');
          return;
      }

      try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const domain = tab?.url ? new URL(tab.url).hostname : 'unknown';
          
          await fetch(`${API_BASE_URL}/api/track-activity`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  activity_type: activityType,
                  domain: domain,
                  details: details
              })
          });
          console.log(`KeyShield: Tracked ${activityType} activity`);
      } catch (e) {
          console.error('Failed to track activity:', e);
      }
  }

  // Receive messages from contentt.js - UPDATED: Properly handles object structure
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "report") {
      const owaspDiv = document.getElementById("owaspResults");
      if (!owaspDiv) {
        console.error("OWASP results div not found");
        return;
      }
      
      if (!msg.issues || msg.issues.length === 0) {
        owaspDiv.innerHTML = '<div class="ok">✅ No OWASP-related issues found.</div>';
      } else {
        // Handle the object structure from your contentt.js
        owaspDiv.innerHTML = msg.issues.map(issue => {
          if (issue.title && issue.detail) {
            // Add severity class if available
            const severityClass = issue.severity ? ` ${issue.severity}` : '';
            return `<div class="issue${severityClass}">
                      <strong>${issue.title}</strong>
                      <div class="detail">${issue.detail}</div>
                      ${issue.links && issue.links.length > 0 ? 
                        `<div class="links">${issue.links.map(link => 
                          `<a href="${link.url}" target="_blank">${link.label}</a>`
                        ).join(' | ')}</div>` : ''}
                    </div>`;
          } else {
            // Fallback for string format
            return `<div class="issue">${issue}</div>`;
          }
        }).join("");
      }
    }
  });

  // CHECK THIS WEBSITE
  checkBtn.addEventListener("click", async () => {
    setStatus("🔎 Checking...");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || "";
      
      if (!url) {
        setStatus("⚠️ Could not get current tab URL.", "error");
        return;
      }

      // Track the website check activity
      await trackUserActivity('website_check', { url: url });

      // Get auth token for tracking
      const token = await getAuthToken();

      // 1. Track website visit and security check
      if (token) {
        await fetch(`${API_BASE_URL}/api/track_website_visit`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: url,
            action: "security_check",
            timestamp: new Date().toISOString()
          })
        });
      }

      // 2. Inject the OWASP content script to scan the page
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['contentt.js']
        });
      } catch (e) {
        console.error("Error injecting contentt.js:", e);
        // Continue to API check even if script injection fails
      }
      
      // 3. Call the server's check API
      const resp = await fetch(`${API_BASE_URL}/check_url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url })
      });

      if (!resp.ok) {
        throw new Error(`Server responded with status: ${resp.status}`);
      }

      const data = await resp.json();
      const verdict = (data.verdict || "unknown").toLowerCase();

      // 4. Track security event with the scan results
      if (token) {
        await fetch(`${API_BASE_URL}/api/track_security_event`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: url,
            verdict: verdict,
            reasons: data.reasons ? data.reasons.join(', ') : "No issues found",
            event_type: 'security_scan'
          })
        });
      }

      if (verdict.includes("safe")) {
        setStatus(`✅ Safe Website\nReasons: ${data.reasons || "None"}`, "safe");
        reportBtn.disabled = true;
        
        // Track safe website check
        await trackUserActivity('safe_website_check', {
            url: url,
            verdict: verdict,
            reasons: data.reasons
        });
      } else {
        // Automatically enable report button if it's suspicious based on server check
        setStatus(`🚨 Suspicious Website! (Server Check)\nReasons: ${data.reasons || "No description provided"}`, "suspicious");
        reportBtn.disabled = false;
        
        // Track suspicious website detection
        await trackUserActivity('suspicious_website_detected', {
            url: url,
            verdict: verdict,
            reasons: data.reasons
        });
      }
    } catch (err) {
      console.error(err);
      setStatus("⚠️ Error connecting to backend or server check failed.", "error");
      
      // Track error event
      await trackUserActivity('check_error', {
          error: err.message
      });
    }
  });

  // REPORT THIS WEBSITE (Requires Authentication) - FIXED VERSION
  reportBtn.addEventListener("click", async () => {
    setStatus("🚨 Reporting...");

    const token = await getAuthToken();
    if (!token) {
        setStatus("⚠️ You must be logged in to report a website.", "error");
        return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || "";
      const reason = document.getElementById('description')?.value || "User flagged as suspicious.";

      if (!url) {
        setStatus("⚠️ Could not get current tab URL.", "error");
        return;
      }

      // Track the report activity - THIS IS THE KEY FIX
      await trackUserActivity('website_reported', { 
        url: url, 
        reason: reason 
      });

      // --- Authenticated API Call ---
      const resp = await fetch(`${API_BASE_URL}/report_api`, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json"
            // REMOVED Authorization header since report_api doesn't require auth
        },
        body: JSON.stringify({ 
            url: url, 
            reason: reason,
            reported_type: 'phishing'
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ message: resp.statusText }));
        setStatus(`⚠️ Report failed: ${errData.message || 'Server error'}`, "error");
        return;
      }

      const data = await resp.json();
      if (data.message && data.message.includes('success')) {
        setStatus("✅ Report submitted successfully!", "safe");
        reportBtn.disabled = true;
        
        // Track successful report - THIS WILL INCREMENT PHISHING_BLOCKED STATS
        await trackUserActivity('website_reported_success', {
            url: url,
            reason: reason,
            reported_type: 'phishing'
        });

        console.log(`✅ Phishing report submitted for: ${url}`);
      } else {
        setStatus(`⚠️ Report failed: ${data.message || 'Unknown reason'}`, "error");
        
        // Track report failure
        await trackUserActivity('report_failed', {
            url: url,
            error: data.message
        });
      }
    } catch (e) {
      console.error("Report request failed:", e);
      setStatus("❌ Network error during reporting.", "error");
      
      // Track network error
      await trackUserActivity('report_network_error', {
          error: e.message
      });
    }
  });

  // INITIAL SETUP: Check if the button is in the HTML
  if (checkBtn && reportBtn) {
    setStatus("Ready. Click 'Check' or 'Report'.");
  } else {
    // If the buttons are missing, something is wrong with phishpopup.html
    setStatus("Error: Missing buttons in HTML.", "error");
  }

  // Track when popup is opened
  (async () => {
    await trackUserActivity('popup_opened', {
        action: 'phishing_popup_loaded'
    });
  })();

});