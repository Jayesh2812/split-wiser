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
 * NOTHING IS IMPORTED AT MODULE SCOPE. firebase-admin is 30MB of lazily-required
 * submodules, and if the platform fails to package one of them a top-level
 * import takes the whole invocation down with FUNCTION_INVOCATION_FAILED — a
 * bare 500 with no body, which tells neither the caller nor the developer
 * anything. Loading it inside the handler turns that into a JSON answer that
 * names the problem. GET is a health check for exactly this reason.
 *
 * Setup: put a Firebase service-account JSON in the FIREBASE_SERVICE_ACCOUNT
 * environment variable (Vercel > Project > Settings > Environment Variables).
 * Without it the endpoint reports itself unconfigured and the app falls back to
 * typing addresses in by hand.
 */
import type { App } from "firebase-admin/app";

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

/** The three firebase-admin entry points this endpoint uses. */
async function loadAdmin() {
  const [appMod, authMod, firestoreMod] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
    import("firebase-admin/firestore"),
  ]);
  return {
    cert: appMod.cert,
    getApps: appMod.getApps,
    initializeApp: appMod.initializeApp,
    getAuth: authMod.getAuth,
    getFirestore: firestoreMod.getFirestore,
  };
}

type Admin = Awaited<ReturnType<typeof loadAdmin>>;

/** Reused across invocations on a warm instance. */
let cached: App | null = null;

function adminApp(sdk: Admin): App | null {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  cached =
    sdk.getApps()[0] ??
    sdk.initializeApp({
      credential: sdk.cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Vercel's env editor stores the key with literal \n sequences.
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    });
  return cached;
}

const bearer = (req: Req): string | null => {
  const header = req.headers.authorization ?? req.headers.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim() || null;
};

const message = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export default async function handler(req: Req, res: Res): Promise<void> {
  // Everything is inside this try, including loading the SDK: an endpoint that
  // dies without a body is the one failure nobody can debug from the outside.
  try {
    let sdk: Admin;
    try {
      sdk = await loadAdmin();
    } catch (e) {
      console.error("firebase-admin failed to load", e);
      res.status(500).json({ ok: false, reason: "sdk-load", detail: message(e) });
      return;
    }

    const configured = !!process.env.FIREBASE_SERVICE_ACCOUNT;

    // Health check: says whether the pieces are in place, and nothing else.
    // Deliberately unauthenticated — it reveals only that an env var exists.
    if (req.method === "GET") {
      res.status(200).json({ ok: true, sdk: "loaded", configured });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, reason: "method" });
      return;
    }
    if (!configured) {
      res.status(501).json({ ok: false, reason: "unconfigured" });
      return;
    }

    let instance: App | null;
    try {
      instance = adminApp(sdk);
    } catch (e) {
      // Almost always a malformed service-account JSON in the env var. The
      // common shape of that is worth naming: a .env file keeps only the first
      // line of an unquoted value, so a pretty-printed key becomes "{".
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? "";
      const truncated = raw.trim().length < 100;
      console.error("FIREBASE_SERVICE_ACCOUNT is not valid service-account JSON", e);
      res.status(500).json({
        ok: false,
        reason: "bad-credentials",
        detail: truncated
          ? `FIREBASE_SERVICE_ACCOUNT holds only ${raw.trim().length} characters — the ` +
            `service-account JSON must be on ONE line. Try: ` +
            `echo "FIREBASE_SERVICE_ACCOUNT=$(jq -c . key.json)" >> .env.local`
          : message(e),
      });
      return;
    }
    if (!instance) {
      res.status(501).json({ ok: false, reason: "unconfigured" });
      return;
    }

    const token = bearer(req);
    const body =
      typeof req.body === "string" ? (JSON.parse(req.body || "{}") as unknown) : req.body;
    const groupId =
      typeof body === "object" && body !== null
        ? String((body as { groupId?: unknown }).groupId ?? "")
        : "";
    if (!token || !groupId) {
      res.status(400).json({ ok: false, reason: "bad-request" });
      return;
    }

    // checkRevoked: a signed-out or disabled account must not keep pulling
    // addresses on the strength of a token minted an hour ago.
    const caller = await sdk.getAuth(instance).verifyIdToken(token, true);

    const ref = sdk.getFirestore(instance).collection("groups").doc(groupId);
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
    const lookup = await sdk
      .getAuth(instance)
      .getUsers(wanted.slice(0, 100).map((uid) => ({ uid })));
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
    res.status(500).json({ ok: false, reason: "failed", detail: message(e) });
  }
}
