import { checkUnassignedTickets, restoreBadge } from "./badgeUpdater.js";
import { checkManualReminders } from "./reminders.js";

let refreshIntervalId = null;
let refreshInterval = 60000; // Default refresh interval (60 seconds)
let autoRefreshEnabled = false; // Default auto-refresh state

// Working hours settings
let workingHoursEnabled = false;
let workStartTime = "09:00";
let workEndTime = "17:00";

// Load settings from chrome.storage.sync on startup
chrome.storage.sync.get({
  autoRefresh: false,
  refreshInterval: 60,
  workingHoursEnabled: false,
  workStartTime: "09:00",
  workEndTime: "17:00"
}, (data) => {
  console.log("🔍 Raw data from storage:", data);
  
  autoRefreshEnabled = data.autoRefresh;
  refreshInterval = data.refreshInterval; // Keep in seconds, don't convert to ms
  workingHoursEnabled = data.workingHoursEnabled;
  workStartTime = data.workStartTime;
  workEndTime = data.workEndTime;
  
  console.log("🔍 Parsed values:", {
    autoRefresh: autoRefreshEnabled,
    refreshInterval: refreshInterval,
    workingHours: workingHoursEnabled
  });
  
  if (autoRefreshEnabled) {
    console.log("🔍 Calling setRefreshInterval with:", data.refreshInterval);
    setRefreshInterval(data.refreshInterval);
  }
});

// Listen for storage changes to update settings in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.autoRefresh) {
      autoRefreshEnabled = changes.autoRefresh.newValue;
      console.log("🔄 Auto-refresh setting changed:", autoRefreshEnabled);
      
      if (autoRefreshEnabled) {
        // Get the current refresh interval
        chrome.storage.sync.get({ refreshInterval: 60 }, (data) => {
          console.log("🔄 Starting auto-refresh with interval:", data.refreshInterval);
          setRefreshInterval(data.refreshInterval);
        });
      } else {
        // Stop auto-refresh
        if (refreshIntervalId) {
          clearInterval(refreshIntervalId);
          refreshIntervalId = null;
          console.log("🔄 Auto-refresh stopped");
        }
      }
    }
    
    if (changes.refreshInterval && autoRefreshEnabled) {
      const newInterval = changes.refreshInterval.newValue;
      console.log("⏱️ Refresh interval changed:", newInterval);
      setRefreshInterval(newInterval);
    }

    // Handle working hours changes
    if (changes.workingHoursEnabled) {
      workingHoursEnabled = changes.workingHoursEnabled.newValue;
      console.log("🕐 Working hours enabled:", workingHoursEnabled);
    }
    
    if (changes.workStartTime) {
      workStartTime = changes.workStartTime.newValue;
      console.log("🕐 Work start time updated:", workStartTime);
    }
    
    if (changes.workEndTime) {
      workEndTime = changes.workEndTime.newValue;
      console.log("🕐 Work end time updated:", workEndTime);
    }
  }
});

//// Throttle Write Utility ////
let writeTimeout;
function throttleWriteData(dataToWrite) {
  clearTimeout(writeTimeout); // Clear the previous timeout if it's still pending
  writeTimeout = setTimeout(() => {
    chrome.storage.local.set(dataToWrite, () => {});
  }, 5000); // Adjust this interval as necessary (5 seconds in this case)
}

// Listener for messages from popup.js and options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "logRedirectUri") {
    console.log("🔗 Redirect URI from popup:", request.redirectUri);
    console.log("🔗 Redirect URI length:", request.redirectUriLength);
    console.log("🔗 Ends with slash:", request.redirectUriEndsWithSlash);
  } else if (request.action === "logOAuthUrl") {
    console.log("🔗 Full OAuth URL:", request.oauthUrl);
  } else if (request.action === "logAuthUrl") {
    console.log("🔗 Auth URL being opened:", request.authUrl);
  } else if (request.action === "triggerSignIn") {
    // Handle sign-in request from options page
    handleSignInFromBackground(sendResponse);
    return true; // Keep the message channel open for async response
  } else if (request.action === "startSignIn") {
    // New: Handle sign-in entirely in background
    startSignInFlow(sendResponse);
    return true;
  } else if (request.action === "checkAutoRefreshStatus") {
    // Check if auto-refresh is running and restart if needed
    const shouldBeRunning = autoRefreshEnabled && !refreshIntervalId;
    
    if (shouldBeRunning) {
      console.log("🔄 Popup requested status - auto-refresh should be running but isn't, restarting...");
      chrome.storage.sync.get({ refreshInterval: 60 }, (data) => {
        setRefreshInterval(data.refreshInterval);
      });
    }
    
    sendResponse({
      autoRefreshEnabled,
      refreshInterval: refreshInterval, // Already in seconds, don't divide
      isRunning: !!refreshIntervalId,
      shouldBeRunning
    });
    return false;
  }
});

// Set refresh interval
function setRefreshInterval(intervalSeconds) {
  console.log(`🔄 Setting refresh interval to ${intervalSeconds} seconds`);
  console.log(`🔄 Current auto-refresh state: ${autoRefreshEnabled}`);
  
  // Clear existing interval
  if (refreshIntervalId) {
    console.log("🔄 Clearing existing refresh interval");
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  // Only start the interval if auto-refresh is enabled
  if (autoRefreshEnabled) {
    const intervalMs = intervalSeconds * 1000; // Convert seconds to ms for setInterval
    refreshIntervalId = setInterval(refreshZendesk, intervalMs);
    console.log(`🔄 Auto-refresh started with ${intervalSeconds} second interval (${intervalMs}ms)`);
    
    // Verify the interval was created
    if (refreshIntervalId) {
      console.log("✅ Auto-refresh interval successfully created");
    } else {
      console.error("❌ Failed to create auto-refresh interval");
    }
  } else {
    console.log("🔄 Auto-refresh is disabled, not starting interval");
  }
}

// Handle sign-in from background script
async function handleSignInFromBackground(sendResponse) {
  try {
    console.log("🔐 Background script handling sign-in request");
    console.log("🔐 Client ID:", "469337959937-4hh07g3u8499rk3t5gd14cjcbpem6umm.apps.googleusercontent.com");
    console.log("🔐 Cloud Function URL:", "https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app");
    
    // Use Chrome's identity API for OAuth flow
    chrome.identity.launchWebAuthFlow(
      {
        url: getOAuthUrl(),
        interactive: true,
      },
      async (redirectUrl) => {
        console.log("🔄 Background OAuth callback received, redirectUrl:", redirectUrl);
        
        if (chrome.runtime.lastError) {
          console.error("❌ Background auth error:", chrome.runtime.lastError);
          console.error("❌ Background auth error details:", JSON.stringify(chrome.runtime.lastError));
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        if (!redirectUrl) {
          console.error("❌ No redirect URL received in background");
          sendResponse({ success: false, error: "No redirect URL received" });
          return;
        }

                const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          console.error("❌ Background OAuth error:", error);
          sendResponse({ success: false, error: errorDescription || error });
          return;
        }

        if (!code) {
          console.error("❌ No code received in background");
          sendResponse({ success: false, error: "No authorization code received" });
          return;
        }

        try {
          console.log("🔄 Background exchanging code for token...");
          const redirectUri = chrome.identity.getRedirectURL();
          console.log("🔗 Background redirect URI:", redirectUri);

          const requestBody = { code, redirectUri };
          console.log("📤 Background request body:", JSON.stringify(requestBody));

          const response = await fetch("https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          console.log("📡 Background cloud function response status:", response.status);
          console.log("📡 Background cloud function response headers:", Object.fromEntries(response.headers.entries()));

          if (!response.ok) {
            const errorData = await response.json();
            console.error("❌ Background cloud function error:", errorData);
            throw new Error(errorData.error || "Token exchange failed");
          }

          const responseData = await response.json();
          console.log("📡 Background cloud function response data:", responseData);
          
          const { idToken, accessToken } = responseData;

          // Store the tokens and notify popup to handle the sign-in
          await chrome.storage.local.set({ 
            pendingSignIn: { idToken, accessToken },
            signInTimestamp: Date.now()
          });

          // Notify popup to handle the sign-in
          chrome.runtime.sendMessage({ 
            action: 'completeSignIn', 
            idToken, 
            accessToken 
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log("Popup not available, will handle on next popup open");
            }
          });
          sendResponse({ success: true });
        } catch (error) {
                  console.error("Background error exchanging code for token:", error);
          sendResponse({ success: false, error: error.message });
        }
      }
    );
  } catch (error) {
    console.error("Background error in handleSignInFromBackground:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// New: Full sign-in flow in background
async function startSignInFlow(sendResponse) {
  try {
    const clientId = "469337959937-4hh07g3u8499rk3t5gd14cjcbpem6umm.apps.googleusercontent.com";
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
    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
              if (chrome.runtime.lastError) {
          console.error("Auth error:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!redirectUrl) {
          console.error("No redirect URL received");
          sendResponse({ success: false, error: "No redirect URL received" });
          return;
        }
        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        if (error) {
          console.error("OAuth error:", error, errorDescription);
          sendResponse({ success: false, error: errorDescription || error });
          return;
        }
        if (!code) {
          console.error("No code received");
          sendResponse({ success: false, error: "No authorization code received" });
          return;
        }
      try {
        // Exchange code for tokens
        const response = await fetch("https://exchangeoauthcode-7ylhtvfxha-uc.a.run.app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirectUri }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          console.error("Cloud function error:", errorData);
          sendResponse({ success: false, error: errorData.error || "Token exchange failed" });
          return;
        }
        const { idToken, accessToken } = await response.json();
        
        // Store tokens and notify popup to handle Firebase sign-in
        await chrome.storage.local.set({
          pendingSignIn: { idToken, accessToken },
          signInTimestamp: Date.now(),
          shouldReopenPopup: true
        });
        
        // Notify popup to complete the sign-in
        chrome.runtime.sendMessage({ 
          action: "completeSignIn", 
          idToken, 
          accessToken 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("Popup not available, will handle on next popup open");
          }
        });
        
        sendResponse({ success: true });
        
        // Update badge to indicate successful sign-in and trigger popup
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        
        // Clear badge after 3 seconds
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' });
        }, 3000);
        
        // Try to reopen popup after a delay
        setTimeout(() => {
          chrome.action.openPopup();
        }, 2000);
      } catch (err) {
        console.error("Error in token exchange or Firebase sign-in:", err);
        sendResponse({ success: false, error: err.message });
      }
    });
  } catch (err) {
    console.error("Error in startSignInFlow:", err);
    sendResponse({ success: false, error: err.message });
  }
}

function getOAuthUrl() {
  const clientId = "469337959937-4hh07g3u8499rk3t5gd14cjcbpem6umm.apps.googleusercontent.com";
  const redirectUri = chrome.identity.getRedirectURL();
  const scope = "profile email";
  
  return `https://accounts.google.com/o/oauth2/v2/auth?` +
         `client_id=${clientId}&` +
         `redirect_uri=${encodeURIComponent(redirectUri)}&` +
         `response_type=code&` +
         `scope=${encodeURIComponent(scope)}&` +
         `access_type=offline`;
}

// Check if current time is within working hours
function isWithinWorkingHours() {
  if (!workingHoursEnabled) {
    return true; // If working hours mode is disabled, always allow notifications
  }

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // Get HH:MM format
  
  // Convert times to comparable format
  const startTime = workStartTime;
  const endTime = workEndTime;
  
  // Handle overnight shifts (e.g., 22:00 to 06:00)
  if (startTime > endTime) {
    // Overnight shift: current time should be >= start OR <= end
    return currentTime >= startTime || currentTime <= endTime;
  } else {
    // Regular shift: current time should be between start and end
    return currentTime >= startTime && currentTime <= endTime;
  }
}

// Auto-refresh function
function refreshZendesk() {
  chrome.tabs.query({ url: "*://*.zendesk.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      return;
    }

    tabs.forEach((tab) => {
      const url = tab.url;

      // Only refresh on pages where the refresh button is expected
      if (url.includes("/filters/") || url.includes("/views/")) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const waitForElement = (selector, callback) => {
              const element = document.querySelector(selector);
              if (element) {
                callback(element);
              } else {
                console.log("Element not found, retrying...");
                setTimeout(() => waitForElement(selector, callback), 500);
              }
            };

            waitForElement(
              'button[data-test-id="views_views-list_header-refresh"]',
              (refreshButton) => {
                refreshButton.click();
                console.log("Refresh button clicked.");
              }
            );
          },
        });
      } else {
        console.log("No refresh button on this page, skipping auto-refresh.");
      }
    });
  });
}

// Handle updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes(".zendesk.com")
  ) {
    const zendeskDomain = new URL(tab.url).origin;
    throttleWriteData({ zendeskDomain: zendeskDomain }); // Throttle domain writes
    restoreBadge(tab.url); // Only restore badge on certain pages
  }
});

// Listen for notification clicks globally
chrome.notifications.onClicked.addListener((notificationId) => {
  const ticketId = parseInt(notificationId, 10); // Convert the notificationId back to an integer

  if (!isNaN(ticketId)) {
    // Get the Zendesk domain from storage
    chrome.storage.sync.get("zendeskDomain", (data) => {
      if (data.zendeskDomain) {
        const zendeskDomain = data.zendeskDomain;
        const ticketUrl = `${zendeskDomain}/agent/tickets/${ticketId}`;

        // Always open the ticket in a new tab
        chrome.tabs.create({ url: ticketUrl });
      } else {
        console.error("Zendesk domain not found.");
      }
    });
  } else {
    console.error("Invalid ticket ID:", notificationId);
  }
});

// Set interval to check unassigned tickets every 60 seconds
setInterval(checkUnassignedTickets, 60 * 1000);
// Check reminders every 60 seconds (optimizing check interval to reduce overhead)
setInterval(checkManualReminders, 60 * 1000);

// Health check for auto-refresh - ensure it's still running if it should be
setInterval(() => {
  if (autoRefreshEnabled && !refreshIntervalId) {
    console.log("🔄 Health check: Auto-refresh should be running but isn't, restarting...");
    chrome.storage.sync.get({ refreshInterval: 60 }, (data) => {
      setRefreshInterval(data.refreshInterval);
    });
  }
}, 30000); // Check every 30 seconds

// Initial check when the extension loads
checkUnassignedTickets();
// When the extension loads, restore the badge count
restoreBadge();
