// Auto Refresh Functionality
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

// Add Important Ticket
document.getElementById("addTicket").addEventListener("click", () => {
  const ticketId = document.getElementById("ticketInput").value;
  if (ticketId) {
    chrome.storage.sync.get({ importantTickets: [] }, (data) => {
      const updatedTickets = [...data.importantTickets, ticketId];
      chrome.storage.sync.set({ importantTickets: updatedTickets }, () => {
        displayImportantTickets(updatedTickets);
      });
    });
  }
});

function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  list.innerHTML = "";
  tickets.forEach((ticket) => {
    const li = document.createElement("li");
    li.textContent = ticket;
    list.appendChild(li);
  });
}

// Display the tickets when popup opens
chrome.storage.sync.get("importantTickets", (data) => {
  displayImportantTickets(data.importantTickets || []);
});
