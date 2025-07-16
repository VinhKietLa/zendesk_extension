import { auth } from "./firebase.js";
import { getUserReminders, updateReminder, isUserPro, getUserProfile } from "./db.js";

// Cloud Function URL for sending emails
const EMAIL_FUNCTION_URL = "https://us-central1-zendesk-chrome-tool.cloudfunctions.net/sendReminderEmail";



// Check if current time is within working hours
async function isWithinWorkingHours() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      workingHoursEnabled: false,
      workStartTime: "09:00",
      workEndTime: "17:00"
    }, (data) => {
      if (!data.workingHoursEnabled) {
        resolve(true); // If working hours mode is disabled, always allow notifications
        return;
      }

      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // Get HH:MM format
      
      const startTime = data.workStartTime;
      const endTime = data.workEndTime;
      
      // Handle overnight shifts (e.g., 22:00 to 06:00)
      if (startTime > endTime) {
        // Overnight shift: current time should be >= start OR <= end
        resolve(currentTime >= startTime || currentTime <= endTime);
      } else {
        // Regular shift: current time should be between start and end
        resolve(currentTime >= startTime && currentTime <= endTime);
      }
    });
  });
}

// Send email reminder
async function sendEmailReminder(userId, reminderData) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log("❌ No authenticated user for email reminder");
      return;
    }

    // Get user's ID token
    const idToken = await user.getIdToken();
    
    // Get user profile to check email alerts setting
    const userProfile = await getUserProfile(userId);
    if (!userProfile?.settings?.emailAlertsEnabled) {
      console.log("📧 Email alerts disabled for user");
      return;
    }

    console.log("📧 Sending email reminder for ticket #", reminderData.ticketId);

    const response = await fetch(EMAIL_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idToken,
        reminderData,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ Email function error:", errorData);
      return;
    }

    const result = await response.json();
    console.log("✅ Email sent successfully:", result);
  } catch (error) {
    console.error("❌ Error sending email reminder:", error);
  }
}

// Check Reminders in the Background
export async function checkManualReminders() {
  console.log("🔍 Checking manual reminders...");

  // Get current user
  const user = auth.currentUser;
  if (!user) {
    console.log("👤 No user signed in, checking local storage only");
    checkLocalReminders();
    return;
  }

  // Check if user is Pro
  const isPro = await isUserPro(user.uid);
  console.log("⭐ Checking reminders for", isPro ? "Pro" : "Free", "user");

  if (isPro) {
    await checkFirestoreReminders(user.uid);
  } else {
    checkLocalReminders();
  }
}

async function checkFirestoreReminders(userId) {
  try {
    const reminders = await getUserReminders(userId);
    const now = new Date().getTime();
    let notificationsCreated = false;

    for (const reminder of reminders) {
      if (reminder.type !== "important" || reminder.status !== "active")
        continue;

      const reminderTimestamp = reminder.reminderTime
        ? new Date(reminder.reminderTime).getTime()
        : null;

      if (reminderTimestamp && reminderTimestamp <= now) {
        console.log(`⏰ Reminder due for ticket #${reminder.ticketId}`);

        // Check working hours before creating notification
        const withinWorkingHours = await isWithinWorkingHours();
        
        if (withinWorkingHours) {
          // Create notification
          try {
            chrome.notifications.create(
              `reminder-${reminder.ticketId}`,
              {
                type: "basic",
                iconUrl: chrome.runtime.getURL("icon128.png"),
                title: `Reminder for Ticket #${reminder.ticketId}`,
                message: reminder.description,
                priority: 2,
                requireInteraction: true,
              },
              async (notificationId) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "❌ Notification error:",
                    chrome.runtime.lastError
                  );
                } else {
                  console.log("✅ Notification created:", notificationId);
                  notificationsCreated = true;
                }
              }
            );
          } catch (error) {
            console.error("❌ Error creating notification:", error);
          }
        } else {
          console.log(`🕐 Outside working hours - skipping notification for ticket #${reminder.ticketId}`);
        }

        // Send email reminder (Pro users only)
        await sendEmailReminder(userId, {
          ticketId: reminder.ticketId,
          description: reminder.description,
          reminderTime: reminder.reminderTime,
        });

        // Update reminder status in Firestore
        await updateReminder(reminder.id, {
          status: "overdue",
          type: "overdue",
        });
      }
    }

    if (notificationsCreated) {
      // Notify popup to refresh its display
      try {
        chrome.runtime.sendMessage(
          { action: "remindersUpdated" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.log("📝 Popup not available to receive update");
            }
          }
        );
      } catch (error) {
        console.error("❌ Error sending message:", error);
      }
    }
  } catch (error) {
    console.error("❌ Error checking Firestore reminders:", error);
  }
}

function checkLocalReminders() {
  chrome.storage.local.get(
    { importantTickets: [], overdueTickets: [] },
    (data) => {
      const now = new Date().getTime();
      let overdueTickets = [...data.overdueTickets];
      let updatedTickets = [];
      let notificationsCreated = false;

      data.importantTickets.forEach(
        ({ ticketId, description, reminderTime }) => {
          const reminderTimestamp = reminderTime
            ? new Date(reminderTime).getTime()
            : null;

          if (reminderTimestamp && reminderTimestamp <= now) {
            console.log(`⏰ Reminder due for ticket #${ticketId}`);

            // Check working hours before creating notification
            isWithinWorkingHours().then(async (withinWorkingHours) => {
              if (withinWorkingHours) {
                try {
                  chrome.notifications.create(
                    `reminder-${ticketId}`,
                    {
                      type: "basic",
                      iconUrl: chrome.runtime.getURL("icon128.png"),
                      title: `Reminder for Ticket #${ticketId}`,
                      message: description,
                      priority: 2,
                      requireInteraction: true,
                    },
                    async (notificationId) => {
                      if (chrome.runtime.lastError) {
                        console.error(
                          "❌ Notification error:",
                          chrome.runtime.lastError
                        );
                      } else {
                        console.log("✅ Notification created:", notificationId);
                        notificationsCreated = true;
                      }
                    }
                  );
                } catch (error) {
                  console.error("❌ Error creating notification:", error);
                }
              } else {
                console.log(`🕐 Outside working hours - skipping notification for ticket #${ticketId}`);
              }
            });

            if (
              !overdueTickets.some((ticket) => ticket.ticketId === ticketId)
            ) {
              console.log(`📦 Moving ticket #${ticketId} to overdue`);
              overdueTickets.push({
                ticketId,
                description,
                reminderTime,
              });
            }
          } else {
            updatedTickets.push({
              ticketId,
              description,
              reminderTime,
            });
          }
        }
      );

      if (
        notificationsCreated ||
        updatedTickets.length !== data.importantTickets.length
      ) {
        console.log("💾 Updating ticket storage");
        chrome.storage.local.set(
          {
            importantTickets: updatedTickets,
            overdueTickets: overdueTickets,
          },
          () => {
            try {
              chrome.runtime.sendMessage(
                { action: "remindersUpdated" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    console.log("📝 Popup not available to receive update");
                  }
                }
              );
            } catch (error) {
              console.error("❌ Error sending message:", error);
            }
          }
        );
      }
    }
  );
}
