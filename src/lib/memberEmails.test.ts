import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: null as { currentUser: { getIdToken: () => Promise<string> } | null } | null,
}));
vi.mock("./firebase", () => ({ getAuthOrNull: () => h.auth }));

const { fetchMemberEmails } = await import("./memberEmails");

/** A fetch() reply with the given status, body and content type. */
const reply = (status: number, body: unknown, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": type },
  });

beforeEach(() => {
  h.auth = { currentUser: { getIdToken: async () => "id-token" } };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMemberEmails", () => {
  it("reports how many addresses were filled in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { ok: true, filled: 3 })));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: true, filled: 3 });
  });

  it("sends the group id and a bearer token", async () => {
    const f = vi.fn(async () => reply(200, { ok: true, filled: 0 }));
    vi.stubGlobal("fetch", f);
    await fetchMemberEmails("g1");

    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/member-emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    expect(JSON.parse(String(init.body))).toEqual({ groupId: "g1" });
  });

  /**
   * The failure mode that would otherwise look like a bug: a static host with a
   * catch-all rewrite answers 200 with the app shell, not 404, so the status
   * alone cannot tell a missing endpoint from a working one.
   */
  it("treats the app shell coming back as no endpoint at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, "<!doctype html>", "text/html")));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("treats a deployment with no service account as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(501, { ok: false, reason: "unconfigured" })));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("is unavailable rather than broken when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("separates a rejected token from a caller outside the group", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { ok: false, reason: "auth" })));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "auth" });

    vi.stubGlobal("fetch", vi.fn(async () => reply(403, { ok: false, reason: "not-a-member" })));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "not-a-member" });
  });

  it("keeps an owner-only refusal distinct from an outsider's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(403, { ok: false, reason: "not-admin" })));
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "not-admin" });
  });

  it("does not call the endpoint when nobody is signed in", async () => {
    h.auth = { currentUser: null };
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchMemberEmails("g1")).toEqual({ ok: false, reason: "auth" });
    expect(f).not.toHaveBeenCalled();
  });
});
