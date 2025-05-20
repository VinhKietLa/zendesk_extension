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
  getUserReminders,
  updateProStatus,
} from "./db.js";

const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID;
const CLOUD_FUNCTION_URL = "https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app";

// Helper function to load reminders based on user type
async function loadReminders(user) {
  if (!user) return;

  const pro = await isUserPro(user.uid);
  if (pro) {
    // Pro: Load from Firestore
    const reminders = await getUserReminders(user.uid);

    const importantTickets = reminders
      .filter((r) => r.type === "important" && r.status === "active")
      .map((r) => ({
        ticketId: r.ticketId,
        description: r.description,
        reminderTime: r.reminderTime,
      }));

    const completedTickets = reminders
      .filter((r) => r.type === "completed")
      .map((r) => ({
        ticketId: r.ticketId,
        description: r.description,
      }));

    const overdueTickets = reminders
      .filter((r) => r.type === "overdue")
      .map((r) => ({
        ticketId: r.ticketId,
        description: r.description,
        reminderTime: r.reminderTime,
      }));

    displayImportantTickets(importantTickets);
    displayCompletedTickets(completedTickets);
    displayOverdueTickets(overdueTickets);
  } else {
    // Free: Load from local storage
    chrome.storage.local.get(
      ["importantTickets", "completedTickets", "overdueTickets"],
      (data) => {
        displayImportantTickets(data.importantTickets || []);
        displayCompletedTickets(data.completedTickets || []);
        displayOverdueTickets(data.overdueTickets || []);
      }
    );
  }
}

// Helper function to add a reminder
async function addReminder(user, ticketId, description, reminderTime) {
  if (!user) throw new Error("User not authenticated");

  const pro = await isUserPro(user.uid);

  if (pro) {
    // Pro: Save to Firestore
    await createReminder(user.uid, {
      ticketId,
      description,
      reminderTime,
      type: "important",
    });
    // Reload all reminders from Firestore
    await loadReminders(user);
  } else {
    // Free: Save to local storage only
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ importantTickets: [] }, async (data) => {
        try {
          const currentTickets = [...data.importantTickets];
          const isDuplicate = currentTickets.some(
            (ticket) => ticket.ticketId === ticketId
          );

          if (isDuplicate) {
            throw new Error(
              `Ticket ID #${ticketId} already exists. Please enter a unique ID.`
            );
          }

          const updatedTickets = [
            ...currentTickets,
            { ticketId, description, reminderTime },
          ];
          await chrome.storage.local.set({ importantTickets: updatedTickets });
          displayImportantTickets(updatedTickets);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

// Helper function to mark a reminder as done
async function markReminderAsDone(user, ticketId) {
  if (!user) throw new Error("User not authenticated");

  const pro = await isUserPro(user.uid);

  if (pro) {
    // Pro: Update in Firestore
    const reminders = await getUserReminders(user.uid);
    const reminder = reminders.find((r) => r.ticketId === ticketId);
    if (reminder) {
      await updateReminder(reminder.id, {
        status: "completed",
        type: "completed",
      });
    }
    // Reload all reminders
    await loadReminders(user);
  } else {
    // Free: Update local storage only
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(
        ["importantTickets", "completedTickets", "overdueTickets"],
        async (data) => {
          try {
            const importantTickets = data.importantTickets || [];
            const overdueTickets = data.overdueTickets || [];
            const completedTickets = data.completedTickets || [];

            // Check both important and overdue tickets
            const ticket =
              importantTickets.find((t) => t.ticketId === ticketId) ||
              overdueTickets.find((t) => t.ticketId === ticketId);

            if (ticket) {
              // Remove from both lists (only one will actually have the ticket)
              const updatedImportantTickets = importantTickets.filter(
                (t) => t.ticketId !== ticketId
              );
              const updatedOverdueTickets = overdueTickets.filter(
                (t) => t.ticketId !== ticketId
              );

              const updatedCompletedTickets = [
                ...completedTickets,
                { ticketId: ticket.ticketId, description: ticket.description },
              ];

              await chrome.storage.local.set({
                importantTickets: updatedImportantTickets,
                overdueTickets: updatedOverdueTickets,
                completedTickets: updatedCompletedTickets,
              });

              displayImportantTickets(updatedImportantTickets);
              displayOverdueTickets(updatedOverdueTickets);
              displayCompletedTickets(updatedCompletedTickets);
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }
}

// Helper function to clear completed tickets
async function clearCompletedTickets(user) {
  if (!user) throw new Error("User not authenticated");

  const pro = await isUserPro(user.uid);

  if (pro) {
    // Pro: Delete completed tickets from Firestore
    const reminders = await getUserReminders(user.uid);
    const completedReminders = reminders.filter((r) => r.type === "completed");

    // Delete all completed reminders
    await Promise.all(
      completedReminders.map((reminder) => deleteReminder(reminder.id))
    );

    // Reload reminders
    await loadReminders(user);
  } else {
    // Free: Clear from local storage only
    await chrome.storage.local.set({ completedTickets: [] });
    displayCompletedTickets([]);
  }
}

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
  const modal = document.getElementById("upgradeModal");
  const closeModal = document.getElementsByClassName("close-modal")[0];
  const activateProBtn = document.getElementById("activateProBtn");

  onAuthStateChanged(auth, async (user) => {
    console.log("🔐 Auth state changed:", user ? "User signed in" : "No user");

    if (user) {
      console.log("👤 User details:", {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      });

      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      userInfo.textContent = `Signed in as ${user.displayName}`;

      try {
        // Check if user profile exists, if not create one
        const userProfile = await getUserProfile(user.uid);
        console.log("📋 User profile:", userProfile);

        if (!userProfile) {
          console.log("🆕 Creating new user profile");
          await createUserProfile(user.uid, {
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          });
        }

        // Check pro status and load appropriate data
        const isPro = await isUserPro(user.uid);
        console.log("⭐ Pro status:", isPro);

        if (isPro) {
          proBadge.style.display = "inline-block";
          upgradeBtn.style.display = "none";
        } else {
          proBadge.style.display = "none";
          upgradeBtn.style.display = "inline-block";
        }

        // Load reminders based on user type
        console.log(
          "📥 Loading reminders for user type:",
          isPro ? "Pro" : "Free"
        );
        await loadReminders(user);
      } catch (error) {
        console.error("❌ Error in auth state change:", error);
      }
    } else {
      console.log("👋 User signed out");
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      userInfo.textContent = "";
      proBadge.style.display = "none";
      upgradeBtn.style.display = "none";

      // Clear UI when logged out
      displayImportantTickets([]);
      displayCompletedTickets([]);
      displayOverdueTickets([]);
    }
  });

  loginBtn?.addEventListener("click", () => {
    console.log("🔑 Login button clicked");
    chrome.identity.launchWebAuthFlow(
      {
        url: getOAuthUrl(),
        interactive: true,
      },
      async (redirectUrl) => {
        console.log("🔄 Auth flow redirect URL:", redirectUrl);

        if (chrome.runtime.lastError) {
          console.error("❌ Auth error:", chrome.runtime.lastError);
          alert("Authentication failed: " + chrome.runtime.lastError.message);
          return;
        }

        if (!redirectUrl) {
          console.error("❌ No redirect URL received");
          alert("Authentication failed: No redirect URL received");
          return;
        }

        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          console.error("❌ OAuth error:", error);
          console.error("❌ Error description:", errorDescription);
          alert("Authentication failed: " + (errorDescription || error));
          return;
        }

        if (!code) {
          console.error("❌ No code received");
          alert("Authentication failed: No authorization code received");
          return;
        }

        try {
          console.log("🔄 Exchanging code for token");
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
          console.log("✅ Token exchange successful");

          const credential = GoogleAuthProvider.credential(
            idToken,
            accessToken
          );
          console.log("🔐 Signing in with credential");
          await signInWithCredential(auth, credential);
          console.log("✅ Sign in successful");
        } catch (err) {
          console.error("❌ Token exchange or sign-in failed:", err);
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
      await addReminder(user, ticketId, description, reminderTime);

      // Clear form
      document.getElementById("ticketInput").value = "";
      document.getElementById("ticketDescription").value = "";
      document.getElementById("reminderTime").value = "";
    } catch (error) {
      console.error("Error adding reminder:", error);
      alert(error.message || "Failed to add reminder. Please try again.");
    }
  });

  document.addEventListener("click", async (e) => {
    if (e.target.classList.contains("markAsDone")) {
      const ticketId = e.target.getAttribute("data-ticket-id");
      const user = auth.currentUser;
      if (!user) {
        alert("Please sign in to mark tickets as done.");
        return;
      }
      try {
        await markReminderAsDone(user, ticketId);
      } catch (error) {
        console.error("Error marking ticket as done:", error);
        alert("Failed to mark ticket as done. Please try again.");
      }
    }
  });

  document
    .getElementById("clearCompletedTickets")
    ?.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (!user) {
        alert("Please sign in to clear completed tickets.");
        return;
      }
      try {
        await clearCompletedTickets(user);
      } catch (error) {
        console.error("Error clearing completed tickets:", error);
        alert("Failed to clear completed tickets. Please try again.");
      }
    });

  chrome.runtime.sendMessage({ action: "resetBadge" });
  migrateSyncToLocal();

  // Modal handling
  upgradeBtn?.addEventListener("click", () => {
    modal.style.display = "block";
  });

  closeModal?.addEventListener("click", () => {
    modal.style.display = "none";
  });

  window.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });

  activateProBtn?.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Please sign in to upgrade to Pro.");
      return;
    }

    try {
      console.log("⭐ Upgrading user to Pro");
      await updateProStatus(user.uid, true);
      console.log("✅ User upgraded to Pro");

      // Close modal
      modal.style.display = "none";

      // Refresh the UI
      proBadge.style.display = "inline-block";
      upgradeBtn.style.display = "none";

      // Show success message
      showToast("Successfully upgraded to Pro!");

      // Reload reminders to use Firestore
      await loadReminders(user);
    } catch (error) {
      console.error("❌ Error upgrading to Pro:", error);
      alert("Failed to upgrade to Pro. Please try again.");
    }
  });

  // Listen for reminder updates from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "remindersUpdated") {
      console.log("🔄 Reminders updated, refreshing display");
      const user = auth.currentUser;
      if (user) {
        loadReminders(user);
      }
    }
  });
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
