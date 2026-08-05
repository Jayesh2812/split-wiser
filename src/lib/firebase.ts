/**
 * Optional Firebase bootstrap.
 *
 * Firebase is a *progressive enhancement*: if the VITE_FIREBASE_* env vars are
 * absent, `isCloudConfigured()` is false, nothing is initialised, and the app
 * runs exactly as it did before — 100% offline with localStorage only.
 * Nothing here runs at import time.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** True when enough config is present to talk to Firebase. */
export function isCloudConfigured(): boolean {
  return Boolean(cfg.apiKey && cfg.projectId && cfg.appId);
}

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getApp(): FirebaseApp | null {
  if (!isCloudConfigured()) return null;
  if (!app) {
    app = initializeApp({
      apiKey: cfg.apiKey!,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId!,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId!,
    });
  }
  return app;
}

export function getAuthOrNull(): Auth | null {
  const a = getApp();
  if (!a) return null;
  if (!authInstance) authInstance = getAuth(a);
  return authInstance;
}

/**
 * Firestore with IndexedDB persistence enabled, so shared groups keep working
 * offline and queued writes flush when connectivity returns.
 */
export function getDbOrNull(): Firestore | null {
  const a = getApp();
  if (!a) return null;
  if (!dbInstance) {
    try {
      dbInstance = initializeFirestore(a, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      // Already initialised elsewhere, or IndexedDB unavailable (e.g. private mode).
      dbInstance = initializeFirestore(a, {});
    }
  }
  return dbInstance;
}
