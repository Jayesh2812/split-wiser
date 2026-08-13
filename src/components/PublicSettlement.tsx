/**
 * The page a stranger sees at /s/<token>.
 *
 * Renders a frozen settlement summary with no sign-in and no app install. It is
 * mounted directly by main.tsx, NOT from inside <App/>, and must stay that way:
 * it deliberately imports no store, no repo, no auth and no cloud sync, so it can
 * neither rewrite the URL nor write anything to Firestore.
 */
import { useEffect, useState } from "react";
import { fetchPublicSettlement, type PublicFetch } from "../lib/publicSettlement";
import type { PublicSettlementDoc } from "../lib/snapshot";
import { colorFor, initials, money } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  token: string;
}

type View =
  | { s: "loading" }
  | { s: "ready"; doc: PublicSettlementDoc }
  | { s: "missing" }
  | { s: "unavailable" }
  | { s: "error" };

const fromFetch = (r: PublicFetch): View =>
  r.status === "ok" ? { s: "ready", doc: r.doc } : { s: r.status };

/** "7 Aug 2026, 14:32" — the moment the owner froze these numbers. */
function stampOf(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function PublicSettlement({ token }: Props) {
  const [view, setView] = useState<View>({ s: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setView({ s: "loading" });
    void fetchPublicSettlement(token).then((r) => {
      if (!cancelled) setView(fromFetch(r));
    });
    return () => {
      cancelled = true;
    };
  }, [token, nonce]);

  // A shared link is not the app: give it its own title, and keep it out of
  // search results even on a host that cannot set X-Robots-Tag.
  useEffect(() => {
    const name = view.s === "ready" ? view.doc.name : null;
    document.title = name ? `${name} — settlement` : "Settlement — Splitwiser";

    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, [view]);

  if (view.s === "loading") {
    return (
      <Shell>
        <div className="public-state">
          <div className="spinner" />
          <p>Loading settlement…</p>
        </div>
      </Shell>
    );
  }

  if (view.s !== "ready") {
    const copy = {
      missing: {
        title: "This settlement isn’t shared",
        body: "The group owner has stopped sharing this link, or it never existed.",
      },
      unavailable: {
        title: "Not available here",
        body: "This copy of Splitwiser runs without cloud sync, so shared settlement links can’t be opened.",
      },
      error: {
        title: "Couldn’t load this settlement",
        body: "Something went wrong fetching it. Check your connection and try again.",
      },
    }[view.s];

    return (
      <Shell>
        <div className="public-state">
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="public-actions">
            {view.s === "error" && (
              <button className="btn btn-ghost" onClick={() => setNonce((n) => n + 1)}>
                Try again
              </button>
            )}
            <a className="btn btn-ghost" href="/">
              Open Splitwiser
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  const { doc } = view;
  const cur = doc.currency;

  return (
    <Shell>
      <header className="public-head">
        <h1>{doc.name}</h1>
        <p className="public-stamp">Full and final settlement · as of {stampOf(doc.publishedAt)}</p>
      </header>

      <div className="tx-summary">
        <div className="stat">
          <b>{money(cur, doc.totals.total)}</b>
          <span>Total spent</span>
        </div>
        <div className="stat">
          <b>{doc.totals.count}</b>
          <span>{doc.totals.count === 1 ? "Expense" : "Expenses"}</span>
        </div>
        <div className="stat">
          <b>{doc.totals.members}</b>
          <span>{doc.totals.members === 1 ? "Person" : "People"}</span>
        </div>
      </div>

      <h2 className="public-h2">Who pays whom</h2>
      {doc.transfers.length === 0 ? (
        <div className="hint">Everyone is settled up.</div>
      ) : (
        <ul className="public-list">
          {doc.transfers.map((t, i) => (
            <li className="public-row" key={`${t.from}|${t.to}|${i}`}>
              <div className="avatar" style={{ background: colorFor(t.from) }}>
                {initials(t.from)}
              </div>
              <div className="public-who">
                <b>{t.from}</b>
                <small>
                  pays <span className="public-to">{t.to}</span>
                </small>
              </div>
              <div className="public-amt">{money(cur, t.amount)}</div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="public-h2">Where everyone stands</h2>
      {doc.balances.length === 0 ? (
        <div className="hint">No members.</div>
      ) : (
        <ul className="public-list">
          {doc.balances.map((b, i) => {
            const settled = Math.abs(b.net) < 0.005;
            const cls = settled ? "zero" : b.net > 0 ? "pos" : "neg";
            const label = settled ? "settled up" : b.net > 0 ? "is owed" : "owes";
            return (
              <li className="public-row" key={`${b.name}|${i}`}>
                <div className="avatar" style={{ background: colorFor(b.name) }}>
                  {initials(b.name)}
                </div>
                <div className="public-who">
                  <b>{b.name}</b>
                  <small>{label}</small>
                </div>
                <div className={`public-amt ${cls}`}>{money(cur, settled ? 0 : b.net)}</div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="public-note">
        {doc.mode === "greedy"
          ? "Fewest possible payments — some people pay someone they didn’t directly borrow from."
          : "Each person repays whoever actually paid for them, so every payment is traceable."}
      </p>

      <footer className="public-foot">
        <p>
          A frozen snapshot published by the group owner. It won’t change unless they publish
          again.
        </p>
        <div className="public-actions">
          <button className="btn btn-ghost" onClick={() => window.print()}>
            <Icon name="print" /> Save PDF
          </button>
          <a className="btn btn-ghost" href="/">
            Open Splitwiser
          </a>
        </div>
      </footer>
    </Shell>
  );
}

/** Same frame for every state, so no outcome looks like a broken page. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page">
      <div className="public-mark" aria-hidden="true">
        ₹
      </div>
      {children}
    </div>
  );
}
