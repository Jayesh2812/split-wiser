import { useState } from "react";
import { Modal } from "./Modal";
import { createLocalGroup, createSharedGroup } from "../lib/repo";
import { signInWithGoogle } from "../lib/auth";
import { toast } from "../lib/toast";
import { useAuthUser } from "../hooks/useAuth";
import type { GroupKind } from "../types";

interface Props {
  kind: GroupKind;
  onClose: () => void;
  onCreated: () => void;
}

export function GroupModal({ kind, onClose, onCreated }: Props) {
  const user = useAuthUser();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("₹");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);

  const shared = kind === "shared";

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

  const create = async () => {
    if (shared) {
      if (!user) return toast("Sign in with Google first.");
      try {
        setBusy(true);
        await createSharedGroup(name.trim() || "New group", currency.trim() || "₹", user);
        toast("Shared group created — share the invite code!");
        onCreated();
      } catch (e) {
        console.error(e);
        toast(e instanceof Error ? e.message : "Could not create the group.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const names = members
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    createLocalGroup(name.trim() || "New group", currency.trim() || "₹", names);
    toast("Group created");
    onCreated();
  };

  return (
    <Modal title={shared ? "New shared group" : "New group"} onClose={onClose}>
      <div className="field">
        <label>Group name</label>
        <input
          type="text"
          placeholder="e.g. Goa Trip, Flatmates"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Currency symbol</label>
        <input
          type="text"
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        />
      </div>

      {shared ? (
        <div className="field">
          <label>Members</label>
          {user ? (
            <div className="notice">
              You'll be added as <b>{user.name}</b>. After creating, share the invite code from
              Settings — anyone who joins with Google becomes a member and can add expenses.
            </div>
          ) : (
            <>
              <div className="notice">
                A shared group needs a Google account so members can sync. Your expense data stays
                private to the group.
              </div>
              <button className="btn btn-primary btn-block" onClick={signIn} disabled={busy}>
                Continue with Google
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="field">
          <label>Members (one per line)</label>
          <textarea
            placeholder={"Alex\nSam\nJordan"}
            value={members}
            onChange={(e) => setMembers(e.target.value)}
          />
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={create}
          disabled={busy || (shared && !user)}
        >
          {busy ? "Working…" : shared ? "Create shared group" : "Create group"}
        </button>
      </div>
    </Modal>
  );
}
