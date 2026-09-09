import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyAO-7vRM4cG4BJ1g92CJjZw1O-FkECSNEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "split-budget-69c92.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "split-budget-69c92",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "split-budget-69c92.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "699361366696",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:699361366696:web:9318ddf088233a1fb3689d",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-QSKQ0LZPBX",
};

export const firebaseApp: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export let analytics: Analytics | undefined;

if (typeof window !== "undefined") {
  void isAnalyticsSupported().then((supported) => {
    if (supported) analytics = getAnalytics(firebaseApp);
  });
}

// Emulator connections must happen once, before the first read/write.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  const emulatorState = globalThis as typeof globalThis & { __budgetFirebaseEmulators?: boolean };
  if (!emulatorState.__budgetFirebaseEmulators) {
    connectAuthEmulator(auth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8080));
    emulatorState.__budgetFirebaseEmulators = true;
  }
}
