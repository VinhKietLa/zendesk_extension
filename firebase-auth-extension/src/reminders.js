import { auth } from "./firebase.js";
import { getUserReminders, updateReminder, isUserPro } from "./db.js";

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
            (notificationId) => {
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
                (notificationId) => {
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
