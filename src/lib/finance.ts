import type { Group, Transaction, Transfer } from "../types";

/* Work in integer cents to avoid floating-point drift, format back at the edges. */
export const toCents = (x: number): number => Math.round((Number(x) || 0) * 100);
export const fromCents = (c: number): number => c / 100;
export const round2 = (x: number): number => Math.round((Number(x) || 0) * 100) / 100;

let _seq = 0;
export function uid(prefix = "id"): string {
  _seq = (_seq + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

export function memberName(g: Group, id: string): string {
  return g.members.find((m) => m.id === id)?.name ?? "—";
}

/**
 * A settlement rather than an expense. Anything without the marker is an
 * expense — see the note on Transaction.kind for why expenses carry no field.
 */
export const isPayment = (t: Pick<Transaction, "kind">): boolean => t.kind === "payment";

/** The member a settlement was paid to (payments have exactly one participant). */
export function paymentRecipient(t: Transaction): string | null {
  return isPayment(t) ? (t.split.among[0] ?? null) : null;
}

/**
 * How much each participant owes for a single transaction, in cents.
 * The returned values always sum to the transaction total (payer's share included).
 */
export function txShares(tx: Pick<Transaction, "amount" | "split">): Record<string, number> {
  const total = toCents(tx.amount);
  const among = tx.split.among.length ? tx.split.among : [];
  const out: Record<string, number> = {};
  if (among.length === 0) return out;

  if (tx.split.type === "equal") {
    const base = Math.floor(total / among.length);
    const rem = total - base * among.length; // spread leftover cents deterministically
    among.forEach((id, i) => {
      out[id] = base + (i < rem ? 1 : 0);
    });
  } else if (tx.split.type === "exact") {
    among.forEach((id) => {
      out[id] = toCents(tx.split.shares[id] ?? 0);
    });
  } else {
    // shares (weights)
    const weights = among.map((id) => Number(tx.split.shares[id]) || 0);
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    let allocated = 0;
    among.forEach((id, i) => {
      const c = Math.round((total * weights[i]!) / wsum);
      out[id] = c;
      allocated += c;
    });
    const last = among[among.length - 1]!;
    out[last] = (out[last] ?? 0) + (total - allocated); // absorb rounding drift
  }
  return out;
}

/**
 * Net balance per member across the whole group (currency units).
 * Positive => the group owes them (creditor). Negative => they owe (debtor).
 */
export function computeBalances(g: Group): Record<string, number> {
  const net: Record<string, number> = {};
  for (const m of g.members) net[m.id] = 0;

  for (const t of g.transactions) {
    net[t.paidBy] = (net[t.paidBy] ?? 0) + toCents(t.amount);
    const shares = txShares(t);
    for (const id of Object.keys(shares)) {
      net[id] = (net[id] ?? 0) - shares[id]!;
    }
  }

  const out: Record<string, number> = {};
  for (const id of Object.keys(net)) out[id] = fromCents(net[id]!);
  return out;
}

export interface GroupTotals {
  /** Money spent. Settlements move money between members without spending any. */
  total: number;
  /** Expense count, excluding settlements. */
  count: number;
  /** Settlements recorded. */
  payments: number;
  members: number;
}

export function groupTotals(g: Group): GroupTotals {
  let total = 0;
  let count = 0;
  let payments = 0;
  for (const t of g.transactions) {
    if (isPayment(t)) {
      payments++;
      continue;
    }
    total += toCents(t.amount);
    count++;
  }
  return { total: fromCents(total), count, payments, members: g.members.length };
}

/**
 * GREEDY (opt-in): minimise the number of payments.
 * Repeatedly match the biggest debtor against the biggest creditor.
 */
export function settleGreedy(balances: Record<string, number>): Transfer[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];
  for (const id of Object.keys(balances)) {
    const c = toCents(balances[id]!);
    if (c > 0) creditors.push({ id, amt: c });
    else if (c < 0) debtors.push({ id, amt: -c });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const pay = Math.min(d.amt, c.amt);
    if (pay > 0) out.push({ from: d.id, to: c.id, amount: fromCents(pay) });
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt === 0) i++;
    if (c.amt === 0) j++;
  }
  return out;
}

/**
 * DIRECT (default): traceable per-transaction debts aggregated by pair.
 * Each participant repays whoever paid on their behalf; mutual debts are netted.
 */
export function settleDirect(g: Group): Transfer[] {
  const pair: Record<string, number> = {}; // "debtor|creditor" -> cents
  const bump = (d: string, c: string, amt: number) => {
    if (d === c || amt <= 0) return;
    const k = `${d}|${c}`;
    pair[k] = (pair[k] ?? 0) + amt;
  };

  for (const t of g.transactions) {
    const shares = txShares(t);
    for (const id of Object.keys(shares)) {
      if (id !== t.paidBy) bump(id, t.paidBy, shares[id]!);
    }
  }

  const seen = new Set<string>();
  const out: Transfer[] = [];
  for (const k of Object.keys(pair)) {
    if (seen.has(k)) continue;
    const [d, c] = k.split("|") as [string, string];
    const rk = `${c}|${d}`;
    const net = pair[k]! - (pair[rk] ?? 0);
    seen.add(k);
    seen.add(rk);
    if (net > 0) out.push({ from: d, to: c, amount: fromCents(net) });
    else if (net < 0) out.push({ from: c, to: d, amount: fromCents(-net) });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}

export function settle(g: Group, greedy: boolean): Transfer[] {
  return greedy ? settleGreedy(computeBalances(g)) : settleDirect(g);
}
