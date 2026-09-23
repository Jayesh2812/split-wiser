/**
 * The frozen, publishable view of a group's settlement.
 *
 * Everything here is pure: no window, no Date.now, no firebase. The output is
 * what lands in a WORLD-READABLE Firestore document, so it is built from an
 * explicit allowlist rather than by spreading the Group. A Group carries
 * inviteCode, memberUids, ownerUid and per-transaction addedByUid/note, and
 * publishing any of those would leak the group — `inviteCode` most severely,
 * since it is the capability to join.
 *
 * Member ids never appear either: balances and transfers are keyed by display
 * name, disambiguated when two people share one.
 */
import type { Group } from "../types";
import { computeBalances, groupTotals, round2, settle } from "./finance";

/** The fingerprinted content. Deliberately has no timestamp — see fingerprint(). */
export interface SettlementSnapshot {
  v: 1;
  name: string;
  currency: string;
  /** Which settlement algorithm produced `transfers`. */
  mode: "direct" | "greedy";
  totals: { total: number; count: number; members: number };
  /** Sorted by name. Positive net = is owed. */
  balances: { name: string; net: number }[];
  /** Sorted by amount desc. Names, never member ids. */
  transfers: { from: string; to: string; amount: number }[];
}

/** What actually lands in public_settlements/{token}. */
export interface PublicSettlementDoc extends SettlementSnapshot {
  publishedAt: number;
}

/**
 * Bounds mirrored by validSettlement() in firestore.rules. Enforced here so a
 * long group name can never turn into an opaque permission error at publish.
 */
const MAX_NAME = 120;
const MAX_CURRENCY = 8;

/** Locale-independent string order — localeCompare would vary by device. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Collapse -0 to 0 so the serialised form can't differ for an identical value. */
const norm = (n: number): number => (n === 0 ? 0 : n);

/**
 * member id -> display name, unique within the snapshot. Duplicates get
 * " (2)", " (3)"… so a name remains a valid key without emitting any member id.
 *
 * Independent of members[] order: replaceCloudMember is arrayRemove + arrayUnion,
 * which moves the renamed member to the end of the array.
 */
export function displayNames(g: Group): Record<string, string> {
  const buckets = new Map<string, string[]>();
  for (const m of g.members) {
    const name = (m.name ?? "").trim() || "—";
    const ids = buckets.get(name) ?? [];
    ids.push(m.id);
    buckets.set(name, ids);
  }
  const out: Record<string, string> = {};
  for (const [name, ids] of buckets) {
    // Ordered by member id purely to pick who keeps the bare name; never emitted.
    ids.sort(cmp);
    ids.forEach((id, i) => {
      out[id] = i === 0 ? name : `${name} (${i + 1})`;
    });
  }
  return out;
}

/**
 * The settlement as it stands right now, ready to publish.
 * Reuses finance.ts wholesale — no money logic lives here.
 */
export function buildSnapshot(g: Group, greedy: boolean): SettlementSnapshot {
  const names = displayNames(g);
  const nameOf = (id: string): string => names[id] ?? "—";

  const totals = groupTotals(g);
  const bal = computeBalances(g);

  const balances = g.members
    .map((m) => ({ name: nameOf(m.id), net: norm(round2(bal[m.id] ?? 0)) }))
    .sort((a, b) => cmp(a.name, b.name));

  // settleDirect/settleGreedy rank by amount, but ties fall back to object key
  // insertion order, so sort explicitly to keep the fingerprint stable.
  const transfers = settle(g, greedy)
    .map((t) => ({ from: nameOf(t.from), to: nameOf(t.to), amount: norm(round2(t.amount)) }))
    .sort((a, b) => b.amount - a.amount || cmp(a.from, b.from) || cmp(a.to, b.to));

  return {
    v: 1,
    name: String(g.name ?? "").slice(0, MAX_NAME),
    currency: String(g.currency ?? "").slice(0, MAX_CURRENCY),
    mode: greedy ? "greedy" : "direct",
    totals: {
      total: norm(round2(totals.total)),
      count: totals.count,
      members: totals.members,
    },
    balances,
    transfers,
  };
}

/** JSON with keys sorted at every level, so the digest can't depend on key order. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort(cmp)
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

/**
 * Stable 16-hex-char content hash of a snapshot. Deterministic by construction:
 * no time, no randomness, sorted keys, and locale-independent ordering.
 *
 * Used to detect that a published page no longer matches its group. A timestamp
 * comparison cannot do this job — deleting a transaction LOWERS the group's
 * max(updatedAt), so deletions would go unnoticed.
 *
 * Not cryptographic; it only has to change when the settlement changes.
 */
export function fingerprint(snap: SettlementSnapshot): string {
  // Hash an explicit projection rather than the argument itself: a
  // PublicSettlementDoc is structurally a SettlementSnapshot, and folding its
  // publishedAt in would leave every group permanently stale.
  const canonical = {
    v: snap.v,
    name: snap.name,
    currency: snap.currency,
    mode: snap.mode,
    totals: {
      total: snap.totals.total,
      count: snap.totals.count,
      members: snap.totals.members,
    },
    balances: snap.balances.map((b) => ({ name: b.name, net: b.net })),
    transfers: snap.transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount })),
  };

  const s = stableJson(canonical);
  // FNV-1a in two lanes -> 64 bits, enough for a handful of states per group.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 5) | (c >>> 3)), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
