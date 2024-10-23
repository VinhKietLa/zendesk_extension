let writeTimeout;

// Function to throttle writes to chrome.storage.sync
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout); // Clear any previous timeout
  writeTimeout = setTimeout(() => {
    chrome.storage.sync.set(dataToWrite, () => {
      console.log("Batched write to chrome.storage.sync", dataToWrite);
    });
  }, 1000); // Adjust the debounce interval if necessary
}

//// Load saved interval on popup load ////
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get({ refreshInterval: 60 }, (data) => {
    document.getElementById("refreshInterval").value = data.refreshInterval;
  });
});

//// Auto Refresh Functionality ////
document.getElementById("toggleRefresh").addEventListener("click", () => {
  const interval = parseInt(document.getElementById("refreshInterval").value);

  // Add validation for empty or non-numeric interval input
  if (isNaN(interval) || interval <= 0) {
    alert("Please enter a valid refresh interval greater than 0.");
    return;
  }

  // Save interval and send message to background script
  chrome.storage.sync.set({ refreshInterval: interval }, () => {
    console.log("Auto-refresh interval saved:", interval);

    // Send message to the background script to start the refresh
    chrome.runtime.sendMessage(
      { action: "startRefresh", interval: interval },
      (response) => {
        console.log("Message sent to background script. Response:", response);
      }
    );
  });
});

//// Add Important Ticket with Optional Reminder ////
document.getElementById("addTicket").addEventListener("click", () => {
  const ticketId = document.getElementById("ticketInput").value;
  const description = document.getElementById("ticketDescription").value;
  const reminderTime = document.getElementById("reminderTime").value; // Optional reminder time

  if (ticketId && description) {
    chrome.storage.sync.get({ importantTickets: [] }, (data) => {
      const currentTickets = [...data.importantTickets];

      const isDuplicate = currentTickets.some(
        (ticket) => ticket.ticketId === ticketId
      );
      if (isDuplicate) {
        alert(
          `Ticket ID #${ticketId} already exists. Please enter a unique ID.`
        );
        return;
      }

      const updatedTickets = [
        ...currentTickets,
        { ticketId, description, reminderTime },
      ];

      throttleWriteData({ importantTickets: updatedTickets });
      displayImportantTickets(updatedTickets);

      document.getElementById("ticketInput").value = "";
      document.getElementById("ticketDescription").value = "";
      document.getElementById("reminderTime").value = "";
    });
  } else {
    alert("Please enter a ticket ID and description.");
  }
});

//// Mark Ticket as Done ////
document.addEventListener("click", (event) => {
  if (event.target.classList.contains("markAsDone")) {
    const ticketId = event.target.getAttribute("data-ticket-id");
    markAsDone(ticketId);
  }
});

function markAsDone(ticketId) {
  chrome.storage.sync.get(
    { importantTickets: [], overdueTickets: [], completedTickets: [] },
    (data) => {
      // Find the ticket from either important or overdue lists
      const completedTicket =
        data.importantTickets.find((ticket) => ticket.ticketId === ticketId) ||
        data.overdueTickets.find((ticket) => ticket.ticketId === ticketId);

      if (completedTicket) {
        // Remove the ticket from important and overdue lists
        const updatedImportantTickets = data.importantTickets.filter(
          (ticket) => ticket.ticketId !== ticketId
        );
        const updatedOverdueTickets = data.overdueTickets.filter(
          (ticket) => ticket.ticketId !== ticketId
        );

        // Add the ticket to the completed list while preserving all properties
        const updatedCompletedTickets = [
          ...data.completedTickets.filter(
            (ticket) => ticket.ticketId !== ticketId
          ),
          {
            ...completedTicket, // Spread all properties to retain them
          },
        ];

        // Update the storage with the new lists
        chrome.storage.sync.set(
          {
            importantTickets: updatedImportantTickets,
            overdueTickets: updatedOverdueTickets,
            completedTickets: updatedCompletedTickets,
          },
          () => {
            // Refresh the UI
            clearUI();
            displayImportantTickets(updatedImportantTickets);
            displayCompletedTickets(updatedCompletedTickets);
            displayOverdueTickets(updatedOverdueTickets);
            console.log(`Ticket #${ticketId} marked as done.`);
          }
        );
      } else {
        console.error("Could not find the ticket to mark as done.");
      }
    }
  );
}

//// Clear UI Before Updating ////
function clearUI() {
  document.getElementById("importantTicketsList").innerHTML = "";
  document.getElementById("completedTicketsList").innerHTML = "";
  document.getElementById("overdueTicketsList").innerHTML = "";
}

//// Display Important Tickets ////
function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  list.innerHTML = "";

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, reminderTime }) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `${zendeskDomain}/agent/tickets/${ticketId}`;
      link.target = "_blank";
      link.textContent = `Ticket #${ticketId} - ${description}`;

      if (reminderTime) {
        const reminderText = document.createElement("span");
        reminderText.textContent = ` (Reminder: ${new Date(
          reminderTime
        ).toLocaleString()})`;
        li.appendChild(reminderText);
      }

      const markAsDoneButton = document.createElement("button");
      markAsDoneButton.textContent = "Done";
      markAsDoneButton.classList.add("markAsDone");
      markAsDoneButton.setAttribute("data-ticket-id", ticketId);

      li.appendChild(link);
      li.appendChild(markAsDoneButton);
      list.appendChild(li);
    });
  });
}

//// Display Completed Tickets ////
function displayCompletedTickets(tickets) {
  const list = document.getElementById("completedTicketsList");
  list.innerHTML = "";

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, reminderTime }) => {
      const li = document.createElement("li");

      // Create the link for the ticket
      const link = document.createElement("a");
      link.href = `${zendeskDomain}/agent/tickets/${ticketId}`;
      link.target = "_blank";
      link.textContent = `Ticket #${ticketId} - ${description}`;
      li.appendChild(link);

      // Display the reminder time if available
      if (reminderTime) {
        const reminderText = document.createElement("span");
        reminderText.textContent = ` (Reminder: ${new Date(
          reminderTime
        ).toLocaleString()})`;
        li.appendChild(reminderText);
      }

      list.appendChild(li);
    });
  });
}

//// Display Overdue Tickets ////
function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
  list.innerHTML = ""; // Clear the list before displaying

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, reminderTime }) => {
      const li = document.createElement("li");

      // Create the link for the ticket
      const link = document.createElement("a");
      link.href = `${zendeskDomain}/agent/tickets/${ticketId}`;
      link.target = "_blank";
      link.textContent = `Ticket #${ticketId} - ${description}`;
      li.appendChild(link);

      // Display the reminder time if available
      if (reminderTime) {
        const reminderText = document.createElement("span");
        reminderText.textContent = ` (Reminder: ${new Date(
          reminderTime
        ).toLocaleString()})`;
        li.appendChild(reminderText);
      }

      // Add the "Done" button for marking the ticket as done
      const markAsDoneButton = document.createElement("button");
      markAsDoneButton.textContent = "Done";
      markAsDoneButton.classList.add("markAsDone");
      markAsDoneButton.setAttribute("data-ticket-id", ticketId);
      li.appendChild(markAsDoneButton);

      // Append the list item to the list
      list.appendChild(li);
    });
  });
}

// Load important, completed, and overdue tickets when the popup opens
chrome.storage.sync.get(
  ["importantTickets", "completedTickets", "overdueTickets"],
  (data) => {
    displayImportantTickets(data.importantTickets || []);
    displayCompletedTickets(data.completedTickets || []);
    displayOverdueTickets(data.overdueTickets || []);
  }
);

// Clear Completed Tickets
document
  .getElementById("clearCompletedTickets")
  .addEventListener("click", () => {
    throttleWriteData({ completedTickets: [] });
    displayCompletedTickets([]);
  });

// When the popup is opened, reset the badge count
chrome.runtime.sendMessage({ action: "resetBadge" });
