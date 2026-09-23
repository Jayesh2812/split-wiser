/**
 * Fill in the email addresses of a shared group's signed-in members.
 *
 * WHY THIS EXISTS AT ALL. A browser can only read the address of whoever is
 * signed in on it: the Firebase client SDK exposes no lookup of another user's
 * email by uid, and no Firestore rule can expose one either, because the address
 * lives in Firebase Auth rather than in Firestore. So a member's row stays blank
 * for everyone else until that member's own device writes it (see
 * syncMyMemberEmail), which never happens for someone who has stopped using the
 * app. Reading it for them needs the Admin SDK, and the Admin SDK needs a
 * server. This is that server — small enough to run on a free Vercel function.
 *
 * WHAT IT WILL NOT DO. It is not a directory: it answers only for one group, and
 * only for a caller who is already a member of it and could therefore see those
 * people anyway. An unverified token, or a caller outside the group, gets
 * nothing. Uids are read from the GROUP DOCUMENT, never from the request body,
 * so a member cannot use their own group as a lens onto arbitrary accounts.
 *
 * Setup: put a Firebase service-account JSON in the FIREBASE_SERVICE_ACCOUNT
 * environment variable (Vercel > Project > Settings > Environment Variables).
 * Without it the endpoint reports itself unconfigured and the app falls back to
 * typing addresses in by hand.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

interface Member {
  id: string;
  name: string;
  uid?: string | null;
  email?: string | null;
}

/** Minimal shape of the Vercel request/response pair, avoiding a @vercel/node dependency. */
interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (code: number) => Res;
  json: (body: unknown) => void;
}

/** Lazily built so an unconfigured deployment fails with a message, not a crash on import. */
let app: App | null = null;

function adminApp(): App | null {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    app =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          // Vercel's env editor stores the key with literal \n sequences.
          privateKey: parsed.private_key.replace(/\\n/g, "\n"),
        }),
      });
    return app;
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not valid service-account JSON", e);
    return null;
  }
}

const bearer = (req: Req): string | null => {
  const header = req.headers.authorization ?? req.headers.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim() || null;
};

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }

  const instance = adminApp();
  if (!instance) {
    res.status(501).json({ ok: false, reason: "unconfigured" });
    return;
  }

  const token = bearer(req);
  const groupId =
    typeof req.body === "object" && req.body !== null
      ? String((req.body as { groupId?: unknown }).groupId ?? "")
      : "";
  if (!token || !groupId) {
    res.status(400).json({ ok: false, reason: "bad-request" });
    return;
  }

  try {
    // checkRevoked: a signed-out or disabled account must not keep pulling
    // addresses on the strength of a token minted an hour ago.
    const caller = await getAuth(instance).verifyIdToken(token, true);

    const ref = getFirestore(instance).collection("groups").doc(groupId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, reason: "no-group" });
      return;
    }
    const group = snap.data() as { members?: Member[]; memberUids?: string[] };

    // The membership check. Mirrors isMember() in firestore.rules.
    if (!(group.memberUids ?? []).includes(caller.uid)) {
      res.status(403).json({ ok: false, reason: "not-a-member" });
      return;
    }

    const members = group.members ?? [];
    // Only members who hold an account and have no address stored yet. Anyone
    // whose email is already on the document is left alone, so a hand-typed
    // address is not churned on every call.
    const wanted = members.filter((m) => m.uid && !m.email).map((m) => m.uid as string);
    if (wanted.length === 0) {
      res.status(200).json({ ok: true, filled: 0 });
      return;
    }

    // getUsers tolerates uids it cannot find (deleted accounts) by returning
    // them under notFound rather than throwing. 100 identifiers per call is the
    // Admin SDK's limit; a group that size is far beyond anything real.
    const lookup = await getAuth(instance).getUsers(
      wanted.slice(0, 100).map((uid) => ({ uid })),
    );
    const byUid = new Map(lookup.users.map((u) => [u.uid, u.email ?? null]));

    const next = members.map((m) =>
      m.uid && !m.email && byUid.get(m.uid) ? { ...m, email: byUid.get(m.uid) as string } : m,
    );
    const filled = next.filter((m, i) => m.email !== members[i]?.email).length;
    // Only the members array, so a concurrent expense write is not clobbered.
    if (filled > 0) await ref.update({ members: next });

    res.status(200).json({ ok: true, filled });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    // An expired or revoked token is the client's problem to fix by retrying
    // with a fresh one, not a server fault.
    if (code.startsWith("auth/")) {
      res.status(401).json({ ok: false, reason: "auth" });
      return;
    }
    console.error("member-emails failed", e);
    res.status(500).json({ ok: false, reason: "failed" });
  }
}
