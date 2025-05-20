// =========================
// Agent Hero - popup.js
// =========================

import { auth, signOut, onAuthStateChanged } from "./firebase.js";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import {
  createUserProfile,
  getUserProfile,
  isUserPro,
  syncLocalToFirestore,
  syncFirestoreToLocal,
  createReminder,
  updateReminder,
  deleteReminder,
} from "./db.js";

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
  const proBadge = document.getElementById("proBadge");
  const upgradeBtn = document.getElementById("upgradeBtn");

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      userInfo.textContent = `Signed in as ${user.displayName}`;

      // Check if user profile exists, if not create one
      const userProfile = await getUserProfile(user.uid);
      if (!userProfile) {
        await createUserProfile(user.uid, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        });
      }

      // Check pro status
      const isPro = await isUserPro(user.uid);
      if (isPro) {
        proBadge.style.display = "inline-block";
        upgradeBtn.style.display = "none";
        // Sync Firestore to local
        await syncFirestoreToLocal(user.uid);
      } else {
        proBadge.style.display = "none";
        upgradeBtn.style.display = "inline-block";
        // Sync local to Firestore (one-time migration)
        await syncLocalToFirestore(user.uid);
      }
    } else {
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      userInfo.textContent = "";
      proBadge.style.display = "none";
      upgradeBtn.style.display = "none";
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
  addTicketBtn?.addEventListener("click", async () => {
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

    const user = auth.currentUser;
    if (!user) {
      alert("Please sign in to add reminders.");
      return;
    }

    try {
      // Create reminder in Firestore
      await createReminder(user.uid, {
        ticketId,
        description,
        reminderTime,
        type: "important",
      });

      // Update local storage
      chrome.storage.local.get({ importantTickets: [] }, async (data) => {
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
        await chrome.storage.local.set({ importantTickets: updatedTickets });
        displayImportantTickets(updatedTickets);

        document.getElementById("ticketInput").value = "";
        document.getElementById("ticketDescription").value = "";
        document.getElementById("reminderTime").value = "";
      });
    } catch (error) {
      console.error("Error adding reminder:", error);
      alert("Failed to add reminder. Please try again.");
    }
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

async function markAsDone(ticketId) {
  const user = auth.currentUser;
  if (!user) {
    alert("Please sign in to mark tickets as done.");
    return;
  }

  try {
    // Get the reminder from Firestore
    const reminders = await getUserReminders(user.uid);
    const reminder = reminders.find((r) => r.ticketId === ticketId);

    if (reminder) {
      // Update reminder status in Firestore
      await updateReminder(reminder.id, {
        status: "completed",
        type: "completed",
      });
    }

    // Update local storage
    chrome.storage.local.get(
      ["importantTickets", "completedTickets"],
      async (data) => {
        const importantTickets = data.importantTickets || [];
        const completedTickets = data.completedTickets || [];

        const ticket = importantTickets.find((t) => t.ticketId === ticketId);
        if (ticket) {
          const updatedImportantTickets = importantTickets.filter(
            (t) => t.ticketId !== ticketId
          );
          const updatedCompletedTickets = [
            ...completedTickets,
            { ticketId: ticket.ticketId, description: ticket.description },
          ];

          await chrome.storage.local.set({
            importantTickets: updatedImportantTickets,
            completedTickets: updatedCompletedTickets,
          });

          displayImportantTickets(updatedImportantTickets);
          displayCompletedTickets(updatedCompletedTickets);
        }
      }
    );
  } catch (error) {
    console.error("Error marking ticket as done:", error);
    alert("Failed to mark ticket as done. Please try again.");
  }
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
