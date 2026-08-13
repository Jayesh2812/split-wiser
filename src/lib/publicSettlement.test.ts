import { describe, it, expect, beforeEach, vi } from "vitest";

let configured = true;
let dbHandle: object | null = {};

vi.mock("./firebase", () => ({
  isCloudConfigured: () => configured,
  getDbOrNull: () => dbHandle,
  getAuthOrNull: () => null,
}));

const getDoc = vi.fn();
const doc = vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") }));

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => doc(...(args as [unknown, ...string[]])),
  getDoc: (...args: unknown[]) => getDoc(...args),
}));

const { fetchPublicSettlement, isValidToken, PUBLIC_SETTLEMENTS } = await import(
  "./publicSettlement"
);

const TOKEN = "tok0000000000000000001";

const okDoc = () => ({
  v: 1,
  name: "Goa Trip",
  currency: "₹",
  mode: "direct" as const,
  publishedAt: 1_700_000_000_000,
  totals: { total: 100, count: 1, members: 2 },
  balances: [{ name: "Alex", net: 50 }],
  transfers: [{ from: "Sam", to: "Alex", amount: 50 }],
});

const snap = (data: unknown) => ({ exists: () => data !== null, data: () => data });

beforeEach(() => {
  configured = true;
  dbHandle = {};
  vi.clearAllMocks();
});

describe("isValidToken", () => {
  it("accepts a 22-char base62 token", () => {
    expect(isValidToken(TOKEN)).toBe(true);
  });

  it("rejects path-traversal segments and junk", () => {
    for (const bad of [".", "..", "", "short", "has/slash", "has-dash", "has space", "a".repeat(65)]) {
      expect(isValidToken(bad), bad).toBe(false);
    }
  });
});

describe("fetchPublicSettlement", () => {
  it("rejects a malformed token without touching the network", async () => {
    expect(await fetchPublicSettlement("..")).toEqual({ status: "missing" });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it("reports unavailable when Firebase is not configured", async () => {
    configured = false;
    expect(await fetchPublicSettlement(TOKEN)).toEqual({ status: "unavailable" });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it("reports unavailable when Firestore cannot be created", async () => {
    dbHandle = null;
    expect(await fetchPublicSettlement(TOKEN)).toEqual({ status: "unavailable" });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it("reads the published document and returns it", async () => {
    const data = okDoc();
    getDoc.mockResolvedValue(snap(data));
    expect(await fetchPublicSettlement(TOKEN)).toEqual({ status: "ok", doc: data });
    expect(doc).toHaveBeenCalledWith(expect.anything(), PUBLIC_SETTLEMENTS, TOKEN);
  });

  it("reports missing for an unpublished token", async () => {
    getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    expect(await fetchPublicSettlement(TOKEN)).toEqual({ status: "missing" });
  });

  it("reports error rather than rendering an untrusted document", async () => {
    const bad: unknown[] = [
      { ...okDoc(), v: 2 },
      { ...okDoc(), balances: "nope" },
      { ...okDoc(), transfers: [{ from: "A", to: "B", amount: "50" }] },
      { ...okDoc(), balances: [{ name: "A" }] },
      { ...okDoc(), mode: "sideways" },
      { ...okDoc(), publishedAt: "yesterday" },
      { ...okDoc(), totals: { total: 1, count: 1 } },
      { ...okDoc(), name: 42 },
      null,
      "a string",
    ];
    for (const data of bad) {
      getDoc.mockResolvedValue({ exists: () => true, data: () => data });
      expect(await fetchPublicSettlement(TOKEN), JSON.stringify(data)).toEqual({ status: "error" });
    }
  });

  it("reports error when the read fails", async () => {
    getDoc.mockRejectedValue(new Error("offline"));
    expect(await fetchPublicSettlement(TOKEN)).toEqual({ status: "error" });
  });
});
