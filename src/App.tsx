import { useEffect, useState } from "react";
import { useAppState } from "./hooks/useStore";
import { useAuthReady, useAuthUser } from "./hooks/useAuth";
import { useCloudSync } from "./hooks/useCloudSync";
import { getActiveGroup, setActiveGroup } from "./lib/store";
import { isPayment } from "./lib/finance";
import * as repo from "./lib/repo";
import { toast } from "./lib/toast";
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
import { findGroupBySlug, readRoute, writeRoute } from "./lib/route";
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

const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v);

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
  // Restore position from the URL on first render so a refresh stays put.
  const [tab, setTab] = useState<TabKey>(() => {
    const t = readRoute().tab;
    return isTab(t) ? t : "transactions";
  });
  /**
   * Group slug from the URL that has not been applied yet. Shared groups arrive
   * asynchronously over the Firestore snapshot, so the target may not exist on
   * first render — hold it until it does.
   */
  const [pendingSlug, setPendingSlug] = useState<string | null>(() => readRoute().slug);
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

  // Apply the URL's group once it has loaded.
  useEffect(() => {
    if (!pendingSlug) return;
    const id = findGroupBySlug(state.groups, pendingSlug);
    if (id) {
      setActiveGroup(id);
      setPendingSlug(null);
    } else if (state.groups.length) {
      // Loaded, but nothing matches — a deleted group or a stale link.
      setPendingSlug(null);
    }
  }, [pendingSlug, state.groups]);

  // Adopt the first group if none is active (e.g. after restore or sign-out).
  // Held off while a URL group is still pending, or we would flash the wrong one.
  useEffect(() => {
    if (pendingSlug) return;
    if (!state.activeGroupId && state.groups.length) setActiveGroup(state.groups[0]!.id);
  }, [state.activeGroupId, state.groups, pendingSlug]);

  // Keep the URL in step with where the user actually is.
  useEffect(() => {
    writeRoute(group, state.groups, tab);
  }, [group, state.groups, tab]);

  const closeModal = () => setModal({ type: "none" });

  useScrollLock(drawerOpen || modal.type !== "none");

  // Fill in recurring expenses that came due while the app was closed.
  useEffect(() => {
    if (!group) return;
    void repo.materialiseRecurring(group, user).then((n) => {
      if (n > 0) toast(`Added ${n} recurring ${n === 1 ? "expense" : "expenses"}`);
    });
  }, [group?.id]);

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
        {group && tab === "balances" && <BalancesPanel group={group} user={user} />}
        {group && tab === "settle" && (
          <SettlePanel
            group={group}
            greedy={state.settings.greedyMode}
            user={user}
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
