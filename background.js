import { checkUnassignedTickets } from "./badgeUpdater.js";

let refreshIntervalId = null;

//// Throttle Write Utility ////
let writeTimeout;

function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout); // Clear the previous timeout if it's still pending
  writeTimeout = setTimeout(() => {
    chrome.storage.sync.set(dataToWrite, () => {
      console.log("Batched write to chrome.storage.sync", dataToWrite);
    });
  }, 5000); // Adjust this interval as necessary (5 seconds in this case)
}

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startRefresh") {
    const interval = request.interval;

    // Clear any existing interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }

    // Start the new refresh interval
    refreshIntervalId = setInterval(() => {
      refreshZendesk();
    }, interval * 1000); // Convert seconds to milliseconds
  }
});

// Auto-refresh function
function refreshZendesk() {
  console.log("button clicked");
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
          } else {
            console.error("Refresh button not found.");
          }
        },
      });
    });
  });
}

// Detect zendesk domain
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log("Tab URL:", tab.url); // Log the tab URL for debugging

  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes(".zendesk.com")
  ) {
    const zendeskDomain = new URL(tab.url).origin;
    throttleWriteData({ zendeskDomain: zendeskDomain }); // Throttle domain writes
  }
});

// Check Reminders in the Background
function checkManualReminders() {
  chrome.storage.sync.get(
    { importantTickets: [], overdueTickets: [] }, // Ensure both importantTickets and overdueTickets have default values
    (data) => {
      const now = new Date().getTime();
      let overdueTickets = [...data.overdueTickets]; // Keep existing overdue tickets
      let updatedTickets = [];

      data.importantTickets.forEach(
        ({ ticketId, description, reminderTime }) => {
          const reminderTimestamp = reminderTime
            ? new Date(reminderTime).getTime()
            : null;

          if (reminderTimestamp && reminderTimestamp <= now) {
            console.log(`Reminder triggered for ticket #${ticketId}`);

            // Create reminder notification
            chrome.notifications.create(String(ticketId), {
              type: "basic",
              iconUrl: "icon128.png",
              title: `Reminder for Ticket #${ticketId}`,
              message: description,
              priority: 2,
            });

            // Move ticket to overdue if it's not already in the overdue list
            if (
              !overdueTickets.some((ticket) => ticket.ticketId === ticketId)
            ) {
              overdueTickets.push({
                ticketId,
                description,
                reminderTime, // Preserve the reminder time when moving to overdue
              });
              console.log(`Ticket #${ticketId} moved to overdue.`);
            }
          } else {
            updatedTickets.push({
              ticketId,
              description,
              reminderTime,
            });
          }
        }
      );

      // Throttle writes for important and overdue tickets
      throttleWriteData({
        importantTickets: updatedTickets,
        overdueTickets: overdueTickets,
      });
    }
  );
}

// Check reminders every 60 seconds (optimizing check interval to reduce overhead)
setInterval(checkManualReminders, 60 * 1000);

// Listen for notification clicks globally
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log("Notification clicked:", notificationId);

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

// Initial check when the extension loads
checkUnassignedTickets();
