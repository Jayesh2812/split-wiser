import type { AuthUser, Group } from "../types";
import { groupTotals } from "../lib/finance";
import { initials } from "../lib/format";
import { isCloudConfigured } from "../lib/firebase";
import { Icon } from "./Icon";

interface TopBarProps {
  group: Group | null;
  user: AuthUser | null;
  onMenu: () => void;
  onSettings: () => void;
  onAccount: () => void;
}

export function TopBar({ group, user, onMenu, onSettings, onAccount }: TopBarProps) {
  const totals = group ? groupTotals(group) : null;
  const shared = group?.kind === "shared";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" aria-label="Groups" title="Groups" onClick={onMenu}>
          <Icon name="menu" size={20} />
        </button>
        {/* With a group open the whole brand block is a button into Settings. */}
        <div
          className={`brand${group ? " brand-tappable" : ""}`}
          {...(group
            ? {
                role: "button",
                tabIndex: 0,
                title: "Group settings",
                "aria-label": `Settings for ${group.name}`,
                onClick: onSettings,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSettings();
                  }
                },
              }
            : {})}
        >
          <span className="brand-mark">{group?.currency || "₹"}</span>
          <div className="brand-text">
            <strong>
              {group ? group.name : "Splitwiser"}
              {group && (
                <span className="kind-badge" title={shared ? "Shared group" : "Solo group"}>
                  <Icon name={shared ? "users" : "notebook"} size={13} />
                </span>
              )}
            </strong>
            <small>
              {totals ? `${totals.members} members · ${totals.count} transactions` : "No group yet"}
            </small>
          </div>
        </div>
      </div>
      <div className="topbar-right">
        {isCloudConfigured() && (
          <button className="icon-btn" aria-label="Account" title="Account" onClick={onAccount}>
            {user ? (
              user.photoURL ? (
                <img className="avatar-sm" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar-sm avatar-fallback">{initials(user.name)}</span>
              )
            ) : (
              <Icon name="user" size={19} />
            )}
          </button>
        )}
        {group && (
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
            <Icon name="settings" size={19} />
          </button>
        )}
      </div>
    </header>
  );
}
