import { useMemo, useState } from "react";
import type { Group, Transaction } from "../types";
import {
  groupTotals,
  isForeign,
  isPayment,
  memberName,
  paymentRecipient,
  txPayers,
  txTotalInGroup,
} from "../lib/finance";
import { fmtDate, money } from "../lib/format";

interface Props {
  group: Group;
  onAdd: () => void;
  onEdit: (tx: Transaction) => void;
  onNeedMembers: () => void;
}

export function TransactionsPanel({ group, onAdd, onEdit, onNeedMembers }: Props) {
  const [query, setQuery] = useState("");

  /** "Alex paid", "Alex & Sam paid", "Alex +2 others paid". */
  const paidByLabel = (t: Transaction): string => {
    const ids = Object.keys(txPayers(t));
    const names = ids.map((id) => memberName(group, id));
    if (names.length === 1) return `${names[0]} paid`;
    if (names.length === 2) return `${names[0]} & ${names[1]} paid`;
    return `${names[0]} +${names.length - 1} others paid`;
  };
  const totals = groupTotals(group);
  const cur = group.currency;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...group.transactions].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt,
    );
    if (!q) return list;
    return list.filter((t) => {
      const to = paymentRecipient(t);
      const payerNames = Object.keys(txPayers(t))
        .map((id) => memberName(group, id))
        .join(" ");
      const haystack = `${t.description} ${t.note} ${payerNames}${
        to ? ` ${memberName(group, to)} settlement payment` : ""
      }`;
      return haystack.toLowerCase().includes(q);
    });
  }, [group, query]);

  const addClick = () => {
    if (group.members.length < 1) onNeedMembers();
    else onAdd();
  };

  return (
    <section className="tab-panel">
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search transactions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary" onClick={addClick}>
          ＋ Add
        </button>
      </div>

      <div className="tx-summary">
        <div className="stat">
          <b>{money(cur, totals.total)}</b>
          <span>Total spent</span>
        </div>
        <div className="stat">
          <b>{totals.count}</b>
          <span>{totals.payments ? `Expenses · ${totals.payments} settled` : "Expenses"}</span>
        </div>
        <div className="stat">
          <b>{money(cur, totals.members ? totals.total / totals.members : 0)}</b>
          <span>Avg / member</span>
        </div>
      </div>

      {group.transactions.length === 0 && (
        <div className="hint">
          No transactions yet. Tap <b>＋ Add</b> to log the first contribution.
        </div>
      )}

      {group.transactions.length > 0 && shown.length === 0 && (
        <div className="hint">No transactions match “{query}”.</div>
      )}

      <ul className="tx-list">
        {shown.map((t) => {
          const to = paymentRecipient(t);
          const payment = isPayment(t);
          return (
            <li
              key={t.id}
              className={`tx-item${payment ? " tx-payment" : ""}`}
              onClick={() => onEdit(t)}
            >
              <div className="tx-emoji">{t.category}</div>
              <div className="tx-main">
                <div className="tx-desc">{t.description}</div>
                <div className="tx-sub">
                  {payment && to
                    ? `${memberName(group, t.paidBy)} paid ${memberName(group, to)} · ${fmtDate(t.date)}`
                    : `${paidByLabel(t)} · ${fmtDate(t.date)} · split ${t.split.among.length}`}
                  {t.recurrence ? ` · repeats ${t.recurrence}` : ""}
                </div>
              </div>
              {/* The group-currency value leads, so the column stays comparable and
                  matches the balances; what was actually paid sits underneath. */}
              <div className="tx-amt">
                {money(cur, txTotalInGroup(t))}
                {isForeign(t, cur) && <small>{money(t.currency!, t.amount)}</small>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
