import { useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { AuthUser, Group } from "../types";
import * as repo from "../lib/repo";
import { importBackup } from "../lib/store";
import { exportBackupFile } from "../lib/exporter";
import { toast } from "../lib/toast";
import { copyText } from "../lib/invite";
import { publicSettlementLink } from "../lib/route";
import { buildSnapshot, fingerprint } from "../lib/snapshot";
import { isGroupAdmin } from "../lib/finance";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  /** Settlement mode the snapshot is built with, mirroring the Settle Up tab. */
  greedy: boolean;
  user: AuthUser | null;
  onClose: () => void;
  /** Membership lives on its own tab now; this is the way back to it. */
  onManageMembers: () => void;
}

export function SettingsModal({ group, greedy, user, onClose, onManageMembers }: Props) {
  const [name, setName] = useState(group.name);
  const [currency, setCurrency] = useState(group.currency);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const shared = group.kind === "shared";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isOwner = isGroupAdmin(group, user?.uid);

  /**
   * `shared &&` is required: isOwner is true for a solo group, and a solo group
   * has no cloud document to publish.
   */
  const canPublish = shared && isOwner;
  const published = shared && !!group.publicToken;
  const snapshot = useMemo(
    () => (canPublish ? buildSnapshot(group, greedy) : null),
    [canPublish, group, greedy],
  );
  /**
   * The published page no longer matches the group. Compared by content, not by
   * timestamp: deleting a transaction LOWERS the group's max updatedAt, so a time
   * comparison would miss deletions entirely.
   */
  const stale = published && !!snapshot && fingerprint(snapshot) !== group.publishedFingerprint;
  const publicLink = group.publicToken ? publicSettlementLink(group.publicToken) : "";

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

  /**
   * Firestore write promises resolve on SERVER acknowledgement, so offline they
   * never settle — run() would stay busy forever. Worse, the group doc's fields
   * apply optimistically from the local cache, so Settings would show a link
   * whose public document was never written and which 404s for everyone.
   */
  const offline = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast("You're offline — this needs a connection so the link works for others.");
      return true;
    }
    return false;
  };

  const publish = (republish: boolean) => {
    if (offline()) return;
    if (
      !republish &&
      !confirm(
        `Publish "${group.name}"? Anyone with the link can see everyone's name and balance, ` +
          `without signing in. Expenses, notes and the invite code are never included.`,
      )
    ) {
      return;
    }
    void run(async () => {
      await repo.publishSettlement(group, greedy);
      // Deliberately not auto-copying: Safari drops clipboard permission once the
      // user gesture has been consumed by the await.
      toast(republish ? "Settlement republished" : "Settlement published");
    });
  };

  const unpublish = () => {
    if (offline()) return;
    if (!confirm(`Stop sharing "${group.name}"? The link will stop working for everyone.`)) return;
    void run(async () => {
      await repo.unpublishSettlement(group);
      toast("Link turned off");
    });
  };

  const copyPublicLink = async () => {
    if (!publicLink) return;
    const ok = await copyText(publicLink);
    toast(ok ? "Link copied" : publicLink);
  };

  const sharePublicLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.share({
        title: group.name,
        text: `Final settlement for "${group.name}"`,
        url: publicLink,
      });
    } catch {
      /* dismissed, or sharing unavailable — the copy button remains */
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

      <div className="field">
        <label>People</label>
        <button className="btn btn-ghost btn-block" onClick={onManageMembers}>
          <Icon name="users" /> Manage members
          {shared && group.inviteCode ? " & invites" : ""}
        </button>
        <small style={{ color: "var(--text-faint)" }}>
          {group.members.length} {group.members.length === 1 ? "person" : "people"} in this group.
          {shared ? " Invite codes, emails and leaving live there too." : " Names and emails live there."}
        </small>
      </div>

      {canPublish && (
        <div className="field">
          <label>Final settlement</label>
          {published ? (
            <>
              <code className="public-link">{publicLink}</code>
              {stale ? (
                <div className="warn-text">
                  The published page no longer matches this group. Republish to update it.
                </div>
              ) : (
                <small style={{ color: "var(--text-faint)", display: "block", marginTop: 6 }}>
                  Published{" "}
                  {group.publishedAt ? new Date(group.publishedAt).toLocaleString() : "recently"}.
                </small>
              )}
              <div className="invite-actions">
                <button className="btn btn-ghost" onClick={copyPublicLink} disabled={busy}>
                  <Icon name="link" /> Copy link
                </button>
                {canShare && (
                  <button className="btn btn-ghost" onClick={sharePublicLink} disabled={busy}>
                    <Icon name="share" /> Share
                  </button>
                )}
                {stale && (
                  <button className="btn btn-ghost" onClick={() => publish(true)} disabled={busy}>
                    <Icon name="save" /> Republish
                  </button>
                )}
              </div>
              <button
                className="btn btn-danger btn-block"
                onClick={unpublish}
                disabled={busy}
                style={{ marginTop: 8 }}
              >
                Stop sharing
              </button>
              <small style={{ color: "var(--text-faint)" }}>
                A frozen snapshot — it won't change until you republish. Anyone who keeps the link
                keeps seeing it, so turn it off if someone shouldn't have access.
              </small>
            </>
          ) : (
            <>
              <div className="notice">
                Publish a read-only page anyone can open — no app, no sign-in — showing who pays
                whom and where everyone stands. Everyone's name and net balance become visible to
                anyone with the link. Expenses, notes and the invite code are never included.
              </div>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => publish(false)}
                disabled={busy}
                style={{ marginTop: 8 }}
              >
                <Icon name="share" /> Publish settlement
              </button>
            </>
          )}
        </div>
      )}

      {/* Their name is on a public URL, so a member should be able to see that. */}
      {shared && !isOwner && published && (
        <div className="field">
          <label>Final settlement</label>
          <div className="notice">
            The group owner has published this group's settlement. Anyone with the link can see
            everyone's name and balance.
          </div>
          <code className="public-link">{publicLink}</code>
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

      {/* Leaving is a membership action and lives on the Members tab; deleting
          the group is the owner's, and stays here with the rest of its setup. */}
      {!(shared && !isOwner) && (
        <div className="field">
          <button className="btn btn-danger btn-block" onClick={del} disabled={busy}>
            Delete this group{shared ? " for everyone" : ""}
          </button>
        </div>
      )}

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
