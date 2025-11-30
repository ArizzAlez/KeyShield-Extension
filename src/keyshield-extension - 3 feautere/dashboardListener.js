// dashboardListener.js - Content script for dashboard communication
(function() {
  'use strict';
  
  console.log('KeyShield Dashboard Listener loaded');
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'extension-event') {
      console.log('Dashboard received extension event:', message.event, message.data);
      
      // Dispatch custom event for React components to listen to
      const event = new CustomEvent('keyshield-extension-event', {
        detail: message
      });
      window.dispatchEvent(event);
      
      // Send response back to background
      sendResponse({ received: true, event: message.event });
    }
    
    return true; // Keep message channel open for async response
  });
  
  // Expose a function for React to check extension status
  window.KeyShieldExtension = {
    checkStatus: function() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'get-auth-status' }, (response) => {
          resolve(response);
        });
      });
    },
    
    getStats: function() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'get-extension-stats' }, (response) => {
          resolve(response);
        });
      });
    },
    
    syncData: function() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'sync-with-dashboard' }, (response) => {
          resolve(response);
        });
      });
    }
  };
  
  console.log('KeyShield Dashboard Listener initialized');
})();