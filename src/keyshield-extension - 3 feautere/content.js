// content.js - Simplified version for auto-login flow
(async () => {
  // Get all extension URLs that should be ALLOWED
  const extensionUrls = [
    chrome.runtime.getURL('popup.html'),
    chrome.runtime.getURL('phishingpopup.html'),
    chrome.runtime.getURL('dashboard.html'),
    'chrome-extension://' + chrome.runtime.id + '/'
  ];

  // Check if current page is an extension page
  const isExtensionPage = extensionUrls.some(url => location.href.startsWith(url));
  
  if (isExtensionPage) {
    console.log('KeyShield: Extension page allowed');
    return; // Allow extension pages
  }

  console.log('KeyShield: Checking authentication for', location.hostname);

  // Check authentication state
  chrome.runtime.sendMessage({ type: 'get-login-state' }, (res) => {
    if (!res || !res.loggedIn) {
      console.log('KeyShield: User not authenticated, website access blocked');
      // The background script will handle redirecting to login
      // We don't need to show overlay anymore
    } else {
      console.log('KeyShield: User authenticated, website allowed');
      // User is logged in, allow browsing and enable keystroke protection
      addActivityPings();
    }
  });

  // Add activity pings to maintain session for logged-in users
  function addActivityPings() {
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    events.forEach(evt => {
      window.addEventListener(evt, () => {
        chrome.runtime.sendMessage({ type: 'user-active' }, (response) => {
          if (chrome.runtime.lastError) {
            // Background might be unavailable, ignore
          }
        });
      }, { passive: true });
    });
  }
})();