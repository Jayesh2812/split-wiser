// @vitest-environment jsdom
/**
 * The transaction filters. The behaviour worth pinning down is the combining
 * rule: several chips inside one group are an OR, and the two groups AND with
 * each other and with the search box.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Group, Transaction } from "../types";
import { TransactionsPanel } from "./TransactionsPanel";

afterEach(cleanup);

const tx = (t: Partial<Transaction> & Pick<Transaction, "id" | "description">): Transaction => ({
  category: "🧾",
  amount: 100,
  date: "2026-09-01",
  note: "",
  paidBy: "a",
  createdAt: 1,
  split: { type: "equal", among: ["a", "b", "c"], shares: {} },
  ...t,
});

const group = (): Group => ({
  id: "g1",
  name: "Goa Trip",
  currency: "₹",
  createdAt: 1,
  kind: "local",
  members: [
    { id: "a", name: "Alex" },
    { id: "b", name: "Sam" },
    { id: "c", name: "Riya" },
  ],
  transactions: [
    tx({ id: "t1", description: "Dinner", category: "🍔", paidBy: "a" }),
    tx({ id: "t2", description: "Cab", category: "🚕", paidBy: "b" }),
    tx({ id: "t3", description: "Lunch", category: "🍔", paidBy: "b" }),
    tx({ id: "t4", description: "Hotel", category: "🏨", paidBy: "a", payers: { a: 60, c: 40 } }),
  ],
});

const noop = () => {};
const show = (g: Group = group()) =>
  render(<TransactionsPanel group={g} onAdd={noop} onEdit={noop} onNeedMembers={noop} />);

/** Descriptions of the rows currently rendered, in order. */
const rows = () =>
  [...document.querySelectorAll(".tx-item .tx-desc")].map((n) => n.textContent);

const openFilters = () => fireEvent.click(screen.getByRole("button", { name: "Filters" }));

const chipIn = (label: string, name: string) => {
  const heading = screen.getByText(label);
  const groupEl = heading.parentElement!;
  return within(groupEl).getByRole("button", { name: new RegExp(name) });
};

describe("TransactionsPanel filters", () => {
  it("keeps the panel closed until the filter button is tapped", () => {
    show();
    expect(screen.queryByText("Category")).toBeNull();
    openFilters();
    expect(screen.getByText("Category")).toBeTruthy();
    expect(screen.getByText("Paid by")).toBeTruthy();
  });

  it("offers only the categories the group actually uses, with counts", () => {
    show();
    openFilters();
    const chips = [...document.querySelectorAll(".f-chip .f-emoji")].map((n) => n.textContent);
    // Commonest first, then by emoji for a stable order; 🧾 is never used here.
    expect(chips).toEqual(["🍔", "🏨", "🚕"]);
    expect(chipIn("Category", "🍔").textContent).toContain("2");
  });

  it("narrows the list to one category", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🍔"));
    expect(rows()).toEqual(["Dinner", "Lunch"]);
  });

  it("ORs several categories together", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🍔"));
    fireEvent.click(chipIn("Category", "🚕"));
    expect(rows()).toEqual(["Dinner", "Cab", "Lunch"]);
  });

  it("filters by who paid, counting every payer of a split payment", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Paid by", "Riya"));
    // Riya only ever paid part of the hotel, and that still counts.
    expect(rows()).toEqual(["Hotel"]);
  });

  it("ANDs the category and payer groups", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🍔"));
    fireEvent.click(chipIn("Paid by", "Sam"));
    expect(rows()).toEqual(["Lunch"]);
  });

  it("ANDs the filters with the search box", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🍔"));
    fireEvent.change(screen.getByPlaceholderText("Search transactions…"), {
      target: { value: "dinner" },
    });
    expect(rows()).toEqual(["Dinner"]);
  });

  it("badges the button with the number of active filters and clears them", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🍔"));
    fireEvent.click(chipIn("Paid by", "Sam"));
    expect(document.querySelector(".filter-count")!.textContent).toBe("2");
    expect(screen.getByText("1 of 4 shown")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(document.querySelector(".filter-count")).toBeNull();
    expect(rows()).toHaveLength(4);
  });

  it("says so when the filters leave nothing", () => {
    show();
    openFilters();
    fireEvent.click(chipIn("Category", "🚕"));
    fireEvent.click(chipIn("Paid by", "Riya"));
    expect(screen.getByText("No transactions match these filters.")).toBeTruthy();
  });

  it("leaves out members who never paid", () => {
    const g = group();
    g.members.push({ id: "d", name: "Noor" });
    show(g);
    openFilters();
    expect(screen.queryByRole("button", { name: /Noor/ })).toBeNull();
  });

  it("has nothing to offer on an empty group", () => {
    const g = group();
    g.transactions = [];
    show(g);
    openFilters();
    expect(screen.getByText("Nothing to filter yet — add a transaction first.")).toBeTruthy();
  });
});
