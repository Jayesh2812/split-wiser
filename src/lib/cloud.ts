/**
 * Firestore layer for shared groups.
 *
 * Data model — deliberately minimal:
 *   groups/{groupId}    one document holding the whole Group blob
 *   invites/{code}      { groupId, groupName } so a code can be resolved to a group
 *
 * Writes use arrayUnion/arrayRemove rather than whole-document writes, so two
 * members adding an expense at the same time cannot clobber each other.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDbOrNull } from "./firebase";
import type { AuthUser, Group, Member, Transaction } from "../types";

const GROUPS = "groups";
const INVITES = "invites";

function db() {
  const d = getDbOrNull();
  if (!d) throw new Error("Cloud sync is not configured.");
  return d;
}

/** 6-character, unambiguous invite code (no O/0/I/1). */
export function makeInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const rand = new Uint32Array(6);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 6; i++) out += alphabet[rand[i]! % alphabet.length];
  return out;
}

/** Strip undefined values — Firestore rejects them. */
function clean<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/* ---------------- create ---------------- */

export async function createSharedGroup(
  name: string,
  currency: string,
  user: AuthUser,
): Promise<Group> {
  const ref = doc(collection(db(), GROUPS));
  const inviteCode = makeInviteCode();
  const me: Member = { id: `mem_${user.uid}`, name: user.name, uid: user.uid };

  const group: Group = {
    id: ref.id,
    name: name.trim() || "New group",
    currency: currency || "₹",
    createdAt: Date.now(),
    members: [me],
    transactions: [],
    kind: "shared",
    ownerUid: user.uid,
    memberUids: [user.uid],
    inviteCode,
  };

  await setDoc(ref, clean(group));
  // Invite lookup doc so others can resolve the code to this group.
  await setDoc(doc(db(), INVITES, inviteCode), {
    groupId: ref.id,
    groupName: group.name,
    createdBy: user.uid,
  });
  return group;
}

/* ---------------- read / subscribe ---------------- */

/** Live-subscribe to every shared group this user belongs to. */
export function subscribeMyGroups(
  uid: string,
  onGroups: (groups: Group[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const q = query(collection(db(), GROUPS), where("memberUids", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const groups = snap.docs.map((d) => {
        const data = d.data() as Group;
        return { ...data, id: d.id, kind: "shared" as const };
      });
      onGroups(groups);
    },
    (err) => onError?.(err),
  );
}

/* ---------------- join ---------------- */

export type JoinResult =
  | { ok: true; groupId: string; alreadyMember: boolean }
  | { ok: false; reason: "not-found" | "failed" };

/**
 * Resolve an invite code and add the user as a real member.
 * The invitee becomes a member slot carrying their own uid.
 */
export async function joinByInviteCode(code: string, user: AuthUser): Promise<JoinResult> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, reason: "not-found" };

  try {
    const inviteSnap = await getDoc(doc(db(), INVITES, normalized));
    if (!inviteSnap.exists()) return { ok: false, reason: "not-found" };
    const { groupId } = inviteSnap.data() as { groupId: string };

    const gref = doc(db(), GROUPS, groupId);
    // If we can already read it, we're a member — nothing to do.
    const existing = await getDoc(gref).catch(() => null);
    if (existing?.exists()) {
      const data = existing.data() as Group;
      if ((data.memberUids ?? []).includes(user.uid)) {
        return { ok: true, groupId, alreadyMember: true };
      }
    }

    const me: Member = { id: `mem_${user.uid}`, name: user.name, uid: user.uid };
    await updateDoc(gref, {
      memberUids: arrayUnion(user.uid),
      members: arrayUnion(clean(me)),
    });
    return { ok: true, groupId, alreadyMember: false };
  } catch (e) {
    console.error("joinByInviteCode failed", e);
    return { ok: false, reason: "failed" };
  }
}

/* ---------------- mutate ---------------- */

export async function updateGroupMeta(
  groupId: string,
  patch: Partial<Pick<Group, "name" | "currency">>,
) {
  await updateDoc(doc(db(), GROUPS, groupId), clean(patch));
}

export async function deleteSharedGroup(group: Group) {
  if (group.inviteCode) {
    await deleteDoc(doc(db(), INVITES, group.inviteCode)).catch(() => {});
  }
  await deleteDoc(doc(db(), GROUPS, group.id));
}

/** Add a name-only member (a placeholder person with no account). */
export async function addCloudMember(groupId: string, member: Member) {
  await updateDoc(doc(db(), GROUPS, groupId), { members: arrayUnion(clean(member)) });
}

export async function removeCloudMember(groupId: string, member: Member) {
  const patch: Record<string, unknown> = { members: arrayRemove(clean(member)) };
  if (member.uid) patch.memberUids = arrayRemove(member.uid);
  await updateDoc(doc(db(), GROUPS, groupId), patch);
}

export async function renameCloudMember(groupId: string, prev: Member, next: Member) {
  await updateDoc(doc(db(), GROUPS, groupId), {
    members: arrayRemove(clean(prev)),
  });
  await updateDoc(doc(db(), GROUPS, groupId), {
    members: arrayUnion(clean(next)),
  });
}

export async function addCloudTransaction(groupId: string, tx: Transaction) {
  await updateDoc(doc(db(), GROUPS, groupId), { transactions: arrayUnion(clean(tx)) });
}

export async function updateCloudTransaction(groupId: string, prev: Transaction, next: Transaction) {
  const ref = doc(db(), GROUPS, groupId);
  // Remove-then-add keeps the operation atomic per array element.
  await updateDoc(ref, { transactions: arrayRemove(clean(prev)) });
  await updateDoc(ref, { transactions: arrayUnion(clean(next)) });
}

export async function deleteCloudTransaction(groupId: string, tx: Transaction) {
  await updateDoc(doc(db(), GROUPS, groupId), { transactions: arrayRemove(clean(tx)) });
}

/** Leave a shared group (removes your uid and your member slot). */
export async function leaveSharedGroup(group: Group, uid: string) {
  const me = group.members.find((m) => m.uid === uid);
  const patch: Record<string, unknown> = { memberUids: arrayRemove(uid) };
  if (me) patch.members = arrayRemove(clean(me));
  await updateDoc(doc(db(), GROUPS, group.id), patch);
}
