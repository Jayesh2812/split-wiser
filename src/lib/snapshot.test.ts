import { describe, it, expect } from "vitest";
import type { Group, Transaction } from "../types";
import { buildSnapshot, displayNames, fingerprint } from "./snapshot";

const A = "mem_alex", B = "mem_sam", C = "mem_jordan";

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "amount" | "paidBy" | "split">,
): Transaction {
  return {
    id: partial.id ?? "tx_" + Math.round(partial.amount * 100),
    description: partial.description ?? "x",
    category: partial.category ?? "🧾",
    amount: partial.amount,
    date: partial.date ?? "2026-01-01",
    note: partial.note ?? "",
    paidBy: partial.paidBy,
    createdAt: partial.createdAt ?? 0,
    split: partial.split,
    // Mirrors normalizeTx: optional keys are absent unless explicitly set.
    ...(partial.kind === "payment" ? { kind: "payment" as const } : {}),
    ...(partial.payers ? { payers: partial.payers } : {}),
    ...(partial.addedByUid ? { addedByUid: partial.addedByUid } : {}),
    ...(partial.updatedAt ? { updatedAt: partial.updatedAt } : {}),
  };
}

/** A shared group carrying every secret the published payload must not contain. */
function sharedGroup(): Group {
  return {
    id: "grp_secret123",
    name: "Goa Trip",
    currency: "₹",
    kind: "shared",
    createdAt: 0,
    ownerUid: "uid_owner_aaa",
    memberUids: ["uid_owner_aaa", "uid_sam_bbb"],
    inviteCode: "XY7K2M",
    members: [
      { id: A, name: "Alex", uid: "uid_owner_aaa" },
      { id: B, name: "Sam", uid: "uid_sam_bbb" },
    ],
    transactions: [
      tx({
        amount: 100,
        paidBy: A,
        note: "reimburse me quietly",
        addedByUid: "uid_owner_aaa",
        split: { type: "equal", among: [A, B], shares: {} },
      }),
    ],
  };
}

describe("buildSnapshot — the published payload", () => {
  it("leaks no group secrets, member ids, uids, notes or transactions", () => {
    const g = sharedGroup();
    const json = JSON.stringify(buildSnapshot(g, false));

    // The invite code is the worst case: it is the capability to JOIN the group.
    for (const secret of [
      "XY7K2M",
      "uid_owner_aaa",
      "uid_sam_bbb",
      "grp_secret123",
      "mem_alex",
      "mem_sam",
      "reimburse me quietly",
      "tx_10000",
      "ownerUid",
      "memberUids",
      "inviteCode",
      "addedByUid",
      "transactions",
      "note",
    ]) {
      expect(json, `published payload must not contain ${secret}`).not.toContain(secret);
    }
  });

  it("exposes only the allowlisted top-level keys", () => {
    const snap = buildSnapshot(sharedGroup(), false);
    expect(Object.keys(snap).sort()).toEqual(
      ["balances", "currency", "mode", "name", "totals", "transfers", "v"],
    );
    expect(Object.keys(snap.totals).sort()).toEqual(["count", "members", "total"]);
    expect(Object.keys(snap.balances[0]!).sort()).toEqual(["name", "net"]);
  });

  it("has no publishedAt, so the fingerprint cannot drift with time", () => {
    expect("publishedAt" in buildSnapshot(sharedGroup(), false)).toBe(false);
  });

  it("keys balances and transfers by display name", () => {
    const snap = buildSnapshot(sharedGroup(), false);
    // Alex paid 100 split equally -> Sam owes Alex 50.
    expect(snap.transfers).toEqual([{ from: "Sam", to: "Alex", amount: 50 }]);
    expect(snap.balances).toEqual([
      { name: "Alex", net: 50 },
      { name: "Sam", net: -50 },
    ]);
    expect(snap.name).toBe("Goa Trip");
    expect(snap.currency).toBe("₹");
    expect(snap.mode).toBe("direct");
    expect(snap.totals).toEqual({ total: 100, count: 1, members: 2 });
  });

  it("clamps name and currency to the bounds firestore.rules enforces", () => {
    const g = sharedGroup();
    g.name = "x".repeat(300);
    g.currency = "wildlyTooLongCurrency";
    const snap = buildSnapshot(g, false);
    expect(snap.name).toHaveLength(120);
    expect(snap.currency).toHaveLength(8);
  });

  it("records greedy mode and its plan when greedy is on", () => {
    const g = sharedGroup();
    g.members.push({ id: C, name: "Jordan" });
    g.transactions.push(
      tx({ amount: 60, paidBy: B, split: { type: "equal", among: [A, B, C], shares: {} } }),
    );
    expect(buildSnapshot(g, true).mode).toBe("greedy");
    expect(buildSnapshot(g, false).mode).toBe("direct");
    // Greedy minimises payment count; direct keeps each debt traceable.
    expect(buildSnapshot(g, true).transfers.length).toBeLessThanOrEqual(
      buildSnapshot(g, false).transfers.length,
    );
  });

  it("handles a group with no transactions", () => {
    const g = sharedGroup();
    g.transactions = [];
    const snap = buildSnapshot(g, false);
    expect(snap.totals).toEqual({ total: 0, count: 0, members: 2 });
    expect(snap.transfers).toEqual([]);
    expect(snap.balances).toEqual([
      { name: "Alex", net: 0 },
      { name: "Sam", net: 0 },
    ]);
  });

  it("handles a group with no members", () => {
    const g = sharedGroup();
    g.members = [];
    g.transactions = [];
    const snap = buildSnapshot(g, false);
    expect(snap.balances).toEqual([]);
    expect(snap.totals.members).toBe(0);
  });

  it("normalises -0 to 0 so an identical value cannot serialise two ways", () => {
    const g = sharedGroup();
    g.transactions = [];
    expect(Object.is(buildSnapshot(g, false).balances[0]!.net, -0)).toBe(false);
  });
});

describe("displayNames — disambiguation", () => {
  it("suffixes duplicates so a name is a usable key", () => {
    const g = sharedGroup();
    g.members = [
      { id: A, name: "Sam" },
      { id: B, name: "Sam" },
      { id: C, name: "Jordan" },
    ];
    const names = displayNames(g);
    expect(new Set(Object.values(names)).size).toBe(3);
    expect(Object.values(names).sort()).toEqual(["Jordan", "Sam", "Sam (2)"]);
  });

  it("is independent of members[] order (replaceCloudMember reorders the array)", () => {
    const g = sharedGroup();
    g.members = [
      { id: A, name: "Sam" },
      { id: B, name: "Sam" },
    ];
    const forward = displayNames(g);
    const reversed = displayNames({ ...g, members: [...g.members].reverse() });
    expect(reversed).toEqual(forward);
  });

  it("falls back for a blank name", () => {
    const g = sharedGroup();
    g.members = [{ id: A, name: "   " }];
    expect(displayNames(g)[A]).toBe("—");
  });

  it("uses disambiguated names inside transfers", () => {
    const g = sharedGroup();
    g.members = [
      { id: A, name: "Sam" },
      { id: B, name: "Sam" },
    ];
    const snap = buildSnapshot(g, false);
    expect(snap.transfers).toEqual([{ from: "Sam (2)", to: "Sam", amount: 50 }]);
  });
});

describe("fingerprint — staleness detection", () => {
  it("is stable across reordered members and transactions", () => {
    const g = sharedGroup();
    g.members.push({ id: C, name: "Jordan" });
    g.transactions.push(
      tx({ amount: 60, paidBy: B, split: { type: "equal", among: [A, B, C], shares: {} } }),
    );
    const base = fingerprint(buildSnapshot(g, false));

    expect(fingerprint(buildSnapshot({ ...g, members: [...g.members].reverse() }, false))).toBe(base);
    expect(
      fingerprint(buildSnapshot({ ...g, transactions: [...g.transactions].reverse() }, false)),
    ).toBe(base);
  });

  it("is identical for two runs at different wall-clock times", async () => {
    const g = sharedGroup();
    const before = fingerprint(buildSnapshot(g, false));
    await new Promise((r) => setTimeout(r, 5));
    expect(fingerprint(buildSnapshot(g, false))).toBe(before);
  });

  it("changes when an amount is edited", () => {
    const g = sharedGroup();
    const before = fingerprint(buildSnapshot(g, false));
    g.transactions[0]!.amount = 120;
    expect(fingerprint(buildSnapshot(g, false))).not.toBe(before);
  });

  it("changes when a transaction is DELETED — the case a timestamp check misses", () => {
    const g = sharedGroup();
    g.transactions.push(
      tx({ amount: 40, paidBy: B, updatedAt: 999, split: { type: "equal", among: [A, B], shares: {} } }),
    );
    const before = fingerprint(buildSnapshot(g, false));
    g.transactions.pop(); // max(updatedAt) now goes DOWN, so a time comparison sees nothing
    expect(fingerprint(buildSnapshot(g, false))).not.toBe(before);
  });

  it("changes when a member is renamed", () => {
    const g = sharedGroup();
    const before = fingerprint(buildSnapshot(g, false));
    g.members[1]!.name = "Samantha";
    expect(fingerprint(buildSnapshot(g, false))).not.toBe(before);
  });

  it("changes when the group is renamed or the currency changes", () => {
    const g = sharedGroup();
    const before = fingerprint(buildSnapshot(g, false));
    expect(fingerprint(buildSnapshot({ ...g, name: "Goa Trip 2" }, false))).not.toBe(before);
    expect(fingerprint(buildSnapshot({ ...g, currency: "$" }, false))).not.toBe(before);
  });

  it("changes when greedy mode is flipped on a group where the plans differ", () => {
    const g = sharedGroup();
    g.members.push({ id: C, name: "Jordan" });
    g.transactions.push(
      tx({ amount: 90, paidBy: B, split: { type: "equal", among: [A, B, C], shares: {} } }),
    );
    expect(fingerprint(buildSnapshot(g, true))).not.toBe(fingerprint(buildSnapshot(g, false)));
  });

  it("ignores edits the public page does not show (a note or category)", () => {
    const g = sharedGroup();
    const before = fingerprint(buildSnapshot(g, false));
    g.transactions[0]!.note = "changed the note entirely";
    g.transactions[0]!.category = "🍕";
    expect(fingerprint(buildSnapshot(g, false))).toBe(before);
  });

  it("is a stable 16-char hex digest", () => {
    expect(fingerprint(buildSnapshot(sharedGroup(), false))).toMatch(/^[0-9a-f]{16}$/);
  });
});
