import { describe, it, expect } from "vitest";
import type { Group, Transaction } from "../types";
import {
  computeBalances,
  groupTotals,
  isPayment,
  paymentRecipient,
  settle,
  settleDirect,
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
    // Mirrors normalizeTx: the key is absent unless this is a payment.
    ...(partial.kind === "payment" ? { kind: "payment" as const } : {}),
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

/** A settlement, shaped exactly as store.buildPayment builds it. */
function pay(from: string, to: string, amount: number): Transaction {
  return tx({
    kind: "payment",
    description: "Settlement",
    category: "🤝",
    amount,
    paidBy: from,
    split: { type: "exact", among: [to], shares: { [to]: amount } },
  });
}

function withTx(g: Group, ...extra: Transaction[]): Group {
  return { ...g, transactions: [...g.transactions, ...extra] };
}

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

describe("settlement payments", () => {
  // Baseline from makeGroup(): Alex +50, Sam -25, Jordan -25.

  it("a full payment zeroes both parties", () => {
    const g = withTx(makeGroup(), pay(B, A, 25));
    const bal = computeBalances(g);
    expect(approx(bal[B]!, 0)).toBe(true);
    expect(approx(bal[A]!, 25)).toBe(true); // Alex still owed 25 by Jordan
    expect(approx(bal[C]!, -25)).toBe(true);
  });

  it("a PARTIAL payment leaves exactly the remainder owing", () => {
    const g = withTx(makeGroup(), pay(B, A, 10));
    const bal = computeBalances(g);
    expect(approx(bal[B]!, -15)).toBe(true); // 25 owed, 10 paid
    expect(approx(bal[A]!, 40)).toBe(true);
  });

  it("a partial payment shrinks the plan rather than removing the transfer", () => {
    const g = withTx(makeGroup(), pay(B, A, 10));
    const owed = settle(g, true).filter((t) => t.from === B);
    expect(owed.length).toBe(1);
    expect(approx(owed[0]!.amount, 15)).toBe(true);
  });

  it("settleDirect stays correct after a payment (30 owed, 25 paid, 5 left)", () => {
    // Alex paid 90 for all three, so Sam owes Alex 30 directly.
    const g: Group = {
      ...makeGroup(),
      transactions: [
        tx({ amount: 90, paidBy: A, split: { type: "equal", among: [A, B, C], shares: {} } }),
        pay(B, A, 25),
      ],
    };
    const plan = settleDirect(g);
    const samToAlex = plan.find((t) => t.from === B && t.to === A);
    expect(samToAlex).toBeTruthy();
    expect(approx(samToAlex!.amount, 5)).toBe(true);
  });

  it("recording every suggested transfer empties the plan", () => {
    const g0 = makeGroup();
    const payments = settle(g0, true).map((t) => pay(t.from, t.to, t.amount));
    const g = withTx(g0, ...payments);
    expect(settle(g, true)).toEqual([]);
    for (const id of [A, B, C]) expect(approx(computeBalances(g)[id]!, 0)).toBe(true);
  });

  it("overpaying flips the balance instead of clamping at zero", () => {
    const g = withTx(makeGroup(), pay(B, A, 40)); // Sam owed only 25
    const bal = computeBalances(g);
    expect(approx(bal[B]!, 15)).toBe(true); // Sam is now owed 15
    expect(approx(bal[A]!, 10)).toBe(true);
  });

  it("excludes payments from spending totals but not from balances", () => {
    const g = withTx(makeGroup(), pay(B, A, 25));
    const totals = groupTotals(g);
    expect(approx(totals.total, 160)).toBe(true); // unchanged: no new money spent
    expect(totals.count).toBe(3); // expenses only
    expect(totals.payments).toBe(1);
    // ...while the payment still moved the balances.
    expect(approx(computeBalances(g)[B]!, 0)).toBe(true);
  });

  it("identifies payments and their recipient", () => {
    const p = pay(B, A, 25);
    expect(isPayment(p)).toBe(true);
    expect(paymentRecipient(p)).toBe(A);
    const expense = makeGroup().transactions[0]!;
    expect(isPayment(expense)).toBe(false);
    expect(paymentRecipient(expense)).toBe(null);
  });

  it("a payment between two people who owe nothing creates a debt the other way", () => {
    const g: Group = { ...makeGroup(), transactions: [pay(A, C, 20)] };
    const bal = computeBalances(g);
    expect(approx(bal[A]!, 20)).toBe(true);
    expect(approx(bal[C]!, -20)).toBe(true);
  });
});
