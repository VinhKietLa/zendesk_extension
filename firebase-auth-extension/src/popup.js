// =========================
// Agent Hero - popup.js
// =========================

import { auth, signOut, onAuthStateChanged } from "./firebase.js";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID;
const CLOUD_FUNCTION_URL = "https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app";

function getOAuthUrl() {
  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = ["profile", "email"];
  const state = Math.random().toString(36).substring(2);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });

  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userInfo = document.getElementById("userInfo");

  onAuthStateChanged(auth, (user) => {
    if (user) {
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      userInfo.textContent = `Signed in as ${user.displayName}`;
    } else {
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      userInfo.textContent = "";
    }
  });

  loginBtn?.addEventListener("click", () => {
    chrome.identity.launchWebAuthFlow(
      {
        url: getOAuthUrl(),
        interactive: true,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Auth error:", chrome.runtime.lastError);
          alert("Authentication failed: " + chrome.runtime.lastError.message);
          return;
        }

        if (!redirectUrl) {
          console.error("No redirect URL received");
          alert("Authentication failed: No redirect URL received");
          return;
        }

        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          console.error("OAuth error:", error);
          console.error("Error description:", errorDescription);
          alert("Authentication failed: " + (errorDescription || error));
          return;
        }

        if (!code) {
          console.error("No code received");
          alert("Authentication failed: No authorization code received");
          return;
        }

        try {
          const redirectUri = chrome.identity.getRedirectURL();

          const response = await fetch(CLOUD_FUNCTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirectUri }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Token exchange failed");
          }

          const { idToken, accessToken } = await response.json();

          const credential = GoogleAuthProvider.credential(
            idToken,
            accessToken
          );

          await signInWithCredential(auth, credential);
        } catch (err) {
          console.error("Token exchange or sign-in failed:", err);
          alert("Authentication failed: " + err.message);
        }
      }
    );
  });

  logoutBtn?.addEventListener("click", () => {
    signOut(auth);
  });

  chrome.storage.sync.get("darkMode", (data) => {
    const isDark = data.darkMode === true;
    const darkToggle = document.getElementById("darkModeToggle");
    if (darkToggle) darkToggle.checked = isDark;
    document.body.classList.toggle("dark-mode", isDark);
  });

  const darkModeCheckbox = document.getElementById("darkModeToggle");
  darkModeCheckbox?.addEventListener("change", (e) => {
    const isDark = e.target.checked;
    document.body.classList.toggle("dark-mode", isDark);
    chrome.storage.sync.set({ darkMode: isDark });
  });

  chrome.storage.local.get({ refreshInterval: 60 }, (data) => {
    const refreshInput = document.getElementById("refreshInterval");
    if (refreshInput) refreshInput.value = data.refreshInterval;
  });

  const refreshBtn = document.getElementById("toggleRefresh");
  refreshBtn?.addEventListener("click", () => {
    const interval = parseInt(document.getElementById("refreshInterval").value);
    if (isNaN(interval) || interval <= 0) {
      alert("Please enter a valid refresh interval greater than 0.");
      return;
    }

    chrome.storage.local.set({ refreshInterval: interval }, () => {
      chrome.runtime.sendMessage(
        { action: "startRefresh", interval },
        (response) => {
          if (response?.error) {
            console.error("Failed to start refresh:", response.error);
          }
        }
      );
    });
  });

  const addTicketBtn = document.getElementById("addTicket");
  addTicketBtn?.addEventListener("click", () => {
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
  });

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("markAsDone")) {
      const ticketId = e.target.getAttribute("data-ticket-id");
      markAsDone(ticketId);
    }
  });

  document
    .getElementById("clearCompletedTickets")
    ?.addEventListener("click", () => {
      throttleWriteData({ completedTickets: [] });
      displayCompletedTickets([]);
    });

  chrome.storage.local.get(
    ["importantTickets", "completedTickets", "overdueTickets"],
    (data) => {
      displayImportantTickets(data.importantTickets || []);
      displayCompletedTickets(data.completedTickets || []);
      displayOverdueTickets(data.overdueTickets || []);
    }
  );

  chrome.runtime.sendMessage({ action: "resetBadge" });
  migrateSyncToLocal();
});

console.log("👋 popup.js loaded");

function extractTicketId(input) {
  const urlMatch = input.match(/\/agent\/tickets\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = input.match(/^\d{3,}$/);
  return idMatch ? idMatch[0] : null;
}

function migrateSyncToLocal() {
  chrome.storage.local.get(
    ["importantTickets", "completedTickets", "overdueTickets"],
    (localData) => {
      const needsMigration =
        !localData.importantTickets &&
        !localData.completedTickets &&
        !localData.overdueTickets;

      if (!needsMigration) return;

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

let writeTimeout;
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout);
  writeTimeout = setTimeout(() => {
    chrome.storage.local.set(dataToWrite, () => {
      console.log("✅ Batched write to local:", dataToWrite);
    });
  }, 1000);
}

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

function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  if (!list) return;
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

function displayCompletedTickets(tickets) {
  const list = document.getElementById("completedTicketsList");
  if (!list) return;
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

function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
  if (!list) return;
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

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}
