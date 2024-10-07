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
  chrome.storage.sync.get({ importantTickets: [] }, (data) => {
    const now = new Date().getTime();
    const overdueTickets = [];
    const updatedTickets = [];

    data.importantTickets.forEach(({ ticketId, description, reminderTime }) => {
      // Trigger reminder notification only if the reminderTime has passed and hasn't been triggered yet
      if (reminderTime && new Date(reminderTime).getTime() <= now) {
        console.log(`Reminder triggered for ticket #${ticketId}`);

        // Create the reminder notification with an integer ticketId
        chrome.notifications.create(String(ticketId), {
          // Use String() to ensure the ID is valid
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `Reminder for Ticket #${ticketId}`,
          message: description,
          priority: 2,
        });

        // Mark the ticket as overdue after 1 hour if no action is taken
        if (reminderTime + 5 * 60 * 1000 <= now) {
          // 5 minutes (5 * 60 * 1000 milliseconds)
          overdueTickets.push({ ticketId, description });
        } else {
          updatedTickets.push({ ticketId, description, reminderTime: null }); // Remove reminderTime after triggering
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
setInterval(checkManualReminders, 10 * 1000); // Check every 10 seconds

// Listen for notification clicks globally
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log("Notification clicked:", notificationId);

  // Ensure the notificationId is a valid integer (as Zendesk expects integers for ticket IDs)
  const ticketId = parseInt(notificationId, 10); // Convert the notificationId back to an integer

  if (!isNaN(ticketId)) {
    // Get the Zendesk domain from storage
    chrome.storage.sync.get("zendeskDomain", (data) => {
      const zendeskDomain =
        data.zendeskDomain || "https://your_zendesk_domain.com";
      const ticketUrl = `${zendeskDomain}/agent/tickets/${ticketId}`;

      // Always open the ticket in a new tab
      chrome.tabs.create({ url: ticketUrl });
    });
  } else {
    console.error("Invalid ticket ID:", notificationId);
  }
});
