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
- **Members** tab — everyone in the group with their email, and every membership action in one place: add, rename, set an email, merge duplicates, remove, invite, leave
- **Export**: CSV and PDF (print-to-PDF report) covering transactions, balances and the settlement plan

**Sharing & accounts**
- Google sign-in; create shared groups and invite people with a code
- Any member of a shared group can add expenses; changes sync live across devices
- Name-only participants can coexist with signed-in members in a shared group
- A member's email comes from their Google account; name-only people get one typed in by hand. Emails stay inside the group — they are never part of an export or a published settlement
- Leave a group from the Members tab, or (as owner) delete it for everyone from Settings

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
   (Or with the CLI: `npm run rules:deploy`, configured by `firebase.json` / `.firebaserc`.)
5. **Project settings → General → Your apps → Web app** → copy the config values.
6. `cp .env.example .env.local` and fill them in, then restart the dev server.

No composite indexes are needed — the only query is a single-field `array-contains`, which Firestore indexes automatically.

The `VITE_FIREBASE_*` keys are public by design; they identify the project rather than authorising access. Data is protected by `firestore.rules`.

### Member emails (optional)

Each member's email writes itself onto their own member slot the next time they open the app, because **a browser can only read the address of whoever is signed in on it** — the Firebase client SDK has no lookup of another user's email, and no Firestore rule can expose one. So a member who never opens the app again stays blank forever, and the Members tab offers to type theirs in by hand.

[`api/member-emails.ts`](./api/member-emails.ts) closes that gap with the Admin SDK, which needs a server. It runs as a serverless function on Vercel's free tier — no Blaze plan, since Blaze is about where *code* runs, not about Admin SDK calls:

1. **Firebase console → Project settings → Service accounts → Generate new private key** — a JSON file.
2. In **Vercel → Project → Settings → Environment Variables**, add `FIREBASE_SERVICE_ACCOUNT` with the whole JSON file as its value. Treat it as a password: it bypasses `firestore.rules` entirely.
3. Redeploy. A **Fetch emails** button appears on the Members tab whenever someone's address is missing.

**`firebase-admin` is held at v13 deliberately.** v14 pulls `jwks-rsa@4`, which does `require('jose')` while `jose@6` is ESM-only — a combination that loads under Node's own `require(esm)` support but not inside Vercel's function loader, where it throws `ERR_REQUIRE_ESM` at import and the invocation dies as `FUNCTION_INVOCATION_FAILED`: a bare 500 with no body, on every request including ones that should have been rejected earlier. v13 resolves to `jwks-rsa@3` and `jose@4`, which are CommonJS and load anywhere. Upgrading to v14 will reintroduce this, so verify `GET /api/member-emails` returns `{"ok":true,"sdk":"loaded"}` after any bump.

#### Testing it locally

`npm run dev` serves it. A dev-only Vite plugin (`devApi` in [`vite.config.ts`](./vite.config.ts)) runs `api/*.ts` inside the dev server's own process, so a handler that throws prints a stack trace in your terminal instead of an opaque 500. `vercel dev` also works in principle, but with no framework preset on the project it insists on building first and reaches for yarn to do it.

`FIREBASE_SERVICE_ACCOUNT` goes in `.env.local` **for local runs only** — gitignored by `*.local`, and not prefixed `VITE_`, so it is read by the dev server and never reaches the browser bundle. The deployed function never sees this file; Vercel supplies the value from the project's environment variables.

It must be **one line**. A `.env` file keeps only the first line of an unquoted value, so pasting the pretty-printed key file leaves the variable holding `{`, and the endpoint answers `bad-credentials` saying so:

```bash
echo "FIREBASE_SERVICE_ACCOUNT=$(jq -c . ~/Downloads/your-key.json)" >> .env.local
```

To exercise it without the UI, grab your own ID token from the browser console on the running app and call the endpoint directly:

```js
// devtools console — Firebase persists the signed-in user here
JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith("firebase:authUser"))[1])
  .stsTokenManager.accessToken;
```

```bash
curl -X POST http://localhost:5173/api/member-emails \
  -H "Authorization: Bearer <that token>" \
  -H "Content-Type: application/json" \
  -d '{"groupId":"<group doc id from the Firestore console>"}'
```

Tokens last an hour; reload the app for a fresh one. Expect `{"ok":true,"filled":N}`, `501` when the service account is missing, `403` if you are not in that group, and `401` for a stale token.

It answers for one group at a time, only to a caller whose ID token verifies *and* who is already in that group's `memberUids`, and it reads the uids from the group document rather than the request — so it cannot be used as a directory of arbitrary accounts. Deployments without the variable report themselves unconfigured and the app falls back to hand-typed addresses; the button and the rest of the tab work the same either way.

## Scripts

```bash
npm run dev           # dev server
npm test              # test suite (Vitest)
npm run typecheck     # TypeScript
npm run build         # production build into dist/ (generates the service worker)
npm run preview       # serve the production build
npm run rules:deploy  # deploy firestore.rules
npm run rules:emulate # local Firestore emulator (needs a Java runtime)
```

## Published settlements

The owner of a shared group can publish a frozen settlement summary to `/s/<token>`,
readable by anyone with the link and no sign-in. Two collections back it:

| collection | contents | client read |
|---|---|---|
| `public_settlements/{token}` | the allowlisted payload — **no `groupId`** | `get: if true`, `list: if false` |
| `public_settlement_refs/{token}` | `{ groupId }` | denied; read only by `firestore.rules` |

Three invariants hold this together, all enforced in `firestore.rules`:

- **No `groupId` in the world-readable doc.** `isJoiningSelf()` lets any signed-in user
  who knows a `groupId` add themselves to `memberUids`, which then grants read access to
  every transaction and the invite code. The ref doc exists purely so the rules can
  resolve the owner without publishing the id.
- **`allow list: if false`.** `allow read` grants get *and* list; without the explicit
  denial, one query returns every published settlement in the database.
- **Delete ordering.** The published docs are authorised *through* the group doc, so
  `deleteSharedGroup` removes `public_settlements` → `public_settlement_refs` →
  `invites` → `groups`. Reversing it leaves a world-readable doc that can never be
  deleted.

`src/lib/snapshot.ts` builds the payload from an explicit allowlist — never by spreading
the `Group` — and `src/lib/snapshot.test.ts` asserts the output contains no invite code,
member id, uid, note or transaction.

### Verifying the rules

`npm test` covers the client. The rules themselves need the emulator (and so a Java
runtime), or the **Firestore → Rules → Playground** in the console. Check that:

1. unauthenticated `get public_settlements/{token}` → **allow**
2. unauthenticated `list public_settlements` → **deny**
3. a non-owner member `create` → **deny**
4. the owner `create` with the ref doc present → **allow**; with it absent → **deny**
5. the owner `create` with an extra `inviteCode` key → **deny** (proves `validSettlement()`)
6. any client `get public_settlement_refs/{token}` → **deny**, while (4) still passes —
   this is the assumption the whole design rests on: rules-side `get()` bypasses read rules
7. a ref `update` that changes `groupId` → **deny**
8. the owner `delete public_settlements/{token}` *after* deleting the group → **deny**
   (pins the ordering requirement so nobody "simplifies" `deleteSharedGroup` later)

## Project layout

```
index.html                 App shell
vite.config.ts             Vite + PWA + Vitest config
firestore.rules            Security rules for shared groups
.env.example               Firebase config template (optional)
api/
  member-emails.ts         Serverless email lookup (optional, Admin SDK)
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
    memberEmails.ts        Client half of the optional email lookup
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
