import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import type { AuthUser, Group, Recurrence, SplitType, Transaction, TxDraft } from "../types";
import {
  fromCents,
  nameForUid,
  round2,
  toCents,
  txShares,
  txTotalInGroup,
} from "../lib/finance";
import { addTransaction, deleteTransaction, updateTransaction } from "../lib/repo";
import { CATEGORIES, money, todayStr } from "../lib/format";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  existing: Transaction | null;
  user: AuthUser | null;
  onClose: () => void;
}

const RECURRENCES: { key: Recurrence | null; label: string }[] = [
  { key: null, label: "Never" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

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
  /** Several people chipped in. Opt-in so the single-payer case stays one tap. */
  const [multiPay, setMultiPay] = useState(!!existing?.payers);
  /** Only the people actually paying, in the order they were added. */
  const [payerIds, setPayerIds] = useState<string[]>(() =>
    existing?.payers ? Object.keys(existing.payers) : [],
  );
  const [payerAmt, setPayerAmt] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(existing?.payers ?? {})) out[k] = String(v);
    return out;
  });
  /**
   * Amounts the user typed. Everything else is auto-split, so adding or removing
   * a payer re-divides only the untouched shares and never overwrites a
   * deliberate figure.
   */
  const [manualPayers, setManualPayers] = useState<Set<string>>(
    () => new Set(existing?.payers ? Object.keys(existing.payers) : []),
  );
  const [recurrence, setRecurrence] = useState<Recurrence | null>(existing?.recurrence ?? null);
  const [foreign, setForeign] = useState(!!existing?.currency);
  const [txCur, setTxCur] = useState(existing?.currency ?? "");
  const [rate, setRate] = useState(existing?.rate ? String(existing.rate) : "");
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    if (existing) for (const [k, v] of Object.entries(existing.split.shares)) s[k] = String(v);
    return s;
  });

  const memberNameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "—";
  const amountNum = Number(amount) || 0;
  const amongIds = group.members.filter((m) => among.has(m.id)).map((m) => m.id);
  /** The currency the amount is typed in — the group's unless overridden. */
  const inputCur = foreign && txCur.trim() ? txCur.trim() : cur;
  const rateNum = Number(rate) || 0;
  const payerSum = round2(payerIds.reduce((sum, id) => sum + (Number(payerAmt[id]) || 0), 0));
  const unpaid = group.members.filter((m) => !payerIds.includes(m.id));
  const converted = foreign && rateNum > 0 ? txTotalInGroup({ amount: amountNum, rate: rateNum }) : null;

  // Live per-person preview (in cents), recomputed as inputs change.
  const preview = useMemo(() => {
    const numShares: Record<string, number> = {};
    for (const id of amongIds) numShares[id] = Number(shares[id]) || 0;
    return txShares({ amount: amountNum, split: { type: splitType, among: amongIds, shares: numShares } });
  }, [amountNum, splitType, amongIds, shares]);

  const warning = useMemo(() => {
    if (amongIds.length === 0) return "Select at least one person to split with.";
    if (foreign && !txCur.trim()) return "Enter the currency this was paid in.";
    if (foreign && rateNum <= 0) return `Enter how many ${cur} one ${inputCur} is worth.`;
    if (multiPay && Math.abs(round2(amountNum - payerSum)) >= 0.01) {
      const diff = round2(amountNum - payerSum);
      return `Contributions add up to ${money(inputCur, payerSum)} of ${money(inputCur, amountNum)} (${
        diff > 0 ? `short by ${money(inputCur, diff)}` : `over by ${money(inputCur, -diff)}`
      }).`;
    }
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
  }, [amongIds, splitType, shares, amountNum, cur, foreign, txCur, rateNum, inputCur, multiPay, payerSum]);

  /**
   * Divide what is not manually set equally across the remaining payers. Cents
   * left over go to the earliest auto rows so the parts always sum to the total.
   */
  const splitEqually = (
    ids: string[],
    amounts: Record<string, string>,
    manual: Set<string>,
    total: number,
  ): Record<string, string> => {
    const auto = ids.filter((id) => !manual.has(id));
    if (!auto.length) return amounts;
    const fixed = ids
      .filter((id) => manual.has(id))
      .reduce((sum, id) => sum + toCents(Number(amounts[id]) || 0), 0);
    const left = Math.max(0, toCents(total) - fixed);
    const base = Math.floor(left / auto.length);
    const rem = left - base * auto.length;
    const next = { ...amounts };
    auto.forEach((id, i) => {
      next[id] = fromCents(base + (i < rem ? 1 : 0)).toFixed(2);
    });
    return next;
  };

  // Re-divide whenever the payer set or the total changes.
  useEffect(() => {
    if (!multiPay || !payerIds.length) return;
    setPayerAmt((prev) => {
      const next = splitEqually(payerIds, prev, manualPayers, amountNum);
      const changed = payerIds.some((id) => next[id] !== prev[id]);
      return changed ? next : prev;
    });
    // splitEqually is pure over its arguments; manualPayers is read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiPay, payerIds.join(","), amountNum]);

  const addPayer = (id: string) => {
    if (!id || payerIds.includes(id)) return;
    setPayerIds((ids) => [...ids, id]);
  };

  const removePayer = (id: string) => {
    setPayerIds((ids) => ids.filter((x) => x !== id));
    setManualPayers((m) => {
      const next = new Set(m);
      next.delete(id);
      return next;
    });
    setPayerAmt((a) => {
      const next = { ...a };
      delete next[id];
      return next;
    });
  };

  const editPayer = (id: string, value: string) => {
    setManualPayers((m) => new Set(m).add(id));
    setPayerAmt((a) => ({ ...a, [id]: value }));
  };

  /** Turning multi-pay on starts from whoever was already selected. */
  const toggleMultiPay = () => {
    setMultiPay((on) => {
      if (!on && payerIds.length === 0 && paidBy) {
        setPayerIds([paidBy]);
        setManualPayers(new Set());
      }
      return !on;
    });
  };

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

    if (foreign && (!txCur.trim() || rateNum <= 0)) {
      return toast("Enter the currency and its rate.");
    }

    let contributors: Record<string, number> | undefined;
    let payer = paidBy;
    if (multiPay) {
      const entries = payerIds
        .map((id) => [id, round2(Number(payerAmt[id]) || 0)] as const)
        .filter(([, v]) => v > 0);
      if (entries.length === 0) return toast("Enter what each person paid.");
      if (Math.abs(round2(amountNum - entries.reduce((s2, [, v]) => s2 + v, 0))) >= 0.01) {
        return toast(`Contributions must add up to ${money(inputCur, amountNum)}.`);
      }
      if (entries.length > 1) contributors = Object.fromEntries(entries);
      // paidBy stays meaningful for older clients: the biggest contributor.
      payer = [...entries].sort((a, b) => b[1] - a[1])[0]![0];
    }

    const numShares: Record<string, number> = {};
    for (const id of amongIds) numShares[id] = Number(shares[id]) || 0;

    const draft: TxDraft = {
      description: description.trim() || "Expense",
      category,
      amount: amountNum,
      date: date || todayStr(),
      note: note.trim(),
      paidBy: payer,
      split: { type: splitType, among: amongIds, shares: numShares },
      ...(contributors ? { payers: contributors } : {}),
      ...(foreign && txCur.trim() ? { currency: txCur.trim(), rate: rateNum } : {}),
      ...(recurrence ? { recurrence } : {}),
    };

    try {
      setBusy(true);
      if (editing && existing) {
        await updateTransaction(group, existing.id, draft, user);
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
    <Modal
      title={editing ? "Edit transaction" : "Add transaction"}
      onClose={onClose}
      headerAction={
        <button
          className="icon-btn header-save"
          aria-label={editing ? "Save transaction" : "Add transaction"}
          title={editing ? "Save" : "Add"}
          onClick={save}
          disabled={busy}
        >
          <Icon name="check" size={20} />
        </button>
      }
    >
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
        <div className="label-row">
          <label>Paid by</label>
          <button type="button" className="link-btn" onClick={toggleMultiPay}>
            {multiPay ? "One person paid" : "Several people paid"}
          </button>
        </div>
        {multiPay ? (
          <div className="payer-list">
            {payerIds.map((id) => (
              <div className="split-row" key={id}>
                <label>{memberNameOf(id)}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={payerAmt[id] ?? ""}
                  onChange={(e) => editPayer(id, e.target.value)}
                />
                <button
                  type="button"
                  className="chip-cancel"
                  aria-label={`Remove ${memberNameOf(id)} as a payer`}
                  onClick={() => removePayer(id)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ))}

            {payerIds.length === 0 && (
              <small style={{ color: "var(--text-faint)" }}>
                Add everyone who chipped in — the amount splits equally between them.
              </small>
            )}

            {unpaid.length > 0 && (
              <select
                aria-label="Add a payer"
                value=""
                onChange={(e) => addPayer(e.target.value)}
              >
                <option value="">
                  {payerIds.length ? "＋ Add another payer…" : "＋ Add a payer…"}
                </option>
                {unpaid.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}

            {payerIds.length > 0 && (
              <small style={{ color: "var(--text-faint)" }}>
                {money(inputCur, payerSum)} of {money(inputCur, amountNum)} accounted for
                {manualPayers.size === 0 ? " · split equally" : ""}.
              </small>
            )}
          </div>
        ) : (
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {group.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="field">
        <div className="label-row">
          <label>Currency</label>
          <button type="button" className="link-btn" onClick={() => setForeign((v) => !v)}>
            {foreign ? `Paid in ${cur}` : "Paid in another currency"}
          </button>
        </div>
        {foreign ? (
          <>
            <div className="row">
              <input
                type="text"
                maxLength={4}
                placeholder="EUR"
                value={txCur}
                onChange={(e) => setTxCur(e.target.value)}
              />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                placeholder={`1 ${txCur.trim() || "EUR"} = ? ${cur}`}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <small style={{ color: "var(--text-faint)" }}>
              {converted != null
                ? `${money(inputCur, amountNum)} ≈ ${money(cur, converted)} — balances use the ${cur} value.`
                : `Rate: how many ${cur} one ${txCur.trim() || "unit"} is worth.`}
            </small>
          </>
        ) : (
          <small style={{ color: "var(--text-faint)" }}>
            Amounts are in {cur}, the group's currency.
          </small>
        )}
      </div>

      <div className="field">
        <div className="label-row">
          <label>Repeats</label>
        </div>
        <div className="seg">
          {RECURRENCES.map((r) => (
            <button
              key={r.label}
              type="button"
              className={recurrence === r.key ? "active" : ""}
              onClick={() => setRecurrence(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {recurrence && (
          <small style={{ color: "var(--text-faint)" }}>
            A copy is added automatically each {recurrence === "weekly" ? "week" : "month"} when
            you open the app.
          </small>
        )}
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

      {group.kind === "shared" && existing && (
        <p className="attribution">
          Added by {nameForUid(group, existing.addedByUid) ?? "someone no longer in the group"}
          {existing.updatedByUid && existing.updatedByUid !== existing.addedByUid
            ? ` · last edited by ${nameForUid(group, existing.updatedByUid) ?? "a former member"}`
            : ""}
          .
        </p>
      )}
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
