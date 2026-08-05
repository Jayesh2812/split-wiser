// @vitest-environment jsdom
/**
 * Offline-mode suite: Firebase is forced OFF so we verify the app still behaves
 * exactly as it did before cloud sync existed. Mocking (rather than relying on
 * the absence of .env.local) keeps this deterministic on any machine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";

vi.mock("./lib/firebase", () => ({
  isCloudConfigured: () => false,
  getAuthOrNull: () => null,
  getDbOrNull: () => null,
}));

const { App } = await import("./App");
const { resetAll } = await import("./lib/store");

beforeEach(() => {
  localStorage.clear();
  resetAll();
});
afterEach(cleanup);

/** Walk the "new group" flow, choosing the solo option. */
function createSoloGroup(name: string, memberNames: string) {
  fireEvent.click(screen.getByText("Create your first group"));
  // Step 1: pick one of the two ways.
  fireEvent.click(screen.getByText("Just me tracking"));
  // Step 2: fill the form.
  if (name) {
    fireEvent.change(screen.getByPlaceholderText("e.g. Goa Trip, Flatmates"), {
      target: { value: name },
    });
  }
  fireEvent.change(document.querySelector<HTMLTextAreaElement>("textarea")!, {
    target: { value: memberNames },
  });
  fireEvent.click(screen.getByText("Create group"));
}

/** Add an equally-split expense and wait for the modal to close (saves are async). */
async function addExpense(desc: string, amount: string) {
  fireEvent.click(screen.getByRole("button", { name: "＋ Add" }));
  fireEvent.change(screen.getByPlaceholderText("e.g. Dinner, Cab, Groceries"), {
    target: { value: desc },
  });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.queryByText("Add transaction")).toBeNull());
}

describe("App — offline mode (no Firebase)", () => {
  it("shows the empty state on first run", () => {
    render(<App />);
    expect(screen.getByText("Welcome to Splitwiser")).toBeTruthy();
  });

  it("offers both ways to create a group", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    expect(screen.getByText("How do you want to split?")).toBeTruthy();
    expect(screen.getByText("Just me tracking")).toBeTruthy();
    expect(screen.getByText("Invite real people")).toBeTruthy();
  });

  it("degrades gracefully: shared groups disabled, solo still works", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    const shared = screen.getByText("Invite real people").closest("button") as HTMLButtonElement;
    const solo = screen.getByText("Just me tracking").closest("button") as HTMLButtonElement;
    expect(shared.disabled).toBe(true);
    expect(solo.disabled).toBe(false);
    expect(screen.getByText("Cloud sync not configured")).toBeTruthy();
  });

  it("hides the account button when Firebase is absent", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });

  it("creates a solo group, adds an expense, and computes balances + settlement", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");

    expect(screen.getByText("Trip")).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();

    await addExpense("Dinner", "100");

    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText(/Alex paid/)).toBeTruthy();

    // Balances: Alex is owed 50, Sam owes 50
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    const alexCard = screen.getByText("Alex").closest(".balance-card") as HTMLElement;
    const samCard = screen.getByText("Sam").closest(".balance-card") as HTMLElement;
    expect(within(alexCard).getByText("₹50.00")).toBeTruthy();
    expect(within(alexCard).getByText("gets back")).toBeTruthy();
    expect(within(samCard).getByText("₹50.00")).toBeTruthy();
    expect(within(samCard).getByText("owes")).toBeTruthy();

    // Settle: one transfer Sam -> Alex of 50
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    const settleItem = document.querySelector(".settle-item") as HTMLElement;
    const chips = settleItem.querySelectorAll(".chip");
    expect(chips[0]!.textContent).toBe("Sam");
    expect(chips[1]!.textContent).toBe("Alex");
    expect(within(settleItem).getByText("₹50.00")).toBeTruthy();
  });

  it("labels a solo group as offline-only and offers no invite code", () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Solo group/)).toBeTruthy();
    expect(document.querySelector(".invite-code")).toBeNull();
    // Backup/restore stays available for local data.
    expect(screen.getByText("💾 Backup JSON")).toBeTruthy();
  });

  it("toggles greedy settlement mode", () => {
    render(<App />);
    createSoloGroup("", "Alex\nSam");
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    const toggle = document.querySelector<HTMLInputElement>(".switch input")!;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/fewest possible payments/)).toBeTruthy();
  });
});
