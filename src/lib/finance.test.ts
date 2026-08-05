import { describe, it, expect } from "vitest";
import type { Group, Transaction } from "../types";
import {
  computeBalances,
  groupTotals,
  settle,
  settleGreedy,
  txShares,
} from "./finance";

const A = "A", B = "B", C = "C";

function tx(partial: Partial<Transaction> & Pick<Transaction, "amount" | "paidBy" | "split">): Transaction {
  return {
    id: partial.id ?? "t_" + Math.round(partial.amount * 100),
    description: partial.description ?? "x",
    category: partial.category ?? "🧾",
    amount: partial.amount,
    date: partial.date ?? "2026-01-01",
    note: partial.note ?? "",
    paidBy: partial.paidBy,
    createdAt: partial.createdAt ?? 0,
    split: partial.split,
  };
}

function makeGroup(): Group {
  return {
    id: "g1",
    name: "Trip",
    currency: "$",
    kind: "local",
    createdAt: 0,
    members: [
      { id: A, name: "Alex" },
      { id: B, name: "Sam" },
      { id: C, name: "Jordan" },
    ],
    transactions: [
      // Alex pays 90 split equally among all 3 -> each owes 30
      tx({ amount: 90, paidBy: A, split: { type: "equal", among: [A, B, C], shares: {} } }),
      // Sam pays 30 for Sam+Jordan exact 15/15
      tx({ amount: 30, paidBy: B, split: { type: "exact", among: [B, C], shares: { [B]: 15, [C]: 15 } } }),
      // Jordan pays 40 by shares 1:1:2 -> 10/10/20
      tx({ amount: 40, paidBy: C, split: { type: "shares", among: [A, B, C], shares: { [A]: 1, [B]: 1, [C]: 2 } } }),
    ],
  };
}

const approx = (a: number, b: number) => Math.abs(a - b) < 0.005;

describe("txShares", () => {
  it("splits equally and sums to total (odd cents)", () => {
    const shares = txShares({ amount: 100, split: { type: "equal", among: [A, B, C], shares: {} } });
    const sum = Object.values(shares).reduce((s, v) => s + v, 0);
    expect(sum).toBe(10000);
    expect(Object.values(shares).sort((a, b) => a - b)).toEqual([3333, 3333, 3334]);
  });

  it("splits by exact amounts", () => {
    const shares = txShares({ amount: 30, split: { type: "exact", among: [B, C], shares: { [B]: 15, [C]: 15 } } });
    expect(shares[B]).toBe(1500);
    expect(shares[C]).toBe(1500);
  });

  it("splits by weighted shares and absorbs rounding drift", () => {
    const shares = txShares({ amount: 40, split: { type: "shares", among: [A, B, C], shares: { [A]: 1, [B]: 1, [C]: 2 } } });
    expect(shares[A]).toBe(1000);
    expect(shares[B]).toBe(1000);
    expect(shares[C]).toBe(2000);
  });
});

describe("computeBalances", () => {
  const g = makeGroup();
  const bal = computeBalances(g);

  it("nets to zero", () => {
    const total = Object.values(bal).reduce((s, v) => s + v, 0);
    expect(approx(total, 0)).toBe(true);
  });

  it("computes expected per-member balances", () => {
    expect(approx(bal[A]!, 50)).toBe(true);
    expect(approx(bal[B]!, -25)).toBe(true);
    expect(approx(bal[C]!, -25)).toBe(true);
  });

  it("reports totals", () => {
    const totals = groupTotals(g);
    expect(totals.count).toBe(3);
    expect(totals.members).toBe(3);
    expect(approx(totals.total, 160)).toBe(true);
  });
});

describe("settlement", () => {
  const g = makeGroup();
  const bal = computeBalances(g);

  it("greedy is minimal (2 transfers) and consistent", () => {
    const plan = settleGreedy(bal);
    expect(plan.length).toBe(2);
    expect(plan.every((t) => t.amount > 0)).toBe(true);
    const inflow: Record<string, number> = {};
    const outflow: Record<string, number> = {};
    plan.forEach((t) => {
      inflow[t.to] = (inflow[t.to] ?? 0) + t.amount;
      outflow[t.from] = (outflow[t.from] ?? 0) + t.amount;
    });
    expect(approx(inflow[A] ?? 0, 50)).toBe(true);
    expect(approx(outflow[B] ?? 0, 25)).toBe(true);
    expect(approx(outflow[C] ?? 0, 25)).toBe(true);
  });

  it("direct settlement also zeroes every balance", () => {
    const plan = settle(g, false);
    const net: Record<string, number> = {};
    plan.forEach((t) => {
      net[t.to] = (net[t.to] ?? 0) + t.amount;
      net[t.from] = (net[t.from] ?? 0) - t.amount;
    });
    for (const id of [A, B, C]) expect(approx(net[id] ?? 0, bal[id]!)).toBe(true);
    expect(plan.every((t) => t.amount > 0)).toBe(true);
    expect(plan.every((t) => t.from !== t.to)).toBe(true);
  });

  it("greedy uses no more transfers than direct", () => {
    expect(settle(g, true).length).toBeLessThanOrEqual(settle(g, false).length);
  });

  it("returns empty plan when everyone is settled", () => {
    const empty: Group = { ...makeGroup(), transactions: [] };
    expect(settle(empty, true)).toEqual([]);
    expect(settle(empty, false)).toEqual([]);
  });
});
