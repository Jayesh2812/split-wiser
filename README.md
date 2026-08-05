# Splitwiser

An **offline-first, installable PWA** for splitting group expenses — like Splitwise, but it works with no network and doesn't require anyone to sign up. Log who paid for what, see who owes whom, and export the ledger as **PDF or CSV** to share.

Groups come in two flavours:

| | 📓 **Solo group** | 👥 **Shared group** |
|---|---|---|
| Members | Names you type in | Real people who join with Google |
| Sign-in | Not needed | Google sign-in required |
| Storage | `localStorage`, this device only | Firestore, one document per group |
| Who adds expenses | Only you | Any member |
| Invite | — | 6-character code |
| Works offline | Yes | Yes (queued writes sync on reconnect) |

Firebase is **optional**. With no config the app runs exactly as it always did — fully offline, solo groups only.

## Stack

- **React 18 + TypeScript** (UI)
- **Vite 5** + **vite-plugin-pwa** (build, service worker, manifest, installability)
- **Firebase** — Auth (Google) + Firestore with IndexedDB persistence *(optional)*
- **Vitest** + **Testing Library / jsdom** (37 tests)

## Features

**Core**
- Multiple groups, each with its own members and currency symbol
- Add a transaction: payer, amount, category, date, note, split among selected members
- Three split methods — **equally**, **by shares** (weights), **exact amounts** — with a live per-person preview and validation
- **Balances**: net owed / owing per member
- **Settle Up**, two modes:
  - *Direct* (default): each person repays whoever paid for them, mutual debts netted — fully traceable
  - *Greedy* (**opt-in toggle**): minimises the number of payments to settle everyone
- **Export**: CSV and PDF (print-to-PDF report) covering transactions, balances and the settlement plan

**Sharing & accounts**
- Google sign-in; create shared groups and invite people with a code
- Any member of a shared group can add expenses; changes sync live across devices
- Name-only participants can coexist with signed-in members in a shared group
- Leave a group, or (as owner) delete it for everyone

**Extras**
- Edit / delete transactions, search, per-group totals and average per member
- JSON **backup / restore** for solo groups
- Offline indicator; installable to home screen

## Money & correctness

All arithmetic is done in integer **cents** to avoid floating-point drift; leftover cents from uneven splits (e.g. 100 ÷ 3) are distributed deterministically so shares always sum exactly to the total. Greedy settlement repeatedly matches the largest debtor with the largest creditor, producing a minimal set of transfers.

Shared-group writes use Firestore's `arrayUnion` / `arrayRemove` rather than whole-document writes, so two members adding an expense at the same moment cannot clobber each other.

## Setup

```bash
npm install
npm run dev          # http://localhost:5173
```

That's enough for solo groups. To enable Google sign-in and shared groups:

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method → Google → Enable** (set a support email).
3. **Build → Firestore Database → Create database** → *Production mode* → choose a region.
4. **Firestore → Rules** → paste the contents of [`firestore.rules`](./firestore.rules) → **Publish**.
   (Or with the CLI: `firebase deploy --only firestore:rules`.)
5. **Project settings → General → Your apps → Web app** → copy the config values.
6. `cp .env.example .env.local` and fill them in, then restart the dev server.

No composite indexes are needed — the only query is a single-field `array-contains`, which Firestore indexes automatically.

The `VITE_FIREBASE_*` keys are public by design; they identify the project rather than authorising access. Data is protected by `firestore.rules`.

## Scripts

```bash
npm run dev        # dev server
npm test           # test suite (Vitest)
npm run typecheck  # TypeScript
npm run build      # production build into dist/ (generates the service worker)
npm run preview    # serve the production build
```

## Project layout

```
index.html                 App shell
vite.config.ts             Vite + PWA + Vitest config
firestore.rules            Security rules for shared groups
.env.example               Firebase config template (optional)
src/
  main.tsx                 React entry
  App.tsx                  Layout, tabs, modal orchestration
  types.ts                 Shared domain types
  styles.css               Styling (dark theme + print styles for the PDF)
  lib/
    finance.ts             Pure logic: shares, balances, settlement algorithms
    store.ts               Local state + localStorage persistence
    cloud.ts               Firestore reads/writes for shared groups
    repo.ts                Facade routing each mutation by group kind
    firebase.ts            Lazy, optional Firebase bootstrap
    auth.ts                Google sign-in / sign-out
    exporter.ts            CSV / PDF / JSON-backup export
    format.ts              Money, colours, dates
    toast.ts               Toast pub/sub
  hooks/
    useStore.ts            useSyncExternalStore binding
    useAuth.ts             Signed-in user
    useCloudSync.ts        Firestore subscription -> store
  components/              Panels, modals, drawer, bars
public/icons/              App icons (SVG + PNG)
```

### How the two storage paths stay separate

`repo.ts` is the only thing the UI mutates through. It inspects `group.kind` and dispatches to either the synchronous local store or Firestore. Shared groups are never written to `localStorage` (Firestore keeps its own offline cache, so a second copy would only go stale), and they're excluded from JSON backups. Signing out drops shared groups from memory and leaves solo groups untouched.

## Offline / install

After a production build the service worker precaches the app shell, so the app runs with no network. Shared groups additionally rely on Firestore's IndexedDB persistence: reads come from cache and writes queue until connectivity returns. In a Chromium browser you'll be offered an install prompt to add it to your home screen or desktop.
