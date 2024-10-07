//// Auto Refresh Functionality ////
document.getElementById("toggleRefresh").addEventListener("click", () => {
  const interval = parseInt(document.getElementById("refreshInterval").value);

  // Add validation for empty or non-numeric interval input
  if (isNaN(interval) || interval <= 0) {
    alert("Please enter a valid refresh interval greater than 0.");
    return;
  }
  console.log("button in popupjs fired");

  // Send message to background script to start/stop the refresh
  chrome.runtime.sendMessage({ action: "startRefresh", interval: interval });
});

//// Add Important Ticket with Optional Reminder ////
document.getElementById("addTicket").addEventListener("click", () => {
  const ticketId = document.getElementById("ticketInput").value;
  const description = document.getElementById("ticketDescription").value;
  const reminderTime = document.getElementById("reminderTime").value; // Optional reminder time

  if (ticketId && description) {
    chrome.storage.sync.get({ importantTickets: [] }, (data) => {
      const updatedTickets = [
        ...data.importantTickets,
        { ticketId, description, reminderTime },
      ];
      chrome.storage.sync.set({ importantTickets: updatedTickets }, () => {
        displayImportantTickets(updatedTickets); // Update the UI
        document.getElementById("ticketInput").value = ""; // Clear the fields
        document.getElementById("ticketDescription").value = "";
        document.getElementById("reminderTime").value = ""; // Clear the reminder field
      });
    });
  } else {
    alert("Please enter a ticket ID and description.");
  }
});

//// Display Important Tickets ////
function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  list.innerHTML = ""; // Clear the list before displaying

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, reminderTime }) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `${zendeskDomain}/agent/tickets/${ticketId}`;
      link.target = "_blank"; // Opens the link in a new tab
      link.textContent = `Ticket #${ticketId} - ${description}`;

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

//// Mark Ticket as Done ////
document.addEventListener("click", (event) => {
  if (event.target.classList.contains("markAsDone")) {
    const ticketId = event.target.getAttribute("data-ticket-id");
    markAsDone(ticketId);
  }
});

//// Mark Ticket as Done ////
function markAsDone(ticketId) {
  chrome.storage.sync.get(["importantTickets", "overdueTickets"], (data) => {
    // Remove the ticket from the importantTickets list
    const updatedImportantTickets = data.importantTickets.filter(
      (ticket) => ticket.ticketId !== ticketId
    );

    // Remove the ticket from the overdueTickets list
    const updatedOverdueTickets = data.overdueTickets.filter(
      (ticket) => ticket.ticketId !== ticketId
    );

    // Find the completed ticket
    const completedTicket = data.importantTickets.find(
      (ticket) => ticket.ticketId === ticketId
    );

    // Add the completed ticket to the completedTickets list
    chrome.storage.sync.get({ completedTickets: [] }, (completedData) => {
      const updatedCompletedTickets = [
        ...completedData.completedTickets,
        completedTicket,
      ];

      // Update storage with the new completedTickets and remove from overdue and important tickets
      chrome.storage.sync.set(
        {
          importantTickets: updatedImportantTickets,
          overdueTickets: updatedOverdueTickets,
          completedTickets: updatedCompletedTickets,
        },
        () => {
          // Update the UI
          displayImportantTickets(updatedImportantTickets);
          displayCompletedTickets(updatedCompletedTickets);
          displayOverdueTickets(updatedOverdueTickets);
        }
      );
    });
  });
}

//// Display Completed Tickets ////
function displayCompletedTickets(tickets) {
  const list = document.getElementById("completedTicketsList");
  list.innerHTML = ""; // Clear the list before displaying

  tickets.forEach(({ ticketId, description }) => {
    const li = document.createElement("li");
    li.textContent = `Ticket #${ticketId} - ${description}`;
    list.appendChild(li);
  });
}

//// Display Overdue Tickets ////
function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
  list.innerHTML = ""; // Clear the list before displaying

  tickets.forEach(({ ticketId, description }) => {
    const li = document.createElement("li");
    li.textContent = `Ticket #${ticketId} - ${description}`;
    list.appendChild(li);
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

//// Clear Completed Tickets ////
document
  .getElementById("clearCompletedTickets")
  .addEventListener("click", () => {
    chrome.storage.sync.set({ completedTickets: [] }, () => {
      displayCompletedTickets([]); // Clear the UI
      console.log("Completed tickets cleared.");
    });
  });
