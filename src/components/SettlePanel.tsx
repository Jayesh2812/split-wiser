import { useMemo, useState } from "react";
import type { Group, Transfer } from "../types";
import { memberName, settle } from "../lib/finance";
import { colorFor, initials, money } from "../lib/format";
import { setGreedyMode } from "../lib/store";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

interface Props {
  group: Group;
  greedy: boolean;
  onRecord: (transfer: Transfer) => void;
}

/** Which side of a transfer the selected person is on. */
type Role = "all" | "paying" | "receiving";

const ROLES: { key: Role; label: string }[] = [
  { key: "all", label: "Both" },
  { key: "paying", label: "Paying" },
  { key: "receiving", label: "Receiving" },
];

export function SettlePanel({ group, greedy, onRecord }: Props) {
  const cur = group.currency;
  const plan = settle(group, greedy);

  const [person, setPerson] = useState<string>("all");
  const [role, setRole] = useState<Role>("all");
  const [showInfo, setShowInfo] = useState(false);
  /** Only the person picker collapses — the side segment is one compact row. */
  const [pickerOpen, setPickerOpen] = useState(false);
  // A member removed while the tab was open would otherwise filter to nothing.
  const focused = group.members.some((m) => m.id === person) ? person : "all";

  const { shown, pays, receives, payCount, receiveCount } = useMemo(() => {
    if (focused === "all") {
      return { shown: plan, pays: 0, receives: 0, payCount: 0, receiveCount: 0 };
    }
    const mine = plan.filter((t) => t.from === focused || t.to === focused);
    const out = mine.filter((t) => t.from === focused);
    const inc = mine.filter((t) => t.to === focused);
    return {
      shown: role === "paying" ? out : role === "receiving" ? inc : mine,
      pays: out.reduce((s, t) => s + t.amount, 0),
      receives: inc.reduce((s, t) => s + t.amount, 0),
      payCount: out.length,
      receiveCount: inc.length,
    };
  }, [plan, focused, role]);

  const hint = greedy
    ? "Greedy: fewest possible payments. Balances are pooled, so who-paid-for-whom is not preserved — just the minimal set of transfers to zero everyone out."
    : "Direct: mirrors actual expenses. Each person repays whoever paid on their behalf (mutual debts netted). More payments, but fully traceable.";

  const name = focused === "all" ? "" : memberName(group, focused);

  return (
    <section className="tab-panel">
      <div className="settle-mode card">
        <div className="settle-mode-row">
          <div className="settle-mode-label">
            <strong>Greedy settlement</strong>
            <button
              className="info-btn"
              aria-label="About settlement modes"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((v) => !v)}
            >
              <Icon name="info" size={16} />
            </button>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={greedy}
              onChange={(e) => {
                setGreedyMode(e.target.checked);
                toast(e.target.checked ? "Greedy settlement on" : "Direct settlement on");
              }}
            />
            <span className="slider" />
          </label>
        </div>
        {showInfo && <p className="settle-hint">{hint}</p>}
      </div>

      {plan.length > 0 && group.members.length > 1 && (
        <div className="settle-filter card">
          <div className="filter-row">
            <button
              className="filter-bar"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Icon name="filter" size={15} />
              <span className="filter-current">
                {focused === "all" ? "Everyone" : name}
              </span>
              <Icon name="chevron-down" size={15} className={pickerOpen ? "flip" : ""} />
            </button>
            {focused !== "all" && (
              <button
                className="icon-btn"
                aria-label="Clear filter"
                title="Show everyone"
                onClick={() => {
                  setPerson("all");
                  setRole("all");
                  setPickerOpen(false);
                }}
              >
                <Icon name="close" size={17} />
              </button>
            )}
          </div>

          {pickerOpen && (
            <div className="field filter-field">
              <label htmlFor="settle-person">Show payments for</label>
              <select
                id="settle-person"
                value={focused}
                onChange={(e) => {
                  setPerson(e.target.value);
                  setRole("all");
                  setPickerOpen(false); // chosen — give the space back
                }}
              >
                <option value="all">Everyone</option>
                {group.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {focused !== "all" && (
            <>
              <div className="seg" role="group" aria-label="Filter by side">
                {ROLES.map((r) => (
                  <button
                    key={r.key}
                    className={role === r.key ? "active" : ""}
                    aria-pressed={role === r.key}
                    onClick={() => setRole(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="settle-summary">
                <div className="stat">
                  <b className="neg">{money(cur, pays)}</b>
                  <span>
                    {name} pays {payCount} {payCount === 1 ? "person" : "people"}
                  </span>
                </div>
                <div className="stat">
                  <b className="pos">{money(cur, receives)}</b>
                  <span>
                    receives from {receiveCount} {receiveCount === 1 ? "person" : "people"}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {plan.length === 0 ? (
        <div className="hint">Everyone is settled up.</div>
      ) : shown.length === 0 ? (
        <div className="hint">
          {role === "paying"
            ? `${name} doesn't owe anyone.`
            : role === "receiving"
              ? `Nobody owes ${name}.`
              : `${name} is settled up.`}
        </div>
      ) : (
        <>
          <ul className="settle-list">
            {shown.map((s, i) => (
              <li className="settle-item" key={`${s.from}-${s.to}-${i}`}>
                <div className="avatar" style={{ background: colorFor(s.from) }}>
                  {initials(memberName(group, s.from))}
                </div>
                <div className="flow">
                  <span className="chip">{memberName(group, s.from)}</span>
                  <span className="arrow">
                    <Icon name="arrow-right" size={16} />
                  </span>
                  <span className="chip">{memberName(group, s.to)}</span>
                </div>
                <div className="settle-amt">{money(cur, s.amount)}</div>
                <button
                  className="btn btn-ghost btn-record"
                  onClick={() => onRecord(s)}
                  aria-label={`Record payment from ${memberName(group, s.from)} to ${memberName(group, s.to)}`}
                >
                  Record
                </button>
              </li>
            ))}
          </ul>
          <p className="settle-hint">
            Recording a payment logs it in the group's history and updates these balances. Part
            payments are fine — enter any amount and the remainder stays outstanding.
          </p>
        </>
      )}
    </section>
  );
}
