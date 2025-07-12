import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";

// Get user's macros from Firestore
export async function getUserMacros(userId) {
  try {
    const macrosRef = collection(db, "macros");
    const q = query(macrosRef, where("userId", "==", userId));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error("Error getting macros from Firestore:", error);
    throw error;
  }
}

// Create a new macro in Firestore
export async function createMacro(userId, macro) {
  try {
    const macrosRef = collection(db, "macros");
    const docRef = await addDoc(macrosRef, {
      userId,
      name: macro.name,
      content: macro.content,
      createdAt: new Date().toISOString(),
    });

    return {
      id: docRef.id,
      ...macro,
    };
  } catch (error) {
    console.error("Error creating macro in Firestore:", error);
    throw error;
  }
}

// Update a macro in Firestore
export async function updateMacroInFirestore(macroId, macro) {
  try {
    const macroRef = doc(db, "macros", macroId);
    await updateDoc(macroRef, {
      name: macro.name,
      content: macro.content,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating macro in Firestore:", error);
    throw error;
  }
}

// Delete a macro from Firestore
export async function deleteMacroFromFirestore(macroId) {
  try {
    const macroRef = doc(db, "macros", macroId);
    await deleteDoc(macroRef);
  } catch (error) {
    console.error("Error deleting macro from Firestore:", error);
    throw error;
  }
}
