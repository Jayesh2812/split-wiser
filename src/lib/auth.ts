import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { getAuthOrNull, isCloudConfigured } from "./firebase";
import type { AuthUser } from "../types";

function toAuthUser(u: User): AuthUser {
  return {
    uid: u.uid,
    name: u.displayName || u.email?.split("@")[0] || "Me",
    email: u.email,
    photoURL: u.photoURL,
  };
}

let current: AuthUser | null = null;
/** null = still resolving on first load, then boolean. */
let ready = !isCloudConfigured(); // nothing to resolve when cloud is off
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

// Start listening as soon as this module is used (only when configured).
const auth = getAuthOrNull();
if (auth) {
  onAuthStateChanged(auth, (u) => {
    current = u ? toAuthUser(u) : null;
    ready = true;
    emit();
  });
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUser(): AuthUser | null {
  return current;
}

export function isAuthReady(): boolean {
  return ready;
}

export async function signInWithGoogle(): Promise<AuthUser> {
  const a = getAuthOrNull();
  if (!a) throw new Error("Cloud sync is not configured.");
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(a, provider);
  const user = toAuthUser(res.user);
  current = user;
  emit();
  return user;
}

export async function signOutUser(): Promise<void> {
  const a = getAuthOrNull();
  if (!a) return;
  await signOut(a);
  current = null;
  emit();
}
