// @vitest-environment jsdom
/**
 * The entry-point branch. This is the one piece of the published-settlement
 * feature that no component test can cover, and getting it wrong is silent:
 * mounting <App/> for a /s/<token> visit would run writeRoute and erase the token
 * from the URL, so the link would break on refresh.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./App", () => ({
  App: () => <div data-testid="app-shell" />,
}));

vi.mock("./components/PublicSettlement", () => ({
  PublicSettlement: ({ token }: { token: string }) => (
    <div data-testid="public-page" data-token={token} />
  ),
}));

/** main.tsx reads the route at module scope, so each case needs a fresh import. */
async function mountAt(path: string) {
  window.history.replaceState({}, "", path);
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import("./main");
  // createRoot renders asynchronously in React 18.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("main — entry point routing", () => {
  it("mounts the public page for /s/<token>, never the app", async () => {
    await mountAt("/s/tok0000000000000000001");

    const page = document.querySelector('[data-testid="public-page"]');
    expect(page).toBeTruthy();
    expect(page?.getAttribute("data-token")).toBe("tok0000000000000000001");
    expect(document.querySelector('[data-testid="app-shell"]')).toBeNull();
  });

  it("leaves the token in the URL", async () => {
    await mountAt("/s/tok0000000000000000001");
    expect(window.location.pathname).toBe("/s/tok0000000000000000001");
  });

  it("mounts the app for a group route", async () => {
    await mountAt("/goa-trip/balances");
    expect(document.querySelector('[data-testid="app-shell"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="public-page"]')).toBeNull();
  });

  it("mounts the app at the root", async () => {
    await mountAt("/");
    expect(document.querySelector('[data-testid="app-shell"]')).toBeTruthy();
  });

  it("mounts the public page even for an empty token, rather than falling through", async () => {
    // Falling through to <App/> would be worse than an error page: writeRoute
    // would rewrite the URL and the visitor would lose what they pasted.
    await mountAt("/s/");
    expect(document.querySelector('[data-testid="public-page"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="app-shell"]')).toBeNull();
  });
});
