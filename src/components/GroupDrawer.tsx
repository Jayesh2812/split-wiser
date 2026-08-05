import { useEffect } from "react";
import type { AppState, AuthUser } from "../types";
import { groupTotals } from "../lib/finance";
import { isCloudConfigured } from "../lib/firebase";
import { Icon } from "./Icon";

interface Props {
  state: AppState;
  user: AuthUser | null;
  onClose: () => void;
  onNewGroup: () => void;
  onJoinGroup: () => void;
  onAccount: () => void;
  onPick: (id: string) => void;
}

export function GroupDrawer({
  state,
  user,
  onClose,
  onNewGroup,
  onJoinGroup,
  onAccount,
  onPick,
}: Props) {
  const cloudOn = isCloudConfigured();
  // Match the modals: Escape closes the drawer too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer" role="dialog" aria-label="Groups">
      <div className="drawer-panel">
        <div className="drawer-header">
          <h3>Groups</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        <ul className="group-list">
          {state.groups.length === 0 && <div className="hint">No groups yet.</div>}
          {state.groups.map((g) => {
            const t = groupTotals(g);
            const shared = g.kind === "shared";
            return (
              <li
                key={g.id}
                className={`group-item${g.id === state.activeGroupId ? " active" : ""}`}
                onClick={() => onPick(g.id)}
              >
                <div className="brand-mark">{g.currency || "₹"}</div>
                <div className="g-main">
                  <b>
                    {g.name} <span className="kind-badge">
                      <Icon name={shared ? "users" : "notebook"} size={13} />
                    </span>
                  </b>
                  <small>
                    {t.members} members · {g.currency}
                    {t.total.toFixed(2)}
                  </small>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="drawer-actions">
          <button className="btn btn-primary btn-block" onClick={onNewGroup}>
            <Icon name="plus" /> New group
          </button>
          {cloudOn && (
            <button className="btn btn-ghost btn-block" onClick={onJoinGroup}>
              <Icon name="link" /> Join with code
            </button>
          )}
          <button className="btn btn-ghost btn-block" onClick={onAccount}>
            <Icon name="user" /> {user ? user.name : cloudOn ? "Sign in" : "Account"}
          </button>
        </div>
      </div>
      <div className="drawer-backdrop" onClick={onClose} />
    </div>
  );
}
