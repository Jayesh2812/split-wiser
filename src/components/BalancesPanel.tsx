import type { Group } from "../types";
import { computeBalances } from "../lib/finance";
import { colorFor, initials, money } from "../lib/format";

interface Props {
  group: Group;
}

export function BalancesPanel({ group }: Props) {
  const bal = computeBalances(group);
  const cur = group.currency;

  if (group.members.length === 0) {
    return (
      <section className="tab-panel">
        <div className="hint">Add members and transactions to see balances.</div>
      </section>
    );
  }

  const members = [...group.members].sort((a, b) => (bal[b.id] ?? 0) - (bal[a.id] ?? 0));

  return (
    <section className="tab-panel">
      <div className="balance-cards">
        {members.map((m) => {
          const v = bal[m.id] ?? 0;
          const settled = Math.abs(v) < 0.005;
          const cls = settled ? "zero" : v > 0 ? "pos" : "neg";
          const label = settled ? "settled up" : v > 0 ? "gets back" : "owes";
          return (
            <div className="balance-card" key={m.id}>
              <div className="avatar" style={{ background: colorFor(m.id) }}>
                {initials(m.name)}
              </div>
              <div className="who">
                <b>{m.name}</b>
                <small>{label}</small>
              </div>
              <div className={`balance-amt ${cls}`}>{money(cur, settled ? 0 : v)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
