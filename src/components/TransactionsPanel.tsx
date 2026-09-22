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
import { colorFor, fmtDate, initials, money } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  onAdd: () => void;
  onEdit: (tx: Transaction) => void;
  onNeedMembers: () => void;
}

/** Add or drop `value`, returning a new set so React sees the change. */
function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

export function TransactionsPanel({ group, onAdd, onEdit, onNeedMembers }: Props) {
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  /** Empty means "no restriction", not "nothing" — that is what makes OR-within / AND-across read right. */
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [payers, setPayers] = useState<Set<string>>(new Set());

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

  // Only offer what the group actually contains: an emoji nobody used, or a
  // member who never paid, would only ever filter the list down to nothing.
  // Settlements carry their own 🤝 category, so this picks that up for free.
  const catOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of group.transactions) {
      const c = t.category || "🧾";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [group.transactions]);

  const payerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of group.transactions) for (const id of Object.keys(txPayers(t))) seen.add(id);
    // Group order, so the row reads the same as every other member list.
    return group.members.filter((m) => seen.has(m.id));
  }, [group.members, group.transactions]);

  const activeCount = cats.size + payers.size;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...group.transactions].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt,
    );
    return list.filter((t) => {
      if (cats.size && !cats.has(t.category || "🧾")) return false;
      if (payers.size && !Object.keys(txPayers(t)).some((id) => payers.has(id))) return false;
      if (!q) return true;
      const to = paymentRecipient(t);
      const payerNames = Object.keys(txPayers(t))
        .map((id) => memberName(group, id))
        .join(" ");
      const haystack = `${t.description} ${t.note} ${payerNames}${
        to ? ` ${memberName(group, to)} settlement payment` : ""
      }`;
      return haystack.toLowerCase().includes(q);
    });
  }, [group, query, cats, payers]);

  const clearFilters = () => {
    setCats(new Set());
    setPayers(new Set());
  };

  const addClick = () => {
    if (group.members.length < 1) onNeedMembers();
    else onAdd();
  };

  const emptyMessage =
    query.trim() && activeCount
      ? `No transactions match “${query}” with these filters.`
      : query.trim()
        ? `No transactions match “${query}”.`
        : "No transactions match these filters.";

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
        <button
          className={`filter-btn${activeCount ? " on" : ""}`}
          aria-expanded={filterOpen}
          aria-label={activeCount ? `Filters (${activeCount} active)` : "Filters"}
          title="Filters"
          onClick={() => setFilterOpen((v) => !v)}
        >
          <Icon name="filter" size={18} />
          {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
        </button>
        <button className="btn btn-primary" onClick={addClick}>
          ＋ Add
        </button>
      </div>

      {filterOpen && (
        <div className="tx-filter card">
          {catOptions.length === 0 && payerOptions.length === 0 && (
            <p className="filter-none">Nothing to filter yet — add a transaction first.</p>
          )}

          {catOptions.length > 0 && (
            <div className="filter-group">
              <div className="filter-label">Category</div>
              <div className="chip-row">
                {catOptions.map(([c, n]) => (
                  <button
                    key={c}
                    className={`f-chip${cats.has(c) ? " sel" : ""}`}
                    aria-pressed={cats.has(c)}
                    onClick={() => setCats((s) => toggle(s, c))}
                  >
                    <span className="f-emoji">{c}</span>
                    <span className="f-count">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {payerOptions.length > 0 && (
            <div className="filter-group">
              <div className="filter-label">Paid by</div>
              <div className="chip-row">
                {payerOptions.map((m) => (
                  <button
                    key={m.id}
                    className={`f-chip${payers.has(m.id) ? " sel" : ""}`}
                    aria-pressed={payers.has(m.id)}
                    onClick={() => setPayers((s) => toggle(s, m.id))}
                  >
                    <span className="avatar" style={{ background: colorFor(m.id) }}>
                      {initials(m.name)}
                    </span>
                    <span className="f-name">{m.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(catOptions.length > 0 || payerOptions.length > 0) && (
            <div className="filter-foot">
              <span>
                {shown.length} of {group.transactions.length} shown
              </span>
              <button className="btn btn-ghost" disabled={!activeCount} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

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
        <div className="hint">{emptyMessage}</div>
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
