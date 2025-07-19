// =========================
// Agent Hero - popup.js
// =========================

import { auth, signOut, onAuthStateChanged } from "./firebase.js";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import {
  checkLicense,
  initializeLicensing,
  getLicenseStatus,
  setTestLicenseStatus,
} from "./licensing.js";
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
  updateUserSettings,
} from "./db.js";
import {
  getMacros,
  addMacro,
  updateMacro,
  deleteMacro,
  copyMacroToClipboard,
} from "./macros.js";

const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID;
const CLOUD_FUNCTION_URL = "https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app";

// Helper function to format time consistently across all tabs
function formatTicketTime(reminderTime) {
  if (!reminderTime) return null;
  
  try {
    const date = new Date(reminderTime);
    // Use consistent formatting: DD/MM/YYYY HH:MM
    return date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.error('Error formatting time:', error);
    return null;
  }
}

// Helper function to load reminders based on user type
async function loadReminders(user) {
  if (!user) return;

  // Check both Google Auth and Chrome Web Store license
  const [pro, hasLicense] = await Promise.all([
    isUserPro(user.uid),
    getLicenseStatus(),
  ]);

  // User is Pro if they have either Google Auth Pro status or a valid license
  const isProUser = pro || hasLicense;

  if (isProUser) {
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
        completedAt: r.completedAt, // Include completion timestamp
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
        completedAt: Date.now(), // Add completion timestamp
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
                { 
                  ticketId: ticket.ticketId, 
                  description: ticket.description,
                  completedAt: Date.now() // Add completion timestamp
                },
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
  
  // Send to service worker console with more details
  chrome.runtime.sendMessage({ 
    action: "logRedirectUri", 
    redirectUri: redirectUri,
    redirectUriLength: redirectUri.length,
    redirectUriEndsWithSlash: redirectUri.endsWith('/')
  });
  
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

  const fullUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  
  // Log the full URL after it's constructed
  chrome.runtime.sendMessage({ 
    action: "logOAuthUrl", 
    oauthUrl: fullUrl 
  });

  return fullUrl;
}

// Complete sign-in from background script tokens
async function completeSignInFromBackground(idToken, accessToken) {
  try {
    console.log("🔐 Completing sign-in with tokens from background");
    
    const credential = GoogleAuthProvider.credential(idToken, accessToken);
    const userCred = await signInWithCredential(auth, credential);
    const user = userCred.user;
    
    
    showToast("Successfully signed in!", "success");
    
    // Store user data in local storage for options page
    await chrome.storage.local.set({
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }
    });
    console.log("💾 Stored user data in local storage:", user.email);
    
    // Notify options page of auth state change
    try {
      chrome.runtime.sendMessage({ 
        action: 'authStateChanged', 
        user: { email: user.email, uid: user.uid } 
      });
    } catch (error) {
      console.log("Options page not available for auth state update");
    }
  } catch (error) {
    console.error("❌ Error completing sign-in from background:", error);
    showToast("Sign-in failed: " + error.message, "error");
  }
}

// Initialize the extension
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 DOMContentLoaded event fired");
  
  // Initialize licensing
  await initializeLicensing();

  // Add tab switching functionality
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Remove active class from all buttons and panes
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      // Add active class to clicked button and corresponding pane
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.getElementById(`${tabId}-tab`).classList.add("active");
      
      // Load content for specific tabs
      if (tabId === "important") {
        // Get current user and pro status
        const currentUser = auth.currentUser;
        
        if (currentUser) {
          const isPro = await isUserPro(currentUser.uid);
          await loadReminders(currentUser);
        } else {
          // For free users, load from local storage
          loadFreeUserData();
        }
      } else if (tabId === "pinned") {
        // Get current user and pro status
        const currentUser = auth.currentUser;
        
        if (currentUser) {
          const isPro = await isUserPro(currentUser.uid);
          await displayPinnedTickets(currentUser, isPro);
        } else {
          // For free users, load from local storage
          await displayPinnedTickets({ uid: "" }, false);
        }
      } else if (tabId === "macros") {
        // Initialize macros and update count display
        await initializeMacros();
      }
      
      // Settings are now controlled by the options page
    });
  });

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userInfo = document.getElementById("userInfo");
  const proBadge = document.getElementById("proBadge");
  const upgradeBtn = document.getElementById("upgradeBtn");
  const modal = document.getElementById("upgradeModal");
  const closeModal = document.getElementsByClassName("close-modal")[0];
  const activateProBtn = document.getElementById("activateProBtn");

  // Load free user data immediately
  loadFreeUserData();
  
  // Load pinned tickets for free users
  const currentUser = auth.currentUser;
  if (!currentUser) {
    displayPinnedTickets({ uid: "" }, false);
  }

      onAuthStateChanged(auth, async (user) => {
      // Notify options page of auth state change
      try {
        chrome.runtime.sendMessage({ 
          action: 'authStateChanged', 
          user: user ? { email: user.email, uid: user.uid } : null 
        });
      } catch (error) {
        console.log("Options page not available for auth state update");
      }

      if (user) {
        if (loginBtn) loginBtn.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "inline-block";
        if (userInfo) userInfo.textContent = `Signed in as ${user.displayName}`;

        try {
          // Check if user profile exists, if not create one
          const userProfile = await getUserProfile(user.uid);

          if (!userProfile) {
            await createUserProfile(user.uid, {
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
            });
          }

          // Check pro status and load appropriate data
          const isPro = await isUserPro(user.uid);
          
          // Store user data and pro status in local storage for options page
          await chrome.storage.local.set({ 
            user: {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL
            },
            userProStatus: isPro 
          });

        if (isPro) {
          if (proBadge) proBadge.style.display = "inline-block";
          if (upgradeBtn) upgradeBtn.style.display = "none";

          // Check if we need to migrate data
          const localData = await new Promise((resolve) => {
            chrome.storage.local.get(
              [
                "importantTickets",
                "completedTickets",
                "overdueTickets",
                "pinnedTickets",
              ],
              resolve
            );
          });

          const hasDataToMigrate =
            (localData.importantTickets &&
              localData.importantTickets.length > 0) ||
            (localData.completedTickets &&
              localData.completedTickets.length > 0) ||
            (localData.overdueTickets && localData.overdueTickets.length > 0) ||
            (localData.pinnedTickets && localData.pinnedTickets.length > 0);

          if (hasDataToMigrate) {
            await migrateLocalToFirestore(user.uid);
          }
        } else {
          if (proBadge) proBadge.style.display = "none";
          if (upgradeBtn) upgradeBtn.style.display = "inline-block";
        }

        // Load reminders based on user type
        await loadReminders(user);
        await displayPinnedTickets(user, isPro);
        await initializeMacros();
      } catch (error) {
        console.error("Error in auth state change:", error);
      }
    } else {
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (userInfo) userInfo.textContent = "";
      if (proBadge) proBadge.style.display = "none";
      if (upgradeBtn) upgradeBtn.style.display = "none";

      // Clear user data and pro status from storage
      chrome.storage.local.remove(['user', 'userProStatus']);

      // Load free user data when signed out
      loadFreeUserData();
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
    showToast("Successfully signed out!", "success");
  });

  // Popup UI Dark Mode Sync with Options Page
  // Load initial dark mode setting
  chrome.storage.sync.get(['darkMode'], (result) => {
    document.body.classList.toggle('dark-mode', result.darkMode || false);
  });

  // Listen for dark mode changes from options page
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.darkMode) {
      document.body.classList.toggle('dark-mode', changes.darkMode.newValue);
    }
  });

  // Global click handler to close menus
  document.addEventListener("click", (e) => {
    if (!e.target.closest('.ticket-menu-btn')) {
      document.querySelectorAll('.ticket-menu-dropdown.open').forEach(dropdown => {
        dropdown.classList.remove("open");
      });
    }
  });

  // Settings are now controlled by the options page

  const addTicketBtn = document.getElementById("addTicket");
  addTicketBtn?.addEventListener("click", async () => {
    const input = document.getElementById("ticketInput").value.trim();
    const ticketId = extractTicketId(input);
    const description = document.getElementById("ticketDescription").value;
    const reminderDate = document.getElementById("reminderDate").value;
    const reminderTime = document.getElementById("reminderTime").value;

    if (!ticketId || !description) {
      alert(
        "Please enter a valid ticket ID or Zendesk ticket URL and a description."
      );
      return;
    }

    // Combine date and time if both are provided
    let combinedReminderTime = "";
    if (reminderDate && reminderTime) {
      combinedReminderTime = `${reminderDate}T${reminderTime}`;
    } else if (reminderDate) {
      combinedReminderTime = reminderDate;
    } else if (reminderTime) {
      combinedReminderTime = reminderTime;
    }

    const user = auth.currentUser;

    try {
      if (user) {
        // Pro user: Use addReminder function
        await addReminder(user, ticketId, description, combinedReminderTime);
      } else {
        // Free user: Save directly to local storage
        const data = await new Promise((resolve) => {
          chrome.storage.local.get({ importantTickets: [] }, resolve);
        });

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
          { ticketId, description, reminderTime: combinedReminderTime },
        ];
        await chrome.storage.local.set({ importantTickets: updatedTickets });
        displayImportantTickets(updatedTickets);
      }

      // Clear form
      document.getElementById("ticketInput").value = "";
      document.getElementById("ticketDescription").value = "";
      document.getElementById("reminderDate").value = "";
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
      
      try {
        if (user) {
          // Pro user: Use markReminderAsDone function
          await markReminderAsDone(user, ticketId);
        } else {
          // Free user: Update local storage directly
          const data = await new Promise((resolve) => {
            chrome.storage.local.get(
              ["importantTickets", "completedTickets", "overdueTickets"],
              resolve
            );
          });

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
          }
        }
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
      
      try {
        if (user) {
          // Pro user: Use clearCompletedTickets function
          await clearCompletedTickets(user);
        } else {
          // Free user: Clear from local storage directly
          await chrome.storage.local.set({ completedTickets: [] });
          displayCompletedTickets([]);
        }
      } catch (error) {
        console.error("Error clearing completed tickets:", error);
        alert("Failed to clear completed tickets. Please try again.");
      }
    });

  chrome.runtime.sendMessage({ action: "resetBadge" });
  migrateSyncToLocal();

  // Modal handling
  if (upgradeBtn && modal) {
    upgradeBtn.addEventListener("click", () => {
      modal.style.display = "block";
    });
  }

  if (closeModal && modal) {
    closeModal.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (modal) {
    window.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  if (activateProBtn) {
    activateProBtn.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (!user) {
        alert("Please sign in to upgrade to Pro.");
        return;
      }

      try {
        await updateProStatus(user.uid, true);

        // Close modal
        if (modal) modal.style.display = "none";

        // Refresh the UI
        const proBadge = document.getElementById("proBadge");
        const upgradeBtn = document.getElementById("upgradeBtn");
        if (proBadge) proBadge.style.display = "inline-block";
        if (upgradeBtn) upgradeBtn.style.display = "none";

        // Show success message
        showToast("Successfully upgraded to Pro!");

        // Reload reminders and macros to use Firestore
        await loadReminders(user);
        await initializeMacros();
      } catch (error) {
        console.error("Error upgrading to Pro:", error);
        alert("Failed to upgrade to Pro. Please try again.");
      }
    });
  }

  // Listen for reminder updates from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "remindersUpdated") {

      const user = auth.currentUser;
      if (user) {
        loadReminders(user);
      }
        } else if (request.action === "completeSignIn") {

      completeSignInFromBackground(request.idToken, request.accessToken);
    }
  });

  // Check for pending sign-in on popup load
  chrome.storage.local.get(['pendingSignIn', 'signInTimestamp'], (data) => {
    if (data.pendingSignIn && data.signInTimestamp) {
      const timeDiff = Date.now() - data.signInTimestamp;
      // Only process if less than 5 minutes old
      if (timeDiff < 5 * 60 * 1000) {

        completeSignInFromBackground(data.pendingSignIn.idToken, data.pendingSignIn.accessToken);
        // Clear the pending sign-in
        chrome.storage.local.remove(['pendingSignIn', 'signInTimestamp']);
      } else {
        // Clear old pending sign-in
        chrome.storage.local.remove(['pendingSignIn', 'signInTimestamp']);
      }
    }
  });





  // Burger menu dropdown logic
  const menuBtn = document.getElementById("menuBtn");
  const dropdownMenu = document.getElementById("dropdownMenu");
  const planBadge = document.getElementById("planBadge");
  const dropdownUser = document.getElementById("dropdownUser");
  const dropdownSignIn = document.getElementById("dropdownSignIn");
  const dropdownSignOut = document.getElementById("dropdownSignOut");

  // Only add event listeners if elements exist
  if (menuBtn && dropdownMenu) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!dropdownMenu.contains(e.target) && e.target !== menuBtn) {
        dropdownMenu.classList.remove("open");
      }
    });
  }

  // Settings button - open options page
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", function() {
      chrome.runtime.openOptionsPage();
    });
  }

  // Help button - open GitHub README
  const helpBtn = document.getElementById("helpBtn");
  if (helpBtn) {
    helpBtn.addEventListener("click", function() {
      chrome.tabs.create({
        url: 'https://github.com/VinhKietLa/zendesk_extension#readme'
      });
    });
  }

  if (dropdownSignIn) {
    dropdownSignIn.addEventListener("click", async () => {
      try {

        showToast("Signing in...", "info");
        // Send message to background to start sign-in
        chrome.runtime.sendMessage({ action: "startSignIn" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending startSignIn message:", chrome.runtime.lastError);
            showToast("Failed to start sign-in process", "error");
            return;
          }
          if (response && response.success === false) {
            showToast("Sign-in failed: " + (response.error || "Unknown error"), "error");
          } else {
            // Wait for signInComplete message or storage update
            showToast("Waiting for sign-in to complete...", "info");
          }
        });
        // Close the dropdown
        if (dropdownMenu) {
          dropdownMenu.classList.remove("open");
        }
      } catch (error) {
        console.error("Error starting sign-in:", error);
        showToast("Failed to start sign-in process", "error");
      }
    });
  }

  if (dropdownSignOut) {
    dropdownSignOut.addEventListener("click", () => {
      signOut(auth);
      showToast("Successfully signed out!", "success");
      if (dropdownMenu) {
        dropdownMenu.classList.remove("open");
      }
    });
  }

  // Update dropdown info on auth state change
  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const isPro = await isUserPro(user.uid);

        // Update plan badge
        if (planBadge) {
          planBadge.textContent = isPro ? "Pro" : "Free";
          planBadge.className = isPro ? "plan-badge pro" : "plan-badge";
        }

        // Update user info
        if (dropdownUser) {
          dropdownUser.textContent = `Signed in as ${
            user.displayName || user.email || "User"
          }`;
        }

        // Update sign in/out visibility
        if (dropdownSignIn) {
          dropdownSignIn.style.display = "none";
        }
        if (dropdownSignOut) {
          dropdownSignOut.style.display = "block";
        }
      } else {
        // Not signed in state
        if (planBadge) {
          planBadge.textContent = "Free";
          planBadge.className = "plan-badge";
        }
        if (dropdownUser) {
          dropdownUser.textContent = "Not signed in";
        }
        if (dropdownSignIn) {
          dropdownSignIn.style.display = "block";
        }
        if (dropdownSignOut) {
          dropdownSignOut.style.display = "none";
        }
      }
    } catch (error) {
      console.error("Error updating UI:", error);
    }
  });

  // Add macro form submission
  const addMacroForm = document.getElementById("addMacroForm");
  addMacroForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nameInput = document.getElementById("macroName");
    const contentInput = document.getElementById("macroContent");

    const name = nameInput.value.trim();
    const content = contentInput.value.trim();

    if (!name || !content) {
      showToast("Please fill in all fields", "error");
      return;
    }

    const user = auth.currentUser;

    try {
      let newMacro;
      if (user) {
        // Pro user: Use addMacro function
        newMacro = await addMacro(user, name, content);
      } else {
        // Free user: Save directly to local storage
        const data = await new Promise((resolve) => {
          chrome.storage.local.get({ macros: [] }, resolve);
        });

        const currentMacros = data.macros || [];

        if (currentMacros.length >= 3) {
          throw new Error(
            "Free users can only save up to 3 macros. Upgrade to Pro for unlimited macros."
          );
        }

        newMacro = { id: Date.now().toString(), name, content };
        const updatedMacros = [...currentMacros, newMacro];

        await chrome.storage.local.set({ macros: updatedMacros });
      }

      const macrosList = document.getElementById("macrosList");
      if (macrosList) {
        const macroElement = createMacroElement(newMacro);
        macrosList.appendChild(macroElement);
      }

      // Update macro count display
      const isPro = user ? await isUserPro(user.uid) : false;
      const currentMacros = macrosList ? macrosList.children.length : 0;
      updateMacroCountDisplay(currentMacros, isPro);

      nameInput.value = "";
      contentInput.value = "";
      showToast("Macro added successfully", "success");
    } catch (error) {
      console.error("Error adding macro:", error);
      showToast(error.message || "Error adding macro", "error");
    }
  });

  // Add search functionality for macros
  const macroSearch = document.getElementById("macroSearch");
  macroSearch?.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const macroItems = document.querySelectorAll(".macro-item");

    macroItems.forEach((item) => {
      const name = item.querySelector(".macro-name").textContent.toLowerCase();
      const content = item
        .querySelector(".macro-content")
        .textContent.toLowerCase();
      const matches = name.includes(searchTerm) || content.includes(searchTerm);
      item.style.display = matches ? "block" : "none";
    });
  });

  // Check if settings tab is already active and initialize if needed
  const activeTab = document.querySelector(".tab-btn.active");
  if (activeTab && activeTab.getAttribute("data-tab") === "settings") {
    console.log("⚙️ Settings tab is already active, initializing settings...");
    // Settings are now controlled by the options page
  }
  
  // Add direct event listener to email alerts toggle as a fallback
  const emailAlertsToggle = document.getElementById("emailAlertsToggle");
  if (emailAlertsToggle) {
    console.log("🔧 Adding direct event listener to email alerts toggle");
    emailAlertsToggle.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      
      const user = auth.currentUser;
      if (enabled && user) {
        const isPro = await isUserPro(user.uid);
        
        if (!isPro) {
          showToast("Email alerts are only available for Pro users", "error");
          e.target.checked = false;
          return;
        }
      }
      await saveSetting("emailAlertsEnabled", enabled);
      showToast(`Email alerts ${enabled ? "enabled" : "disabled"}`, "success");
    });
  }
});



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
            // Migration complete
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
      // Data written to local storage
    });
  }, 1000);
}

function clearUI() {
  document.getElementById("importantTicketsList").innerHTML = "";
  document.getElementById("completedTicketsList").innerHTML = "";
  document.getElementById("overdueTicketsList").innerHTML = "";
}

// Helper to get IDs of pinned tickets
async function getPinnedTicketIds(user, isPro) {
  const pinned = await getPinnedTickets(user, isPro);
  return pinned.map((t) => t.ticketId);
}

// Update displayImportantTickets to exclude pinned tickets
async function displayImportantTickets(tickets) {
  const list = document.getElementById("importantTicketsList");
  if (!list) return;
  list.innerHTML = "";
  
  // Update badge count
  const badge = document.querySelector(".important-badge");
  if (badge) {
    badge.textContent = tickets.length.toString();
  }
  
  const user = auth.currentUser;
  let isPro = false;
  let pinnedIds = [];
  if (user) {
    isPro = await isUserPro(user.uid);
    pinnedIds = await getPinnedTicketIds(user, isPro);
  }
  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";
    tickets
      .filter(({ ticketId }) => !pinnedIds.includes(ticketId))
      .forEach(({ ticketId, description, reminderTime }) => {
        const li = document.createElement("li");
        li.className = "ticket-card";
        
        // Create header section with ticket ID, date, and menu
        const header = document.createElement("div");
        header.className = "ticket-header";
        
        // Ticket ID badge
        const ticketIdBadge = document.createElement("div");
        ticketIdBadge.className = "ticket-id-badge";
        ticketIdBadge.textContent = `#${ticketId}`;
        header.appendChild(ticketIdBadge);
        
        // Date/time
        if (reminderTime) {
          const dateTime = document.createElement("div");
          dateTime.className = "ticket-datetime";
          const formattedTime = formatTicketTime(reminderTime);
          if (formattedTime) {
            dateTime.textContent = formattedTime;
            header.appendChild(dateTime);
          }
        }
        
        // Three-dot menu
        const menuBtn = document.createElement("button");
        menuBtn.className = "ticket-menu-btn";
        menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
        menuBtn.setAttribute("aria-label", "Ticket options");
        
        // Create dropdown menu
        const menuDropdown = document.createElement("div");
        menuDropdown.className = "ticket-menu-dropdown";
        
        // Mark as Completed option
        const completeOption = document.createElement("button");
        completeOption.className = "menu-option";
        completeOption.style.color = "#28a745";
        completeOption.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Mark as Completed';
        completeOption.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await markReminderAsDone(user, ticketId);
            await loadReminders(user);
          } catch (error) {
            console.error("Failed to mark ticket as completed:", error);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(completeOption);
        
        // Pin option
        if (user && !pinnedIds.includes(ticketId)) {
          const pinOption = document.createElement("button");
          pinOption.className = "menu-option";
          pinOption.innerHTML = '<i class="fas fa-thumbtack"></i> Pin Ticket';
          pinOption.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
              await pinTicket(user, isPro, { ticketId, description });
              await loadReminders(user);
            } catch (error) {
              console.error("Failed to pin ticket:", error);
            }
            menuDropdown.classList.remove("open");
          });
          menuDropdown.appendChild(pinOption);
        }
        
        // Mark as Overdue option
        const overdueOption = document.createElement("button");
        overdueOption.className = "menu-option";
        overdueOption.style.color = "#fd7e14";
        overdueOption.innerHTML = '<i class="fas fa-clock" style="color: #fd7e14;"></i> Mark as Overdue';
        overdueOption.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            // Move ticket from important to overdue
            if (isPro) {
              const reminders = await getUserReminders(user.uid);
              const reminder = reminders.find((r) => r.ticketId === ticketId && r.type === "important");
              if (reminder) {
                // Keep the existing reminder time but change type to overdue
                await updateReminder(reminder.id, { 
                  type: "overdue"
                  // Don't change reminderTime - keep the original time
                });
              }
            } else {
              // For free users, move from important to overdue in local storage
              const data = await new Promise((resolve) => {
                chrome.storage.local.get(["importantTickets", "overdueTickets"], resolve);
              });
              
              const importantTickets = data.importantTickets || [];
              const overdueTickets = data.overdueTickets || [];
              
              const ticket = importantTickets.find(t => t.ticketId === ticketId);
              if (ticket) {
                const updatedImportantTickets = importantTickets.filter(t => t.ticketId !== ticketId);
                // Keep the existing reminder time
                const overdueTicket = { ...ticket }; // Don't change reminderTime
                const updatedOverdueTickets = [...overdueTickets, overdueTicket];
                
                await chrome.storage.local.set({
                  importantTickets: updatedImportantTickets,
                  overdueTickets: updatedOverdueTickets
                });
              }
            }
            await loadReminders(user);
          } catch (error) {
            console.error("Failed to mark ticket as overdue:", error);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(overdueOption);
        
        // Edit Details option
        const editOption = document.createElement("button");
        editOption.className = "menu-option";
        editOption.innerHTML = '<i class="fas fa-edit"></i> Edit Details';
        editOption.addEventListener("click", (e) => {
          e.stopPropagation();
          const newDescription = prompt("Edit description:", description);
          if (newDescription && newDescription !== description) {
            updateTicketDescription(user, isPro, ticketId, newDescription);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(editOption);
        
        // Delete Ticket option
        const deleteOption = document.createElement("button");
        deleteOption.className = "menu-option delete";
        deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete Ticket';
        deleteOption.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("Are you sure you want to delete this ticket?")) {
            deleteTicket(user, isPro, ticketId);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(deleteOption);
        
        // Use the same pattern as the top-right menu with smart positioning
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          
          // Check if dropdown is currently open
          const isOpen = menuDropdown.classList.contains("open");
          
          if (!isOpen) {
            // Calculate available space below the button
            const buttonRect = menuBtn.getBoundingClientRect();
            const popupHeight = window.innerHeight;
            const spaceBelow = popupHeight - buttonRect.bottom;
            const dropdownHeight = 120; // Approximate height of dropdown
            
            // If not enough space below, show above
            if (spaceBelow < dropdownHeight) {
              menuDropdown.classList.add("above");
            } else {
              menuDropdown.classList.remove("above");
            }
          }
          
          menuDropdown.classList.toggle("open");
        });
        
        header.appendChild(menuBtn);
        header.appendChild(menuDropdown);
        li.appendChild(header);
        
        // Description
        const descDiv = document.createElement("div");
        descDiv.className = "ticket-description";
        descDiv.textContent = description;
        li.appendChild(descDiv);
        
        // Make the card clickable to open the ticket
        li.addEventListener("click", (e) => {
          if (!e.target.closest('.ticket-menu-btn')) {
            window.open(`${zendeskDomain}/agent/tickets/${ticketId}`, '_blank');
          }
        });
        
        list.appendChild(li);
      });
  });
}

function displayCompletedTickets(tickets) {
  const list = document.getElementById("completedTicketsList");
  if (!list) return;
  list.innerHTML = "";

  // Update count badge
  const countElement = document.getElementById('completedTicketsCount');
  if (countElement) {
    countElement.textContent = tickets.length;
  }

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, completedAt }) => {
      const ticketElement = document.createElement('li');
      ticketElement.className = 'completed-ticket-card';
      ticketElement.style.cursor = 'pointer';
      
      // Make the entire card clickable to open the ticket
      ticketElement.addEventListener('click', () => {
        window.open(`${zendeskDomain}/agent/tickets/${ticketId}`, '_blank');
      });

      const formattedCompletionTime = formatTicketTime(completedAt);
      
      // Create header
      const header = document.createElement('div');
      header.className = 'completed-ticket-header';
      
      // Ticket ID badge (green for completed)
      const idBadge = document.createElement('div');
      idBadge.className = 'completed-ticket-id-badge';
      idBadge.textContent = `#${ticketId}`;
      header.appendChild(idBadge);
      
      // Completion status and timestamp
      if (formattedCompletionTime) {
        const completionStatus = document.createElement('div');
        completionStatus.className = 'completion-status';
        completionStatus.innerHTML = `<i class="fas fa-check" style="color: #28a745; margin-right: 4px;"></i>Completed: ${formattedCompletionTime}`;
        header.appendChild(completionStatus);
      }
      
      // Three-dot menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'completed-ticket-menu-btn';
      menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
      menuBtn.setAttribute('aria-label', 'Ticket options');
      
      // Create dropdown menu
      const menuDropdown = document.createElement('div');
      menuDropdown.className = 'completed-ticket-menu-dropdown';
      
      // Delete option
      const deleteOption = document.createElement('button');
      deleteOption.className = 'menu-option delete';
      deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete Ticket';
      deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTicket({ uid: '' }, false, ticketId);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(deleteOption);
      
      // Move back to Important option
      const moveToImportantOption = document.createElement('button');
      moveToImportantOption.className = 'menu-option';
      moveToImportantOption.innerHTML = '<i class="fas fa-arrow-left"></i> Move back to Important';
      moveToImportantOption.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove from completed tickets and add back to important
        chrome.storage.local.get(['completedTickets', 'importantTickets'], (data) => {
          const updatedCompletedTickets = (data.completedTickets || []).filter(ticket => 
            ticket.ticketId !== ticketId
          );
          const updatedImportantTickets = [...(data.importantTickets || []), { ticketId, description, reminderTime }];
          
          chrome.storage.local.set({ 
            completedTickets: updatedCompletedTickets,
            importantTickets: updatedImportantTickets
          }, () => {
            displayCompletedTickets(updatedCompletedTickets);
          });
        });
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(moveToImportantOption);
      
      // Edit Details option
      const editOption = document.createElement('button');
      editOption.className = 'menu-option';
      editOption.innerHTML = '<i class="fas fa-edit"></i> Edit Details';
      editOption.addEventListener('click', (e) => {
        e.stopPropagation();
        const newDescription = prompt('Enter new description:', description);
        if (newDescription && newDescription.trim() !== '') {
          updateTicketDescription({ uid: '' }, false, ticketId, newDescription.trim());
          showToast('Ticket description updated');
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(editOption);
      
      // Toggle dropdown
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close other dropdowns
        document.querySelectorAll('.completed-ticket-menu-dropdown').forEach(dropdown => {
          if (dropdown !== menuDropdown) {
            dropdown.classList.remove('open');
          }
        });
        
        menuDropdown.classList.toggle('open');
        
        if (menuDropdown.classList.contains('open')) {
          // Move dropdown to document body to prevent clipping
          document.body.appendChild(menuDropdown);
          
          // Get button position
          const buttonRect = menuBtn.getBoundingClientRect();
          
          // Calculate position to ensure dropdown is fully visible
          const dropdownWidth = 200;
          const dropdownHeight = 120; // Approximate height for 3 menu items
          
          // Position dropdown using fixed positioning
          menuDropdown.style.position = 'fixed';
          menuDropdown.style.top = `${buttonRect.bottom + 4}px`;
          menuDropdown.style.left = `${buttonRect.right - dropdownWidth}px`; // Align to right edge of button
          menuDropdown.style.minWidth = `${dropdownWidth}px`;
          menuDropdown.style.zIndex = '9999999';
          menuDropdown.style.backgroundColor = 'white';
          menuDropdown.style.border = '1px solid #ddd';
          menuDropdown.style.borderRadius = '4px';
          menuDropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        } else {
          // Move back to original parent when closing
          if (menuDropdown.parentNode === document.body) {
            header.appendChild(menuDropdown);
          }
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
          menuDropdown.classList.remove('open');
          // Move back to original parent when closing
          if (menuDropdown.parentNode === document.body) {
            header.appendChild(menuDropdown);
          }
        }
      });
      
      header.appendChild(menuBtn);
      header.appendChild(menuDropdown);
      ticketElement.appendChild(header);
      
      // Ticket description
      const descriptionElement = document.createElement('div');
      descriptionElement.className = 'completed-ticket-description';
      descriptionElement.textContent = description;
      ticketElement.appendChild(descriptionElement);

      list.appendChild(ticketElement);
    });
  });
}

function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
  if (!list) return;
  list.innerHTML = "";

  // Update count badge
  const countElement = document.getElementById('overdueTicketsCount');
  if (countElement) {
    countElement.textContent = tickets.length;
  }

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, reminderTime }) => {
      const ticketElement = document.createElement('li');
      ticketElement.className = 'ticket-card';
      ticketElement.style.cursor = 'pointer';
      
      // Make the entire card clickable to open the ticket
      ticketElement.addEventListener('click', () => {
        window.open(`${zendeskDomain}/agent/tickets/${ticketId}`, '_blank');
      });

      const formattedTime = formatTicketTime(reminderTime);
      
      // Create header
      const header = document.createElement('div');
      header.className = 'ticket-header';
      
      // Ticket ID badge (red for overdue)
      const idBadge = document.createElement('div');
      idBadge.className = 'ticket-id-badge';
      idBadge.style.background = '#dc3545';
      idBadge.style.color = 'white';
      idBadge.textContent = `#${ticketId}`;
      header.appendChild(idBadge);
      
      // Due date/time
      if (formattedTime) {
        const dueDateTime = document.createElement('div');
        dueDateTime.className = 'ticket-datetime';
        dueDateTime.style.color = '#dc2626';
        dueDateTime.textContent = `Due: ${formattedTime}`;
        header.appendChild(dueDateTime);
      }
      
      // Three-dot menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'ticket-menu-btn';
      menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
      menuBtn.setAttribute('aria-label', 'Ticket options');
      
      // Create dropdown menu
      const menuDropdown = document.createElement('div');
      menuDropdown.className = 'ticket-menu-dropdown';
      
      // Mark as completed option
      const completeOption = document.createElement('button');
      completeOption.className = 'menu-option';
      completeOption.innerHTML = '<i class="fas fa-check" style="color: #28a745;"></i> Mark as Completed';
      completeOption.addEventListener('click', (e) => {
        e.stopPropagation();
        markReminderAsDone({ uid: '' }, ticketId);
        // Refresh the display
        setTimeout(() => {
          loadReminders({ uid: '' });
        }, 100);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(completeOption);
      
      // Snooze 1 hour option
      const snooze1HourOption = document.createElement('button');
      snooze1HourOption.className = 'menu-option';
      snooze1HourOption.innerHTML = '<i class="fas fa-redo"></i> Snooze 1 hour';
      snooze1HourOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newReminderTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
        
        // Check if user is Pro
        const user = auth.currentUser;
        if (user) {
          try {
            const isPro = await isUserPro(user.uid);
            if (isPro) {
              // Pro: Update in Firestore
              const reminders = await getUserReminders(user.uid);
              const overdueReminder = reminders.find(r => r.ticketId === ticketId && r.type === 'overdue');
              if (overdueReminder) {
                // Update the reminder to important with new time
                await updateReminder(overdueReminder.id, {
                  type: 'important',
                  status: 'active',
                  reminderTime: newReminderTime.getTime()
                });
                // Reload all reminders
                await loadReminders(user);
                showToast('Ticket snoozed for 1 hour');
              }
            } else {
              // Free: Update local storage
              chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
                const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
                  ticket.ticketId !== ticketId
                );
                const updatedImportantTickets = [...(data.importantTickets || []), { 
                  ticketId, 
                  description, 
                  reminderTime: newReminderTime.getTime() 
                }];
                
                chrome.storage.local.set({ 
                  overdueTickets: updatedOverdueTickets,
                  importantTickets: updatedImportantTickets
                }, () => {
                  displayOverdueTickets(updatedOverdueTickets);
                  displayImportantTickets(updatedImportantTickets);
                  showToast('Ticket snoozed for 1 hour');
                });
              });
            }
          } catch (error) {
            console.error('Error snoozing ticket:', error);
            showToast('Failed to snooze ticket');
          }
        } else {
          // No user - free mode
          chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
            const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
              ticket.ticketId !== ticketId
            );
            const updatedImportantTickets = [...(data.importantTickets || []), { 
              ticketId, 
              description, 
              reminderTime: newReminderTime.getTime() 
            }];
            
            chrome.storage.local.set({ 
              overdueTickets: updatedOverdueTickets,
              importantTickets: updatedImportantTickets
            }, () => {
              displayOverdueTickets(updatedOverdueTickets);
              displayImportantTickets(updatedImportantTickets);
              showToast('Ticket snoozed for 1 hour');
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(snooze1HourOption);
      
      // Snooze 4 hours option
      const snooze4HoursOption = document.createElement('button');
      snooze4HoursOption.className = 'menu-option';
      snooze4HoursOption.innerHTML = '<i class="fas fa-redo"></i> Snooze 4 hours';
      snooze4HoursOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newReminderTime = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours from now
        
        // Check if user is Pro
        const user = auth.currentUser;
        if (user) {
          try {
            const isPro = await isUserPro(user.uid);
            if (isPro) {
              // Pro: Update in Firestore
              const reminders = await getUserReminders(user.uid);
              const overdueReminder = reminders.find(r => r.ticketId === ticketId && r.type === 'overdue');
              if (overdueReminder) {
                // Update the reminder to important with new time
                await updateReminder(overdueReminder.id, {
                  type: 'important',
                  status: 'active',
                  reminderTime: newReminderTime.getTime()
                });
                // Reload all reminders
                await loadReminders(user);
                showToast('Ticket snoozed for 4 hours');
              }
            } else {
              // Free: Update local storage
              chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
                const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
                  ticket.ticketId !== ticketId
                );
                const updatedImportantTickets = [...(data.importantTickets || []), { 
                  ticketId, 
                  description, 
                  reminderTime: newReminderTime.getTime() 
                }];
                
                chrome.storage.local.set({ 
                  overdueTickets: updatedOverdueTickets,
                  importantTickets: updatedImportantTickets
                }, () => {
                  displayOverdueTickets(updatedOverdueTickets);
                  displayImportantTickets(updatedImportantTickets);
                  showToast('Ticket snoozed for 4 hours');
                });
              });
            }
          } catch (error) {
            console.error('Error snoozing ticket:', error);
            showToast('Failed to snooze ticket');
          }
        } else {
          // No user - free mode
          chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
            const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
              ticket.ticketId !== ticketId
            );
            const updatedImportantTickets = [...(data.importantTickets || []), { 
              ticketId, 
              description, 
              reminderTime: newReminderTime.getTime() 
            }];
            
            chrome.storage.local.set({ 
              overdueTickets: updatedOverdueTickets,
              importantTickets: updatedImportantTickets
            }, () => {
              displayOverdueTickets(updatedOverdueTickets);
              displayImportantTickets(updatedImportantTickets);
              showToast('Ticket snoozed for 4 hours');
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(snooze4HoursOption);
      
      // Snooze until tomorrow option
      const snoozeTomorrowOption = document.createElement('button');
      snoozeTomorrowOption.className = 'menu-option';
      snoozeTomorrowOption.innerHTML = '<i class="fas fa-redo"></i> Snooze until tomorrow';
      snoozeTomorrowOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0); // Set to 9 AM tomorrow
        
        // Check if user is Pro
        const user = auth.currentUser;
        if (user) {
          try {
            const isPro = await isUserPro(user.uid);
            if (isPro) {
              // Pro: Update in Firestore
              const reminders = await getUserReminders(user.uid);
              const overdueReminder = reminders.find(r => r.ticketId === ticketId && r.type === 'overdue');
              if (overdueReminder) {
                // Update the reminder to important with new time
                await updateReminder(overdueReminder.id, {
                  type: 'important',
                  status: 'active',
                  reminderTime: tomorrow.getTime()
                });
                // Reload all reminders
                await loadReminders(user);
                showToast('Ticket snoozed until tomorrow');
              }
            } else {
              // Free: Update local storage
              chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
                const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
                  ticket.ticketId !== ticketId
                );
                const updatedImportantTickets = [...(data.importantTickets || []), { 
                  ticketId, 
                  description, 
                  reminderTime: tomorrow.getTime() 
                }];
                
                chrome.storage.local.set({ 
                  overdueTickets: updatedOverdueTickets,
                  importantTickets: updatedImportantTickets
                }, () => {
                  displayOverdueTickets(updatedOverdueTickets);
                  displayImportantTickets(updatedImportantTickets);
                  showToast('Ticket snoozed until tomorrow');
                });
              });
            }
          } catch (error) {
            console.error('Error snoozing ticket:', error);
            showToast('Failed to snooze ticket');
          }
        } else {
          // No user - free mode
          chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
            const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
              ticket.ticketId !== ticketId
            );
            const updatedImportantTickets = [...(data.importantTickets || []), { 
              ticketId, 
              description, 
              reminderTime: tomorrow.getTime() 
            }];
            
            chrome.storage.local.set({ 
              overdueTickets: updatedOverdueTickets,
              importantTickets: updatedImportantTickets
            }, () => {
              displayOverdueTickets(updatedOverdueTickets);
              displayImportantTickets(updatedImportantTickets);
              showToast('Ticket snoozed until tomorrow');
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(snoozeTomorrowOption);
      
      // Move to Important option
      const moveToImportantOption = document.createElement('button');
      moveToImportantOption.className = 'menu-option';
      moveToImportantOption.innerHTML = '<i class="fas fa-arrow-right"></i> Move to Important';
      moveToImportantOption.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove from overdue tickets
        chrome.storage.local.get(['overdueTickets', 'importantTickets'], (data) => {
          const updatedOverdueTickets = (data.overdueTickets || []).filter(ticket => 
            ticket.ticketId !== ticketId
          );
          const updatedImportantTickets = [...(data.importantTickets || []), { ticketId, description, reminderTime }];
          
          chrome.storage.local.set({ 
            overdueTickets: updatedOverdueTickets,
            importantTickets: updatedImportantTickets
          }, () => {
            displayOverdueTickets(updatedOverdueTickets);
          });
        });
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(moveToImportantOption);
      
      // Edit Details option
      const editOption = document.createElement('button');
      editOption.className = 'menu-option';
      editOption.innerHTML = '<i class="fas fa-edit"></i> Edit Details';
      editOption.addEventListener('click', (e) => {
        e.stopPropagation();
        const newDescription = prompt('Edit description:', description);
        if (newDescription && newDescription !== description) {
          // Update the description in storage
          chrome.storage.local.get(['overdueTickets'], (data) => {
            const updatedTickets = (data.overdueTickets || []).map(ticket => 
              ticket.ticketId === ticketId 
                ? { ...ticket, description: newDescription }
                : ticket
            );
            chrome.storage.local.set({ overdueTickets: updatedTickets }, () => {
              displayOverdueTickets(updatedTickets);
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(editOption);
      
      // Delete Ticket option
      const deleteOption = document.createElement('button');
      deleteOption.className = 'menu-option delete';
      deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete Ticket';
      deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this ticket?')) {
          chrome.storage.local.get(['overdueTickets'], (data) => {
            const updatedTickets = (data.overdueTickets || []).filter(ticket => 
              ticket.ticketId !== ticketId
            );
            chrome.storage.local.set({ overdueTickets: updatedTickets }, () => {
              displayOverdueTickets(updatedTickets);
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(deleteOption);
      
      // Menu button click handler
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close all other open dropdowns first
        document.querySelectorAll('.ticket-menu-dropdown.open').forEach(dropdown => {
          if (dropdown !== menuDropdown) {
            dropdown.classList.remove('open');
          }
        });
        
        menuDropdown.classList.toggle('open');
        
        if (menuDropdown.classList.contains('open')) {
          // Move dropdown to document body to avoid clipping
          document.body.appendChild(menuDropdown);
          
          // Calculate position relative to viewport
          const buttonRect = menuBtn.getBoundingClientRect();
          const popupHeight = window.innerHeight;
          const spaceBelow = popupHeight - buttonRect.bottom;
          const dropdownHeight = 120; // Approximate height of dropdown
          
          // Position the dropdown using fixed positioning
          menuDropdown.style.position = 'fixed';
          menuDropdown.style.minWidth = '200px';
          menuDropdown.style.zIndex = '99999999';
          
          if (spaceBelow < dropdownHeight) {
            // Show above if not enough space below
            menuDropdown.style.top = (buttonRect.top - dropdownHeight - 4) + 'px';
          } else {
            // Show below
            menuDropdown.style.top = (buttonRect.bottom + 4) + 'px';
          }
          
          // Position horizontally
          menuDropdown.style.left = (buttonRect.right - 200) + 'px';
        } else {
          // Move dropdown back to header when closing
          header.appendChild(menuDropdown);
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
          menuDropdown.classList.remove('open');
          // Move dropdown back to header
          header.appendChild(menuDropdown);
        }
      });
      
      header.appendChild(menuBtn);
      header.appendChild(menuDropdown);
      ticketElement.appendChild(header);
      
      // Ticket description
      const descriptionElement = document.createElement('div');
      descriptionElement.className = 'ticket-description';
      descriptionElement.textContent = description;
      ticketElement.appendChild(descriptionElement);
      
      // Overdue status indicator
      if (formattedTime) {
        const overdueStatus = document.createElement('div');
        overdueStatus.style.marginTop = '8px';
        overdueStatus.style.fontSize = '12px';
        overdueStatus.style.color = '#dc2626';
        overdueStatus.innerHTML = `<i class="fas fa-clock" style="color: #dc2626; margin-right: 4px;"></i>Overdue since ${formattedTime}`;
        ticketElement.appendChild(overdueStatus);
      }

      list.appendChild(ticketElement);
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

// =========================
// Updated Pinned Tickets Logic (Option 2)
// =========================

// Pin a ticket
async function pinTicket(user, isPro, ticket) {
  if (isPro) {
    // Pro: Add to Firestore as a 'pinned' reminder, remove from 'important'
    // Remove from important
    const reminders = await getUserReminders(user.uid);
    const important = reminders.find(
      (r) => r.type === "important" && r.ticketId === ticket.ticketId
    );
    if (important) {
      await deleteReminder(important.id);
    }
    // Add to pinned
    await createReminder(user.uid, {
      ticketId: ticket.ticketId,
      description: ticket.description,
      type: "pinned",
      pinnedAt: Date.now(),
    });
  } else {
    // Free: Remove from importantTickets, add to pinnedTickets (max 3)
    const [importantTickets, pinnedTickets] = await Promise.all([
      new Promise((resolve) =>
        chrome.storage.local.get({ importantTickets: [] }, (data) =>
          resolve(data.importantTickets || [])
        )
      ),
      getPinnedTickets(user, false),
    ]);
    if (pinnedTickets.length >= 3) {
      showToast(
        "Free users can only pin up to 3 tickets. Upgrade to Pro for unlimited pins."
      );
      return;
    }
    if (pinnedTickets.some((t) => t.ticketId === ticket.ticketId)) {
      return;
    }
    // Remove from important
    const updatedImportant = importantTickets.filter(
      (t) => t.ticketId !== ticket.ticketId
    );
    // Add to pinned
    pinnedTickets.push({
      ticketId: ticket.ticketId,
      description: ticket.description,
      pinnedAt: Date.now(),
    });
    await Promise.all([
      chrome.storage.local.set({ importantTickets: updatedImportant }),
      chrome.storage.local.set({ pinnedTickets }),
    ]);
  }
}

// Unpin a ticket
async function unpinTicket(user, isPro, ticket) {
  const { ticketId, description, reminderTime, pinnedAt } = ticket;
  if (isPro) {
    // Pro: Remove from Firestore 'pinned', add back to 'important' with original properties
    const reminders = await getUserReminders(user.uid);
    const pinned = reminders.find(
      (r) => r.type === "pinned" && r.ticketId === ticketId
    );
    if (pinned) {
      await deleteReminder(pinned.id);
    }
    // Add back to important (if not completed/overdue)
    const alreadyCompletedOrOverdue = reminders.some(
      (r) =>
        (r.type === "completed" || r.type === "overdue") &&
        r.ticketId === ticketId
    );
    if (!alreadyCompletedOrOverdue) {
      await createReminder(user.uid, {
        ticketId,
        description,
        reminderTime: pinned.reminderTime || null,
        type: "important",
      });
    }
  } else {
    // Free: Remove from pinnedTickets, add back to importantTickets with all properties
    const [pinnedTickets, importantTickets, completedTickets, overdueTickets] =
      await Promise.all([
        getPinnedTickets(user, false),
        new Promise((resolve) =>
          chrome.storage.local.get({ importantTickets: [] }, (data) =>
            resolve(data.importantTickets || [])
          )
        ),
        new Promise((resolve) =>
          chrome.storage.local.get({ completedTickets: [] }, (data) =>
            resolve(data.completedTickets || [])
          )
        ),
        new Promise((resolve) =>
          chrome.storage.local.get({ overdueTickets: [] }, (data) =>
            resolve(data.overdueTickets || [])
          )
        ),
      ]);
    const updatedPinned = pinnedTickets.filter((t) => t.ticketId !== ticketId);
    // Only add back if not completed/overdue
    const isCompletedOrOverdue = [...completedTickets, ...overdueTickets].some(
      (t) => t.ticketId === ticketId
    );
    if (!isCompletedOrOverdue) {
      importantTickets.push({
        ticketId,
        description,
        reminderTime: ticket.reminderTime || null,
      });
    }
    await Promise.all([
      chrome.storage.local.set({ pinnedTickets: updatedPinned }),
      chrome.storage.local.set({ importantTickets }),
    ]);
  }
}

// Update displayPinnedTickets to pass the full ticket object to unpinTicket
async function displayPinnedTickets(user, isPro) {
    const userId = user?.uid;
    
    // For free users, userId might be empty string, but we still want to display pinned tickets
    if (userId === undefined || userId === null) {
        return;
    }
    
    try {
        const tickets = await getPinnedTickets(user, isPro);
        
        // Get Zendesk domain from storage
        const zendeskDomain = await new Promise((resolve) => {
            chrome.storage.sync.get("zendeskDomain", (data) => {
                resolve(data.zendeskDomain || "https://your_zendesk_domain.com");
            });
        });
        
        const pinnedTicketsList = document.getElementById('pinnedTicketsList');
        
        if (!pinnedTicketsList) {
            return;
        }
        
        // Clear existing tickets
        pinnedTicketsList.innerHTML = '';
        
        tickets.forEach((ticket) => {
            const ticketElement = document.createElement('li');
            ticketElement.className = 'ticket-card';
            
            const pinnedDate = new Date(ticket.pinnedAt).toLocaleString('en-GB');
            
            // Create header
            const header = document.createElement('div');
            header.className = 'ticket-header';
            
            // Ticket ID badge
            const idBadge = document.createElement('div');
            idBadge.className = 'ticket-id-badge';
            idBadge.textContent = `#${ticket.ticketId}`;
            header.appendChild(idBadge);
            
            // Date/time
            const dateTime = document.createElement('div');
            dateTime.className = 'ticket-datetime';
            dateTime.innerHTML = `<i class="fas fa-thumbtack"></i>${pinnedDate}`;
            header.appendChild(dateTime);
            
            // Three-dot menu button
            const menuBtn = document.createElement('button');
            menuBtn.className = 'ticket-menu-btn';
            menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
            menuBtn.setAttribute('aria-label', 'Ticket options');
            
            // Create dropdown menu
            const menuDropdown = document.createElement('div');
            menuDropdown.className = 'ticket-menu-dropdown';
            
            // Edit option
            const editOption = document.createElement('button');
            editOption.className = 'menu-option';
            editOption.innerHTML = '<i class="fas fa-edit"></i> Edit';
            editOption.addEventListener('click', (e) => {
                e.stopPropagation();
                const newDescription = prompt('Edit description:', ticket.description);
                if (newDescription && newDescription !== ticket.description) {
                    updateTicketDescription(user, isPro, ticket.ticketId, newDescription);
                }
                menuDropdown.classList.remove('open');
            });
            menuDropdown.appendChild(editOption);
            
            // Unpin option
            const unpinOption = document.createElement('button');
            unpinOption.className = 'menu-option';
            unpinOption.innerHTML = '<i class="fas fa-thumbtack"></i> Unpin';
            unpinOption.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await unpinTicket(user, isPro, ticket);
                    await displayPinnedTickets(user, isPro);
                } catch (error) {
                    console.error("Failed to unpin ticket:", error);
                }
                menuDropdown.classList.remove('open');
            });
            menuDropdown.appendChild(unpinOption);
            
            // Delete option
            const deleteOption = document.createElement('button');
            deleteOption.className = 'menu-option delete';
            deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete';
            deleteOption.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this ticket?')) {
                    deleteTicket(user, isPro, ticket.ticketId);
                }
                menuDropdown.classList.remove('open');
            });
            menuDropdown.appendChild(deleteOption);
            
            // Add click event handler for the menu button
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Close all other open dropdowns first
                document.querySelectorAll('.ticket-menu-dropdown.open').forEach(dropdown => {
                    if (dropdown !== menuDropdown) {
                        dropdown.classList.remove('open');
                    }
                });
                
                menuDropdown.classList.toggle('open');
                
                if (menuDropdown.classList.contains('open')) {
                    // Move dropdown to document body to avoid clipping
                    document.body.appendChild(menuDropdown);
                    
                    // Calculate position relative to viewport
                    const buttonRect = menuBtn.getBoundingClientRect();
                    const popupHeight = window.innerHeight;
                    const spaceBelow = popupHeight - buttonRect.bottom;
                    const dropdownHeight = 120; // Approximate height of dropdown
                    
                    // Position the dropdown using fixed positioning
                    menuDropdown.style.position = 'fixed';
                    menuDropdown.style.minWidth = '200px';
                    menuDropdown.style.zIndex = '99999999';
                    
                    if (spaceBelow < dropdownHeight) {
                        // Show above if not enough space below
                        menuDropdown.style.top = (buttonRect.top - dropdownHeight - 4) + 'px';
                    } else {
                        // Show below
                        menuDropdown.style.top = (buttonRect.bottom + 4) + 'px';
                    }
                    
                    // Position horizontally
                    menuDropdown.style.left = (buttonRect.right - 200) + 'px';
                } else {
                    // Move dropdown back to header when closing
                    header.appendChild(menuDropdown);
                }
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
                    menuDropdown.classList.remove('open');
                    // Move dropdown back to header
                    header.appendChild(menuDropdown);
                }
            });
            
            header.appendChild(menuBtn);
            header.appendChild(menuDropdown);
            ticketElement.appendChild(header);
            
            // Description
            const descDiv = document.createElement('div');
            descDiv.className = 'ticket-description';
            descDiv.textContent = ticket.description;
            ticketElement.appendChild(descDiv);
            
            // Make the card clickable to open the ticket
            ticketElement.addEventListener('click', (e) => {
                if (!e.target.closest('.ticket-menu-btn')) {
                    window.open(`${zendeskDomain}/agent/tickets/${ticket.ticketId}`, '_blank');
                }
            });
            
            pinnedTicketsList.appendChild(ticketElement);
        });
        
        // Update count and limit display
        const countElement = document.getElementById('pinnedTicketsCount');
        const limitElement = document.getElementById('pinnedTicketsLimit');
        
        if (countElement) {
            if (isPro) {
                countElement.textContent = '';
            } else {
                countElement.textContent = tickets.length;
            }
        }
        
        if (limitElement) {
            if (isPro) {
                limitElement.textContent = ' (Unlimited)';
            } else {
                limitElement.textContent = '/3';
            }
        }
        

    } catch (error) {
        console.error('Error loading pinned tickets:', error);
    }
}

// Get pinned tickets
async function getPinnedTickets(user, isPro) {
  if (isPro && user?.uid) {
    // Pro: Store in Firestore as reminders with type 'pinned'
    const reminders = await getUserReminders(user.uid);
    const pinnedTickets = reminders
      .filter((r) => r.type === "pinned")
      .map((r) => ({
        ticketId: r.ticketId,
        description: r.description,
        pinnedAt: r.pinnedAt || r.createdAt || Date.now(),
        id: r.id,
      }));
    return pinnedTickets;
  } else {
    // Free: Store in local storage
    return new Promise((resolve) => {
      chrome.storage.local.get({ pinnedTickets: [] }, (data) => {
        resolve(data.pinnedTickets || []);
      });
    });
  }
}

// Add pin buttons to ticket lists
function addPinButtonsToTickets(user, isPro) {
  // For each ticket in important, overdue, completed lists
  [
    "importantTicketsList",
    "overdueTicketsList",
    "completedTicketsList",
  ].forEach((listId) => {
    const list = document.getElementById(listId);
    if (!list) return;
    Array.from(list.children).forEach(async (li) => {
      const link = li.querySelector("a");
      if (!link) return;
      const ticketIdMatch = link.href.match(/tickets\/(\d+)/);
      if (!ticketIdMatch) return;
      const ticketId = ticketIdMatch[1];
      const description = link.textContent.split(" - ").slice(1).join(" - ");
      // Only add pin button if not already pinned
      if (!(await isTicketPinned(user, isPro, ticketId))) {
        const pinBtn = document.createElement("button");
        pinBtn.textContent = "Pin";
        pinBtn.className = "copy-btn";
        pinBtn.style.marginLeft = "8px";
        pinBtn.addEventListener("click", async () => {
          try {
            await pinTicket(user, isPro, { ticketId, description });
            await displayPinnedTickets(user, isPro);
            addPinButtonsToTickets(user, isPro);
          } catch (error) {
            console.error("Failed to pin ticket:", error);
          }
        });
        li.appendChild(pinBtn);
      }
    });
  });
}

// Check if a ticket is pinned
async function isTicketPinned(user, isPro, ticketId) {
  const pinnedTickets = await getPinnedTickets(user, isPro);
  return pinnedTickets.some((t) => t.ticketId === ticketId);
}

// Update pinned tickets on auth state change
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const isPro = await isUserPro(user.uid);
    await displayPinnedTickets(user, isPro);
    addPinButtonsToTickets(user, isPro);
  } else {
    displayPinnedTickets({ uid: "" }, false);
  }
});

// Also update after reminders are loaded
async function afterRemindersLoaded(user) {
  const isPro = await isUserPro(user.uid);
  await displayPinnedTickets(user, isPro);
  addPinButtonsToTickets(user, isPro);
}

// Patch loadReminders to call afterRemindersLoaded
const origLoadReminders = loadReminders;
loadReminders = async function (user) {
  await origLoadReminders(user);
  await afterRemindersLoaded(user);
};

// Add new function to load free user data
async function loadFreeUserData() {
  chrome.storage.local.get(
    ["importantTickets", "completedTickets", "overdueTickets", "pinnedTickets"],
    (data) => {
      displayImportantTickets(data.importantTickets || []);
      displayCompletedTickets(data.completedTickets || []);
      displayOverdueTickets(data.overdueTickets || []);
      displayPinnedTickets({ uid: "" }, false);
    }
  );
}

// Add migration function for Pro users
async function migrateLocalToFirestore(userId) {
  try {
    // First check if we need to migrate
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "importantTickets",
          "completedTickets",
          "overdueTickets",
          "pinnedTickets",
        ],
        resolve
      );
    });

    // Check if there's any data to migrate
    const hasDataToMigrate =
      (localData.importantTickets && localData.importantTickets.length > 0) ||
      (localData.completedTickets && localData.completedTickets.length > 0) ||
      (localData.overdueTickets && localData.overdueTickets.length > 0) ||
      (localData.pinnedTickets && localData.pinnedTickets.length > 0);

    if (!hasDataToMigrate) {
      console.log("No data to migrate");
      return;
    }

    // Migrate important tickets
    for (const ticket of localData.importantTickets || []) {
      await createReminder(userId, {
        ...ticket,
        type: "important",
        status: "active",
      });
    }

    // Migrate completed tickets
    for (const ticket of localData.completedTickets || []) {
      await createReminder(userId, {
        ...ticket,
        type: "completed",
        status: "completed",
      });
    }

    // Migrate overdue tickets
    for (const ticket of localData.overdueTickets || []) {
      await createReminder(userId, {
        ...ticket,
        type: "overdue",
        status: "active",
      });
    }

    // Migrate pinned tickets
    for (const ticket of localData.pinnedTickets || []) {
      await createReminder(userId, {
        ...ticket,
        type: "pinned",
        status: "active",
      });
    }

    // Clear local storage after successful migration
    await chrome.storage.local.remove([
      "importantTickets",
      "completedTickets",
      "overdueTickets",
      "pinnedTickets",
    ]);

    showToast("Successfully migrated your data to Pro!");
  } catch (error) {
    console.error("Migration failed:", error);
    showToast("Failed to migrate data. Please try again.");
  }
}

// Add update ticket description function
async function updateTicketDescription(user, isPro, ticketId, newDescription) {
  try {
    if (isPro) {
      const reminders = await getUserReminders(user.uid);
      const reminder = reminders.find((r) => r.ticketId === ticketId);
      if (reminder) {
        await updateReminder(reminder.id, { description: newDescription });
      }
    } else {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(
          [
            "importantTickets",
            "completedTickets",
            "overdueTickets",
            "pinnedTickets",
          ],
          resolve
        );
      });

      // Update in all relevant lists
      const updateList = (list) => {
        return list.map((ticket) =>
          ticket.ticketId === ticketId
            ? { ...ticket, description: newDescription }
            : ticket
        );
      };

      await chrome.storage.local.set({
        importantTickets: updateList(data.importantTickets || []),
        completedTickets: updateList(data.completedTickets || []),
        overdueTickets: updateList(data.overdueTickets || []),
        pinnedTickets: updateList(data.pinnedTickets || []),
      });
    }

    showToast("Ticket updated successfully");
    
    // Refresh the UI based on user type
    if (user) {
      await loadReminders(user);
    } else {
      // For Free users, refresh from local storage
      loadFreeUserData();
    }
  } catch (error) {
    console.error("Error updating ticket:", error);
    showToast("Failed to update ticket");
  }
}

// Add delete ticket function
async function deleteTicket(user, isPro, ticketId) {
  try {
    if (isPro) {
      const reminders = await getUserReminders(user.uid);
      const reminder = reminders.find((r) => r.ticketId === ticketId);
      if (reminder) {
        await deleteReminder(reminder.id);
      }
    } else {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(
          [
            "importantTickets",
            "completedTickets",
            "overdueTickets",
            "pinnedTickets",
          ],
          resolve
        );
      });

      // Remove from all lists
      const removeFromList = (list) => {
        return list.filter((ticket) => ticket.ticketId !== ticketId);
      };

      await chrome.storage.local.set({
        importantTickets: removeFromList(data.importantTickets || []),
        completedTickets: removeFromList(data.completedTickets || []),
        overdueTickets: removeFromList(data.overdueTickets || []),
        pinnedTickets: removeFromList(data.pinnedTickets || []),
      });
    }

    // Refresh the UI based on user type
    if (user) {
      await loadReminders(user);
    } else {
      // For Free users, refresh from local storage
      loadFreeUserData();
    }
  } catch (error) {
    console.error("Error deleting ticket:", error);
  }
}

// Initialize macros
async function initializeMacros() {
  const user = auth.currentUser;
  const macrosList = document.getElementById("macrosList");
  if (!macrosList) return;

  try {
    let macros = [];
    let isPro = false;
    
    if (user) {
      // Pro user: Get from Firestore
      isPro = await isUserPro(user.uid);
      macros = await getMacros(user);
    } else {
      // Free user: Get from local storage
      const data = await new Promise((resolve) => {
        chrome.storage.local.get({ macros: [] }, resolve);
      });
      macros = data.macros || [];
    }

    macrosList.innerHTML = "";
    macros.forEach((macro) => {
      const macroElement = createMacroElement(macro);
      macrosList.appendChild(macroElement);
    });

    // Update macro count display
    updateMacroCountDisplay(macros.length, isPro);
  } catch (error) {
    console.error("Error loading macros:", error);
    showToast("Error loading macros", "error");
  }
}

// Update macro count display based on user plan
function updateMacroCountDisplay(macroCount, isPro) {
  const countElement = document.getElementById('macrosCount');
  const limitElement = document.getElementById('macrosLimit');
  
  if (countElement) {
    if (isPro) {
      countElement.textContent = '';
    } else {
      countElement.textContent = macroCount;
    }
  }
  
  if (limitElement) {
    if (isPro) {
      limitElement.textContent = ' (Unlimited)';
    } else {
      limitElement.textContent = '/3';
    }
  }
}

// Update createMacroElement to include icons and better structure
function createMacroElement(macro) {
  const div = document.createElement("div");
  div.className = "macro-item";
  div.innerHTML = `
    <div class="macro-header">
      <span class="macro-name">${macro.name}</span>
      <div class="macro-actions">
        <button class="copy-btn" title="Copy to clipboard">
          <i class="fas fa-copy"></i> Copy
        </button>
        <button class="macro-menu-btn" title="Macro options">
          <i class="fas fa-ellipsis-v"></i>
        </button>
        <div class="macro-menu-dropdown">
          <button class="menu-option edit-option">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="menu-option delete-option">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    </div>
    <div class="macro-content">${macro.content}</div>
  `;

  // Add event listeners
  const copyBtn = div.querySelector(".copy-btn");
  const menuBtn = div.querySelector(".macro-menu-btn");
  const menuDropdown = div.querySelector(".macro-menu-dropdown");
  const editOption = div.querySelector(".edit-option");
  const deleteOption = div.querySelector(".delete-option");

  copyBtn.addEventListener("click", async () => {
    const success = await copyMacroToClipboard(macro.content);
    if (success) {
      showToast("Macro copied to clipboard!", "success");
    } else {
      showToast("Failed to copy macro", "error");
    }
  });

  // Menu button click handler
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    
    // Check if dropdown is currently open
    const isOpen = menuDropdown.classList.contains('open');
    
    if (!isOpen) {
      // Calculate available space below the button
      const buttonRect = menuBtn.getBoundingClientRect();
      const popupHeight = window.innerHeight;
      const spaceBelow = popupHeight - buttonRect.bottom;
      const dropdownHeight = 80; // Approximate height of dropdown
      
      // If not enough space below, show above
      if (spaceBelow < dropdownHeight) {
        menuDropdown.classList.add('above');
      } else {
        menuDropdown.classList.remove('above');
      }
    }
    
    menuDropdown.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!menuDropdown.contains(e.target) && !menuBtn.contains(e.target)) {
      menuDropdown.classList.remove('open');
    }
  });

  editOption.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('open');
    showEditMacroModal(macro);
  });

  deleteOption.addEventListener("click", async (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('open');
    
    if (confirm("Are you sure you want to delete this macro?")) {
      try {
        const user = auth.currentUser;
        if (user) {
          // Pro user: Use deleteMacro function
          await deleteMacro(user, macro.id);
        } else {
          // Free user: Delete from local storage
          const data = await new Promise((resolve) => {
            chrome.storage.local.get({ macros: [] }, resolve);
          });
          const updatedMacros = data.macros.filter((m) => m.id !== macro.id);
          await chrome.storage.local.set({ macros: updatedMacros });
        }
        div.remove();
        
        // Update macro count display
        const currentUser = auth.currentUser;
        const isPro = currentUser ? await isUserPro(currentUser.uid) : false;
        const macrosList = document.getElementById("macrosList");
        const currentMacros = macrosList ? macrosList.children.length : 0;
        updateMacroCountDisplay(currentMacros, isPro);
        
        showToast("Macro deleted successfully", "success");
      } catch (error) {
        console.error("Error deleting macro:", error);
        showToast("Error deleting macro", "error");
      }
    }
  });

  return div;
}

// Settings are now controlled by the options page

// Show edit macro modal
function showEditMacroModal(macro) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Macro</h2>
      <input type="text" id="editMacroName" value="${macro.name}" placeholder="Macro Name">
      <textarea id="editMacroContent" placeholder="Macro Content">${macro.content}</textarea>
      <div class="modal-actions">
        <button id="saveMacroBtn">Save</button>
        <button id="cancelMacroBtn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const saveBtn = modal.querySelector("#saveMacroBtn");
  const cancelBtn = modal.querySelector("#cancelMacroBtn");
  const nameInput = modal.querySelector("#editMacroName");
  const contentInput = modal.querySelector("#editMacroContent");

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const content = contentInput.value.trim();

    if (!name || !content) {
      showToast("Please fill in all fields", "error");
      return;
    }

    try {
      const user = auth.currentUser;
      if (user) {
        // Pro user: Use updateMacro function
        await updateMacro(user, macro.id, name, content);
      } else {
        // Free user: Update in local storage
        const data = await new Promise((resolve) => {
          chrome.storage.local.get({ macros: [] }, resolve);
        });
        const updatedMacros = data.macros.map((m) =>
          m.id === macro.id ? { ...m, name, content } : m
        );
        await chrome.storage.local.set({ macros: updatedMacros });
      }
      
      macro.name = name;
      macro.content = content;

      const macroElement = document.querySelector(
        `[data-macro-id="${macro.id}"]`
      );
      if (macroElement) {
        macroElement.querySelector(".macro-name").textContent = name;
        macroElement.querySelector(".macro-content").textContent = content;
      }

      modal.remove();
      showToast("Macro updated successfully", "success");
    } catch (error) {
      console.error("Error updating macro:", error);
      showToast("Error updating macro", "error");
    }
  });

  cancelBtn.addEventListener("click", () => {
    modal.remove();
  });
}

// Add live sync for dark mode
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.darkMode) {
    const isDark = changes.darkMode.newValue;
    document.body.classList.toggle('dark-mode', isDark);
  }
});

// Listen for sign-in completion from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "completeSignIn") {
    completeSignInFromBackground(request.idToken, request.accessToken);
  } else if (request.action === "signInComplete") {
    showToast("Successfully signed in!", "success");
    // Update UI with the user data
    if (request.user) {
      // Update the UI to show signed in state
      const userInfo = document.getElementById("userInfo");
      const loginBtn = document.getElementById("loginBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      const proBadge = document.getElementById("proBadge");
      const upgradeBtn = document.getElementById("upgradeBtn");
      
      if (userInfo) userInfo.textContent = `Signed in as ${request.user.displayName || request.user.email}`;
      if (loginBtn) loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "inline-block";
      
      // Reload the page to update all UI elements
      window.location.reload();
    }
  }
});

// Check for pending sign-in on popup load
chrome.storage.local.get(['pendingSignIn', 'signInTimestamp', 'shouldReopenPopup'], (data) => {
  if (data.pendingSignIn && data.signInTimestamp) {
    const timeDiff = Date.now() - data.signInTimestamp;
    // Only process if less than 5 minutes old
    if (timeDiff < 5 * 60 * 1000) {

      completeSignInFromBackground(data.pendingSignIn.idToken, data.pendingSignIn.accessToken);
      // Clear the pending sign-in
      chrome.storage.local.remove(['pendingSignIn', 'signInTimestamp', 'shouldReopenPopup']);
    } else {
      // Clear old pending sign-in
      chrome.storage.local.remove(['pendingSignIn', 'signInTimestamp', 'shouldReopenPopup']);
    }
  }
  
  // If popup was reopened to show success message, clear the flag
  if (data.shouldReopenPopup) {
    chrome.storage.local.remove(['shouldReopenPopup']);
  }
});

// Check for stored user data on popup load
chrome.storage.local.get(['user'], (data) => {
  if (data.user) {
    // Update UI to show signed in state
    const userInfo = document.getElementById("userInfo");
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    
    if (userInfo) userInfo.textContent = `Signed in as ${data.user.displayName || data.user.email}`;
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
  }
});

// Unified Theme Manager
let currentTheme = 'ocean-blue';
let isDarkMode = false;

function initializeThemeSystem() {
  const themeBtn = document.getElementById('themeBtn');
  const themeDropdown = document.getElementById('themeDropdown');
  
  if (!themeBtn || !themeDropdown) return;
  
  // Load saved theme and dark mode together
  Promise.all([
    new Promise(resolve => chrome.storage.local.get(['selectedTheme'], resolve)),
    new Promise(resolve => chrome.storage.sync.get(['darkMode'], resolve))
  ]).then(([themeData, darkModeData]) => {
    currentTheme = themeData.selectedTheme || 'ocean-blue';
    isDarkMode = darkModeData.darkMode || false;
    
    console.log('Theme system initialization - theme:', currentTheme, 'darkMode:', isDarkMode);
    
    // Apply both theme and dark mode
    applyThemeAndDarkMode(currentTheme, isDarkMode);
    updateActiveThemeOption(currentTheme);
  });
  
  // Theme button click handler
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Close other dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(dropdown => {
      dropdown.classList.remove('open');
    });
    
    themeDropdown.classList.toggle('open');
  });
  
  // Theme option click handlers
  const themeOptions = themeDropdown.querySelectorAll('.theme-option');
  themeOptions.forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const newTheme = option.getAttribute('data-theme');
      console.log('Theme selected:', newTheme);
      
      currentTheme = newTheme;
      applyThemeAndDarkMode(currentTheme, isDarkMode);
      updateActiveThemeOption(currentTheme);
      themeDropdown.classList.remove('open');
      
      // Save theme preference
      chrome.storage.local.set({ selectedTheme: currentTheme }, () => {
        console.log('Theme saved to storage:', currentTheme);
      });
    });
  });
  
  // Close theme dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!themeBtn.contains(e.target) && !themeDropdown.contains(e.target)) {
      themeDropdown.classList.remove('open');
    }
  });
}

function applyThemeAndDarkMode(theme, darkMode) {
  // Remove existing theme classes
  document.documentElement.removeAttribute('data-theme');
  document.body.removeAttribute('data-theme');
  
  // Apply dark mode class
  if (darkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  
  // Apply new theme
  if (theme !== 'ocean-blue') {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }
  
  console.log('Applied theme:', theme, 'darkMode:', darkMode);
}

function updateActiveThemeOption(theme) {
  // Remove active class from all options
  document.querySelectorAll('.theme-option').forEach(option => {
    option.classList.remove('active');
  });
  
  // Add active class to current theme
  const activeOption = document.querySelector(`[data-theme="${theme}"]`);
  if (activeOption) {
    activeOption.classList.add('active');
  }
}

// Modern Dark Mode Toggle System
function initializeDarkModeToggle() {
  const darkModeBtn = document.getElementById('darkModeBtn');
  
  if (!darkModeBtn) return;
  
  // Enhanced dark mode toggle click handler
  darkModeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    
    // Add toggling animation class
    darkModeBtn.classList.add('toggling');
    
    // Toggle dark mode state
    isDarkMode = !isDarkMode;
    
    console.log('Dark mode toggle - new state:', isDarkMode, 'current theme:', currentTheme);
    
    // Smooth transition with slight delay for animation
    setTimeout(() => {
      // Apply both theme and dark mode together
      applyThemeAndDarkMode(currentTheme, isDarkMode);
      
      // Save preference
      chrome.storage.sync.set({ darkMode: isDarkMode });
      
      // Show enhanced toast notification
      const message = isDarkMode ? '🌙 Dark mode enabled' : '☀️ Light mode enabled';
      showToast(message, 'success');
      
      // Remove toggling class after animation
      setTimeout(() => {
        darkModeBtn.classList.remove('toggling');
      }, 300);
    }, 150);
  });
  
  // Keyboard accessibility
  darkModeBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      darkModeBtn.click();
    }
  });
  
  // Enhanced hover feedback
  darkModeBtn.addEventListener('mouseenter', () => {
    const isDark = document.body.classList.contains('dark-mode');
    const tooltip = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    darkModeBtn.setAttribute('title', tooltip);
  });
}

// Initialize theme system and dark mode toggle
setTimeout(() => {
  initializeThemeSystem();
  initializeDarkModeToggle();
}, 500);
