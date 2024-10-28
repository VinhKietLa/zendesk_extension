import { checkUnassignedTickets, restoreBadge } from "./badgeUpdater.js";
import { checkManualReminders } from "./reminders.js";

let refreshIntervalId = null;
let refreshInterval = 60000; // Default refresh interval (60 seconds)

//// Throttle Write Utility ////
let writeTimeout;
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout); // Clear the previous timeout if it's still pending
  writeTimeout = setTimeout(() => {
    chrome.storage.sync.set(dataToWrite, () => {});
  }, 5000); // Adjust this interval as necessary (5 seconds in this case)
}

// Listener for messages from popup.js
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "startRefresh") {
    setRefreshInterval(request.interval);
  }
});

// Set refresh interval
function setRefreshInterval(interval) {
  refreshInterval = interval * 1000; // Convert seconds to ms
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }
  refreshIntervalId = setInterval(refreshZendesk, refreshInterval);
}

// Auto-refresh function
function refreshZendesk() {
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
            const refreshButton = document.querySelector(
              'button[data-test-id="views_views-list_header-refresh"]'
            );
            if (refreshButton) {
              refreshButton.click();
            } else {
              console.error("Refresh button not found.");
            }
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
