import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect, // ✅ Add this
  getRedirectResult, // ✅ Already present
  signOut,
  onAuthStateChanged,
  browserPopupRedirectResolver,
} from "firebase/auth";

export {
  initializeApp,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect, // ✅ Export it
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  browserPopupRedirectResolver,
};
