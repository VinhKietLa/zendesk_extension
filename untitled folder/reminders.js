// Check Reminders in the Background
export function checkManualReminders() {
  let writeTimeout;
  function throttleWriteData(dataToWrite) {
    clearTimeout(writeTimeout); // Clear the previous timeout if it's still pending
    writeTimeout = setTimeout(() => {
      chrome.storage.sync.set(dataToWrite, () => {});
    }, 5000); // Adjust this interval as necessary (5 seconds in this case)
  }

  chrome.storage.sync.get(
    { importantTickets: [], overdueTickets: [] }, // Ensure both importantTickets and overdueTickets have default values
    (data) => {
      const now = new Date().getTime();
      let overdueTickets = [...data.overdueTickets]; // Keep existing overdue tickets
      let updatedTickets = [];

      data.importantTickets.forEach(
        ({ ticketId, description, reminderTime }) => {
          const reminderTimestamp = reminderTime
            ? new Date(reminderTime).getTime()
            : null;

          if (reminderTimestamp && reminderTimestamp <= now) {
            // Create reminder notification
            chrome.notifications.create(String(ticketId), {
              type: "basic",
              iconUrl: "icon128.png",
              title: `Reminder for Ticket #${ticketId}`,
              message: description,
              priority: 2,
            });

            // Move ticket to overdue if it's not already in the overdue list
            if (
              !overdueTickets.some((ticket) => ticket.ticketId === ticketId)
            ) {
              overdueTickets.push({
                ticketId,
                description,
                reminderTime, // Preserve the reminder time when moving to overdue
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

      // Throttle writes for important and overdue tickets
      throttleWriteData({
        importantTickets: updatedTickets,
        overdueTickets: overdueTickets,
      });
    }
  );
}
