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
  const userRef = doc(db, USERS_COLLECTION, userId);
  await setDoc(userRef, {
    ...userData,
    isPro: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function getUserProfile(userId) {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() ? userSnap.data() : null;
}

export async function updateUserProfile(userId, userData) {
  const userRef = doc(db, USERS_COLLECTION, userId);
  await updateDoc(userRef, {
    ...userData,
    updatedAt: serverTimestamp(),
  });
}

// Reminder operations
export async function createReminder(userId, reminderData) {
  const reminderRef = doc(collection(db, REMINDERS_COLLECTION));
  await setDoc(reminderRef, {
    ...reminderData,
    userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: "active",
  });
  return reminderRef.id;
}

export async function getUserReminders(userId) {
  const remindersQuery = query(
    collection(db, REMINDERS_COLLECTION),
    where("userId", "==", userId)
  );
  const querySnapshot = await getDocs(remindersQuery);
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export async function updateReminder(reminderId, reminderData) {
  const reminderRef = doc(db, REMINDERS_COLLECTION, reminderId);
  await updateDoc(reminderRef, {
    ...reminderData,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteReminder(reminderId) {
  const reminderRef = doc(db, REMINDERS_COLLECTION, reminderId);
  await deleteDoc(reminderRef);
}

// Pro status operations
export async function updateProStatus(userId, isPro) {
  const userRef = doc(db, USERS_COLLECTION, userId);
  await updateDoc(userRef, {
    isPro,
    updatedAt: serverTimestamp(),
  });
}

// Helper function to check if user is pro
export async function isUserPro(userId) {
  const userProfile = await getUserProfile(userId);
  return userProfile?.isPro || false;
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
