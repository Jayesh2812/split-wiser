import { useState } from "react";
import type { AuthUser, Group, Member } from "../types";
import * as repo from "../lib/repo";
import { isGroupAdmin } from "../lib/finance";
import { colorFor, initials } from "../lib/format";
import { copyText, inviteLink } from "../lib/invite";
import { fetchMemberEmails } from "../lib/memberEmails";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  user: AuthUser | null;
  /** Leaving removes this group from under us — the caller sends us somewhere valid. */
  onLeft: () => void;
}

/**
 * Everyone in the group, and every operation on them: add, rename, contact
 * details, merge duplicates, remove, invite, and leaving yourself.
 *
 * Deliberately a tab rather than a section of the Settings sheet. Membership is
 * something a group works on together and comes back to, while Settings is the
 * group's own configuration — mixing the two made the sheet long enough that
 * merging a duplicate meant scrolling past the publish and delete controls.
 */
export function MembersPanel({ group, user, onLeft }: Props) {
  const [newMember, setNewMember] = useState("");
  const [busy, setBusy] = useState(false);
  /** Member awaiting delete confirmation — the row swaps to a confirm/cancel pair. */
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  /**
   * Merging is rare — it exists for the one case where somebody was added by
   * name and later joined with Google — and a control on every row for it made
   * the list read like a page of tools rather than a list of people. Behind a
   * toggle, the rows stay quiet until you actually came here to merge.
   */
  const [merging, setMerging] = useState(false);
  /** Member being folded into someone else, awaiting a target. */
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);

  const shared = group.kind === "shared";
  const isOwner = isGroupAdmin(group, user?.uid);
  /**
   * Members holding an account whose address nobody has yet — what the lookup is
   * for. Offered to the group's owner alone, like every other group-wide action;
   * the endpoint enforces the same rule, so hiding it here is courtesy, not
   * security.
   */
  const missingEmails =
    shared && isOwner ? group.members.filter((m) => m.uid && !m.email).length : 0;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
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
            ? "Member is used in transactions — merge them instead of removing."
            : "Can't remove.",
        );
      }
    });

  const merge = (fromId: string, intoId: string) =>
    run(async () => {
      setMergeFrom(null);
      setMerging(false);
      await repo.mergeMembers(group, fromId, intoId);
      toast("Members merged");
    });

  const toggleMerging = (on: boolean) => {
    setMerging(on);
    // Leaving a half-finished pick behind would re-open it the next time the
    // toggle came on, pointing at a member who may since have been removed.
    if (!on) setMergeFrom(null);
  };

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
    try {
      await navigator.share({
        title: group.name,
        text: `Join "${group.name}" on Splitwiser`,
        url: inviteLink(group.inviteCode),
      });
    } catch {
      /* dismissed, or sharing unavailable — the copy buttons remain */
    }
  };

  /**
   * Ask the server to fill in the addresses of members who never wrote their
   * own. Optional infrastructure — a deployment without the endpoint says so
   * plainly instead of looking broken.
   */
  const lookupEmails = () =>
    run(async () => {
      const res = await fetchMemberEmails(group.id);
      if (res.ok) {
        toast(
          res.filled > 0
            ? `Filled in ${res.filled} ${res.filled === 1 ? "email" : "emails"}`
            : "No new emails to fetch — everyone we can look up is already here.",
        );
        return;
      }
      toast(
        res.reason === "unavailable"
          ? "Email lookup isn't set up on this deployment — type them in instead."
          : res.reason === "auth"
            ? "Sign in again and retry."
            : res.reason === "not-admin"
              ? "Only the group's owner can fetch emails."
              : res.reason === "not-a-member"
                ? "Only a member of this group can do that."
                : "Couldn't fetch emails.",
      );
    });

  const leave = () => {
    if (!user) return;
    if (!confirm(`Leave "${group.name}"? You'll need the invite code to rejoin.`)) return;
    void run(async () => {
      await repo.leaveGroup(group, user);
      toast("Left the group");
      onLeft();
    });
  };

  /**
   * What sits under a member's name: their email, or why there isn't one.
   *
   * A signed-in member with no email is almost never someone whose account has
   * none — it is someone who has not opened the app since emails started being
   * stored. A browser can only read the address of whoever is signed in on it,
   * so theirs arrives when they next open the group, or when someone types it.
   */
  const contactLine = (m: Member) => {
    if (m.email) return m.email;
    if (m.uid) return "Email not shared yet";
    return "No email yet";
  };

  return (
    <section className="tab-panel">
      {shared && group.inviteCode && (
        <div className="card invite-card">
          <div className="invite-card-head">
            <b>Invite someone</b>
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
          <small>
            Either works: the code is typed in by hand, the link opens the app and asks them to
            confirm. Anyone who signs in with Google can join as a member.
          </small>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="text"
          placeholder={shared ? "Add a name-only person…" : "Add a member…"}
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addOne()}
        />
        <button className="btn btn-primary" onClick={addOne} disabled={busy}>
          <Icon name="plus" /> Add
        </button>
      </div>

      {missingEmails > 0 && (
        <div className="lookup-row">
          <small>
            {missingEmails} {missingEmails === 1 ? "member hasn't" : "members haven't"} shared an
            email yet.
          </small>
          <button className="btn btn-ghost" onClick={lookupEmails} disabled={busy}>
            <Icon name="download" /> Fetch emails
          </button>
        </div>
      )}

      {group.members.length > 1 && (
        <div className="settle-mode-row merge-toggle">
          <div className="settle-mode-label">
            <strong>Merge duplicates</strong>
            <small>
              For when the same person is in the list twice — added by name, then joined with
              Google.
            </small>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={merging}
              disabled={busy}
              onChange={(e) => toggleMerging(e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>
      )}

      {group.members.length === 0 && (
        <div className="hint">No members yet. Add the people sharing these expenses.</div>
      )}

      <div className="member-list">
        {group.members.map((m) => {
          const mine = isMe(m.uid);
          return (
            <div className={`member-row${m.uid ? " google" : ""}${mine ? " is-you" : ""}`} key={m.id}>
              <div className="member-main">
                <div className="avatar" style={{ background: colorFor(m.id) }}>
                  {initials(m.name)}
                </div>
                <div className="who">
                  <b>
                    {m.name}
                    {mine && <em className="you-tag">you</em>}
                    {m.uid && (
                      <span className="kind-badge" title="Joined with Google">
                        <Icon name="google" size={12} />
                      </span>
                    )}
                  </b>
                  <small className={m.email ? "member-email" : undefined}>{contactLine(m)}</small>
                </div>
                {pendingRemove === m.id ? (
                  <div className="member-actions">
                    <span className="confirm-text">Remove?</span>
                    <button
                      className="chip-confirm"
                      title="Confirm removal"
                      onClick={() => remove(m.id)}
                      disabled={busy}
                    >
                      <Icon name="check" size={15} />
                    </button>
                    <button
                      className="chip-cancel"
                      title="Keep this member"
                      onClick={() => setPendingRemove(null)}
                      disabled={busy}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="member-actions">
                    {merging ? (
                      <button
                        className="link-btn"
                        aria-label={`Merge ${m.name}`}
                        onClick={() => setMergeFrom(m.id)}
                        disabled={busy}
                      >
                        Merge
                      </button>
                    ) : (
                      <button
                        className="icon-action"
                        title={`Remove ${m.name}`}
                        aria-label={`Remove ${m.name}`}
                        onClick={() => setPendingRemove(m.id)}
                        disabled={busy}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {mergeFrom === m.id && (
                <div className="merge-panel">
                  <b>Merge {m.name}</b>
                  <small>
                    Pick who they really are. Every expense, split and payment moves across, and
                    the duplicate disappears. Use this when someone was added by name and then
                    joined with Google.
                  </small>
                  <div className="merge-options">
                    {group.members
                      .filter((other) => other.id !== m.id)
                      .map((other) => (
                        <button
                          key={other.id}
                          className="btn btn-ghost"
                          onClick={() => merge(m.id, other.id)}
                          disabled={busy}
                        >
                          {other.name}
                          {isMe(other.uid) ? " (you)" : ""}
                        </button>
                      ))}
                  </div>
                  <button className="btn btn-ghost btn-block" onClick={() => setMergeFrom(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {shared && (
        <small className="member-legend">
          A Google mark means they joined with their account. Their email fills itself in the next
          time they open this group — a browser can only read the address of whoever is signed in
          on it, so nobody else's device can fetch it for them. Until then you can type it in, and
          their account's own address takes over when they arrive. If someone appears twice, merge
          the duplicate into their account.
        </small>
      )}

      {shared && !isOwner && user && (
        <button
          className="btn btn-danger btn-block"
          onClick={leave}
          disabled={busy}
          style={{ marginTop: 14 }}
        >
          Leave this group
        </button>
      )}
    </section>
  );
}
