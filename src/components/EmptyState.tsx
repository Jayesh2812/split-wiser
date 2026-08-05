import { useState } from "react";
import type { AuthUser } from "../types";
import { Icon } from "./Icon";
import { isCloudConfigured } from "../lib/firebase";
import { signInWithGoogle } from "../lib/auth";
import { toast } from "../lib/toast";

interface EmptyStateProps {
  user: AuthUser | null;
  onCreate: () => void;
  onJoin: () => void;
}

export function EmptyState({ user, onCreate, onJoin }: EmptyStateProps) {
  const cloudOn = isCloudConfigured();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    try {
      setBusy(true);
      await signInWithGoogle();
      toast("Signed in");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="empty-state">
      <div className="empty-illustration">
        <Icon name="wallet" />
      </div>
      <h2>Welcome to Splitwiser</h2>
      <p>
        Create a group, add the people in it, then start logging who paid for what. Everything
        stays on this device and works fully offline.
      </p>

      <div className="home-actions">
        <button className="btn btn-primary btn-lg btn-block" onClick={onCreate}>
          <Icon name="plus" /> Create your first group
        </button>

        {cloudOn && (
          <>
            <div className="home-divider">or</div>

            {!user && (
              <button
                className="btn btn-secondary btn-block"
                onClick={signIn}
                disabled={busy}
              >
                <Icon name="google" /> {busy ? "Signing in…" : "Sign in with Google"}
              </button>
            )}

            <button className="btn btn-secondary btn-block" onClick={onJoin}>
              <Icon name="link" /> Join with a code
            </button>

            <p className="home-hint">
              {user
                ? "Paste an invite code to join a group someone shared with you."
                : "You'll sign in first, then paste the invite code."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
