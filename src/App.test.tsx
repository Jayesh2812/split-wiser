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
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

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
    expect(screen.getByText("Backup JSON")).toBeTruthy();
  });

  it("opens settings by tapping the group name", () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    fireEvent.click(screen.getByRole("button", { name: "Settings for Trip" }));
    expect(screen.getByText("Settings")).toBeTruthy();
    // The group-name field is prefilled, which only the Settings sheet renders.
    expect(screen.getByDisplayValue("Trip")).toBeTruthy();
  });

  it("requires two steps to remove a member", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const chipFor = (name: string) =>
      [...document.querySelectorAll<HTMLElement>(".member-chip")].find((c) =>
        c.textContent?.includes(name),
      );

    // First click only arms the confirmation — Sam is still a member.
    fireEvent.click(within(chipFor("Sam")!).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove Sam?")).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();

    // Backing out leaves the member alone.
    fireEvent.click(
      within(chipFor("Sam")!).getByRole("button", { name: "Keep this member" }),
    );
    expect(screen.queryByText("Remove Sam?")).toBeNull();
    expect(screen.getByText(/2 members/)).toBeTruthy();

    // Confirming actually removes.
    fireEvent.click(within(chipFor("Sam")!).getByRole("button", { name: "Remove" }));
    fireEvent.click(
      within(chipFor("Sam")!).getByRole("button", { name: "Confirm removal" }),
    );
    await waitFor(() => expect(chipFor("Sam")).toBeUndefined());
    expect(screen.getByText(/1 members/)).toBeTruthy();
  });

  it("records a partial payment, then the remainder, from the Settle Up tab", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    await addExpense("Dinner", "100");

    // Alex paid 100 split two ways, so Sam owes 50.
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    let item = document.querySelector(".settle-item") as HTMLElement;
    expect(within(item).getByText("₹50.00")).toBeTruthy();

    // Part-pay 20 of the 50.
    fireEvent.click(within(item).getByRole("button", { name: /Record payment from Sam/ }));
    const amount = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    expect(amount.value).toBe("50"); // prefilled with the full suggestion
    fireEvent.change(amount, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.queryByText("Record a payment")).toBeNull());

    // The transfer shrinks rather than disappearing.
    item = document.querySelector(".settle-item") as HTMLElement;
    expect(within(item).getByText("₹30.00")).toBeTruthy();

    // Settle the rest.
    fireEvent.click(within(item).getByRole("button", { name: /Record payment from Sam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getByText("Everyone is settled up.")).toBeTruthy());
  });

  it("keeps settlements out of spending totals and off the expense form", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    await addExpense("Dinner", "100");

    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    const item = document.querySelector(".settle-item") as HTMLElement;
    fireEvent.click(within(item).getByRole("button", { name: /Record payment from Sam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getByText("Everyone is settled up.")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "Transactions" }));
    // Total spent is unchanged — a settlement moves money, it does not spend any.
    const summary = document.querySelector(".tx-summary") as HTMLElement;
    expect(within(summary).getByText("₹100.00")).toBeTruthy();
    expect(within(summary).getByText(/Expenses/)).toBeTruthy();
    expect(within(summary).getByText("1")).toBeTruthy(); // one expense, not two

    // The payment is in history, and reopens as a settlement — not the expense form.
    const row = [...document.querySelectorAll<HTMLElement>(".tx-item")].find((el) =>
      el.textContent?.includes("Settlement"),
    );
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("Sam paid Alex");
    fireEvent.click(row!);
    expect(screen.getByText("Delete payment")).toBeTruthy();
    expect(screen.queryByPlaceholderText("e.g. Dinner, Cab, Groceries")).toBeNull();
  });

  it("filters Settle Up by person and by which side they are on", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam\nJordan");
    // Alex pays 90 for all three, so Sam and Jordan each owe Alex 30.
    await addExpense("Dinner", "90");

    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    const rows = () => [...document.querySelectorAll<HTMLElement>(".settle-item")];
    expect(rows().length).toBe(2); // everyone, by default

    // The picker is collapsed by default — the bar shows the current scope.
    expect(screen.queryByLabelText("Show payments for")).toBeNull();
    // Selected by class: the Record buttons' labels also contain member names.
    const bar = () => document.querySelector<HTMLElement>(".filter-bar")!;
    expect(bar().textContent).toContain("Everyone");

    // Focus Sam: one debt out, nothing in. Option values are member ids.
    fireEvent.click(bar());
    const pick = screen.getByLabelText("Show payments for") as HTMLSelectElement;
    const samId = [...pick.options].find((o) => o.text === "Sam")!.value;
    fireEvent.change(pick, { target: { value: samId } });
    // Choosing collapses the picker again and the bar names the person.
    expect(screen.queryByLabelText("Show payments for")).toBeNull();
    expect(bar().textContent).toContain("Sam");
    expect(rows().length).toBe(1);
    expect(screen.getByText(/Sam pays 1 person/)).toBeTruthy();
    expect(screen.getByText(/receives from 0 people/)).toBeTruthy();

    // Sam receives from nobody.
    fireEvent.click(screen.getByRole("button", { name: "Receiving" }));
    expect(rows().length).toBe(0);
    expect(screen.getByText("Nobody owes Sam.")).toBeTruthy();

    // Alex is the other way round: owed by both, owes nobody.
    fireEvent.click(bar());
    const pick2 = screen.getByLabelText("Show payments for") as HTMLSelectElement;
    const alexId = [...pick2.options].find((o) => o.text === "Alex")!.value;
    fireEvent.change(pick2, { target: { value: alexId } });
    expect(rows().length).toBe(2);
    expect(screen.getByText(/Alex pays 0 people/)).toBeTruthy();
    expect(screen.getByText(/receives from 2 people/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paying" }));
    expect(rows().length).toBe(0);
    expect(screen.getByText("Alex doesn't owe anyone.")).toBeTruthy();

    // The clear button drops back to everyone.
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(rows().length).toBe(2);
    expect(bar().textContent).toContain("Everyone");
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });

  it("records an expense paid by several people", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");

    fireEvent.click(screen.getByRole("button", { name: "＋ Add" }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Several people paid" }));

    // Two contribution inputs appear, one per member.
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".split-row input[type=number]")];
    fireEvent.change(boxes[0]!, { target: { value: "70" } });
    fireEvent.change(boxes[1]!, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByText("Add transaction")).toBeNull());

    // 100 split two ways with 70/30 contributions leaves Alex owed 20.
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    const alexCard = screen.getByText("Alex").closest(".balance-card") as HTMLElement;
    expect(within(alexCard).getByText("₹20.00")).toBeTruthy();
  });

  it("converts an expense paid in another currency", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam");

    fireEvent.click(screen.getByRole("button", { name: "＋ Add" }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Paid in another currency" }));
    fireEvent.change(screen.getByPlaceholderText("EUR"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByPlaceholderText(/1 EUR = /), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByText("Add transaction")).toBeNull());

    // 10 EUR at 90 = 900, so Sam owes Alex 450 in the group currency.
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    const samCard = screen.getByText("Sam").closest(".balance-card") as HTMLElement;
    expect(within(samCard).getByText("₹450.00")).toBeTruthy();
  });

  it("merges a duplicate member, keeping their history", async () => {
    render(<App />);
    createSoloGroup("Trip", "Alex\nSam\nSam");
    await addExpense("Dinner", "90");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const chips = () => [...document.querySelectorAll<HTMLElement>(".member-chip")];
    expect(chips().length).toBe(3);

    // Fold the second Sam into the first.
    const dupes = chips().filter((c) => c.textContent?.includes("Sam"));
    fireEvent.click(within(dupes[1]!).getByRole("button", { name: /^Merge/ }));
    const options = document.querySelector(".merge-options") as HTMLElement;
    fireEvent.click(within(options).getByRole("button", { name: "Sam" }));

    await waitFor(() => expect(chips().length).toBe(2));
    // The expense survived the merge rather than being dropped.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();
  });

  it("keeps the group and tab in the URL, and restores them on reload", async () => {
    const { unmount } = render(<App />);
    createSoloGroup("Trip", "Alex\nSam");
    await addExpense("Dinner", "100");

    const groupId = () => new URLSearchParams(window.location.search).get("g");
    const tabParam = () => new URLSearchParams(window.location.search).get("t");

    expect(groupId()).toBeTruthy();
    expect(tabParam()).toBe("transactions");

    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    expect(tabParam()).toBe("balances");

    // Simulate a refresh: same URL, fresh mount, same state on disk.
    const saved = groupId();
    unmount();
    render(<App />);
    expect(
      (screen.getByRole("tab", { name: "Balances" }) as HTMLElement).className,
    ).toContain("active");
    expect(groupId()).toBe(saved);
  });

  it("ignores an unknown tab in the URL", () => {
    window.history.replaceState({}, "", "/?t=nonsense");
    render(<App />);
    createSoloGroup("Trip", "Alex");
    expect(
      (screen.getByRole("tab", { name: "Transactions" }) as HTMLElement).className,
    ).toContain("active");
  });

  it("toggles greedy settlement mode", () => {
    render(<App />);
    createSoloGroup("", "Alex\nSam");
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    const toggle = document.querySelector<HTMLInputElement>(".switch input")!;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    // The explanation is kept behind an info toggle to save vertical space.
    expect(screen.queryByText(/fewest possible payments/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About settlement modes" }));
    expect(screen.getByText(/fewest possible payments/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About settlement modes" }));
    expect(screen.queryByText(/fewest possible payments/)).toBeNull();
  });
});
