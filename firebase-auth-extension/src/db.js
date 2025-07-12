import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// Collection names
const USERS_COLLECTION = "users";
const REMINDERS_COLLECTION = "reminders";

// User data operations
export async function createUserProfile(userId, userData) {
  console.log("📝 Creating user profile for:", userId);
  const userRef = doc(db, USERS_COLLECTION, userId);
  await setDoc(userRef, {
    ...userData,
    isPro: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  console.log("✅ User profile created");
}

export async function getUserProfile(userId) {
  console.log("🔍 Getting user profile for:", userId);
  const userRef = doc(db, USERS_COLLECTION, userId);
  const userSnap = await getDoc(userRef);
  const profile = userSnap.exists() ? userSnap.data() : null;
  console.log("📋 User profile:", profile);
  return profile;
}

export async function updateUserProfile(userId, userData) {
  console.log("📝 Updating user profile for:", userId);
  const userRef = doc(db, USERS_COLLECTION, userId);
  await updateDoc(userRef, {
    ...userData,
    updatedAt: serverTimestamp(),
  });
  console.log("✅ User profile updated");
}

// Reminder operations
export async function createReminder(userId, reminderData) {
  console.log("📝 Creating reminder for user:", userId);
  const reminderRef = doc(collection(db, REMINDERS_COLLECTION));
  await setDoc(reminderRef, {
    ...reminderData,
    userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: "active",
  });
  console.log("✅ Reminder created with ID:", reminderRef.id);
  return reminderRef.id;
}

export async function getUserReminders(userId) {
  console.log("🔍 Getting reminders for user:", userId);
  const remindersQuery = query(
    collection(db, REMINDERS_COLLECTION),
    where("userId", "==", userId)
  );
  const querySnapshot = await getDocs(remindersQuery);
  const reminders = querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
  console.log("📋 Found reminders:", reminders);
  return reminders;
}

export async function updateReminder(reminderId, reminderData) {
  console.log("📝 Updating reminder:", reminderId);
  const reminderRef = doc(db, REMINDERS_COLLECTION, reminderId);
  await updateDoc(reminderRef, {
    ...reminderData,
    updatedAt: serverTimestamp(),
  });
  console.log("✅ Reminder updated");
}

export async function deleteReminder(reminderId) {
  console.log("🗑️ Deleting reminder:", reminderId);
  const reminderRef = doc(db, REMINDERS_COLLECTION, reminderId);
  await deleteDoc(reminderRef);
  console.log("✅ Reminder deleted");
}

// Pro status operations
export async function updateProStatus(userId, isPro) {
  console.log("⭐ Updating pro status for user:", userId, "to:", isPro);
  const userRef = doc(db, USERS_COLLECTION, userId);
  await updateDoc(userRef, {
    isPro,
    updatedAt: serverTimestamp(),
  });
  console.log("✅ Pro status updated");
}

// Helper function to check if user is pro
export async function isUserPro(userId) {
  console.log("🔍 Checking pro status for user:", userId);
  const userProfile = await getUserProfile(userId);
  const isPro = userProfile?.isPro || false;
  console.log("⭐ Pro status:", isPro);
  return isPro;
}

// Sync local storage with Firestore
export async function syncLocalToFirestore(userId) {
  // Get local storage data
  const localData = await chrome.storage.local.get([
    "importantTickets",
    "completedTickets",
    "overdueTickets",
  ]);

  // Create reminders in Firestore
  const createPromises = [];

  // Sync important tickets
  if (localData.importantTickets?.length) {
    for (const ticket of localData.importantTickets) {
      createPromises.push(
        createReminder(userId, {
          ticketId: ticket.ticketId,
          description: ticket.description,
          reminderTime: ticket.reminderTime,
          type: "important",
        })
      );
    }
  }

  // Sync completed tickets
  if (localData.completedTickets?.length) {
    for (const ticket of localData.completedTickets) {
      createPromises.push(
        createReminder(userId, {
          ticketId: ticket.ticketId,
          description: ticket.description,
          status: "completed",
          type: "completed",
        })
      );
    }
  }

  // Sync overdue tickets
  if (localData.overdueTickets?.length) {
    for (const ticket of localData.overdueTickets) {
      createPromises.push(
        createReminder(userId, {
          ticketId: ticket.ticketId,
          description: ticket.description,
          reminderTime: ticket.reminderTime,
          status: "overdue",
          type: "overdue",
        })
      );
    }
  }

  await Promise.all(createPromises);
}

// Sync Firestore to local storage
export async function syncFirestoreToLocal(userId) {
  const reminders = await getUserReminders(userId);

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

  await chrome.storage.local.set({
    importantTickets,
    completedTickets,
    overdueTickets,
  });
}
