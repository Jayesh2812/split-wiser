import { useSyncExternalStore } from "react";
import { getUser, isAuthReady, subscribeAuth } from "../lib/auth";
import type { AuthUser } from "../types";

/** The signed-in Google user, or null. */
export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribeAuth, getUser);
}

/** False while Firebase is still restoring the session on first load. */
export function useAuthReady(): boolean {
  return useSyncExternalStore(subscribeAuth, isAuthReady);
}
