import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { joinGroupByCode, lookupInviteCode, setActiveGroup } from "../lib/repo";
import { signInWithGoogle } from "../lib/auth";
import { useAuthUser } from "../hooks/useAuth";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  /** Prefilled when arriving from an invite link. */
  initialCode?: string;
  onClose: () => void;
  onJoined: () => void;
}

type Preview = { code: string; groupId: string; groupName: string };

export function JoinGroupModal({ initialCode, onClose, onJoined }: Props) {
  const user = useAuthUser();
  const [code, setCode] = useState(initialCode?.toUpperCase() ?? "");
  const [busy, setBusy] = useState(false);
  /** Set once a code resolves — the sheet then asks to confirm by group name. */
  const [preview, setPreview] = useState<Preview | null>(null);
  const [looked, setLooked] = useState(false);

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

  const look = async (raw: string) => {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed.length < 4) return toast("Enter the invite code.");
    try {
      setBusy(true);
      const res = await lookupInviteCode(trimmed);
      if (!res.ok) {
        toast(
          res.reason === "not-found"
            ? "No group found for that code."
            : "Could not look that up.",
        );
        return;
      }
      setPreview({ code: res.code, groupId: res.groupId, groupName: res.groupName });
    } finally {
      setBusy(false);
    }
  };

  // Arriving via an invite link: resolve the code as soon as we have a user, so
  // the first thing shown is the group's name rather than a prefilled form.
  useEffect(() => {
    if (initialCode && user && !looked) {
      setLooked(true);
      void look(initialCode);
    }
  }, [initialCode, user, looked]);

  const join = async () => {
    if (!user || !preview) return;
    try {
      setBusy(true);
      const res = await joinGroupByCode(preview.code, user);
      if (!res.ok) {
        toast(res.reason === "not-found" ? "No group found for that code." : "Could not join.");
        return;
      }
      setActiveGroup(res.groupId);
      toast(res.alreadyMember ? "You're already in this group." : `Joined ${preview.groupName}!`);
      onJoined();
    } catch (e) {
      console.error(e);
      toast("Could not join the group.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Modal title="Join a group" onClose={onClose}>
        <div className="notice">
          Sign in with Google so the group knows who you are. You'll be added as a member and can
          start adding expenses right away.
        </div>
        <button className="btn btn-primary btn-block" onClick={signIn} disabled={busy}>
          <Icon name="google" /> Continue with Google
        </button>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  if (preview) {
    return (
      <Modal title="Join this group?" onClose={onClose}>
        <div className="join-confirm">
          <span className="join-confirm-mark">
            <Icon name="users" size={26} />
          </span>
          <b>{preview.groupName}</b>
          <small>Invite code {preview.code}</small>
        </div>
        <p className="settle-hint">
          You'll join as a member and can add expenses straight away. Everyone in the group can see
          what you add.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={busy}>
            Back
          </button>
          <button className="btn btn-primary" onClick={join} disabled={busy}>
            {busy ? "Joining…" : "Join group"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Join a group" onClose={onClose}>
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
          onKeyDown={(e) => e.key === "Enter" && look(code)}
        />
        <small style={{ color: "var(--text-faint)" }}>
          Ask the group's creator for the 6-character code, or open the invite link they shared.
        </small>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => look(code)} disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </div>
    </Modal>
  );
}
