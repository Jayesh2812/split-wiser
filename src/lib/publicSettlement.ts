/**
 * Reading a published settlement — the only Firestore path used by a signed-out
 * stranger.
 *
 * Deliberately NOT in cloud.ts: that module's db() throws when Firebase is
 * unconfigured, which is right for the owner-facing app and wrong here. Opening
 * /s/<token> on a build without cloud config must render a calm message, not an
 * exception, so this module tolerates a missing Firestore.
 */
import { doc, getDoc } from "firebase/firestore";
import { getDbOrNull, isCloudConfigured } from "./firebase";
import type { PublicSettlementDoc } from "./snapshot";

export const PUBLIC_SETTLEMENTS = "public_settlements";
export const PUBLIC_SETTLEMENT_REFS = "public_settlement_refs";

/** Tokens are 22 base62 chars; the range tolerates older or future lengths. */
const TOKEN_RE = /^[0-9A-Za-z]{16,64}$/;

export type PublicFetch =
  | { status: "ok"; doc: PublicSettlementDoc }
  /** Never existed, was unpublished, or the token is malformed. */
  | { status: "missing" }
  /** This build has no Firebase config, so nothing can be fetched. */
  | { status: "unavailable" }
  /** Network, permissions, or a document we cannot trust to render. */
  | { status: "error" };

export function isValidToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/**
 * The document crosses a trust boundary: any group owner can write arbitrary
 * JSON to their own settlement doc, and we render it. Validate before use so a
 * malformed doc is an error state rather than a crash mid-render.
 */
function isRenderable(data: unknown): data is PublicSettlementDoc {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.v !== 1) return false;
  if (typeof d.name !== "string" || typeof d.currency !== "string") return false;
  if (d.mode !== "direct" && d.mode !== "greedy") return false;
  if (typeof d.publishedAt !== "number" || !Number.isFinite(d.publishedAt)) return false;

  const t = d.totals as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return false;
  if (typeof t.total !== "number" || typeof t.count !== "number" || typeof t.members !== "number") {
    return false;
  }

  if (!Array.isArray(d.balances) || !Array.isArray(d.transfers)) return false;
  const balancesOk = d.balances.every(
    (b) => b && typeof b === "object"
      && typeof (b as Record<string, unknown>).name === "string"
      && typeof (b as Record<string, unknown>).net === "number",
  );
  const transfersOk = d.transfers.every(
    (x) => x && typeof x === "object"
      && typeof (x as Record<string, unknown>).from === "string"
      && typeof (x as Record<string, unknown>).to === "string"
      && typeof (x as Record<string, unknown>).amount === "number",
  );
  return balancesOk && transfersOk;
}

/** One unauthenticated read. No auth, no listener, no store. */
export async function fetchPublicSettlement(token: string): Promise<PublicFetch> {
  // Check the shape first: doc() throws on a path segment like "." or "..", and
  // an obviously bad token needs no round trip.
  if (!isValidToken(token)) return { status: "missing" };
  if (!isCloudConfigured()) return { status: "unavailable" };

  const database = getDbOrNull();
  if (!database) return { status: "unavailable" };

  try {
    const snap = await getDoc(doc(database, PUBLIC_SETTLEMENTS, token));
    // A missing doc still resolves (the read rule is `if true`), which is what
    // lets an unpublished link say "no longer shared" rather than erroring.
    if (!snap.exists()) return { status: "missing" };
    const data = snap.data();
    if (!isRenderable(data)) return { status: "error" };
    return { status: "ok", doc: data };
  } catch (e) {
    console.error("fetchPublicSettlement failed", e);
    return { status: "error" };
  }
}
