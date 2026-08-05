import type {
  AppState,
  Group,
  Member,
  PaymentDraft,
  Recurrence,
  Transaction,
  TxDraft,
} from "../types";
import { round2, uid } from "./finance";

const STORAGE_KEY = "splitwiser.state.v1";
const SCHEMA = 1;

/** Emoji standing in for a settlement in the transaction list. */
export const PAYMENT_CATEGORY = "🤝";

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
    // Spread, never assign: an expense must come out with NO `kind` key at all,
    // or cloud.ts's arrayRemove() stops matching documents written before this
    // field existed — edits would silently duplicate instead of replacing.
    // Every optional field below follows the same rule for the same reason.
    ...(draft.kind === "payment" ? { kind: "payment" as const } : {}),
    ...(cleanPayers(draft.payers) ? { payers: cleanPayers(draft.payers)! } : {}),
    ...(draft.currency ? { currency: draft.currency } : {}),
    ...(Number(draft.rate) > 0 && Number(draft.rate) !== 1 ? { rate: Number(draft.rate) } : {}),
    ...(draft.recurrence ? { recurrence: draft.recurrence } : {}),
    ...(draft.repeatOf ? { repeatOf: draft.repeatOf } : {}),
    ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
    ...(draft.updatedByUid ? { updatedByUid: draft.updatedByUid } : {}),
  };
}

/** Drop zero/negative contributions; a single payer is expressed by `paidBy` alone. */
function cleanPayers(p: Record<string, number> | undefined): Record<string, number> | null {
  if (!p) return null;
  const entries = Object.entries(p)
    .map(([k, v]) => [k, round2(Number(v) || 0)] as const)
    .filter(([, v]) => v > 0);
  if (entries.length < 2) return null;
  return Object.fromEntries(entries);
}

/**
 * Collapse transactions that share an id, keeping the most recently edited.
 *
 * cloud.ts updates a transaction with arrayRemove(prev) + arrayUnion(next), which
 * matches on the whole object. If `prev` is stale — two people editing at once, or
 * an offline edit landing late — the remove silently no-ops and the add succeeds,
 * leaving two copies and a wrong balance. Healing it on the way in keeps the fix
 * offline-safe, which a Firestore transaction would not be.
 */
export function dedupeTransactions(list: Transaction[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const t of list) {
    const seen = byId.get(t.id);
    if (!seen) {
      byId.set(t.id, t);
      continue;
    }
    const a = seen.updatedAt ?? seen.createdAt ?? 0;
    const b = t.updatedAt ?? t.createdAt ?? 0;
    if (b >= a) byId.set(t.id, t);
  }
  return [...byId.values()];
}

/**
 * A settlement expressed in the ordinary transaction model: the payer covers an
 * exact split consisting only of the recipient. computeBalances then credits the
 * payer and debits the recipient by the same amount, cancelling the debt — so
 * partial payments need no special handling, they just cancel less of it.
 */
export function buildPayment(p: PaymentDraft): Transaction {
  return normalizeTx({
    kind: "payment",
    description: "Settlement",
    category: PAYMENT_CATEGORY,
    amount: p.amount,
    date: p.date,
    note: p.note,
    paidBy: p.from,
    split: { type: "exact", among: [p.to], shares: { [p.to]: round2(p.amount) } },
  });
}

export function recordPayment(groupId: string, p: PaymentDraft): Transaction | null {
  if (!getGroup(groupId)) return null;
  const t = buildPayment(p);
  withGroup(groupId, (grp) => ({ ...grp, transactions: [...grp.transactions, t] }));
  return t;
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
  const healed = shared.map((g) => ({ ...g, transactions: dedupeTransactions(g.transactions) }));
  const groups = [...locals, ...healed];
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

/**
 * Fold `fromId` into `intoId`, rewriting every reference so no history is lost.
 *
 * This repairs the duplicate-member problem: joining a group used to always create
 * a fresh slot, so a person added by name and then joining by code existed twice —
 * with the name-only copy holding all the expense history, which also made it
 * undeletable. Pure so it can be tested exhaustively and reused by both backends.
 */
export function mergeMembers(g: Group, fromId: string, intoId: string): Group {
  if (fromId === intoId) return g;
  const from = g.members.find((m) => m.id === fromId);
  const into = g.members.find((m) => m.id === intoId);
  if (!from || !into) return g;

  const swap = (id: string) => (id === fromId ? intoId : id);
  /** Merge two keyed maps, ADDING values when both ids appear in one transaction. */
  const foldKeys = (rec: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec)) {
      const key = swap(k);
      out[key] = round2((out[key] ?? 0) + (Number(v) || 0));
    }
    return out;
  };

  const transactions = g.transactions.map((t) => {
    const among = [...new Set(t.split.among.map(swap))];
    const next: Transaction = {
      ...t,
      paidBy: swap(t.paidBy),
      split: { ...t.split, among, shares: foldKeys(t.split.shares) },
    };
    if (t.payers) {
      const payers = foldKeys(t.payers);
      // A lone payer is expressed by paidBy alone; keep the shape canonical.
      if (Object.keys(payers).length > 1) next.payers = payers;
      else delete next.payers;
    }
    return next;
  });

  return {
    ...g,
    // Keep the surviving slot, but prefer a real name over a placeholder.
    members: g.members
      .filter((m) => m.id !== fromId)
      .map((m) => (m.id === intoId ? { ...m, name: m.name || from.name } : m)),
    memberUids: (g.memberUids ?? []).filter((u) => !from.uid || u !== from.uid),
    transactions,
  };
}

export type RemoveMemberResult = { ok: true } | { ok: false; reason: "no-group" | "in-use" };

export function canRemoveMember(group: Group, memberId: string): RemoveMemberResult {
  const used = group.transactions.some(
    (t) => t.paidBy === memberId || t.split.among.includes(memberId),
  );
  if (used) return { ok: false, reason: "in-use" };
  return { ok: true };
}

export function mergeMembersLocal(groupId: string, fromId: string, intoId: string) {
  withGroup(groupId, (g) => mergeMembers(g, fromId, intoId));
}

export function removeMember(groupId: string, memberId: string): RemoveMemberResult {
  const g = getGroup(groupId);
  if (!g) return { ok: false, reason: "no-group" };
  const check = canRemoveMember(g, memberId);
  if (!check.ok) return check;
  withGroup(groupId, (grp) => ({ ...grp, members: grp.members.filter((m) => m.id !== memberId) }));
  return { ok: true };
}

/* ---------- recurring ---------- */

/**
 * The `n`th occurrence after a plain YYYY-MM-DD start date.
 *
 * Indexed from the original date rather than chained from the previous instance,
 * so a monthly expense anchors to its own day of the month and cannot drift: the
 * 31st clamps to the 28th in February and then returns to the 31st in March.
 *
 * All arithmetic is in UTC — parsing as local and formatting with toISOString()
 * shifts the date backwards wherever the offset is positive, and chaining would
 * compound that error on every step.
 */
function nthPeriod(startIso: string, every: Recurrence, n: number): string {
  const start = new Date(startIso + "T00:00:00Z");
  if (every === "weekly") {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return d.toISOString().slice(0, 10);
  }
  const day = start.getUTCDate();
  const month = start.getUTCMonth() + n;
  const year = start.getUTCFullYear();
  const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastOfTarget)))
    .toISOString()
    .slice(0, 10);
}

/** The user's local calendar date — what they would call "today". */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Instances a recurring template still owes, up to today.
 *
 * Ids are derived from the template and date, so if two devices materialise the
 * same period they produce the SAME id and dedupeTransactions collapses them —
 * which is what makes this safe to run on every open, on every device.
 */
export function dueInstances(g: Group, today = new Date()): Transaction[] {
  const todayIso = localIso(today);
  const out: Transaction[] = [];

  for (const template of g.transactions) {
    if (!template.recurrence || template.repeatOf) continue;
    const every = template.recurrence;
    const existing = new Set(
      g.transactions.filter((t) => t.repeatOf === template.id).map((t) => t.date),
    );

    for (let n = 1; n <= 240; n++) {
      const next = nthPeriod(template.date, every, n);
      if (next > todayIso) break;
      if (existing.has(next)) continue;
      out.push(
        normalizeTx({
          ...template,
          id: `${template.id}__${next}`,
          date: next,
          repeatOf: template.id,
          recurrence: undefined, // an instance does not itself repeat
          createdAt: new Date(next + "T00:00:00Z").getTime(),
        }),
      );
    }
  }
  return out;
}

export function materialiseRecurringLocal(groupId: string): Transaction[] {
  const g = getGroup(groupId);
  if (!g) return [];
  const due = dueInstances(g);
  if (!due.length) return [];
  withGroup(groupId, (grp) => ({ ...grp, transactions: [...grp.transactions, ...due] }));
  return due;
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
      t.id === txId ? normalizeTx({ ...t, ...draft, id: txId, updatedAt: Date.now() }) : t,
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
