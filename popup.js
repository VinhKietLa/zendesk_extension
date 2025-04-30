let writeTimeout;

// Throttle writes to chrome.storage.local
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout);
  writeTimeout = setTimeout(() => {
    chrome.storage.local.set(dataToWrite, () => {
      console.log("✅ Batched write to local:", dataToWrite);
    });
  }, 1000);
}

// Extract ticket ID from URL or allow raw numeric ID
function extractTicketId(input) {
  const urlMatch = input.match(/\/agent\/tickets\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = input.match(/^\d{3,}$/);
  return idMatch ? idMatch[0] : null;
}

// One-time migration from sync to local
function migrateSyncToLocal() {
  chrome.storage.local.get(
    ["importantTickets", "completedTickets", "overdueTickets"],
    (localData) => {
      const needsMigration =
        !localData.importantTickets &&
        !localData.completedTickets &&
        !localData.overdueTickets;

      if (!needsMigration) return;

      console.log("🔄 Migrating data from sync to local...");

      chrome.storage.sync.get(
        ["importantTickets", "completedTickets", "overdueTickets"],
        (syncData) => {
          chrome.storage.local.set(syncData, () => {
            console.log("✅ Migration complete:", syncData);
          });
        }
      );
    }
  );
}

// On DOM load
document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ Using chrome.storage.local");
  migrateSyncToLocal();

  chrome.storage.local.get({ refreshInterval: 60 }, (data) => {
    document.getElementById("refreshInterval").value = data.refreshInterval;
  });
});

// Auto-refresh setup
document.getElementById("toggleRefresh").addEventListener("click", () => {
  const interval = parseInt(document.getElementById("refreshInterval").value);

  if (isNaN(interval) || interval <= 0) {
    alert("Please enter a valid refresh interval greater than 0.");
    return;
  }

  chrome.storage.local.set({ refreshInterval: interval }, () => {
    console.log("💾 Refresh interval saved:", interval);
    chrome.runtime.sendMessage(
      { action: "startRefresh", interval },
      (response) => {
        console.log("📨 Sent to background:", response);
      }
    );
  });
});

// Add ticket handler
document.getElementById("addTicket").addEventListener("click", () => {
  const input = document.getElementById("ticketInput").value.trim();
  const ticketId = extractTicketId(input);
  const description = document.getElementById("ticketDescription").value;
  const reminderTime = document.getElementById("reminderTime").value;

  if (!ticketId || !description) {
    alert(
      "Please enter a valid ticket ID or Zendesk ticket URL and a description."
    );
    return;
  }

  chrome.storage.local.get({ importantTickets: [] }, (data) => {
    const currentTickets = [...data.importantTickets];
    const isDuplicate = currentTickets.some(
      (ticket) => ticket.ticketId === ticketId
    );

    if (isDuplicate) {
      alert(`Ticket ID #${ticketId} already exists. Please enter a unique ID.`);
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
});

// Mark ticket as done
document.addEventListener("click", (event) => {
  if (event.target.classList.contains("markAsDone")) {
    const ticketId = event.target.getAttribute("data-ticket-id");
    markAsDone(ticketId);
  }
});

function markAsDone(ticketId) {
  chrome.storage.local.get(
    { importantTickets: [], overdueTickets: [], completedTickets: [] },
    (data) => {
      const completedTicket =
        data.importantTickets.find((t) => t.ticketId === ticketId) ||
        data.overdueTickets.find((t) => t.ticketId === ticketId);

      if (!completedTicket) return;

      const updatedImportant = data.importantTickets.filter(
        (t) => t.ticketId !== ticketId
      );
      const updatedOverdue = data.overdueTickets.filter(
        (t) => t.ticketId !== ticketId
      );
      const updatedCompleted = [
        ...data.completedTickets.filter((t) => t.ticketId !== ticketId),
        completedTicket,
      ];

      chrome.storage.local.set(
        {
          importantTickets: updatedImportant,
          overdueTickets: updatedOverdue,
          completedTickets: updatedCompleted,
        },
        () => {
          clearUI();
          displayImportantTickets(updatedImportant);
          displayCompletedTickets(updatedCompleted);
          displayOverdueTickets(updatedOverdue);
        }
      );
    }
  );
}

function clearUI() {
  document.getElementById("importantTicketsList").innerHTML = "";
  document.getElementById("completedTicketsList").innerHTML = "";
  document.getElementById("overdueTicketsList").innerHTML = "";
}

// Display Important Tickets
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
      li.appendChild(link);

      if (reminderTime) {
        const reminder = document.createElement("div");
        reminder.className = "reminder";
        reminder.textContent = `Reminder: ${new Date(
          reminderTime
        ).toLocaleString()}`;
        li.appendChild(reminder);
      }

      const actions = document.createElement("div");
      actions.className = "action-buttons";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy Link";
      copyBtn.className = "copy-btn";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(
          `${zendeskDomain}/agent/tickets/${ticketId}`
        );
        showToast(`Copied ticket #${ticketId}`);
      });

      const doneBtn = document.createElement("button");
      doneBtn.textContent = "Done";
      doneBtn.className = "done-btn markAsDone";
      doneBtn.setAttribute("data-ticket-id", ticketId);

      actions.appendChild(copyBtn);
      actions.appendChild(doneBtn);
      li.appendChild(actions);

      list.appendChild(li);
    });
  });
}

// Display Completed Tickets
function displayCompletedTickets(tickets) {
  const list = document.getElementById("completedTicketsList");
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
      li.appendChild(link);

      if (reminderTime) {
        const reminder = document.createElement("div");
        reminder.className = "reminder";
        reminder.textContent = `Reminder: ${new Date(
          reminderTime
        ).toLocaleString()}`;
        li.appendChild(reminder);
      }

      list.appendChild(li);
    });
  });
}

// Display Overdue Tickets
function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
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
      li.appendChild(link);

      if (reminderTime) {
        const reminder = document.createElement("div");
        reminder.className = "reminder";
        reminder.textContent = `Reminder: ${new Date(
          reminderTime
        ).toLocaleString()}`;
        li.appendChild(reminder);
      }

      const doneBtn = document.createElement("button");
      doneBtn.textContent = "Done";
      doneBtn.className = "done-btn markAsDone";
      doneBtn.setAttribute("data-ticket-id", ticketId);
      li.appendChild(doneBtn);

      list.appendChild(li);
    });
  });
}

// Load tickets
chrome.storage.local.get(
  ["importantTickets", "completedTickets", "overdueTickets"],
  (data) => {
    displayImportantTickets(data.importantTickets || []);
    displayCompletedTickets(data.completedTickets || []);
    displayOverdueTickets(data.overdueTickets || []);
  }
);

// Clear completed
document
  .getElementById("clearCompletedTickets")
  .addEventListener("click", () => {
    throttleWriteData({ completedTickets: [] });
    displayCompletedTickets([]);
  });

// Reset badge
chrome.runtime.sendMessage({ action: "resetBadge" });

// Toast
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}
