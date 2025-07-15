import { checkUnassignedTickets, restoreBadge } from "./badgeUpdater.js";
import { checkManualReminders } from "./reminders.js";

let refreshIntervalId = null;
let refreshInterval = 60000; // Default refresh interval (60 seconds)
let autoRefreshEnabled = false; // Default auto-refresh state

// Load settings from chrome.storage.sync on startup
chrome.storage.sync.get({
  autoRefresh: false,
  refreshInterval: 60
}, (data) => {
  autoRefreshEnabled = data.autoRefresh;
  refreshInterval = data.refreshInterval * 1000; // Convert seconds to ms
  
  if (autoRefreshEnabled) {
    setRefreshInterval(refreshInterval);
  }
});

// Listen for storage changes to update settings in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.autoRefresh) {
      autoRefreshEnabled = changes.autoRefresh.newValue;
      if (autoRefreshEnabled) {
        // Get the current refresh interval
        chrome.storage.sync.get({ refreshInterval: 60 }, (data) => {
          setRefreshInterval(data.refreshInterval);
        });
      } else {
        // Stop auto-refresh
        if (refreshIntervalId) {
          clearInterval(refreshIntervalId);
          refreshIntervalId = null;
        }
      }
    }
    
    if (changes.refreshInterval && autoRefreshEnabled) {
      setRefreshInterval(changes.refreshInterval.newValue);
    }
  }
});

//// Throttle Write Utility ////
let writeTimeout;
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout); // Clear the previous timeout if it's still pending
  writeTimeout = setTimeout(() => {
    chrome.storage.local.set(dataToWrite, () => {});
  }, 5000); // Adjust this interval as necessary (5 seconds in this case)
}

// Listener for messages from popup.js
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "logRedirectUri") {
    console.log("🔗 Redirect URI from popup:", request.redirectUri);
    console.log("🔗 Redirect URI length:", request.redirectUriLength);
    console.log("🔗 Ends with slash:", request.redirectUriEndsWithSlash);
  } else if (request.action === "logOAuthUrl") {
    console.log("🔗 Full OAuth URL:", request.oauthUrl);
  } else if (request.action === "logAuthUrl") {
    console.log("🔗 Auth URL being opened:", request.authUrl);
  }
});

// Set refresh interval
function setRefreshInterval(intervalSeconds) {
  console.log(`🔄 Setting refresh interval to ${intervalSeconds} seconds`);
  
  // Clear existing interval
  if (refreshIntervalId) {
    console.log("🔄 Clearing existing refresh interval");
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  // Only start the interval if auto-refresh is enabled
  if (autoRefreshEnabled) {
    const intervalMs = intervalSeconds * 1000; // Convert seconds to ms
    refreshIntervalId = setInterval(refreshZendesk, intervalMs);
    console.log(`🔄 Auto-refresh started with ${intervalSeconds} second interval (${intervalMs}ms)`);
  } else {
    console.log("🔄 Auto-refresh is disabled, not starting interval");
  }
}

// Auto-refresh function
function refreshZendesk() {
  console.log("🔄 Auto-refresh function called");
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      return;
    }

    tabs.forEach((tab) => {
      const url = tab.url;

      // Only refresh on pages where the refresh button is expected
      if (url.includes("/filters/") || url.includes("/views/")) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const waitForElement = (selector, callback) => {
              const element = document.querySelector(selector);
              if (element) {
                callback(element);
              } else {
                console.log("Element not found, retrying...");
                setTimeout(() => waitForElement(selector, callback), 500);
              }
            };

            waitForElement(
              'button[data-test-id="views_views-list_header-refresh"]',
              (refreshButton) => {
                refreshButton.click();
                console.log("Refresh button clicked.");
              }
            );
          },
        });
      } else {
        console.log("No refresh button on this page, skipping auto-refresh.");
      }
    });
  });
}

// Handle updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes(".zendesk.com")
  ) {
    const zendeskDomain = new URL(tab.url).origin;
    throttleWriteData({ zendeskDomain: zendeskDomain }); // Throttle domain writes
    restoreBadge(tab.url); // Only restore badge on certain pages
  }
});

// Listen for notification clicks globally
chrome.notifications.onClicked.addListener((notificationId) => {
  const ticketId = parseInt(notificationId, 10); // Convert the notificationId back to an integer

  if (!isNaN(ticketId)) {
    // Get the Zendesk domain from storage
    chrome.storage.sync.get("zendeskDomain", (data) => {
      if (data.zendeskDomain) {
        const zendeskDomain = data.zendeskDomain;
        const ticketUrl = `${zendeskDomain}/agent/tickets/${ticketId}`;

        // Always open the ticket in a new tab
        chrome.tabs.create({ url: ticketUrl });
      } else {
        console.error("Zendesk domain not found.");
      }
    });
  } else {
    console.error("Invalid ticket ID:", notificationId);
  }
});

// Set interval to check unassigned tickets every 60 seconds
setInterval(checkUnassignedTickets, 60 * 1000);
// Check reminders every 60 seconds (optimizing check interval to reduce overhead)
setInterval(checkManualReminders, 60 * 1000);

// Initial check when the extension loads
checkUnassignedTickets();
// When the extension loads, restore the badge count
restoreBadge();
