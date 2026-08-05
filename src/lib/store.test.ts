import { describe, it, expect, beforeEach } from "vitest";
import type { Group } from "../types";
import {
  addMember,
  addTransaction,
  buildPayment,
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
