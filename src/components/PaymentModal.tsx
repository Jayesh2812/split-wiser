import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import type { AuthUser, Group, Transaction } from "../types";
import { memberName, paymentRecipient, round2 } from "../lib/finance";
import { deleteTransaction, recordPayment } from "../lib/repo";
import { money, todayStr } from "../lib/format";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  /** Payer and payee are fixed once the sheet opens — a payment is between two people. */
  from: string;
  to: string;
  /** The plan's suggested figure, used to prefill and to flag over/under payment. */
  suggested?: number;
  /** Set when reopening a payment already recorded, which makes this a view/delete sheet. */
  existing?: Transaction | null;
  user: AuthUser | null;
  onClose: () => void;
}

export function PaymentModal({
  group,
  from,
  to,
  suggested,
  existing,
  user,
  onClose,
}: Props) {
  const cur = group.currency;
  const [amount, setAmount] = useState<string>(
    existing ? String(existing.amount) : suggested != null ? String(round2(suggested)) : "",
  );
  const [date, setDate] = useState(existing?.date ?? todayStr());
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount) || 0;
  const payer = memberName(group, from);
  const payee = memberName(group, to);

  const warning = useMemo(() => {
    if (amountNum <= 0) return "Enter an amount greater than zero.";
    if (suggested != null && amountNum > suggested + 0.004) {
      // Deliberately allowed: overpaying is a real thing, it just reverses who owes.
      return `That's ${money(cur, amountNum - suggested)} more than owed — ${payee} will end up owing ${payer}.`;
    }
    return "";
  }, [amountNum, suggested, cur, payer, payee]);

  const blocked = amountNum <= 0;
  const partial = suggested != null && amountNum > 0 && amountNum < suggested - 0.004;

  const submit = async () => {
    if (blocked) return;
    try {
      setBusy(true);
      await recordPayment(group, { from, to, amount: round2(amountNum), date, note }, user);
      toast(partial ? `Part payment of ${money(cur, amountNum)} recorded` : "Payment recorded");
      onClose();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm("Delete this payment? The balance it settled will come back.")) return;
    try {
      setBusy(true);
      await deleteTransaction(group, existing.id);
      toast("Payment deleted");
      onClose();
    } catch (e) {
      console.error(e);
      toast("Could not delete the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={existing ? "Settlement" : "Record a payment"} onClose={onClose}>
      <div className="pay-flow">
        <span className="pay-who">{payer}</span>
        <Icon name="arrow-right" size={18} />
        <span className="pay-who">{payee}</span>
      </div>

      {existing ? (
        <>
          <div className="pay-amount-static">{money(cur, existing.amount)}</div>
          <p className="settle-hint">
            Recorded on {existing.date}
            {existing.note ? ` · ${existing.note}` : ""}. Deleting it restores the balance it
            settled.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>
              Delete payment
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {suggested != null && (
              <small style={{ color: "var(--text-faint)" }}>
                {money(cur, suggested)} owed
                {partial ? ` · part payment, ${money(cur, suggested - amountNum)} will remain` : ""}
              </small>
            )}
          </div>

          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="field">
            <label>Note</label>
            <input
              type="text"
              placeholder="e.g. UPI, cash"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {warning && <div className="warn-text">{warning}</div>}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={busy || blocked}>
              {busy ? "Recording…" : "Record payment"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Reopen an already-recorded settlement. Payments must never open in the expense form. */
export function paymentParties(tx: Transaction): { from: string; to: string } | null {
  const to = paymentRecipient(tx);
  if (!to) return null;
  return { from: tx.paidBy, to };
}
