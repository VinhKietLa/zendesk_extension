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
import {
  initializePayments,
  checkProSubscription,
  purchasePro,
  restorePurchases,
  getSubscriptionStatus,
} from "./payments.js";

const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID;
const CLOUD_FUNCTION_URL = "https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app";

// Helper function to format time consistently across all tabs
function formatTicketTime(reminderTime) {
  if (!reminderTime) return null;
  
  console.log("🔍 formatTicketTime called with:", reminderTime, typeof reminderTime);
  
  try {
    const date = new Date(reminderTime);
    console.log("🔍 Parsed date:", date, "Is valid:", !isNaN(date.getTime()));
    
    if (isNaN(date.getTime())) {
      console.error("❌ Invalid date object created from:", reminderTime);
      return "Invalid reminder time";
    }
    
    const now = new Date();
    
    // Check if the date is in the past
    if (date < now) {
      // Format as "Overdue - DD/MM/YYYY HH:MM"
      const formattedDate = date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log("✅ Past date formatted as overdue:", formattedDate);
      return `Overdue - ${formattedDate}`;
    } else {
      // Format as normal: DD/MM/YYYY HH:MM
      const formattedDate = date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log("✅ Future date formatted normally:", formattedDate);
      return formattedDate;
    }
  } catch (error) {
    console.error('❌ Error formatting time:', error);
    return "Error formatting time";
  }
}

// Helper function to check auto-refresh status and restart if needed
async function checkAutoRefreshStatus() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "checkAutoRefreshStatus" }, resolve);
    });
    
    if (response && response.shouldBeRunning) {
      console.log("🔄 Auto-refresh was not running but should be - background script is restarting it");
    }
  } catch (error) {
    console.log("Could not check auto-refresh status:", error);
  }
}

// Helper function to validate reminder time and show warning for past dates
function validateReminderTime(date, time) {
  if (!date && !time) return { isValid: true };
  
  let combinedDateTime = null;
  let isDateOnly = false;
  
  if (date && time) {
    // Both date and time provided - exact datetime comparison
    combinedDateTime = new Date(`${date}T${time}`);
  } else if (date) {
    // Date only - treat as "all day" for that date
    // Compare just the date part (ignore time)
    const selectedDate = new Date(date);
    const today = new Date();
    
    // Reset both to midnight for date-only comparison
    const selectedDateOnly = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    if (selectedDateOnly < todayOnly) {
      return {
        isValid: false,
        message: "This reminder date is in the past",
        options: [
          { label: "Create overdue reminder", action: "overdue", description: "Get notified immediately" },
          { label: "Set to today", action: "adjust", description: "Set reminder for today" },
          { label: "Pick different date", action: "cancel", description: "Choose a new date" }
        ]
      };
    }
    return { isValid: true };
  } else if (time) {
    // Time only - smart handling for past times
    const today = new Date();
    const [hours, minutes] = time.split(':');
    const timeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hours), parseInt(minutes));
    
    // If the time has already passed today, set it for tomorrow
    if (timeToday < today) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      combinedDateTime = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), parseInt(hours), parseInt(minutes));
    } else {
      // Time is still in the future today
      combinedDateTime = timeToday;
    }
  }
  
  // Only check time-based comparisons (when we have a specific time)
  if (combinedDateTime && combinedDateTime < new Date()) {
    return {
      isValid: false,
      message: "This reminder time is in the past",
      options: [
        { label: "Create overdue reminder", action: "overdue", description: "Get notified immediately" },
        { label: "Set to 1 hour from now", action: "adjust", description: "Recommended for most cases" },
        { label: "Pick different time", action: "cancel", description: "Choose a new date/time" }
      ]
    };
  }
  
  return { isValid: true };
}

// Helper function to show past date warning modal
function showPastDateWarning(date, time, onConfirm) {
  const validation = validateReminderTime(date, time);
  if (validation.isValid) {
    onConfirm(date, time, false);
    return;
  }
  
  const modal = document.createElement("div");
  modal.className = "edit-modal";
  modal.innerHTML = `
    <div class="edit-modal-content" style="max-width: 400px;">
      <div class="edit-modal-header">
        <h3>⚠️ Past Reminder Time</h3>
        <button class="close-edit-modal">&times;</button>
      </div>
      <div class="edit-modal-body">
        <p style="margin-bottom: 16px; color: #dc2626; font-weight: 500;">
          ${validation.message}
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${validation.options.map(option => `
            <button class="past-date-option" data-action="${option.action}">
              <div style="font-weight: 600; text-align: left;">${option.label}</div>
              <div style="font-size: 12px; color: #6b7280; text-align: left;">${option.description}</div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector(".close-edit-modal");
  const optionBtns = modal.querySelectorAll(".past-date-option");
  
  const closeModal = () => modal.remove();
  
  closeBtn.addEventListener("click", closeModal);
  
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  
  optionBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      closeModal();
      
      switch (action) {
        case "overdue":
          onConfirm(date, time, true);
          break;
        case "adjust":
          if (date && !time) {
            // Date-only adjustment: set to today
            const today = new Date().toISOString().split('T')[0];
            onConfirm(today, "", false);
            showToast("Reminder date adjusted to today", "success");
          } else {
            // Time-based adjustment: set to 1 hour from now
            const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
            const adjustedDate = oneHourFromNow.toISOString().split('T')[0];
            const adjustedTime = oneHourFromNow.toTimeString().slice(0, 5);
            onConfirm(adjustedDate, adjustedTime, false);
            showToast("Reminder time adjusted to 1 hour from now", "success");
          }
          break;
        case "cancel":
          // Do nothing, user can pick a different time
          break;
      }
    });
  });
}

// Helper function to load reminders based on user type
async function loadReminders(user) {
  if (!user || !user.uid) return;

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
async function addReminder(user, ticketId, description, reminderTime, isOverdue = false) {
  if (!user || !user.uid) throw new Error("User not authenticated");

  const pro = await isUserPro(user.uid);

  if (pro) {
    // Pro: Save to Firestore
    if (isOverdue) {
      // For overdue tickets, create directly as overdue (no notification needed)
      await createReminder(user.uid, {
        ticketId,
        description,
        reminderTime,
        type: "overdue",
        status: "overdue",
      });
    } else {
      // For future tickets, create as important (will get notification when due)
      await createReminder(user.uid, {
        ticketId,
        description,
        reminderTime,
        type: "important",
        status: "active",
      });
    }
    // Reload all reminders from Firestore
    await loadReminders(user);
  } else {
    // Free: Save to local storage only
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ importantTickets: [], overdueTickets: [] }, async (data) => {
        try {
          const currentTickets = [...data.importantTickets];
          const currentOverdueTickets = [...data.overdueTickets];
          const isDuplicate = currentTickets.some(
            (ticket) => ticket.ticketId === ticketId
          ) || currentOverdueTickets.some(
            (ticket) => ticket.ticketId === ticketId
          );

          if (isDuplicate) {
            throw new Error(
              `Ticket ID #${ticketId} already exists. Please enter a unique ID.`
            );
          }

          if (isOverdue) {
            // Add to overdue tickets
            const updatedOverdueTickets = [
              ...currentOverdueTickets,
              { ticketId, description, reminderTime },
            ];
            await chrome.storage.local.set({ overdueTickets: updatedOverdueTickets });
            // Refresh all tabs to show the ticket moved to overdue
            loadFreeUserData();
          } else {
            // Add to important tickets
            const updatedTickets = [
              ...currentTickets,
              { ticketId, description, reminderTime },
            ];
            await chrome.storage.local.set({ importantTickets: updatedTickets });
            displayImportantTickets(updatedTickets);
          }
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
  // Handle free users (user is null)
  if (!user) {
    // Free: Update local storage only
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(
        ["importantTickets", "completedTickets", "overdueTickets", "pinnedTickets"],
        async (data) => {
          try {
            const importantTickets = data.importantTickets || [];
            const overdueTickets = data.overdueTickets || [];
            const completedTickets = data.completedTickets || [];
            const pinnedTickets = data.pinnedTickets || [];

            // Check all ticket lists
            const ticket =
              importantTickets.find((t) => t.ticketId === ticketId) ||
              overdueTickets.find((t) => t.ticketId === ticketId) ||
              pinnedTickets.find((t) => t.ticketId === ticketId);

            if (ticket) {
              // Remove from all lists
              const updatedImportantTickets = importantTickets.filter(
                (t) => t.ticketId !== ticketId
              );
              const updatedOverdueTickets = overdueTickets.filter(
                (t) => t.ticketId !== ticketId
              );
              const updatedPinnedTickets = pinnedTickets.filter(
                (t) => t.ticketId !== ticketId
              );

              const updatedCompletedTickets = [
                ...completedTickets,
                { 
                  ticketId: ticket.ticketId, 
                  description: ticket.description,
                  reminderTime: ticket.reminderTime, // Preserve original reminder time
                  completedAt: Date.now()
                },
              ];

              await chrome.storage.local.set({
                importantTickets: updatedImportantTickets,
                overdueTickets: updatedOverdueTickets,
                completedTickets: updatedCompletedTickets,
                pinnedTickets: updatedPinnedTickets,
              });

              displayImportantTickets(updatedImportantTickets);
              displayOverdueTickets(updatedOverdueTickets);
              displayCompletedTickets(updatedCompletedTickets);
              displayPinnedTickets(null, false);
              resolve();
            } else {
              reject(new Error("Ticket not found"));
            }
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  // Only check if user is pro if user exists and has a valid uid
  const pro = user && user.uid ? await isUserPro(user.uid) : false;

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
        ["importantTickets", "completedTickets", "overdueTickets", "pinnedTickets"],
        async (data) => {
          try {
            const importantTickets = data.importantTickets || [];
            const overdueTickets = data.overdueTickets || [];
            const completedTickets = data.completedTickets || [];
            const pinnedTickets = data.pinnedTickets || [];

            // Check all ticket lists
            const ticket =
              importantTickets.find((t) => t.ticketId === ticketId) ||
              overdueTickets.find((t) => t.ticketId === ticketId) ||
              pinnedTickets.find((t) => t.ticketId === ticketId);

            if (ticket) {
              // Remove from all lists
              const updatedImportantTickets = importantTickets.filter(
                (t) => t.ticketId !== ticketId
              );
              const updatedOverdueTickets = overdueTickets.filter(
                (t) => t.ticketId !== ticketId
              );
              const updatedPinnedTickets = pinnedTickets.filter(
                (t) => t.ticketId !== ticketId
              );

              const updatedCompletedTickets = [
                ...completedTickets,
                { 
                  ticketId: ticket.ticketId, 
                  description: ticket.description,
                  reminderTime: ticket.reminderTime, // Preserve original reminder time
                  completedAt: Date.now() // Add completion timestamp
                },
              ];

              await chrome.storage.local.set({
                importantTickets: updatedImportantTickets,
                overdueTickets: updatedOverdueTickets,
                completedTickets: updatedCompletedTickets,
                pinnedTickets: updatedPinnedTickets,
              });

              displayImportantTickets(updatedImportantTickets);
              displayOverdueTickets(updatedOverdueTickets);
              displayCompletedTickets(updatedCompletedTickets);
              displayPinnedTickets(null, false);
              resolve();
            } else {
              reject(new Error("Ticket not found"));
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
  if (!user || !user.uid) throw new Error("User not authenticated");

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
  
  // Initialize theme system immediately to prevent flash
  initializeThemeSystem();
  initializeDarkModeToggle();
  
  // Initialize licensing
  await initializeLicensing();

  // Initialize payment system
  await initializePayments();
  
  // Check auto-refresh status when popup opens to ensure it's working
  checkAutoRefreshStatus();

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
        
        if (currentUser && currentUser.uid) {
          const isPro = await isUserPro(currentUser.uid);
          await loadReminders(currentUser);
        } else {
          // For free users, load from local storage
          loadFreeUserData();
        }
      } else if (tabId === "pinned") {
        // Get current user and pro status
        const currentUser = auth.currentUser;
        
        if (currentUser && currentUser.uid) {
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

          // Check pro status using Chrome payments and Firebase
          const chromeProStatus = await checkProSubscription();
          const firebaseProStatus = await isUserPro(user.uid);
          let isPro = chromeProStatus || firebaseProStatus;
          
          // TEMPORARY FIX: Force Free mode for testing
          isPro = false;
          
          console.log("🔍 Pro status check:", { 
            chromeProStatus, 
            firebaseProStatus, 
            finalIsPro: isPro,
            userId: user.uid 
          });
          
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
        console.log("🔍 Calling displayPinnedTickets with:", { user: user?.uid, isPro });
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

    // Show past date warning if needed
    showPastDateWarning(reminderDate, reminderTime, async (finalDate, finalTime, isOverdue = false) => {
      // Combine date and time if both are provided
      let combinedReminderTime = "";
      if (finalDate && finalTime) {
        combinedReminderTime = `${finalDate}T${finalTime}`;
      } else if (finalDate) {
        // If only date is provided, set it to end of day (23:59) for proper datetime format
        combinedReminderTime = `${finalDate}T23:59`;
      } else if (finalTime) {
        // If only time is provided, use smart time handling
        const today = new Date();
        const [hours, minutes] = finalTime.split(':');
        const timeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hours), parseInt(minutes));
        
        // If the time has already passed today, set it for tomorrow
        if (timeToday < today) {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowDate = tomorrow.toISOString().split('T')[0];
          combinedReminderTime = `${tomorrowDate}T${finalTime}`;
        } else {
          // Time is still in the future today
          const todayDate = today.toISOString().split('T')[0];
          combinedReminderTime = `${todayDate}T${finalTime}`;
        }
      }

      const user = auth.currentUser;

      try {
        if (user) {
          // Pro user: Use addReminder function
          await addReminder(user, ticketId, description, combinedReminderTime, isOverdue);
        } else {
          // Free user: Save directly to local storage
          const data = await new Promise((resolve) => {
            chrome.storage.local.get({ importantTickets: [], overdueTickets: [] }, resolve);
          });

          const currentTickets = [...data.importantTickets];
          const currentOverdueTickets = [...data.overdueTickets];
          const isDuplicate = currentTickets.some(
            (ticket) => ticket.ticketId === ticketId
          ) || currentOverdueTickets.some(
            (ticket) => ticket.ticketId === ticketId
          );

          if (isDuplicate) {
            throw new Error(
              `Ticket ID #${ticketId} already exists. Please enter a unique ID.`
            );
          }

          if (isOverdue) {
            // Add to overdue tickets
            const updatedOverdueTickets = [
              ...currentOverdueTickets,
              { ticketId, description, reminderTime: combinedReminderTime },
            ];
            await chrome.storage.local.set({ overdueTickets: updatedOverdueTickets });
            displayOverdueTickets(updatedOverdueTickets);
          } else {
            // Add to important tickets
            const updatedTickets = [
              ...currentTickets,
              { ticketId, description, reminderTime: combinedReminderTime },
            ];
            await chrome.storage.local.set({ importantTickets: updatedTickets });
            displayImportantTickets(updatedTickets);
          }
        }

        // Clear form
        document.getElementById("ticketInput").value = "";
        document.getElementById("ticketDescription").value = "";
        document.getElementById("reminderDate").value = "";
        document.getElementById("reminderTime").value = "";
        
        // Removed success toast for ticket creation
      } catch (error) {
        console.error("Error adding reminder:", error);
        alert(error.message || "Failed to add reminder. Please try again.");
      }
    });
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

  // Upgrade button - opens options page
  if (upgradeBtn) {
    upgradeBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }





  // Listen for reminder updates from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("📨 Received message:", request.action);
    
    if (request.action === "remindersUpdated") {
      console.log("🔄 Refreshing reminders due to update");
      const user = auth.currentUser;
      if (user) {
        loadReminders(user);
      }
      sendResponse({ success: true });
    } else if (request.action === "completeSignIn") {
      completeSignInFromBackground(request.idToken, request.accessToken);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "Unknown action" });
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
      if (enabled && user && user.uid) {
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
  if (user && user.uid) {
    isPro = await isUserPro(user.uid);
    pinnedIds = await getPinnedTicketIds(user, isPro);
  } else {
    // For free users, get pinned tickets from local storage
    isPro = false;
    pinnedIds = await getPinnedTicketIds(null, false);
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
        
        // Pin option - show for both logged-in and free users (FIRST - most common action)
        if (!pinnedIds.includes(ticketId)) {
          const pinOption = document.createElement("button");
          pinOption.className = "menu-option";
          pinOption.innerHTML = '<i class="fas fa-thumbtack icon-navigation"></i> Pin Ticket';
          pinOption.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
              await pinTicket(user, isPro, { ticketId, description, reminderTime });
              // Refresh the UI based on user type
              if (user) {
                await loadReminders(user);
              } else {
                // For Free users, refresh from local storage
                loadFreeUserData();
              }
            } catch (error) {
              console.error("Failed to pin ticket:", error);
            }
            menuDropdown.classList.remove("open");
          });
          menuDropdown.appendChild(pinOption);
        }
        
              // Edit Details option (SECOND - secondary action)
      const editOption = document.createElement("button");
      editOption.className = "menu-option";
      editOption.innerHTML = '<i class="fas fa-edit icon-secondary"></i> Edit Details';
        editOption.addEventListener("click", (e) => {
          e.stopPropagation();
          showEditTicketModal({ ticketId, description, reminderTime }, user, isPro);
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(editOption);
        
        // Mark as Done option (THIRD - completion)
        const completeOption = document.createElement("button");
        completeOption.className = "menu-option";
        completeOption.style.color = "#28a745";
        completeOption.innerHTML = '<i class="fas fa-check-circle icon-done"></i> Mark as Done';
        completeOption.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await markReminderAsDone(user, ticketId);
            // Ensure UI is refreshed for both Pro and Free users
            if (user && user.uid) {
              await loadReminders(user);
            } else {
              // For free users, refresh the display immediately
              chrome.storage.local.get(['importantTickets', 'completedTickets', 'overdueTickets', 'pinnedTickets'], (data) => {
                displayImportantTickets(data.importantTickets || []);
                displayCompletedTickets(data.completedTickets || []);
                displayOverdueTickets(data.overdueTickets || []);
                displayPinnedTickets(null, false);
              });
            }
          } catch (error) {
            console.error("Failed to mark ticket as completed:", error);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(completeOption);
        
              // Delete Ticket option (FOURTH - destructive action)
      const deleteOption = document.createElement("button");
      deleteOption.className = "menu-option delete";
      deleteOption.innerHTML = '<i class="fas fa-trash icon-destructive"></i> Delete Ticket';
        deleteOption.addEventListener("click", (e) => {
          e.stopPropagation();
              showDeleteConfirmationModal(ticketId, () => {
      deleteTicket(user, isPro, ticketId);
    });
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(deleteOption);
        
        // Mark as Overdue option (LAST - specialized action)
        const overdueOption = document.createElement("button");
        overdueOption.className = "menu-option";
        overdueOption.style.color = "#fd7e14";
        overdueOption.innerHTML = '<i class="fas fa-clock icon-overdue"></i> Mark as Overdue';
        overdueOption.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            // Move ticket from important to overdue
            if (isPro && user) {
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
            // Ensure UI is refreshed for both Pro and Free users
            if (user && user.uid) {
              await loadReminders(user);
            } else {
              // For free users, refresh the display immediately
              chrome.storage.local.get(['importantTickets', 'overdueTickets'], (data) => {
                displayImportantTickets(data.importantTickets || []);
                displayOverdueTickets(data.overdueTickets || []);
              });
            }
          } catch (error) {
            console.error("Failed to mark ticket as overdue:", error);
          }
          menuDropdown.classList.remove("open");
        });
        menuDropdown.appendChild(overdueOption);
        
        // Use fixed positioning to prevent clipping
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          
          // Close all other open dropdowns first
          document.querySelectorAll('.ticket-menu-dropdown.open').forEach(dropdown => {
            if (dropdown !== menuDropdown) {
              dropdown.classList.remove('open');
            }
          });
          
          menuDropdown.classList.toggle("open");
          
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
            
            // Position horizontally - align right edge of dropdown with right edge of button
            const dropdownWidth = 200;
            menuDropdown.style.left = (buttonRect.right - dropdownWidth) + 'px';
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

  console.log("🔍 displayCompletedTickets called with tickets:", tickets);

  // Update count badge
  const countElement = document.getElementById('completedTicketsCount');
  if (countElement) {
    countElement.textContent = tickets.length;
  }

  chrome.storage.sync.get("zendeskDomain", (data) => {
    const zendeskDomain =
      data.zendeskDomain || "https://your_zendesk_domain.com";

    tickets.forEach(({ ticketId, description, completedAt, reminderTime }) => {
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
      
      // Move back to Important option (FIRST - most common action for completed tickets)
      const moveToImportantOption = document.createElement('button');
      moveToImportantOption.className = 'menu-option';
      moveToImportantOption.innerHTML = '<i class="fas fa-arrow-left icon-navigation"></i> Move back to Important';
      moveToImportantOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        console.log("🔍 Moving completed ticket back to important:", { ticketId, description, reminderTime });
        
        // Check if user is Pro
        const user = auth.currentUser;
        if (user) {
          try {
            const isPro = await isUserPro(user.uid);
            if (isPro) {
              // Pro: Update in Firestore
              const reminders = await getUserReminders(user.uid);
              const completedReminder = reminders.find(r => r.ticketId === ticketId && r.type === 'completed');
              if (completedReminder) {
                console.log("🔍 Found completed reminder in Firestore:", completedReminder);
                // Update the reminder to important
                await updateReminder(completedReminder.id, {
                  type: 'important',
                  status: 'active'
                });
                // Reload all reminders
                await loadReminders(user);
              }
            } else {
              // Free: Update local storage
              chrome.storage.local.get(['completedTickets', 'importantTickets'], (data) => {
                const updatedCompletedTickets = (data.completedTickets || []).filter(ticket => 
                  ticket.ticketId !== ticketId
                );
                const updatedImportantTickets = [...(data.importantTickets || []), { ticketId, description, reminderTime }];
                
                console.log("🔍 Free user - moving ticket with data:", { ticketId, description, reminderTime });
                console.log("🔍 Updated important tickets:", updatedImportantTickets);
                
                chrome.storage.local.set({ 
                  completedTickets: updatedCompletedTickets,
                  importantTickets: updatedImportantTickets
                }, () => {
                  displayCompletedTickets(updatedCompletedTickets);
                  displayImportantTickets(updatedImportantTickets);
                });
              });
            }
          } catch (error) {
            console.error('Error moving completed ticket to important:', error);
          }
        } else {
          // No user - free mode
          chrome.storage.local.get(['completedTickets', 'importantTickets'], (data) => {
            const updatedCompletedTickets = (data.completedTickets || []).filter(ticket => 
              ticket.ticketId !== ticketId
            );
            const updatedImportantTickets = [...(data.importantTickets || []), { ticketId, description, reminderTime }];
            
            console.log("🔍 No user - moving ticket with data:", { ticketId, description, reminderTime });
            console.log("🔍 Updated important tickets:", updatedImportantTickets);
            
            chrome.storage.local.set({ 
              completedTickets: updatedCompletedTickets,
              importantTickets: updatedImportantTickets
            }, () => {
              displayCompletedTickets(updatedCompletedTickets);
              displayImportantTickets(updatedImportantTickets);
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(moveToImportantOption);
      
      // Edit Details option (SECOND - secondary action)
      const editOption = document.createElement('button');
      editOption.className = 'menu-option';
      editOption.innerHTML = '<i class="fas fa-edit icon-secondary"></i> Edit Details';
      editOption.addEventListener('click', (e) => {
        e.stopPropagation();
        const ticket = { ticketId, description, reminderTime };
        showEditTicketModal(ticket, { uid: '' }, false);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(editOption);
      
      // Delete option (LAST - destructive action)
      const deleteOption = document.createElement('button');
      deleteOption.className = 'menu-option delete';
      deleteOption.innerHTML = '<i class="fas fa-trash icon-destructive"></i> Delete Ticket';
      deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteConfirmationModal(ticketId, async () => {
          await deleteTicket({ uid: '' }, false, ticketId);
          // Ensure completed tickets are refreshed immediately
          loadFreeUserData();
        });
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(deleteOption);
      
      // Toggle dropdown
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close other dropdowns
        document.querySelectorAll('.completed-ticket-menu-dropdown').forEach(dropdown => {
          if (dropdown !== menuDropdown) {
            dropdown.classList.remove('open');
          }
        });
        
        // Check if dropdown is currently open
        const isOpen = menuDropdown.classList.contains('open');
        
        if (!isOpen) {
          // Calculate available space below the button
          const buttonRect = menuBtn.getBoundingClientRect();
          const popupHeight = window.innerHeight;
          const spaceBelow = popupHeight - buttonRect.bottom;
          const dropdownHeight = 120; // Approximate height of dropdown
          
          // If not enough space below, show above
          if (spaceBelow < dropdownHeight) {
            menuDropdown.classList.add('above');
          } else {
            menuDropdown.classList.remove('above');
          }
        }
        
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
      descriptionElement.className = 'completed-ticket-description';
      descriptionElement.textContent = description;
      ticketElement.appendChild(descriptionElement);

      list.appendChild(ticketElement);
    });
  });
}

async function displayOverdueTickets(tickets) {
  const list = document.getElementById("overdueTicketsList");
  if (!list) return;
  list.innerHTML = "";

  // Update count badge
  const countElement = document.getElementById('overdueTicketsCount');
  if (countElement) {
    countElement.textContent = tickets.length;
  }

  // Get current user and Pro status
  const user = auth.currentUser;
  let isPro = false;
  if (user && user.uid) {
    isPro = await isUserPro(user.uid);
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
      
      // Mark as Done option (FIRST - immediate resolution)
      const completeOption = document.createElement('button');
      completeOption.className = 'menu-option';
              completeOption.innerHTML = '<i class="fas fa-check icon-done"></i> Mark as Done';
      completeOption.addEventListener('click', (e) => {
        e.stopPropagation();
        markReminderAsDone(user, ticketId);
        // Refresh the display
        setTimeout(() => {
          loadReminders(user);
        }, 100);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(completeOption);
      
      // Move to Important option (SECOND - status change to prioritize)
      const moveToImportantOption = document.createElement('button');
      moveToImportantOption.className = 'menu-option';
      moveToImportantOption.innerHTML = '<i class="fas fa-arrow-right icon-navigation"></i> Move to Important';
      moveToImportantOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        
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
                // Update the reminder to important
                await updateReminder(overdueReminder.id, {
                  type: 'important',
                  status: 'active'
                });
                // Reload all reminders
                await loadReminders(user);
              }
            } else {
              // Free: Update local storage
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
                  displayImportantTickets(updatedImportantTickets);
                });
              });
            }
          } catch (error) {
            console.error('Error moving ticket to important:', error);
            showToast('Failed to move ticket');
          }
        } else {
          // No user - free mode
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
              displayImportantTickets(updatedImportantTickets);
            });
          });
        }
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(moveToImportantOption);
      
      // Snooze 1 hour option (THIRD - quick delay)
      const snooze1HourOption = document.createElement('button');
      snooze1HourOption.className = 'menu-option';
      snooze1HourOption.innerHTML = '<i class="fas fa-redo icon-overdue"></i> Snooze 1 hour';
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
      
      // Snooze 4 hours option (FOURTH - medium delay)
      const snooze4HoursOption = document.createElement('button');
      snooze4HoursOption.className = 'menu-option';
      snooze4HoursOption.innerHTML = '<i class="fas fa-redo icon-overdue"></i> Snooze 4 hours';
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
      
      // Snooze until tomorrow option (FIFTH - long delay)
      const snoozeTomorrowOption = document.createElement('button');
      snoozeTomorrowOption.className = 'menu-option';
      snoozeTomorrowOption.innerHTML = '<i class="fas fa-redo icon-overdue"></i> Snooze until tomorrow';
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
      
      // Edit Details option (SIXTH - secondary action)
      const editOption = document.createElement('button');
      editOption.className = 'menu-option';
      editOption.innerHTML = '<i class="fas fa-edit icon-secondary"></i> Edit Details';
      editOption.addEventListener('click', (e) => {
        e.stopPropagation();
        const ticket = { ticketId, description, reminderTime };
        showEditTicketModal(ticket, user, isPro);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.appendChild(editOption);
      
      // Delete Ticket option (LAST - destructive action)
      const deleteOption = document.createElement('button');
      deleteOption.className = 'menu-option delete';
      deleteOption.innerHTML = '<i class="fas fa-trash icon-destructive"></i> Delete Ticket';
      deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteConfirmationModal(ticketId, () => {
          deleteTicket(user, isPro, ticketId);
        });
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
          const dropdownHeight = 160; // Approximate height of dropdown (4 options)
          
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
          
          // Position horizontally - align right edge of dropdown with right edge of button
          const dropdownWidth = 200;
          menuDropdown.style.left = (buttonRect.right - dropdownWidth) + 'px';
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
  if (isPro && user) {
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
      reminderTime: ticket.reminderTime, // Preserve reminder time
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
      reminderTime: ticket.reminderTime, // Preserve reminder time
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
  if (isPro && user) {
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
        reminderTime: reminderTime || null,
        type: "important",
        status: "active"
      });
    }
    // Reload all reminders to refresh the UI
    await loadReminders(user);
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
    
    // For free users, userId might be undefined/null, but we still want to display pinned tickets
    // Only return early if we're dealing with Pro users who don't have a valid user object
    if (isPro && (userId === undefined || userId === null)) {
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
            
            // Create header
            const header = document.createElement('div');
            header.className = 'ticket-header';
            
            // Ticket ID badge
            const idBadge = document.createElement('div');
            idBadge.className = 'ticket-id-badge';
            idBadge.textContent = `#${ticket.ticketId}`;
            header.appendChild(idBadge);
            
            // Date/time - show reminder time if available, otherwise show when it was pinned
            let dateTimeText = '';
            if (ticket.reminderTime) {
                const formattedTime = formatTicketTime(ticket.reminderTime);
                dateTimeText = formattedTime || 'Invalid reminder time';
            } else {
                const pinnedDate = new Date(ticket.pinnedAt).toLocaleString('en-GB');
                dateTimeText = `Pinned: ${pinnedDate}`;
            }
            
            const dateTime = document.createElement('div');
            dateTime.className = 'ticket-datetime';
            dateTime.innerHTML = `<i class="fas fa-thumbtack"></i>${dateTimeText}`;
            header.appendChild(dateTime);
            
            // Three-dot menu button
            const menuBtn = document.createElement('button');
            menuBtn.className = 'ticket-menu-btn';
            menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
            menuBtn.setAttribute('aria-label', 'Ticket options');
            
            // Create dropdown menu
            const menuDropdown = document.createElement('div');
            menuDropdown.className = 'ticket-menu-dropdown';
            
            // Unpin option (FIRST - most common action for pinned tickets)
            const unpinOption = document.createElement('button');
            unpinOption.className = 'menu-option';
            unpinOption.innerHTML = '<i class="fas fa-thumbtack icon-navigation"></i> Unpin';
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
            
            // Mark as Done option (SECOND - completion action)
            const doneOption = document.createElement('button');
            doneOption.className = 'menu-option';
            doneOption.style.color = '#28a745';
            doneOption.innerHTML = '<i class="fas fa-check-circle icon-done"></i> Mark as Done';
            doneOption.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    // Mark as done (this will also remove from pinned)
                    await markReminderAsDone(user, ticket.ticketId);
                    // Refresh the display based on user type
                    if (user) {
                        await loadReminders(user);
                    } else {
                        // For Free users, refresh from local storage
                        loadFreeUserData();
                    }
                } catch (error) {
                    console.error("Failed to mark pinned ticket as done:", error);
                }
                menuDropdown.classList.remove('open');
            });
            menuDropdown.appendChild(doneOption);
            
            // Edit option (THIRD - secondary action)
            const editOption = document.createElement('button');
            editOption.className = 'menu-option';
            editOption.innerHTML = '<i class="fas fa-edit icon-secondary"></i> Edit';
            editOption.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log("🔍 Edit clicked for pinned ticket:", ticket);
                console.log("🔍 User:", user, "isPro:", isPro);
                console.log("🔍 About to call showEditTicketModal with:", { ticket, user, isPro });
                showEditTicketModal(ticket, user, isPro);
                menuDropdown.classList.remove('open');
            });
            menuDropdown.appendChild(editOption);
            
            // Delete option (LAST - destructive action)
            const deleteOption = document.createElement('button');
            deleteOption.className = 'menu-option delete';
            deleteOption.innerHTML = '<i class="fas fa-trash icon-destructive"></i> Delete';
            deleteOption.addEventListener('click', async (e) => {
                e.stopPropagation();
                showDeleteConfirmationModal(ticket.ticketId, async () => {
                    await deleteTicket(user, isPro, ticket.ticketId);
                    // Ensure pinned tickets are refreshed immediately
                    if (!user || !user.uid) {
                        // For free users, refresh pinned tickets display
                        await displayPinnedTickets(null, false);
                    }
                });
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
                    
                    // Position horizontally - align right edge of dropdown with right edge of button
                    const dropdownWidth = 200;
                    menuDropdown.style.left = (buttonRect.right - dropdownWidth) + 'px';
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
                limitElement.textContent = ' /3';
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
        reminderTime: r.reminderTime, // Preserve reminder time
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
    // For free users, display pinned tickets with null user
    displayPinnedTickets(null, false);
  }
});

// Also update after reminders are loaded
async function afterRemindersLoaded(user) {
  // Only proceed if user exists
  if (!user) return;
  
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
      displayPinnedTickets(null, false);
    }
  );
  
  // Also initialize macros for free users
  await initializeMacros();
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
    if (isPro && user) {
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
  console.log("🔍 deleteTicket called:", { ticketId, user: user ? 'Pro' : 'Free', isPro });
  try {
    if (isPro && user) {
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

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({
          importantTickets: removeFromList(data.importantTickets || []),
          completedTickets: removeFromList(data.completedTickets || []),
          overdueTickets: removeFromList(data.overdueTickets || []),
          pinnedTickets: removeFromList(data.pinnedTickets || []),
        }, () => {
          if (chrome.runtime.lastError) {
            console.error("❌ Storage error during delete:", chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log("✅ Storage updated during delete");
            resolve();
          }
        });
      });
    }

    // Refresh the UI based on user type
    if (user) {
      console.log("🔍 Pro user - calling loadReminders after delete...");
      await loadReminders(user);
    } else {
      // For Free users, refresh from local storage
      console.log("🔍 Free user - calling loadFreeUserData after delete...");
      loadFreeUserData();
    }
    console.log("✅ UI refresh completed after delete");
  } catch (error) {
    console.error("❌ Error deleting ticket:", error);
    console.error("❌ Error stack:", error.stack);
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
      try {
        isPro = await isUserPro(user.uid);
        macros = await getMacros(user);
      } catch (firestoreError) {
        console.error("Error loading macros from Firestore:", firestoreError);
        // Fallback to empty macros if Firestore fails
        macros = [];
        isPro = false;
      }
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
    // Don't show error toast for macro loading issues during sign-out
    // Only show if it's not a sign-out related error
    if (user) {
      showToast("Error loading macros", "error");
    }
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
      limitElement.textContent = ' /3';
    }
  }
}

// Update createMacroElement to include icons and better structure with text truncation
function createMacroElement(macro) {
  const div = document.createElement("div");
  div.className = "macro-item";
  
  // Truncate content if it's longer than 100 characters
  const isLongContent = macro.content.length > 100;
  const truncatedContent = isLongContent ? macro.content.substring(0, 100) + '...' : macro.content;
  
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
            <i class="fas fa-edit icon-secondary"></i> Edit
          </button>
          <button class="menu-option delete-option">
            <i class="fas fa-trash icon-destructive"></i> Delete
          </button>
        </div>
      </div>
    </div>
    <div class="macro-content">
      <span class="macro-content-text ${isLongContent ? 'truncated' : ''}">${truncatedContent}</span>
      ${isLongContent ? `
        <span class="macro-content-full" style="display: none;">${macro.content}</span>
        <button class="show-more-btn" title="Show more content">
          <i class="fas fa-chevron-down"></i> Show More
        </button>
        <button class="show-less-btn" title="Show less content" style="display: none;">
          <i class="fas fa-chevron-up"></i> Show Less
        </button>
      ` : ''}
    </div>
  `;

  // Add event listeners
  const copyBtn = div.querySelector(".copy-btn");
  const menuBtn = div.querySelector(".macro-menu-btn");
  const menuDropdown = div.querySelector(".macro-menu-dropdown");
  const editOption = div.querySelector(".edit-option");
  const deleteOption = div.querySelector(".delete-option");
  
  // Add show more/less functionality
  const showMoreBtn = div.querySelector(".show-more-btn");
  const showLessBtn = div.querySelector(".show-less-btn");
  const contentText = div.querySelector(".macro-content-text");
  const contentFull = div.querySelector(".macro-content-full");

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
    console.log("Edit button clicked for macro:", macro);
    try {
      showEditMacroModal(macro);
    } catch (error) {
      console.error("Error showing edit modal:", error);
      showToast("Error opening edit modal", "error");
    }
  });

  deleteOption.addEventListener("click", async (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('open');
    
    showMacroDeleteConfirmationModal(macro.name, async () => {
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
    });
  });

  // Add show more/less functionality
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      contentText.style.display = 'none';
      contentFull.style.display = 'block';
      showMoreBtn.style.display = 'none';
      showLessBtn.style.display = 'inline-flex';
    });
  }

  if (showLessBtn) {
    showLessBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      contentText.style.display = 'block';
      contentFull.style.display = 'none';
      showMoreBtn.style.display = 'inline-flex';
      showLessBtn.style.display = 'none';
    });
  }

  return div;
}

// Settings are now controlled by the options page

// Show edit macro modal
function showEditMacroModal(macro) {
  console.log("showEditMacroModal called with macro:", macro);
  
  // Remove any existing modals first
  const existingModals = document.querySelectorAll('.modal');
  existingModals.forEach(modal => modal.remove());
  
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "block"; // Ensure modal is visible
  modal.style.zIndex = "999999999"; // Much higher z-index
  modal.innerHTML = `
    <div class="modal-content" style="position: relative; z-index: 999999999;">
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

  // Add click outside to close functionality
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

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

      // Find the macro element by looking for the one that contains the current macro name
      const macroElements = document.querySelectorAll(".macro-item");
      let macroElement = null;
      
      for (const element of macroElements) {
        const elementName = element.querySelector(".macro-name").textContent;
        if (elementName === macro.name) {
          macroElement = element;
          break;
        }
      }
      
      if (macroElement) {
        // Update the macro name
        macroElement.querySelector(".macro-name").textContent = name;
        
        // Update the macro content - handle both truncated and full content
        const contentText = macroElement.querySelector(".macro-content-text");
        const contentFull = macroElement.querySelector(".macro-content-full");
        
        if (contentText) {
          const isLongContent = content.length > 100;
          const truncatedContent = isLongContent ? content.substring(0, 100) + '...' : content;
          contentText.textContent = truncatedContent;
          contentText.className = `macro-content-text ${isLongContent ? 'truncated' : ''}`;
        }
        
        if (contentFull) {
          contentFull.textContent = content;
        }
        
        // Update the macro object for future reference
        macro.name = name;
        macro.content = content;
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
  
  // Load saved theme and dark mode together with immediate fallback
  Promise.all([
    new Promise(resolve => chrome.storage.local.get(['selectedTheme'], resolve)),
    new Promise(resolve => chrome.storage.sync.get(['darkMode'], resolve))
  ]).then(([themeData, darkModeData]) => {
    currentTheme = themeData.selectedTheme || 'ocean-blue';
    isDarkMode = darkModeData.darkMode || false;
    
    console.log('Theme system initialization - theme:', currentTheme, 'darkMode:', isDarkMode);
    
    // Apply both theme and dark mode immediately
    applyThemeAndDarkMode(currentTheme, isDarkMode);
    updateActiveThemeOption(currentTheme);
  }).catch(() => {
    // Fallback to default theme if storage fails
    currentTheme = 'ocean-blue';
    isDarkMode = false;
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
  document.documentElement.classList.remove('dark-mode');
  document.body.classList.remove('dark-mode');
  
  // Apply dark mode class to both html and body
  if (darkMode) {
    document.documentElement.classList.add('dark-mode');
    document.body.classList.add('dark-mode');
  }
  
  // Apply new theme to both html and body
  if (theme !== 'ocean-blue') {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }
  
  // Ensure content is visible
  document.documentElement.classList.add('theme-ready');
  
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
      
      // Toast notification removed for cleaner UX
      
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

// Edit ticket modal function
function showEditTicketModal(ticket, user, isPro) {
  console.log("🔍 showEditTicketModal called with:", { ticket, user: user?.uid, isPro });
  
  // Parse the reminder time for the form
  let reminderDate = "";
  let reminderTime = "";
  if (ticket.reminderTime) {
    try {
      const date = new Date(ticket.reminderTime);
      reminderDate = date.toISOString().split('T')[0];
      reminderTime = date.toTimeString().slice(0, 5);
    } catch (error) {
      console.error('Error parsing reminder time:', error);
    }
  }
  
  const modal = document.createElement("div");
  modal.className = "edit-modal";
  modal.innerHTML = `
    <div class="edit-modal-content">
      <div class="edit-modal-header">
        <h3>Edit Ticket #${ticket.ticketId}</h3>
        <button class="close-edit-modal">&times;</button>
      </div>
      <div class="edit-modal-body">
        <div class="form-group">
          <label for="editTicketId">Ticket ID</label>
          <input type="text" id="editTicketId" value="${ticket.ticketId}">
        </div>
        <div class="form-group">
          <label for="editDescription">Description</label>
          <textarea id="editDescription" placeholder="Enter description">${ticket.description || ''}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="editDate">Date</label>
            <input type="date" id="editDate" value="${reminderDate}">
          </div>
          <div class="form-group">
            <label for="editTime">Time</label>
            <input type="time" id="editTime" value="${reminderTime}">
          </div>
        </div>
      </div>
      <div class="edit-modal-actions">
        <button id="saveEditBtn" class="save-btn">Save Changes</button>
        <button id="cancelEditBtn" class="cancel-btn">Cancel</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector(".close-edit-modal");
  const cancelBtn = modal.querySelector("#cancelEditBtn");
  const saveBtn = modal.querySelector("#saveEditBtn");
  
  // Close modal functions
  const closeModal = () => {
    modal.remove();
  };
  
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  
  // Close when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Save button functionality
  saveBtn.addEventListener("click", async () => {
    const newTicketId = document.getElementById("editTicketId").value.trim();
    const newDescription = document.getElementById("editDescription").value.trim();
    const newDate = document.getElementById("editDate").value;
    const newTime = document.getElementById("editTime").value;

    // Basic validation
    if (!newTicketId || !newDescription) {
      alert("Please enter both Ticket ID and Description");
      return;
    }

    // Show past date warning if needed
    showPastDateWarning(newDate, newTime, async (finalDate, finalTime, isOverdue = false) => {
      // Combine date and time if both are provided
      let newReminderTime = null;
      if (finalDate && finalTime) {
        newReminderTime = `${finalDate}T${finalTime}`;
      } else if (finalDate) {
        // If only date is provided, set it to end of day (23:59) for proper datetime format
        newReminderTime = `${finalDate}T23:59`;
      } else if (finalTime) {
        // If only time is provided, use smart time handling
        const today = new Date();
        const [hours, minutes] = finalTime.split(':');
        const timeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hours), parseInt(minutes));
        
        // If the time has already passed today, set it for tomorrow
        if (timeToday < today) {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowDate = tomorrow.toISOString().split('T')[0];
          newReminderTime = `${tomorrowDate}T${finalTime}`;
        } else {
          // Time is still in the future today
          const todayDate = today.toISOString().split('T')[0];
          newReminderTime = `${todayDate}T${finalTime}`;
        }
      }

      try {
        console.log("🔍 Updating ticket:", { 
          oldTicketId: ticket.ticketId, 
          newTicketId, 
          newDescription, 
          newReminderTime, 
          isOverdue,
          user: user ? 'Pro' : 'Free',
          ticketData: ticket
        });
        
        // Update all ticket fields
        await updateTicketDetails(user, isPro, ticket.ticketId, newTicketId, newDescription, newReminderTime, isOverdue);
        
        // Show success message
        showToast("Ticket updated successfully", "success");
        closeModal();
      } catch (error) {
        console.error("❌ Error updating ticket:", error);
        console.error("❌ Ticket data:", ticket);
        alert("Failed to update ticket. Please try again.");
      }
    });
  });
}

// Update ticket details function - handles all fields
async function updateTicketDetails(user, isPro, oldTicketId, newTicketId, newDescription, newReminderTime, isOverdue = false) {
  console.log("🔍 updateTicketDetails called:", { 
    oldTicketId, 
    newTicketId, 
    newDescription, 
    newReminderTime, 
    isOverdue,
    user: user ? 'Pro' : 'Free',
    isPro: isPro,
    userUid: user?.uid,
    userObject: user
  });
  
  try {
    console.log("🔍 Checking Pro status:", { isPro, hasUser: !!user, userUid: user?.uid });
    if (isPro && user) {
      // Pro user: Update in Firestore
      const reminders = await getUserReminders(user.uid);
      const reminder = reminders.find((r) => r.ticketId === oldTicketId);
      if (reminder) {
        const updateData = { 
          description: newDescription,
          reminderTime: newReminderTime,
          type: isOverdue ? "overdue" : "important",
          status: isOverdue ? "overdue" : "active"
        };
        
        // If ticket ID changed, update it too
        if (oldTicketId !== newTicketId) {
          updateData.ticketId = newTicketId;
        }
        
        await updateReminder(reminder.id, updateData);
      }
    } else {
      // Free user: Update in local storage
      console.log("🔍 Free user update - getting data from storage...");
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
      console.log("🔍 Storage data retrieved:", data);

      // Update in all relevant lists
      const updateList = (list) => {
        console.log("🔍 Updating list with", list.length, "tickets, looking for ticketId:", oldTicketId);
        const updated = list.map((ticket) => {
          if (ticket.ticketId === oldTicketId) {
            console.log("🔍 Found ticket to update:", ticket);
            return { 
              ...ticket, 
              ticketId: newTicketId,
              description: newDescription, 
              reminderTime: newReminderTime 
            };
          }
          return ticket;
        });
        console.log("🔍 List updated, found matches:", updated.filter(t => t.ticketId === newTicketId).length);
        return updated;
      };

      // Update all lists
      const updatedImportantTickets = updateList(data.importantTickets || []);
      const updatedCompletedTickets = updateList(data.completedTickets || []);
      const updatedOverdueTickets = updateList(data.overdueTickets || []);
      const updatedPinnedTickets = updateList(data.pinnedTickets || []);
      
      console.log("🔍 Updated lists:", {
        important: updatedImportantTickets.length,
        completed: updatedCompletedTickets.length,
        overdue: updatedOverdueTickets.length,
        pinned: updatedPinnedTickets.length
      });

      // If the ticket is now overdue, move it to overdue list
      if (isOverdue) {
        console.log("🔍 Moving ticket to overdue list...");
        // Remove from important and pinned lists
        const filteredImportant = updatedImportantTickets.filter(t => t.ticketId !== newTicketId);
        const filteredPinned = updatedPinnedTickets.filter(t => t.ticketId !== newTicketId);
        
        // Add to overdue list
        updatedOverdueTickets.push({
          ticketId: newTicketId,
          description: newDescription,
          reminderTime: newReminderTime
        });

        console.log("🔍 Setting storage for overdue ticket...");
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({
            importantTickets: filteredImportant,
            completedTickets: updatedCompletedTickets,
            overdueTickets: updatedOverdueTickets,
            pinnedTickets: filteredPinned,
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("❌ Storage error:", chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log("✅ Storage updated for overdue ticket");
              resolve();
            }
          });
        });
      } else {
        // Normal update - keep in current lists
        console.log("🔍 Normal update - keeping ticket in current lists...");
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({
            importantTickets: updatedImportantTickets,
            completedTickets: updatedCompletedTickets,
            overdueTickets: updatedOverdueTickets,
            pinnedTickets: updatedPinnedTickets,
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("❌ Storage error:", chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log("✅ Storage updated for normal ticket");
              resolve();
            }
          });
        });
      }
    }

    // Refresh the UI based on user type
    if (user && user.uid && user.uid.trim() !== '') {
      console.log("🔍 Pro user - calling loadReminders...");
      await loadReminders(user);
    } else {
      // For Free users, refresh from local storage
      console.log("🔍 Free user - calling loadFreeUserData...");
      loadFreeUserData();
    }
    console.log("✅ UI refresh completed");
  } catch (error) {
    console.error("❌ Error updating ticket details:", error);
    console.error("❌ Error stack:", error.stack);
    throw error;
  }
}

// Helper function to show delete confirmation modal
function showDeleteConfirmationModal(ticketId, onConfirm) {
  const modal = document.createElement("div");
  modal.className = "edit-modal";
  modal.innerHTML = `
    <div class="edit-modal-content" style="max-width: 400px;">
      <div class="edit-modal-header">
        <h3>🗑️ Delete Ticket</h3>
        <button class="close-edit-modal">&times;</button>
      </div>
      <div class="edit-modal-body">
        <p style="margin-bottom: 16px; color: #dc2626; font-weight: 500;">
          Are you sure you want to delete ticket #${ticketId}?
        </p>
        <p style="margin-bottom: 20px; color: #6b7280; font-size: 14px;">
          This action cannot be undone.
        </p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="cancel-btn" style="flex: 1;">Cancel</button>
          <button class="delete-confirm-btn" style="flex: 1;">Delete</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector(".close-edit-modal");
  const cancelBtn = modal.querySelector(".cancel-btn");
  const deleteBtn = modal.querySelector(".delete-confirm-btn");
  
  const closeModal = () => modal.remove();
  
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  
  deleteBtn.addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}

// Helper function to show macro delete confirmation modal
function showMacroDeleteConfirmationModal(macroName, onConfirm) {
  // Remove any existing modals first
  const existingModals = document.querySelectorAll('.edit-modal, .modal');
  existingModals.forEach(modal => modal.remove());
  
  const modal = document.createElement("div");
  modal.className = "edit-modal";
  modal.style.zIndex = "999999999"; // Much higher z-index
  modal.innerHTML = `
    <div class="edit-modal-content" style="max-width: 400px; position: relative; z-index: 999999999;">
      <div class="edit-modal-header">
        <h3>🗑️ Delete Macro</h3>
        <button class="close-edit-modal">&times;</button>
      </div>
      <div class="edit-modal-body">
        <p style="margin-bottom: 16px; color: #dc2626; font-weight: 500;">
          Are you sure you want to delete the macro "${macroName}"?
        </p>
        <p style="margin-bottom: 20px; color: #6b7280; font-size: 14px;">
          This action cannot be undone.
        </p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="cancel-btn" style="flex: 1;">Cancel</button>
          <button class="delete-confirm-btn" style="flex: 1;">Delete</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector(".close-edit-modal");
  const cancelBtn = modal.querySelector(".cancel-btn");
  const deleteBtn = modal.querySelector(".delete-confirm-btn");
  
  const closeModal = () => modal.remove();
  
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  
  deleteBtn.addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}


