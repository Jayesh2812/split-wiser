import { useEffect, useState } from "react";
import { useAppState } from "./hooks/useStore";
import { useAuthReady, useAuthUser } from "./hooks/useAuth";
import { useCloudSync } from "./hooks/useCloudSync";
import { getActiveGroup, setActiveGroup } from "./lib/store";
import { isPayment } from "./lib/finance";
import type { GroupKind, Transaction, Transfer } from "./types";
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
import { PaymentModal, paymentParties } from "./components/PaymentModal";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";
import { Splash } from "./components/Splash";
import { clearInviteFromUrl, readInviteFromUrl } from "./lib/invite";
import { useScrollLock, useViewportVars } from "./hooks/useViewport";

export type TabKey = "transactions" | "balances" | "settle";
type ModalState =
  | { type: "none" }
  | { type: "chooseKind" }
  | { type: "group"; kind: GroupKind }
  | { type: "join"; code?: string }
  | { type: "account" }
  | { type: "settings" }
  | { type: "tx"; tx: Transaction | null }
  | { type: "payment"; from: string; to: string; suggested?: number; existing?: Transaction };

const TABS: { key: TabKey; label: string }[] = [
  { key: "transactions", label: "Transactions" },
  { key: "balances", label: "Balances" },
  { key: "settle", label: "Settle Up" },
];

/**
 * A settlement must not open in the expense form — that form would render it as
 * an exact-split expense and let the user mangle it into something incoherent.
 */
function openForTx(tx: Transaction): ModalState {
  if (!isPayment(tx)) return { type: "tx", tx };
  const parties = paymentParties(tx);
  if (!parties) return { type: "tx", tx }; // malformed payment: fall back to the raw editor
  return { type: "payment", from: parties.from, to: parties.to, existing: tx };
}

export function App() {
  const state = useAppState();
  const user = useAuthUser();
  const authReady = useAuthReady();
  useCloudSync(user);
  useViewportVars();

  const group = getActiveGroup();
  const [tab, setTab] = useState<TabKey>("transactions");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: "none" });

  // An invite link (?join=CODE) opens the join sheet once, then the param is
  // dropped so a refresh doesn't re-prompt for a group already dealt with.
  useEffect(() => {
    const code = readInviteFromUrl();
    if (!code) return;
    clearInviteFromUrl();
    setModal({ type: "join", code });
  }, []);

  // Adopt the first group if none is active (e.g. after restore or sign-out).
  useEffect(() => {
    if (!state.activeGroupId && state.groups.length) setActiveGroup(state.groups[0]!.id);
  }, [state.activeGroupId, state.groups]);

  const closeModal = () => setModal({ type: "none" });

  useScrollLock(drawerOpen || modal.type !== "none");

  // Hold the whole UI back until Firebase has restored the session — otherwise the
  // signed-out home screen flashes before the user's groups arrive.
  if (!authReady) return <Splash />;

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
        {!group && (
          <EmptyState
            user={user}
            onCreate={() => setModal({ type: "chooseKind" })}
            onJoin={() => setModal({ type: "join" })}
          />
        )}
        {group && tab === "transactions" && (
          <TransactionsPanel
            group={group}
            onAdd={() => setModal({ type: "tx", tx: null })}
            onEdit={(tx) => setModal(openForTx(tx))}
            onNeedMembers={() => setModal({ type: "settings" })}
          />
        )}
        {group && tab === "balances" && <BalancesPanel group={group} />}
        {group && tab === "settle" && (
          <SettlePanel
            group={group}
            greedy={state.settings.greedyMode}
            onRecord={(t: Transfer) =>
              setModal({ type: "payment", from: t.from, to: t.to, suggested: t.amount })
            }
          />
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
          initialCode={modal.code}
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
      {modal.type === "payment" && group && (
        <PaymentModal
          group={group}
          from={modal.from}
          to={modal.to}
          suggested={modal.suggested}
          existing={modal.existing ?? null}
          user={user}
          onClose={closeModal}
        />
      )}

      <Toast />
      <div id="print-root" className="print-root" />
    </div>
  );
}
