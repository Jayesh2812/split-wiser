import type { AppState, Group, Member, Transaction, TxDraft } from "../types";
import { round2, uid } from "./finance";

const STORAGE_KEY = "splitwiser.state.v1";
const SCHEMA = 1;

function defaultState(): AppState {
  return { schema: SCHEMA, activeGroupId: null, settings: { greedyMode: false }, groups: [] };
}

/** Groups saved before shared groups existed had no `kind`. */
function migrateGroup(g: Group): Group {
  return { ...g, kind: g.kind ?? "local" };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw) as Partial<AppState>;
    if (!s || typeof s !== "object" || !Array.isArray(s.groups)) return defaultState();
    return {
      schema: s.schema ?? SCHEMA,
      activeGroupId: s.activeGroupId ?? null,
      settings: s.settings ?? { greedyMode: false },
      groups: (s.groups as Group[]).map(migrateGroup),
    };
  } catch (e) {
    console.warn("Failed to load state, starting fresh.", e);
    return defaultState();
  }
}

/* ---------- external store plumbing ---------- */
let state: AppState = load();
const listeners = new Set<() => void>();

/**
 * Only local groups are written to localStorage. Shared groups are owned by
 * Firestore, which keeps its own offline (IndexedDB) cache — persisting them
 * twice would just create a second, staler copy.
 */
function persist() {
  try {
    const persistable: AppState = {
      ...state,
      groups: state.groups.filter((g) => g.kind !== "shared"),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch (e) {
    console.error("Save failed", e);
  }
}

function commit(next: AppState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): AppState {
  return state;
}

export function getActiveGroup(): Group | null {
  return state.groups.find((g) => g.id === state.activeGroupId) ?? null;
}

export function getGroup(id: string): Group | null {
  return state.groups.find((g) => g.id === id) ?? null;
}

/* ---------- helpers ---------- */
export function normalizeTx(draft: TxDraft & Partial<Transaction>): Transaction {
  return {
    id: draft.id ?? uid("tx"),
    description: (draft.description || "Expense").trim(),
    category: draft.category || "🧾",
    amount: round2(draft.amount),
    date: draft.date || new Date().toISOString().slice(0, 10),
    note: (draft.note || "").trim(),
    paidBy: draft.paidBy,
    createdAt: draft.createdAt ?? Date.now(),
    addedByUid: draft.addedByUid ?? null,
    split: {
      type: draft.split?.type ?? "equal",
      among: draft.split?.among ? [...draft.split.among] : [],
      shares: draft.split?.shares ? { ...draft.split.shares } : {},
    },
  };
}

function withGroup(groupId: string, fn: (g: Group) => Group) {
  commit({
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? fn(g) : g)),
  });
}

/* ---------- group actions (local state) ---------- */
export function setActiveGroup(id: string | null) {
  commit({ ...state, activeGroupId: id });
}

export function createGroup(name: string, currency: string): Group {
  const g: Group = {
    id: uid("grp"),
    name: (name || "New group").trim(),
    currency: currency || "₹",
    createdAt: Date.now(),
    members: [],
    transactions: [],
    kind: "local",
  };
  commit({ ...state, groups: [...state.groups, g], activeGroupId: g.id });
  return g;
}

/** Insert an already-built group (used when a shared group is created). */
export function upsertGroup(group: Group, makeActive = false) {
  const exists = state.groups.some((g) => g.id === group.id);
  commit({
    ...state,
    groups: exists
      ? state.groups.map((g) => (g.id === group.id ? group : g))
      : [...state.groups, group],
    activeGroupId: makeActive ? group.id : state.activeGroupId,
  });
}

/**
 * Replace the set of shared groups with what Firestore reports.
 * Local groups are untouched.
 */
export function mergeSharedGroups(shared: Group[]) {
  const locals = state.groups.filter((g) => g.kind !== "shared");
  const groups = [...locals, ...shared];
  const stillThere = groups.some((g) => g.id === state.activeGroupId);
  commit({
    ...state,
    groups,
    activeGroupId: stillThere ? state.activeGroupId : (groups[0]?.id ?? null),
  });
}

/** Drop shared groups from memory (on sign-out). */
export function clearSharedGroups() {
  const groups = state.groups.filter((g) => g.kind !== "shared");
  const stillThere = groups.some((g) => g.id === state.activeGroupId);
  commit({
    ...state,
    groups,
    activeGroupId: stillThere ? state.activeGroupId : (groups[0]?.id ?? null),
  });
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "currency">>) {
  withGroup(id, (g) => ({ ...g, ...patch }));
}

export function deleteGroup(id: string) {
  const groups = state.groups.filter((g) => g.id !== id);
  const activeGroupId = state.activeGroupId === id ? (groups[0]?.id ?? null) : state.activeGroupId;
  commit({ ...state, groups, activeGroupId });
}

/* ---------- member actions ---------- */
export function addMember(groupId: string, name: string): Member {
  const m: Member = { id: uid("mem"), name: (name || "Member").trim() };
  withGroup(groupId, (g) => ({ ...g, members: [...g.members, m] }));
  return m;
}

export function renameMember(groupId: string, memberId: string, name: string) {
  withGroup(groupId, (g) => ({
    ...g,
    members: g.members.map((m) => (m.id === memberId ? { ...m, name: name.trim() } : m)),
  }));
}

export type RemoveMemberResult = { ok: true } | { ok: false; reason: "no-group" | "in-use" };

export function canRemoveMember(group: Group, memberId: string): RemoveMemberResult {
  const used = group.transactions.some(
    (t) => t.paidBy === memberId || t.split.among.includes(memberId),
  );
  if (used) return { ok: false, reason: "in-use" };
  return { ok: true };
}

export function removeMember(groupId: string, memberId: string): RemoveMemberResult {
  const g = getGroup(groupId);
  if (!g) return { ok: false, reason: "no-group" };
  const check = canRemoveMember(g, memberId);
  if (!check.ok) return check;
  withGroup(groupId, (grp) => ({ ...grp, members: grp.members.filter((m) => m.id !== memberId) }));
  return { ok: true };
}

/* ---------- transaction actions ---------- */
export function addTransaction(groupId: string, draft: TxDraft): Transaction {
  const t = normalizeTx(draft);
  withGroup(groupId, (g) => ({ ...g, transactions: [...g.transactions, t] }));
  return t;
}

export function updateTransaction(groupId: string, txId: string, draft: TxDraft) {
  withGroup(groupId, (g) => ({
    ...g,
    transactions: g.transactions.map((t) =>
      t.id === txId ? normalizeTx({ ...t, ...draft, id: txId }) : t,
    ),
  }));
}

export function deleteTransaction(groupId: string, txId: string) {
  withGroup(groupId, (g) => ({ ...g, transactions: g.transactions.filter((t) => t.id !== txId) }));
}

/* ---------- settings ---------- */
export function setGreedyMode(on: boolean) {
  commit({ ...state, settings: { ...state.settings, greedyMode: on } });
}

/* ---------- backup / restore ---------- */
/** Backups cover local groups only — shared groups live in the cloud. */
export function exportBackup(): string {
  const payload: AppState = {
    ...state,
    groups: state.groups.filter((g) => g.kind !== "shared"),
  };
  return JSON.stringify(payload, null, 2);
}

export function importBackup(json: string) {
  const parsed = JSON.parse(json) as Partial<AppState>;
  if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Not a valid Splitwiser backup.");
  const restored = (parsed.groups as Group[]).map(migrateGroup).filter((g) => g.kind !== "shared");
  const shared = state.groups.filter((g) => g.kind === "shared");
  const groups = [...restored, ...shared];
  commit({
    schema: parsed.schema ?? SCHEMA,
    activeGroupId: groups[0]?.id ?? null,
    settings: parsed.settings ?? { greedyMode: false },
    groups,
  });
}

export function resetAll() {
  commit(defaultState());
}
