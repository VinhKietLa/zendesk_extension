import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

console.log("🚦 redirect.js loaded");

const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");

if (!code) {
  document.body.innerHTML = "<p>❌ No code provided in URL.</p>";
  throw new Error("Missing OAuth code");
}

(async () => {
  try {
    console.log("📤 Sending OAuth code to cloud function...");
    const response = await fetch(
      "https://us-central1-zendesk-chrome-tool.cloudfunctions.net/exchangeOAuthCode",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          redirectUri: window.location.origin + "/redirect.html",
        }),
      }
    );

    const { customToken, user } = await response.json();
    console.log("🔐 Received custom token for:", user);

    const credential = await signInWithCustomToken(auth, customToken);

    chrome.runtime.sendMessage(
      {
        type: "oauthSuccess",
        payload: {
          userEmail: credential.user.email,
          userId: credential.user.uid,
          userName: credential.user.displayName,
        },
      },
      () => {
        console.log("📤 Sent user info to extension");
        document.body.innerHTML =
          "<h2>✅ Signed in!</h2><p>You can close this tab.</p>";
        setTimeout(() => window.close(), 3000);
      }
    );
  } catch (err) {
    console.error("❌ Sign-in error:", err);
    document.body.innerHTML = `<p>❌ Sign-in failed: ${err.message}</p>`;
  }
})();
