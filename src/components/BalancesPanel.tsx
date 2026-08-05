import type { AuthUser, Group } from "../types";
import { computeBalances, myMemberId } from "../lib/finance";
import { colorFor, initials, money } from "../lib/format";

interface Props {
  group: Group;
  user: AuthUser | null;
}

export function BalancesPanel({ group, user }: Props) {
  const bal = computeBalances(group);
  const cur = group.currency;
  const me = myMemberId(group, user?.uid);
  const mine = me ? (bal[me] ?? 0) : 0;
  const settledUp = Math.abs(mine) < 0.005;

  if (group.members.length === 0) {
    return (
      <section className="tab-panel">
        <div className="hint">Add members and transactions to see balances.</div>
      </section>
    );
  }

  // You first — the answer people open this tab for is their own position.
  const members = [...group.members].sort((a, b) => {
    if (me && a.id === me) return -1;
    if (me && b.id === me) return 1;
    return (bal[b.id] ?? 0) - (bal[a.id] ?? 0);
  });

  return (
    <section className="tab-panel">
      {me && (
        <div className="you-summary card">
          <span className="you-summary-label">
            {settledUp ? "You're all square" : mine > 0 ? "You are owed" : "You owe"}
          </span>
          <b className={settledUp ? "zero" : mine > 0 ? "pos" : "neg"}>
            {money(cur, settledUp ? 0 : mine)}
          </b>
        </div>
      )}

      <div className="balance-cards">
        {members.map((m) => {
          const v = bal[m.id] ?? 0;
          const settled = Math.abs(v) < 0.005;
          const cls = settled ? "zero" : v > 0 ? "pos" : "neg";
          const label = settled ? "settled up" : v > 0 ? "gets back" : "owes";
          return (
            <div className={`balance-card${m.id === me ? " is-you" : ""}`} key={m.id}>
              <div className="avatar" style={{ background: colorFor(m.id) }}>
                {initials(m.name)}
              </div>
              <div className="who">
                <b>
                  {m.id === me ? "You" : m.name}
                </b>
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
