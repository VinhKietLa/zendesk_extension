let refreshIntervalId = null;

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

function refreshZendesk() {
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
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
          }
        },
      });
    });
  });
}

// Detect zendesk domain
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url.includes(".zendesk.com")) {
    const zendeskDomain = new URL(tab.url).origin;

    chrome.storage.sync.set({ zendeskDomain: zendeskDomain });
  }
});

//// Check Reminders in the Background ////
function checkManualReminders() {
  console.log("Checking manual reminders...");
  chrome.storage.sync.get({ importantTickets: [] }, (data) => {
    const now = new Date().getTime();
    const overdueTickets = [];
    const updatedTickets = [];

    data.importantTickets.forEach(({ ticketId, description, reminderTime }) => {
      // Trigger reminder notification only once
      if (reminderTime && reminderTime <= now) {
        console.log(`Reminder triggered for ticket #${ticketId}`);

        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `Reminder for Ticket #${ticketId}`,
          message: description,
          priority: 2,
        });

        // Move to overdue if necessary, otherwise keep in list without reminder
        if (reminderTime + 60 * 60 * 1000 <= now) {
          overdueTickets.push({ ticketId, description });
        } else {
          updatedTickets.push({ ticketId, description }); // Keep ticket but remove reminderTime
        }
      } else {
        updatedTickets.push({ ticketId, description, reminderTime }); // Keep unaffected tickets
      }
    });

    // Update the important tickets list (without repeated notifications)
    chrome.storage.sync.set({ importantTickets: updatedTickets });

    // Save overdue tickets
    chrome.storage.sync.get({ overdueTickets: [] }, (overdueData) => {
      const updatedOverdue = [...overdueData.overdueTickets, ...overdueTickets];
      chrome.storage.sync.set({ overdueTickets: updatedOverdue });
    });
  });
}

// Check reminders every minute in the background
setInterval(checkManualReminders, 60 * 1000); // Check every minute
