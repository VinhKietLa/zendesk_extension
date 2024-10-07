//// Auto Refresh Functionality ////
document.getElementById("toggleRefresh").addEventListener("click", () => {
  const interval = parseInt(document.getElementById("refreshInterval").value);

  // Add validation for empty or non-numeric interval input
  if (isNaN(interval) || interval <= 0) {
    alert("Please enter a valid refresh interval greater than 0.");
    return;
  }
  console.log("button in popupjs fireddd");

  // Send message to background script to start/stop the refresh
  chrome.runtime.sendMessage({ action: "startRefresh", interval: interval });
});

//// Add Important Ticket ////
document.getElementById("addTicket").addEventListener("click", () => {
  const ticketId = document.getElementById("ticketInput").value;
  const description = document.getElementById("ticketDescription").value;

  if (ticketId && description) {
    // Get current important tickets from storage
    chrome.storage.sync.get({ importantTickets: [] }, (data) => {
      // Add new ticket with description
      const updatedTickets = [
        ...data.importantTickets,
        { ticketId, description },
      ];
      chrome.storage.sync.set({ importantTickets: updatedTickets }, () => {
        displayImportantTickets(updatedTickets); // Update UI with new ticket
        document.getElementById("ticketInput").value = ""; // Clear input field
        document.getElementById("ticketDescription").value = ""; // Clear description field
      });
    });
  }
});

// Display Important Tickets with Description
function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  list.innerHTML = ""; // Clear the list before displaying

  // Fetch the stored Zendesk domain
  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain = data.zendeskDomain || ""; // Check if domain is available

    if (!zendeskDomain) {
      console.log("Zendesk domain not detected yet");
      return; // If domain is not available, don't create ticket links
    }

    tickets.forEach(({ ticketId, description }) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `${zendeskDomain}/agent/tickets/${ticketId}`;
      link.target = "_blank"; // Open in new tab
      link.textContent = `Ticket #${ticketId} - ${description}`;

      const removeButton = document.createElement("button");
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => removeTicket(ticketId));

      li.appendChild(link);
      li.appendChild(removeButton);
      list.appendChild(li);
    });
  });
}

// Remove ticket from list
function removeTicket(ticketId) {
  chrome.storage.sync.get({ importantTickets: [] }, (data) => {
    const updatedTickets = data.importantTickets.filter(
      (ticket) => ticket !== ticketId
    );
    chrome.storage.sync.set({ importantTickets: updatedTickets }, () => {
      displayImportantTickets(updatedTickets);
    });
  });
}

// Load important tickets when popup opens
chrome.storage.sync.get("importantTickets", (data) => {
  displayImportantTickets(data.importantTickets || []);
});
