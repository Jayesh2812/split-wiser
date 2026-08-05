import type { Group } from "../types";
import { memberName, settle } from "../lib/finance";
import { colorFor, initials, money } from "../lib/format";
import { setGreedyMode } from "../lib/store";
import { toast } from "../lib/toast";

interface Props {
  group: Group;
  greedy: boolean;
}

export function SettlePanel({ group, greedy }: Props) {
  const cur = group.currency;
  const plan = settle(group, greedy);

  const hint = greedy
    ? "Greedy: fewest possible payments. Balances are pooled, so who-paid-for-whom is not preserved — just the minimal set of transfers to zero everyone out."
    : "Direct: mirrors actual expenses. Each person repays whoever paid on their behalf (mutual debts netted). More payments, but fully traceable.";

  return (
    <section className="tab-panel">
      <div className="settle-mode card">
        <div className="settle-mode-row">
          <div>
            <strong>Greedy settlement</strong>
            <small>Minimise the number of payments needed to settle up.</small>
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
        <p className="settle-hint">{hint}</p>
      </div>

      {plan.length === 0 ? (
        <div className="hint">Everyone is settled up. 🎉</div>
      ) : (
        <ul className="settle-list">
          {plan.map((s, i) => (
            <li className="settle-item" key={i}>
              <div className="avatar" style={{ background: colorFor(s.from) }}>
                {initials(memberName(group, s.from))}
              </div>
              <div className="flow">
                <span className="chip">{memberName(group, s.from)}</span>
                <span className="arrow">→</span>
                <span className="chip">{memberName(group, s.to)}</span>
              </div>
              <div className="settle-amt">{money(cur, s.amount)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
