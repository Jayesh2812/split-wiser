import { useRef, useState } from "react";
import { Modal } from "./Modal";
import type { AuthUser, Group } from "../types";
import * as repo from "../lib/repo";
import { importBackup } from "../lib/store";
import { exportBackupFile } from "../lib/exporter";
import { toast } from "../lib/toast";
import { copyText, inviteLink } from "../lib/invite";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  user: AuthUser | null;
  onClose: () => void;
}

export function SettingsModal({ group, user, onClose }: Props) {
  const [name, setName] = useState(group.name);
  const [currency, setCurrency] = useState(group.currency);
  const [newMember, setNewMember] = useState("");
  const [busy, setBusy] = useState(false);
  /** Member awaiting delete confirmation — the chip swaps to a confirm/cancel pair. */
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  /** Member being folded into someone else, awaiting a target. */
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shared = group.kind === "shared";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isOwner = !shared || (!!user?.uid && group.ownerUid === user.uid);
  const isMe = (memberUid?: string | null) => !!user?.uid && !!memberUid && memberUid === user.uid;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const addOne = () => {
    const n = newMember.trim();
    if (!n) return;
    setNewMember("");
    void run(() => repo.addMember(group, n));
  };

  const remove = (memberId: string) =>
    run(async () => {
      setPendingRemove(null);
      const res = await repo.removeMember(group, memberId);
      if (!res.ok) {
        toast(
          res.reason === "in-use"
            ? "Member is used in transactions — can't remove."
            : "Can't remove.",
        );
      }
    });

  const merge = (fromId: string, intoId: string) =>
    run(async () => {
      setMergeFrom(null);
      await repo.mergeMembers(group, fromId, intoId);
      toast("Members merged");
    });

  const copyCode = async () => {
    if (!group.inviteCode) return;
    const ok = await copyText(group.inviteCode);
    toast(ok ? "Invite code copied" : `Invite code: ${group.inviteCode}`);
  };

  const copyLink = async () => {
    if (!group.inviteCode) return;
    const link = inviteLink(group.inviteCode);
    const ok = await copyText(link);
    toast(ok ? "Invite link copied" : link);
  };

  /** Native share sheet where available — the natural way to send a link on mobile. */
  const shareLink = async () => {
    if (!group.inviteCode) return;
    const link = inviteLink(group.inviteCode);
    try {
      await navigator.share({
        title: group.name,
        text: `Join "${group.name}" on Splitwiser`,
        url: link,
      });
    } catch {
      /* dismissed, or sharing unavailable — the copy buttons remain */
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importBackup(String(reader.result));
        toast("Backup restored");
        onClose();
      } catch {
        toast("Invalid backup file.");
      }
    };
    reader.readAsText(file);
  };

  const save = () =>
    run(async () => {
      await repo.updateGroup(group, {
        name: name.trim() || group.name,
        currency: currency.trim() || "₹",
      });
      toast("Settings saved");
      onClose();
    });

  const del = () => {
    if (!confirm(`Delete group "${group.name}" and all its transactions? This cannot be undone.`))
      return;
    void run(async () => {
      await repo.deleteGroup(group);
      toast("Group deleted");
      onClose();
    });
  };

  const leave = () => {
    if (!user) return;
    if (!confirm(`Leave "${group.name}"? You'll need the invite code to rejoin.`)) return;
    void run(async () => {
      await repo.leaveGroup(group, user);
      toast("Left the group");
      onClose();
    });
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="field">
        <label>Group type</label>
        <div className="notice">
          {shared ? (
            <>
              <b>
                <Icon name="users" size={14} /> Shared group
              </b>{" "}
              — synced for {group.memberUids?.length ?? 1} signed-in
              member(s). Any member can add expenses.
            </>
          ) : (
            <>
              <b>
                <Icon name="notebook" size={14} /> Solo group
              </b>{" "}
              — only on this device, fully offline. You log everyone's
              expenses yourself.
            </>
          )}
        </div>
      </div>

      {shared && group.inviteCode && (
        <div className="field">
          <label>Invite others</label>
          <div className="invite-row">
            <code className="invite-code">{group.inviteCode}</code>
          </div>
          <div className="invite-actions">
            <button className="btn btn-ghost" onClick={copyCode}>
              <Icon name="copy" /> Copy code
            </button>
            <button className="btn btn-ghost" onClick={copyLink}>
              <Icon name="link" /> Copy link
            </button>
            {canShare && (
              <button className="btn btn-ghost" onClick={shareLink}>
                <Icon name="share" /> Share
              </button>
            )}
          </div>
          <small style={{ color: "var(--text-faint)" }}>
            Either works: the code is typed in by hand, the link opens the app and asks them to
            confirm. Anyone who signs in with Google can join as a member.
          </small>
        </div>
      )}

      <div className="field">
        <label>Group name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
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

      <div className="field">
        <label>Members</label>
        <div className="row">
          <input
            type="text"
            placeholder={shared ? "Add a name-only person…" : "Add a member…"}
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOne()}
          />
          <button
            className="btn btn-primary"
            style={{ flex: "0 0 auto" }}
            onClick={addOne}
            disabled={busy}
          >
            Add
          </button>
        </div>
        <div className="member-chips">
          {group.members.length === 0 && (
            <small style={{ color: "var(--text-faint)" }}>No members yet.</small>
          )}
          {group.members.map((m) =>
            pendingRemove === m.id ? (
              <span className="member-chip confirming" key={m.id}>
                Remove {m.name}?
                <button
                  className="chip-confirm"
                  title="Confirm removal"
                  onClick={() => remove(m.id)}
                  disabled={busy}
                >
                  <Icon name="check" size={14} />
                </button>
                <button
                  className="chip-cancel"
                  title="Keep this member"
                  onClick={() => setPendingRemove(null)}
                  disabled={busy}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ) : (
              <span
                className={`member-chip${m.uid ? " google" : ""}`}
                key={m.id}
                title={m.uid ? "Joined with Google" : "Name-only participant"}
              >
                {m.name}
                {isMe(m.uid) && <em className="you-tag">you</em>}
                {group.members.length > 1 && (
                  <button
                    className="chip-merge"
                    title={`Merge ${m.name} into another member`}
                    aria-label={`Merge ${m.name}`}
                    onClick={() => setMergeFrom(m.id)}
                    disabled={busy}
                  >
                    <Icon name="users" size={13} />
                  </button>
                )}
                <button
                  title="Remove"
                  onClick={() => setPendingRemove(m.id)}
                  disabled={busy}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ),
          )}
        </div>
        {mergeFrom && (
          <div className="merge-panel">
            <b>Merge {repo.getGroup(group.id)?.members.find((m) => m.id === mergeFrom)?.name}</b>
            <small>
              Pick who they really are. Every expense, split and payment moves across, and the
              duplicate disappears. Use this when someone was added by name and then joined with
              Google.
            </small>
            <div className="merge-options">
              {group.members
                .filter((m) => m.id !== mergeFrom)
                .map((m) => (
                  <button
                    key={m.id}
                    className="btn btn-ghost"
                    onClick={() => merge(mergeFrom, m.id)}
                    disabled={busy}
                  >
                    {m.name}
                    {isMe(m.uid) ? " (you)" : ""}
                  </button>
                ))}
            </div>
            <button className="btn btn-ghost btn-block" onClick={() => setMergeFrom(null)}>
              Cancel
            </button>
          </div>
        )}

        {shared && (
          <small style={{ color: "var(--text-faint)" }}>
            A coloured glow means they joined with Google. Plain chips are name-only
            participants you track manually. If someone appears twice, merge the duplicate into
            their account with the merge button.
          </small>
        )}
      </div>

      {!shared && (
        <div className="field">
          <label>Data</label>
          <div className="row">
            <button
              className="btn btn-ghost"
              onClick={() => {
                exportBackupFile();
                toast("Backup downloaded");
              }}
            >
              <Icon name="save" /> Backup JSON
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <Icon name="folder" /> Restore
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
          />
          <small style={{ color: "var(--text-faint)" }}>
            Backups cover solo groups. Shared groups already live in the cloud.
          </small>
        </div>
      )}

      <div className="field">
        {shared && !isOwner ? (
          <button className="btn btn-danger btn-block" onClick={leave} disabled={busy}>
            Leave this group
          </button>
        ) : (
          <button className="btn btn-danger btn-block" onClick={del} disabled={busy}>
            Delete this group{shared ? " for everyone" : ""}
          </button>
        )}
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </Modal>
  );
}
