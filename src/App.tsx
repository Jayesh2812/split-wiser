import { useEffect, useState } from "react";
import { useAppState } from "./hooks/useStore";
import { useAuthUser } from "./hooks/useAuth";
import { useCloudSync } from "./hooks/useCloudSync";
import { getActiveGroup, setActiveGroup } from "./lib/store";
import type { GroupKind, Transaction } from "./types";
import { TopBar } from "./components/TopBar";
import { TransactionsPanel } from "./components/TransactionsPanel";
import { BalancesPanel } from "./components/BalancesPanel";
import { SettlePanel } from "./components/SettlePanel";
import { ExportBar } from "./components/ExportBar";
import { GroupDrawer } from "./components/GroupDrawer";
import { GroupModal } from "./components/GroupModal";
import { CreateGroupChoiceModal } from "./components/CreateGroupChoiceModal";
import { JoinGroupModal } from "./components/JoinGroupModal";
import { AccountModal } from "./components/AccountModal";
import { SettingsModal } from "./components/SettingsModal";
import { TransactionModal } from "./components/TransactionModal";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";

export type TabKey = "transactions" | "balances" | "settle";
type ModalState =
  | { type: "none" }
  | { type: "chooseKind" }
  | { type: "group"; kind: GroupKind }
  | { type: "join" }
  | { type: "account" }
  | { type: "settings" }
  | { type: "tx"; tx: Transaction | null };

const TABS: { key: TabKey; label: string }[] = [
  { key: "transactions", label: "Transactions" },
  { key: "balances", label: "Balances" },
  { key: "settle", label: "Settle Up" },
];

export function App() {
  const state = useAppState();
  const user = useAuthUser();
  useCloudSync(user);

  const group = getActiveGroup();
  const [tab, setTab] = useState<TabKey>("transactions");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: "none" });

  // Adopt the first group if none is active (e.g. after restore or sign-out).
  useEffect(() => {
    if (!state.activeGroupId && state.groups.length) setActiveGroup(state.groups[0]!.id);
  }, [state.activeGroupId, state.groups]);

  const closeModal = () => setModal({ type: "none" });

  return (
    <div id="app">
      <TopBar
        group={group}
        user={user}
        onMenu={() => setDrawerOpen(true)}
        onSettings={() => group && setModal({ type: "settings" })}
        onAccount={() => setModal({ type: "account" })}
      />

      {group && (
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              className={`tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="content">
        {!group && <EmptyState onCreate={() => setModal({ type: "chooseKind" })} />}
        {group && tab === "transactions" && (
          <TransactionsPanel
            group={group}
            onAdd={() => setModal({ type: "tx", tx: null })}
            onEdit={(tx) => setModal({ type: "tx", tx })}
            onNeedMembers={() => setModal({ type: "settings" })}
          />
        )}
        {group && tab === "balances" && <BalancesPanel group={group} />}
        {group && tab === "settle" && (
          <SettlePanel group={group} greedy={state.settings.greedyMode} />
        )}
      </main>

      {group && <ExportBar group={group} greedy={state.settings.greedyMode} />}

      {drawerOpen && (
        <GroupDrawer
          state={state}
          user={user}
          onClose={() => setDrawerOpen(false)}
          onNewGroup={() => {
            setDrawerOpen(false);
            setModal({ type: "chooseKind" });
          }}
          onJoinGroup={() => {
            setDrawerOpen(false);
            setModal({ type: "join" });
          }}
          onAccount={() => {
            setDrawerOpen(false);
            setModal({ type: "account" });
          }}
          onPick={(id) => {
            setActiveGroup(id);
            setTab("transactions");
            setDrawerOpen(false);
          }}
        />
      )}

      {modal.type === "chooseKind" && (
        <CreateGroupChoiceModal
          onClose={closeModal}
          onPick={(kind) => setModal({ type: "group", kind })}
        />
      )}
      {modal.type === "group" && (
        <GroupModal
          kind={modal.kind}
          onClose={closeModal}
          onCreated={() => {
            setTab("transactions");
            closeModal();
          }}
        />
      )}
      {modal.type === "join" && (
        <JoinGroupModal
          onClose={closeModal}
          onJoined={() => {
            setTab("transactions");
            closeModal();
          }}
        />
      )}
      {modal.type === "account" && <AccountModal onClose={closeModal} />}
      {modal.type === "settings" && group && (
        <SettingsModal group={group} user={user} onClose={closeModal} />
      )}
      {modal.type === "tx" && group && (
        <TransactionModal group={group} existing={modal.tx} user={user} onClose={closeModal} />
      )}

      <Toast />
      <div id="print-root" className="print-root" />
    </div>
  );
}
