import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo.local",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-household-budget",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "demo-app-id",
};

export const firebaseApp: FirebaseApp = getApps()[0] ?? initializeApp(config);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// Emulator connections must happen once, before the first read/write.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  const emulatorState = globalThis as typeof globalThis & { __budgetFirebaseEmulators?: boolean };
  if (!emulatorState.__budgetFirebaseEmulators) {
    connectAuthEmulator(auth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8080));
    emulatorState.__budgetFirebaseEmulators = true;
  }
}

