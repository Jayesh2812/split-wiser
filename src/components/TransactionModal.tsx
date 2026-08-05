import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import type { AuthUser, Group, SplitType, Transaction, TxDraft } from "../types";
import { round2, txShares } from "../lib/finance";
import { addTransaction, deleteTransaction, updateTransaction } from "../lib/repo";
import { CATEGORIES, money, todayStr } from "../lib/format";
import { toast } from "../lib/toast";

interface Props {
  group: Group;
  existing: Transaction | null;
  user: AuthUser | null;
  onClose: () => void;
}

const SPLIT_TABS: { key: SplitType; label: string }[] = [
  { key: "equal", label: "Equally" },
  { key: "shares", label: "By shares" },
  { key: "exact", label: "Exact amounts" },
];

export function TransactionModal({ group, existing, user, onClose }: Props) {
  const editing = !!existing;
  const cur = group.currency;
  const allIds = group.members.map((m) => m.id);

  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState(existing?.category ?? "🧾");
  const [amount, setAmount] = useState<string>(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date ?? todayStr());
  const [note, setNote] = useState(existing?.note ?? "");
  const [paidBy, setPaidBy] = useState(existing?.paidBy ?? group.members[0]?.id ?? "");
  const [splitType, setSplitType] = useState<SplitType>(existing?.split.type ?? "equal");
  const [among, setAmong] = useState<Set<string>>(
    new Set(existing?.split.among.length ? existing.split.among : allIds),
  );
  const [busy, setBusy] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    if (existing) for (const [k, v] of Object.entries(existing.split.shares)) s[k] = String(v);
    return s;
  });

  const amountNum = Number(amount) || 0;
  const amongIds = group.members.filter((m) => among.has(m.id)).map((m) => m.id);

  // Live per-person preview (in cents), recomputed as inputs change.
  const preview = useMemo(() => {
    const numShares: Record<string, number> = {};
    for (const id of amongIds) numShares[id] = Number(shares[id]) || 0;
    return txShares({ amount: amountNum, split: { type: splitType, among: amongIds, shares: numShares } });
  }, [amountNum, splitType, amongIds, shares]);

  const warning = useMemo(() => {
    if (amongIds.length === 0) return "Select at least one person to split with.";
    if (splitType === "exact") {
      const sum = amongIds.reduce((s, id) => s + (Number(shares[id]) || 0), 0);
      const diff = round2(amountNum - sum);
      if (Math.abs(diff) >= 0.01) {
        return `Exact amounts sum to ${money(cur, sum)} of ${money(cur, amountNum)} (${
          diff > 0 ? `short by ${money(cur, diff)}` : `over by ${money(cur, -diff)}`
        }).`;
      }
    }
    if (splitType === "shares") {
      const any = amongIds.some((id) => (Number(shares[id]) || 0) > 0);
      if (!any) return "Enter share weights for at least one person.";
    }
    return "";
  }, [amongIds, splitType, shares, amountNum, cur]);

  const toggleAmong = (id: string) => {
    setAmong((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (amountNum <= 0) return toast("Enter an amount greater than 0.");
    if (amongIds.length === 0) return toast("Select at least one person to split with.");
    if (splitType === "exact") {
      const sum = amongIds.reduce((s, id) => s + (Number(shares[id]) || 0), 0);
      if (Math.abs(round2(amountNum - sum)) >= 0.01) return toast(`Exact amounts must add up to ${money(cur, amountNum)}.`);
    }
    if (splitType === "shares" && !amongIds.some((id) => (Number(shares[id]) || 0) > 0)) {
      return toast("Enter share weights.");
    }

    const numShares: Record<string, number> = {};
    for (const id of amongIds) numShares[id] = Number(shares[id]) || 0;

    const draft: TxDraft = {
      description: description.trim() || "Expense",
      category,
      amount: amountNum,
      date: date || todayStr(),
      note: note.trim(),
      paidBy,
      split: { type: splitType, among: amongIds, shares: numShares },
    };

    try {
      setBusy(true);
      if (editing && existing) {
        await updateTransaction(group, existing.id, draft);
        toast("Transaction updated");
      } else {
        await addTransaction(group, draft, user);
        toast("Transaction added");
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast("Could not save the transaction.");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!existing) return;
    try {
      setBusy(true);
      await deleteTransaction(group, existing.id);
      toast("Transaction deleted");
      onClose();
    } catch (e) {
      console.error(e);
      toast("Could not delete the transaction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? "Edit transaction" : "Add transaction"} onClose={onClose}>
      <div className="field">
        <label>What was it for?</label>
        <input
          type="text"
          placeholder="e.g. Dinner, Cab, Groceries"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Category</label>
        <div className="emoji-row">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`emoji-pick${c === category ? " sel" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="row">
          <div>
            <label>Amount</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="field">
        <label>Paid by</label>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {group.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Split method</label>
        <div className="seg">
          {SPLIT_TABS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={splitType === s.key ? "active" : ""}
              onClick={() => setSplitType(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Split among</label>
        <div className="split-list">
          {group.members.map((m) => {
            const on = among.has(m.id);
            return (
              <div className="split-row" key={m.id}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => toggleAmong(m.id)} />
                  {m.name}
                </label>
                {splitType === "equal" ? (
                  <span className="owe">{on ? money(cur, (preview[m.id] ?? 0) / 100) : "—"}</span>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step={splitType === "shares" ? "1" : "0.01"}
                    placeholder={splitType === "shares" ? "shares" : "amount"}
                    value={shares[m.id] ?? ""}
                    disabled={!on}
                    onChange={(e) => setShares((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
        </div>
        {warning && <div className="warn-text">{warning}</div>}
      </div>

      <div className="field">
        <label>Note (optional)</label>
        <textarea placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="modal-actions">
        {editing && (
          <button className="btn btn-danger" onClick={del} disabled={busy}>
            Delete
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : editing ? "Save" : "Add"}
        </button>
      </div>
    </Modal>
  );
}
