export function checkUnassignedTickets() {
  //Queries the browser for any open tabs that hav a URL matching the zendesk domain, callback function is passed as an array of tabs (tabs).
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      console.log("No Zendesk tabs found.");
      return;
    }
    //If zendesk tabs are found, loops through each tab to perform the check for unassigned tickets
    tabs.forEach((tab) => {
      console.log("Checking tab:", tab.url);
      //this injects a script into each zendesk tab to for check for unassigned tickets.
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          function: () => {
            // Find the "Unassigned tickets" view element by its name
            const unassignedViewElement = Array.from(
              document.querySelectorAll(
                'a[data-test-id^="views_views-tree_item-view-"]'
              )
            ).find((el) => el.textContent.includes("Unassigned tickets"));

            if (unassignedViewElement) {
              const unassignedTicketElement =
                unassignedViewElement.querySelector(
                  'div[data-test-id="views_views-tree_item_count"]'
                );

              const unassignedTicketCount = unassignedTicketElement
                ? parseInt(unassignedTicketElement.textContent.trim(), 10)
                : 0;

              console.log(
                "Unassigned ticket count found:",
                unassignedTicketCount
              );
              return unassignedTicketCount;
            } else {
              console.log("Unassigned tickets view not found.");
              return 0;
            }
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
          } else if (results && results.length > 0) {
            const count = results[0].result;
            console.log("Unassigned ticket count:", count);
            updateBadge(count);
          }
        }
      );
    });
  });
}
// Updates the badge notification
function updateBadge(count) {
  console.log(`Badge update triggered with count: ${count}`);
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    chrome.storage.sync.set({ unassignedTicketCount: count }); // Save count in storage
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.storage.sync.set({ unassignedTicketCount: 0 }); // Reset stored value
  }
}

export function restoreBadge() {
  // Checks for any active zendesk tabs
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      return;
    }
    // Iterate through all open zendesk tabs
    tabs.forEach((tab) => {
      //For each tab that matches, it checks if the tab.url is a valid string and includes .zendesk.com. This ensures the logic is applied only to Zendesk-related tabs.
      if (tab.url && typeof tab.url === "string") {
        if (tab.url.includes(".zendesk.com")) {
          //Retrieve and restore the unassigned ticket count from storage
          chrome.storage.sync.get("unassignedTicketCount", (data) => {
            const storedCount = data.unassignedTicketCount || 0;
            if (storedCount > 0) {
              chrome.action.setBadgeText({ text: storedCount.toString() });
              chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
            } else {
              chrome.action.setBadgeText({ text: "" });
            }
          });
        }
      } else {
        console.error("tab.url is undefined or not a string");
      }
    });
  });
}
