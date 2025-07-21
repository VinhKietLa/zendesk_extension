import { auth } from "./firebase.js";
import { isUserPro } from "./db.js";
import {
  getUserMacros,
  createMacro,
  updateMacroInFirestore,
  deleteMacroFromFirestore,
} from "./firestore.js";

// Get macros based on user type
export async function getMacros(user) {
  if (!user || !user.uid) return [];

  const isPro = await isUserPro(user.uid);

  if (isPro) {
    // Pro: Get from Firestore
    return await getUserMacros(user.uid);
  } else {
    // Free: Get from local storage
    return new Promise((resolve) => {
      chrome.storage.local.get({ macros: [] }, (data) => {
        resolve(data.macros || []);
      });
    });
  }
}

// Add a new macro
export async function addMacro(user, name, content) {
  if (!user || !user.uid) throw new Error("User not authenticated");

  const isPro = await isUserPro(user.uid);

  if (isPro) {
    // Pro: Save to Firestore
    return await createMacro(user.uid, { name, content });
  } else {
    // Free: Save to local storage (max 3)
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ macros: [] }, async (data) => {
        try {
          const currentMacros = data.macros || [];

          if (currentMacros.length >= 3) {
            throw new Error(
              "Free users can only save up to 3 macros. Upgrade to Pro for unlimited macros."
            );
          }

          const updatedMacros = [
            ...currentMacros,
            { id: Date.now().toString(), name, content },
          ];

          await chrome.storage.local.set({ macros: updatedMacros });
          resolve({ id: Date.now().toString(), name, content });
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

// Update a macro
export async function updateMacro(user, macroId, name, content) {
  if (!user || !user.uid) throw new Error("User not authenticated");

  const isPro = await isUserPro(user.uid);

  if (isPro) {
    // Pro: Update in Firestore
    await updateMacroInFirestore(macroId, { name, content });
  } else {
    // Free: Update in local storage
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ macros: [] }, async (data) => {
        try {
          const macros = data.macros || [];
          const updatedMacros = macros.map((macro) =>
            macro.id === macroId ? { ...macro, name, content } : macro
          );

          await chrome.storage.local.set({ macros: updatedMacros });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

// Delete a macro
export async function deleteMacro(user, macroId) {
  if (!user || !user.uid) throw new Error("User not authenticated");

  const isPro = await isUserPro(user.uid);

  if (isPro) {
    // Pro: Delete from Firestore
    await deleteMacroFromFirestore(macroId);
  } else {
    // Free: Delete from local storage
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({ macros: [] }, async (data) => {
        try {
          const macros = data.macros || [];
          const updatedMacros = macros.filter((macro) => macro.id !== macroId);

          await chrome.storage.local.set({ macros: updatedMacros });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

// Copy macro content to clipboard
export async function copyMacroToClipboard(content) {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (error) {
    console.error("Failed to copy macro:", error);
    return false;
  }
}
