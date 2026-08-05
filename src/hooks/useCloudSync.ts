import { useEffect } from "react";
import { subscribeMyGroups } from "../lib/cloud";
import { clearSharedGroups, mergeSharedGroups } from "../lib/store";
import { isCloudConfigured } from "../lib/firebase";
import { toast } from "../lib/toast";
import type { AuthUser } from "../types";

/**
 * Keeps the store's shared groups in sync with Firestore for the signed-in
 * user. Signing out drops them from memory (local groups are unaffected).
 */
export function useCloudSync(user: AuthUser | null) {
  useEffect(() => {
    if (!isCloudConfigured()) return;
    if (!user) {
      clearSharedGroups();
      return;
    }
    const unsub = subscribeMyGroups(
      user.uid,
      (groups) => mergeSharedGroups(groups),
      (err) => {
        console.error("Cloud sync error", err);
        toast("Cloud sync error — working from cache.");
      },
    );
    return () => {
      unsub();
    };
  }, [user]);
}
