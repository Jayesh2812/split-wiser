/**
 * Single facade the UI talks to. Routes every mutation by group kind:
 *
 *   local  -> localStorage store (synchronous, offline-only)
 *   shared -> Firestore (snapshot listener echoes the change back into the store)
 *
 * For shared groups we rely on Firestore's latency compensation: the local
 * cache fires the snapshot immediately, so the UI updates instantly even
 * offline, and the write flushes when connectivity returns.
 */
import type { AuthUser, Group, Member, TxDraft } from "../types";
import * as store from "./store";
import * as cloud from "./cloud";
import { uid } from "./finance";

export type { RemoveMemberResult } from "./store";

const isShared = (g: Group) => g.kind === "shared";

/* ---------- create ---------- */

/** Option 1: solo group — names only, nothing leaves the device. */
export function createLocalGroup(name: string, currency: string, memberNames: string[]): Group {
  const g = store.createGroup(name, currency);
  memberNames.forEach((n) => store.addMember(g.id, n));
  return store.getGroup(g.id) ?? g;
}

/** Option 2: shared group — real people join with Google and can add expenses. */
export async function createSharedGroup(
  name: string,
  currency: string,
  user: AuthUser,
): Promise<Group> {
  const g = await cloud.createSharedGroup(name, currency, user);
  store.upsertGroup(g, true);
  return g;
}

export async function joinGroupByCode(code: string, user: AuthUser) {
  return cloud.joinByInviteCode(code, user);
}

/** Name the group behind an invite code without joining it. */
export async function lookupInviteCode(code: string) {
  return cloud.lookupInviteCode(code);
}

/* ---------- group ---------- */

export async function updateGroup(
  group: Group,
  patch: Partial<Pick<Group, "name" | "currency">>,
): Promise<void> {
  if (isShared(group)) await cloud.updateGroupMeta(group.id, patch, group.inviteCode);
  else store.updateGroup(group.id, patch);
}

export async function deleteGroup(group: Group): Promise<void> {
  if (isShared(group)) {
    await cloud.deleteSharedGroup(group);
    store.deleteGroup(group.id);
  } else {
    store.deleteGroup(group.id);
  }
}

export async function leaveGroup(group: Group, user: AuthUser): Promise<void> {
  if (!isShared(group)) return;
  await cloud.leaveSharedGroup(group, user.uid);
  store.deleteGroup(group.id);
}

/* ---------- members ---------- */

export async function addMember(group: Group, name: string): Promise<void> {
  if (isShared(group)) {
    // A name-only participant: someone who owes money but has no account.
    const m: Member = { id: uid("mem"), name: name.trim() || "Member", uid: null };
    await cloud.addCloudMember(group.id, m);
  } else {
    store.addMember(group.id, name);
  }
}

export async function removeMember(
  group: Group,
  memberId: string,
): Promise<store.RemoveMemberResult> {
  const check = store.canRemoveMember(group, memberId);
  if (!check.ok) return check;
  if (isShared(group)) {
    const m = group.members.find((x) => x.id === memberId);
    if (!m) return { ok: false, reason: "no-group" };
    await cloud.removeCloudMember(group.id, m);
    return { ok: true };
  }
  return store.removeMember(group.id, memberId);
}

export async function renameMember(group: Group, memberId: string, name: string): Promise<void> {
  if (isShared(group)) {
    const prev = group.members.find((x) => x.id === memberId);
    if (!prev) return;
    await cloud.renameCloudMember(group.id, prev, { ...prev, name: name.trim() });
  } else {
    store.renameMember(group.id, memberId, name);
  }
}

/* ---------- transactions ---------- */

export async function addTransaction(
  group: Group,
  draft: TxDraft,
  user: AuthUser | null,
): Promise<void> {
  if (isShared(group)) {
    const tx = store.normalizeTx({ ...draft, addedByUid: user?.uid ?? null });
    await cloud.addCloudTransaction(group.id, tx);
  } else {
    store.addTransaction(group.id, draft);
  }
}

export async function updateTransaction(
  group: Group,
  txId: string,
  draft: TxDraft,
): Promise<void> {
  if (isShared(group)) {
    const prev = group.transactions.find((t) => t.id === txId);
    if (!prev) return;
    const next = store.normalizeTx({ ...prev, ...draft, id: txId });
    await cloud.updateCloudTransaction(group.id, prev, next);
  } else {
    store.updateTransaction(group.id, txId, draft);
  }
}

export async function deleteTransaction(group: Group, txId: string): Promise<void> {
  if (isShared(group)) {
    const tx = group.transactions.find((t) => t.id === txId);
    if (!tx) return;
    await cloud.deleteCloudTransaction(group.id, tx);
  } else {
    store.deleteTransaction(group.id, txId);
  }
}

/* ---------- re-exports the UI still needs ---------- */
export const {
  getState,
  getActiveGroup,
  getGroup,
  setActiveGroup,
  setGreedyMode,
  exportBackup,
  importBackup,
  resetAll,
  mergeSharedGroups,
  clearSharedGroups,
} = store;
