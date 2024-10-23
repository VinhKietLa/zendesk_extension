// badgeUpdater.js

export function checkUnassignedTickets() {
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      console.log("No Zendesk tabs found.");
      return;
    }

    tabs.forEach((tab) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          function: () => {
            const unassignedTicketElement = document.querySelector(
              'a[data-test-id="views_views-tree_item-view-4561171961759"] div[data-test-id="views_views-tree_item_count"]'
            );
            console.log(unassignedTicketElement); // Check if this element is selected
            console.log(
              unassignedTicketElement
                ? unassignedTicketElement.textContent.trim()
                : "Not found"
            );

            const unassignedTicketCount = unassignedTicketElement
              ? parseInt(unassignedTicketElement.textContent.trim(), 10)
              : 0;
            return unassignedTicketCount;
          },
        },
        (results) => {
          console.log("Unassigned ticket count:", results[0].result); // Add this log to check the results
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
          } else if (results && results.length > 0) {
            const count = results[0].result || 0;
            updateBadge(count); // Update badge based on unassigned tickets
          }
        }
      );
    });
  });
}

function updateBadge(count) {
  console.log(`Badge update triggered with count: ${count}`); // Add this for debugging
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
  } else {
    chrome.action.setBadgeText({ text: "" }); // Clear the badge if no unassigned tickets
  }
}
