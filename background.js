let refreshIntervalId = null;

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("button from popupjs fired");

  if (request.action === "startRefresh") {
    const interval = request.interval;

    // Clear any existing interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }

    // Start the new refresh interval
    refreshIntervalId = setInterval(() => {
      console.log("Interval is calling refreshZendesk");

      refreshZendesk();
    }, interval * 1000); // Convert seconds to milliseconds

    console.log("Auto-refresh set for every " + interval + " seconds");
  }
});

function refreshZendesk() {
  console.log("this fired");
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      console.log("No Zendesk tabs found.");
      return;
    }

    tabs.forEach((tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          const refreshButton = document.querySelector(
            'button[data-test-id="views_views-list_header-refresh"]'
          );
          if (refreshButton) {
            refreshButton.click();
            console.log("Zendesk view refreshed");
          } else {
            console.log("Refresh button not found on this page");
          }
        },
      });
    });
  });
}

// Cleanup the interval if necessary
chrome.runtime.onSuspend.addListener(() => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    console.log("Auto-refresh interval cleared.");
  }
});

// Detect zendesk domain

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Ensure that the tab is fully loaded before running the detection
  if (changeInfo.status === "complete" && tab.url.includes(".zendesk.com")) {
    const zendeskDomain = new URL(tab.url).origin; // Get base domain (e.g., https://your_zendesk_domain.com)

    console.log("Detected Zendesk domain:", zendeskDomain); // Log detected domain for debugging

    chrome.storage.sync.set({ zendeskDomain: zendeskDomain }, () => {
      console.log("Zendesk domain saved:", zendeskDomain); // Log when domain is saved
    });
  }
});
