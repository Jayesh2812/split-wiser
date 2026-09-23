/**
 * Client half of api/member-emails.ts — ask the server to fill in the email
 * addresses of members who have not written their own.
 *
 * The endpoint is optional infrastructure: the app is deployed to static hosts
 * where /api does not exist at all, and to Vercel deployments with no service
 * account configured. Both answer clearly rather than being treated as errors,
 * so the Members tab can say why nothing happened.
 */
import { getAuthOrNull } from "./firebase";

export type FetchEmailsResult =
  | { ok: true; filled: number }
  /** No endpoint deployed, or it has no service account — the feature is simply off here. */
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "auth" | "not-a-member" | "not-admin" | "failed" };

const ENDPOINT = "/api/member-emails";

export async function fetchMemberEmails(groupId: string): Promise<FetchEmailsResult> {
  const auth = getAuthOrNull();
  const current = auth?.currentUser;
  if (!current) return { ok: false, reason: "auth" };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await current.getIdToken()}`,
      },
      body: JSON.stringify({ groupId }),
    });
  } catch {
    // Offline, or no network path to the endpoint.
    return { ok: false, reason: "unavailable" };
  }

  // A static host rewrites unknown paths to index.html, so a missing endpoint
  // arrives as 200 text/html rather than a 404. Checking the content type is
  // what tells those two apart.
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (res.status === 404 || res.status === 501 || !isJson) return { ok: false, reason: "unavailable" };
  if (res.status === 401) return { ok: false, reason: "auth" };
  if (res.status === 403) {
    // Both are refusals, but only one of them is worth explaining to the person
    // looking at the screen, so they are not collapsed into one reason.
    const body = await res.json().catch(() => null);
    const reason = (body as { reason?: string } | null)?.reason;
    return { ok: false, reason: reason === "not-admin" ? "not-admin" : "not-a-member" };
  }

  try {
    const body = (await res.json()) as {
      ok?: boolean;
      filled?: number;
      reason?: string;
      detail?: string;
    };
    if (res.ok && body.ok) return { ok: true, filled: Number(body.filled) || 0 };
    // The endpoint names what went wrong; the toast cannot say it usefully, so
    // it goes to the console where it can actually be read.
    console.error("member-emails:", body.reason ?? res.status, body.detail ?? "");
  } catch {
    /* falls through to the generic failure */
  }
  return { ok: false, reason: "failed" };
}
