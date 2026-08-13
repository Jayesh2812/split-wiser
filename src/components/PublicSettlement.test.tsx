// @vitest-environment jsdom
/**
 * The published-settlement page. Two of these tests are structural rather than
 * cosmetic, and are the real point of the file: the page must not rewrite the URL
 * (which would destroy the token on refresh) and must not touch the app store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { PublicFetch } from "../lib/publicSettlement";

const fetchPublicSettlement = vi.fn<(token: string) => Promise<PublicFetch>>();

vi.mock("../lib/publicSettlement", () => ({
  fetchPublicSettlement: (token: string) => fetchPublicSettlement(token),
  PUBLIC_SETTLEMENTS: "public_settlements",
  PUBLIC_SETTLEMENT_REFS: "public_settlement_refs",
  isValidToken: () => true,
}));

const { PublicSettlement } = await import("./PublicSettlement");

const TOKEN = "tok0000000000000000001";

const doc = () => ({
  v: 1 as const,
  name: "Goa Trip",
  currency: "₹",
  mode: "direct" as const,
  publishedAt: Date.UTC(2026, 7, 7, 9, 30),
  totals: { total: 420.5, count: 3, members: 2 },
  balances: [
    { name: "Alex", net: 120.25 },
    { name: "Sam", net: -120.25 },
    { name: "Jordan", net: 0 },
  ],
  transfers: [{ from: "Sam", to: "Alex", amount: 120.25 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", `/s/${TOKEN}`);
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("PublicSettlement — rendering", () => {
  it("shows the settlement, its stamp, transfers and balances", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });
    render(<PublicSettlement token={TOKEN} />);

    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());
    expect(screen.getByText(/Full and final settlement/)).toBeTruthy();

    // Totals row.
    expect(screen.getByText("₹420.50")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // Who pays whom, by name — each name appears in transfers AND in balances.
    expect(screen.getAllByText("Sam")).toHaveLength(2);
    expect(screen.getAllByText("Alex")).toHaveLength(2);
    // The transfer row names its recipient.
    expect(document.querySelector(".public-to")?.textContent).toBe("Alex");
    expect(screen.getAllByText("₹120.25").length).toBeGreaterThanOrEqual(2);

    // Balance status labels, including the settled member.
    expect(screen.getByText("is owed")).toBeTruthy();
    expect(screen.getByText("owes")).toBeTruthy();
    expect(screen.getByText("settled up")).toBeTruthy();

    expect(screen.getByText(/traceable/)).toBeTruthy();
  });

  it("labels a greedy plan differently", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: { ...doc(), mode: "greedy" } });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText(/Fewest possible payments/)).toBeTruthy());
  });

  it("says everyone is settled up when there are no transfers", async () => {
    fetchPublicSettlement.mockResolvedValue({
      status: "ok",
      doc: { ...doc(), transfers: [], balances: [{ name: "Alex", net: 0 }] },
    });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText("Everyone is settled up.")).toBeTruthy());
  });

  it("titles the document after the group", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(document.title).toBe("Goa Trip — settlement"));
  });

  it("keeps itself out of search results", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => {
      const meta = document.head.querySelector('meta[name="robots"]');
      expect(meta?.getAttribute("content")).toBe("noindex,nofollow");
    });
  });
});

describe("PublicSettlement — terminal states", () => {
  it("explains an unpublished link", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "missing" });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText(/isn’t shared/)).toBeTruthy());
    expect(screen.getByText("Open Splitwiser")).toBeTruthy();
  });

  it("explains a build without cloud sync", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "unavailable" });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText("Not available here")).toBeTruthy());
  });

  it("offers a retry on error and refetches", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "error" });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText(/Couldn’t load/)).toBeTruthy());

    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());
    expect(fetchPublicSettlement).toHaveBeenCalledTimes(2);
  });
});

describe("PublicSettlement — structural guarantees", () => {
  it("never rewrites the URL, so the token survives a refresh", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });

    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());

    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/s/${TOKEN}`);
    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it("renders no app shell and never reads the local store", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });

    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());

    expect(document.querySelector("#app")).toBeNull();
    expect(document.querySelector(".topbar")).toBeNull();
    expect(document.querySelector(".tabs")).toBeNull();
    expect(getItem.mock.calls.flat()).not.toContain("splitwiser.state.v1");
    getItem.mockRestore();
  });

  it("leaves the app with a plain link, not client-side navigation", async () => {
    fetchPublicSettlement.mockResolvedValue({ status: "ok", doc: doc() });
    render(<PublicSettlement token={TOKEN} />);
    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());

    const link = screen.getByText("Open Splitwiser") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/");
  });
});
