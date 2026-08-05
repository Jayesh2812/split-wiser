import { useState } from "react";
import { Modal } from "./Modal";
import { joinGroupByCode, setActiveGroup } from "../lib/repo";
import { signInWithGoogle } from "../lib/auth";
import { useAuthUser } from "../hooks/useAuth";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
  onJoined: () => void;
}

export function JoinGroupModal({ onClose, onJoined }: Props) {
  const user = useAuthUser();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    try {
      setBusy(true);
      await signInWithGoogle();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!user) return toast("Sign in with Google first.");
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return toast("Enter the invite code.");
    try {
      setBusy(true);
      const res = await joinGroupByCode(trimmed, user);
      if (!res.ok) {
        toast(res.reason === "not-found" ? "No group found for that code." : "Could not join.");
        return;
      }
      setActiveGroup(res.groupId);
      toast(res.alreadyMember ? "You're already in this group." : "Joined the group!");
      onJoined();
    } catch (e) {
      console.error(e);
      toast("Could not join the group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Join a group" onClose={onClose}>
      {!user ? (
        <div className="field">
          <div className="notice">
            Sign in with Google so the group knows who you are. You'll be added as a member and can
            start adding expenses right away.
          </div>
          <button className="btn btn-primary btn-block" onClick={signIn} disabled={busy}>
            <Icon name="google" /> Continue with Google
          </button>
        </div>
      ) : (
        <div className="field">
          <label>Invite code</label>
          <input
            type="text"
            className="code-input"
            placeholder="ABC123"
            maxLength={8}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <small style={{ color: "var(--text-faint)" }}>
            Ask the group's creator for the 6-character code from their Settings screen.
          </small>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={join} disabled={busy || !user}>
          {busy ? "Joining…" : "Join group"}
        </button>
      </div>
    </Modal>
  );
}
