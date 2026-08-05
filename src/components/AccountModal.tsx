import { useState } from "react";
import { Modal } from "./Modal";
import { signInWithGoogle, signOutUser } from "../lib/auth";
import { useAuthUser } from "../hooks/useAuth";
import { isCloudConfigured } from "../lib/firebase";
import { toast } from "../lib/toast";
import { initials } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
}

export function AccountModal({ onClose }: Props) {
  const user = useAuthUser();
  const [busy, setBusy] = useState(false);

  if (!isCloudConfigured()) {
    return (
      <Modal title="Account" onClose={onClose}>
        <div className="notice">
          Cloud sync isn't configured, so Splitwiser is running in fully offline mode. Solo groups
          work normally. To enable Google sign-in and shared groups, add your Firebase keys to{" "}
          <code>.env.local</code> — see <code>.env.example</code>.
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  const action = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      setBusy(true);
      await fn();
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Account" onClose={onClose}>
      {user ? (
        <>
          <div className="account-row">
            {user.photoURL ? (
              <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="avatar" style={{ background: "var(--text-dim)" }}>
                {initials(user.name)}
              </div>
            )}
            <div className="who">
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
          </div>
          <p className="settle-hint">
            Signed in — your shared groups sync across devices. Solo groups stay on this device
            only and are unaffected by signing out.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => action(signOutUser, "Signed out").then(onClose)}
            >
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="notice">
            Sign in with Google to create shared groups and join groups by invite code. You don't
            need an account for solo tracking.
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => action(signInWithGoogle, "Signed in")}
          >
            <Icon name="google" /> Continue with Google
          </button>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
