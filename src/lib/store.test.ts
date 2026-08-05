import { describe, it, expect, beforeEach } from "vitest";
import type { Group, Transaction } from "../types";
import { computeBalances } from "./finance";
import {
  addMember,
  addTransaction,
  buildPayment,
  dedupeTransactions,
  dueInstances,
  mergeMembers,
  normalizeTx,
  recordPayment,
  clearSharedGroups,
  createGroup,
  exportBackup,
  getActiveGroup,
  getState,
  importBackup,
  mergeSharedGroups,
  removeMember,
  resetAll,
  setActiveGroup,
  setGreedyMode,
} from "./store";

beforeEach(() => resetAll());

const approxEq = (a: number, b: number) => Math.abs(a - b) < 0.005;

describe("store", () => {
  it("creates a group and makes it active", () => {
    const g = createGroup("Trip", "$");
    expect(getState().activeGroupId).toBe(g.id);
    expect(getActiveGroup()?.name).toBe("Trip");
  });

  it("adds members and transactions immutably", () => {
    const g = createGroup("Trip", "$");
    const before = getState();
    addMember(g.id, "Alex");
    expect(getState()).not.toBe(before); // new state reference for React
    const g2 = getActiveGroup()!;
    addMember(g2.id, "Sam");
    const alex = getActiveGroup()!.members[0]!.id;
    const sam = getActiveGroup()!.members[1]!.id;
    addTransaction(g2.id, {
      description: "Dinner", category: "🍔", amount: 20, date: "2026-01-01", note: "",
      paidBy: alex, split: { type: "equal", among: [alex, sam], shares: {} },
    });
    expect(getActiveGroup()!.transactions.length).toBe(1);
  });

  it("blocks removing a member referenced by a transaction", () => {
    const g = createGroup("Trip", "$");
    addMember(g.id, "Alex");
    const alex = getActiveGroup()!.members[0]!.id;
    addTransaction(g.id, {
      description: "x", category: "🧾", amount: 10, date: "2026-01-01", note: "",
      paidBy: alex, split: { type: "equal", among: [alex], shares: {} },
    });
    const res = removeMember(g.id, alex);
    expect(res).toEqual({ ok: false, reason: "in-use" });
    expect(getActiveGroup()!.members.length).toBe(1);
  });

  it("round-trips a JSON backup", () => {
    const g = createGroup("Trip", "$");
    addMember(g.id, "Alex");
    setGreedyMode(true);
    const backup = exportBackup();
    resetAll();
    expect(getState().groups.length).toBe(0);
    importBackup(backup);
    expect(getState().groups.length).toBe(1);
    expect(getState().settings.greedyMode).toBe(true);
    expect(getActiveGroup()!.members[0]!.name).toBe("Alex");
  });

  it("rejects an invalid backup", () => {
    expect(() => importBackup("{}")).toThrow();
    expect(() => importBackup("not json")).toThrow();
  });
});

describe("local vs shared groups", () => {
  const sharedGroup = (id: string, name: string): Group => ({
    id,
    name,
    currency: "₹",
    createdAt: 0,
    members: [{ id: "m1", name: "Alex", uid: "u1" }],
    transactions: [],
    kind: "shared",
    ownerUid: "u1",
    memberUids: ["u1"],
    inviteCode: "ABC123",
  });

  it("defaults new groups to local", () => {
    const g = createGroup("Trip", "₹");
    expect(g.kind).toBe("local");
  });

  it("merges shared groups alongside local ones without disturbing them", () => {
    createGroup("Solo", "₹");
    mergeSharedGroups([sharedGroup("s1", "Goa")]);
    const kinds = getState().groups.map((g) => g.kind);
    expect(kinds).toContain("local");
    expect(kinds).toContain("shared");
    expect(getState().groups.length).toBe(2);
  });

  it("replaces the shared set on each snapshot", () => {
    mergeSharedGroups([sharedGroup("s1", "Goa"), sharedGroup("s2", "Flat")]);
    expect(getState().groups.length).toBe(2);
    mergeSharedGroups([sharedGroup("s1", "Goa")]); // s2 removed remotely
    expect(getState().groups.map((g) => g.id)).toEqual(["s1"]);
  });

  it("drops shared groups on sign-out but keeps local ones", () => {
    const local = createGroup("Solo", "₹");
    mergeSharedGroups([sharedGroup("s1", "Goa")]);
    clearSharedGroups();
    expect(getState().groups.map((g) => g.id)).toEqual([local.id]);
  });

  it("re-points activeGroupId when the active shared group disappears", () => {
    const local = createGroup("Solo", "₹");
    mergeSharedGroups([sharedGroup("s1", "Goa")]);
    setActiveGroup("s1");
    expect(getState().activeGroupId).toBe("s1");
    clearSharedGroups();
    expect(getState().activeGroupId).toBe(local.id);
  });

  it("excludes shared groups from localStorage and from backups", () => {
    createGroup("Solo", "₹");
    mergeSharedGroups([sharedGroup("s1", "Goa")]);

    const persisted = JSON.parse(localStorage.getItem("splitwiser.state.v1")!) as {
      groups: Group[];
    };
    expect(persisted.groups.map((g) => g.name)).toEqual(["Solo"]);

    const backup = JSON.parse(exportBackup()) as { groups: Group[] };
    expect(backup.groups.map((g) => g.name)).toEqual(["Solo"]);
  });

  it("restoring a backup leaves live shared groups intact", () => {
    createGroup("Solo", "₹");
    const backup = exportBackup();
    resetAll();
    mergeSharedGroups([sharedGroup("s1", "Goa")]);
    importBackup(backup);
    const names = getState().groups.map((g) => g.name).sort();
    expect(names).toEqual(["Goa", "Solo"]);
  });

  it("treats legacy groups with no kind as local", () => {
    const legacy = {
      schema: 1,
      activeGroupId: null,
      settings: { greedyMode: false },
      groups: [{ id: "old", name: "Old", currency: "₹", createdAt: 0, members: [], transactions: [] }],
    };
    importBackup(JSON.stringify(legacy));
    expect(getState().groups[0]!.kind).toBe("local");
  });
});

describe("settlement payments in the store", () => {
  /** Two members, returns their ids. */
  function pair(): { g: Group; alex: string; sam: string } {
    const g = createGroup("Trip", "$");
    addMember(g.id, "Alex");
    addMember(g.id, "Sam");
    const [alex, sam] = getActiveGroup()!.members.map((m) => m.id) as [string, string];
    return { g: getActiveGroup()!, alex, sam };
  }

  /**
   * Guards a subtle data-loss bug: cloud.ts deletes transactions with
   * arrayRemove(clean(tx)), which needs an EXACT match against the stored map.
   * If an expense ever gained a `kind` key, locally-held objects would stop
   * matching documents written before the field existed — arrayRemove would
   * no-op and updateCloudTransaction would then add a duplicate.
   */
  it("never writes a `kind` key on an expense", () => {
    const t = normalizeTx({
      description: "Dinner", category: "🍔", amount: 20, date: "2026-01-01", note: "",
      paidBy: "m1", split: { type: "equal", among: ["m1"], shares: {} },
    });
    expect("kind" in t).toBe(false);
    expect(Object.keys(JSON.parse(JSON.stringify(t)))).not.toContain("kind");
  });

  it("builds a payment as an exact split naming only the recipient", () => {
    const t = buildPayment({ from: "a", to: "b", amount: 25, date: "2026-01-02", note: "upi" });
    expect(t.kind).toBe("payment");
    expect(t.paidBy).toBe("a");
    expect(t.split.type).toBe("exact");
    expect(t.split.among).toEqual(["b"]);
    expect(t.split.shares["b"]).toBe(25);
    expect(t.amount).toBe(25);
  });

  it("records a payment onto the group", () => {
    const { g, alex, sam } = pair();
    recordPayment(g.id, { from: sam, to: alex, amount: 12.5, date: "2026-01-02", note: "" });
    const txs = getActiveGroup()!.transactions;
    expect(txs.length).toBe(1);
    expect(txs[0]!.kind).toBe("payment");
    expect(txs[0]!.amount).toBe(12.5);
  });

  it("rounds a payment amount to cents", () => {
    const t = buildPayment({ from: "a", to: "b", amount: 10.005, date: "2026-01-02", note: "" });
    expect(t.amount).toBe(10.01);
  });

  it("returns null for an unknown group", () => {
    expect(
      recordPayment("nope", { from: "a", to: "b", amount: 5, date: "2026-01-02", note: "" }),
    ).toBe(null);
  });
});

/** Minimal transaction for pure-function tests. */
function t(over: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    description: "x", category: "🧾", amount: 30, date: "2026-01-01", note: "",
    paidBy: "a", createdAt: 0, split: { type: "equal", among: ["a", "b"], shares: {} },
    ...over,
  };
}

describe("dedupeTransactions", () => {
  it("keeps the most recently edited copy of a duplicated id", () => {
    const out = dedupeTransactions([
      t({ id: "t1", amount: 10, updatedAt: 100 }),
      t({ id: "t1", amount: 99, updatedAt: 200 }),
      t({ id: "t2", amount: 5 }),
    ]);
    expect(out.length).toBe(2);
    expect(out.find((x) => x.id === "t1")!.amount).toBe(99);
  });

  it("falls back to createdAt when updatedAt is absent", () => {
    const out = dedupeTransactions([
      t({ id: "t1", amount: 10, createdAt: 5 }),
      t({ id: "t1", amount: 20, createdAt: 9 }),
    ]);
    expect(out.length).toBe(1);
    expect(out[0]!.amount).toBe(20);
  });

  it("leaves distinct ids untouched", () => {
    const list = [t({ id: "a" }), t({ id: "b" }), t({ id: "c" })];
    expect(dedupeTransactions(list).length).toBe(3);
  });
});

describe("mergeMembers", () => {
  const base: Group = {
    id: "g", name: "Trip", currency: "₹", kind: "shared", createdAt: 0,
    ownerUid: "u1", memberUids: ["u1", "u2"],
    members: [
      { id: "ghost", name: "Sam" },              // added by name
      { id: "real", name: "Sam", uid: "u2" },    // then joined by code
      { id: "alex", name: "Alex", uid: "u1" },
    ],
    transactions: [
      t({ id: "t1", paidBy: "ghost", amount: 60, split: { type: "equal", among: ["ghost", "alex"], shares: {} } }),
      t({ id: "t2", paidBy: "alex", amount: 40, split: { type: "exact", among: ["ghost", "alex"], shares: { ghost: 25, alex: 15 } } }),
    ],
  };

  it("moves every reference onto the surviving member", () => {
    const g = mergeMembers(base, "ghost", "real");
    expect(g.members.map((m) => m.id).sort()).toEqual(["alex", "real"]);
    expect(g.transactions[0]!.paidBy).toBe("real");
    expect(g.transactions[0]!.split.among).toContain("real");
    expect(g.transactions[0]!.split.among).not.toContain("ghost");
    expect(g.transactions[1]!.split.shares["real"]).toBe(25);
    expect(g.transactions[1]!.split.shares["ghost"]).toBeUndefined();
  });

  it("preserves the total owed — nothing is lost or double counted", () => {
    const before = computeBalances(base);
    const after = computeBalances(mergeMembers(base, "ghost", "real"));
    expect(approxEq((before["ghost"] ?? 0) + (before["real"] ?? 0), after["real"]!)).toBe(true);
    expect(approxEq(before["alex"]!, after["alex"]!)).toBe(true);
  });

  it("ADDS shares when both ids appear in one transaction", () => {
    const both: Group = {
      ...base,
      transactions: [
        t({ id: "t3", paidBy: "alex", amount: 30,
            split: { type: "exact", among: ["ghost", "real"], shares: { ghost: 10, real: 20 } } }),
      ],
    };
    const g = mergeMembers(both, "ghost", "real");
    expect(g.transactions[0]!.split.shares["real"]).toBe(30);
    expect(g.transactions[0]!.split.among).toEqual(["real"]);
  });

  it("folds a payers map and collapses it when one payer remains", () => {
    const multi: Group = {
      ...base,
      transactions: [t({ id: "t4", paidBy: "ghost", amount: 50, payers: { ghost: 20, real: 30 } })],
    };
    const g = mergeMembers(multi, "ghost", "real");
    // Both payers were the same person, so it is no longer a multi-payer expense.
    expect(g.transactions[0]!.payers).toBeUndefined();
    expect(g.transactions[0]!.paidBy).toBe("real");
  });

  it("drops the absorbed member's uid from memberUids", () => {
    const g = mergeMembers(base, "real", "ghost");
    expect(g.memberUids).not.toContain("u2");
  });

  it("is a no-op for unknown or identical ids", () => {
    expect(mergeMembers(base, "ghost", "ghost")).toBe(base);
    expect(mergeMembers(base, "nope", "real")).toBe(base);
  });
});

describe("dueInstances (recurring)", () => {
  const monthly: Group = {
    id: "g", name: "Flat", currency: "₹", kind: "local", createdAt: 0,
    members: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    transactions: [t({ id: "rent", date: "2026-01-01", amount: 1000, recurrence: "monthly" })],
  };

  it("fills in every period that has come due", () => {
    const due = dueInstances(monthly, new Date("2026-04-15T00:00:00"));
    expect(due.map((d) => d.date)).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("gives instances deterministic ids so two devices cannot double-add", () => {
    const a = dueInstances(monthly, new Date("2026-03-02T00:00:00"));
    const b = dueInstances(monthly, new Date("2026-03-02T00:00:00"));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    // The dedupe on ingest is what makes concurrent materialisation safe.
    expect(dedupeTransactions([...a, ...b]).length).toBe(a.length);
  });

  it("does not repeat an instance that already exists", () => {
    const withOne: Group = {
      ...monthly,
      transactions: [
        ...monthly.transactions,
        t({ id: "rent__2026-02-01", date: "2026-02-01", repeatOf: "rent" }),
      ],
    };
    const due = dueInstances(withOne, new Date("2026-02-20T00:00:00"));
    expect(due).toEqual([]);
  });

  it("instances do not themselves recur", () => {
    const due = dueInstances(monthly, new Date("2026-02-05T00:00:00"));
    expect(due[0]!.recurrence).toBeUndefined();
    expect(due[0]!.repeatOf).toBe("rent");
  });

  it("clamps a month-end date instead of skipping a month", () => {
    const endOfMonth: Group = {
      ...monthly,
      transactions: [t({ id: "rent", date: "2026-01-31", recurrence: "monthly" })],
    };
    const due = dueInstances(endOfMonth, new Date("2026-04-05T00:00:00"));
    // Naive month arithmetic turns 31 Jan into 3 Mar and loses February.
    expect(due.map((d) => d.date)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("handles weekly and ignores one-off expenses", () => {
    const weekly: Group = {
      ...monthly,
      transactions: [t({ id: "w", date: "2026-01-01", recurrence: "weekly" }), t({ id: "once", date: "2026-01-01" })],
    };
    const due = dueInstances(weekly, new Date("2026-01-22T00:00:00"));
    expect(due.map((d) => d.date)).toEqual(["2026-01-08", "2026-01-15", "2026-01-22"]);
    expect(due.every((d) => d.repeatOf === "w")).toBe(true);
  });
});
