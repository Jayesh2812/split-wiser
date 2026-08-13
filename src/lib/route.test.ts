// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import type { Group } from "../types";
import {
  findGroupBySlug,
  groupSlug,
  publicSettlementLink,
  publicSettlementPath,
  readGroupRoute,
  readRoute,
  writeRoute,
} from "./route";

const at = (path: string) => window.history.replaceState({}, "", path);

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function group(id: string, name: string): Group {
  return {
    id,
    name,
    currency: "₹",
    kind: "local",
    createdAt: 0,
    members: [],
    transactions: [],
  };
}

describe("readRoute — published settlements", () => {
  it("recognises /s/<token>", () => {
    at("/s/tok0000000000000000001");
    expect(readRoute()).toEqual({ kind: "public", token: "tok0000000000000000001" });
  });

  it("treats a bare /s or /s/ as public with an empty token", () => {
    at("/s");
    expect(readRoute()).toEqual({ kind: "public", token: "" });
    at("/s/");
    expect(readRoute()).toEqual({ kind: "public", token: "" });
  });

  it("wins over the legacy ?g=&t= form and over stray query params", () => {
    at("/s/tok0000000000000000001?join=XY7K2M&g=grp_1&t=balances");
    expect(readRoute()).toEqual({ kind: "public", token: "tok0000000000000000001" });
  });

  it("ignores anything past the token", () => {
    at("/s/tok0000000000000000001/extra/junk");
    expect(readRoute()).toEqual({ kind: "public", token: "tok0000000000000000001" });
  });
});

describe("readRoute — group routes still work", () => {
  it("parses /<slug>/<tab>", () => {
    at("/goa-trip/balances");
    expect(readRoute()).toEqual({ kind: "group", slug: "goa-trip", tab: "balances" });
  });

  it("parses the root", () => {
    at("/");
    expect(readRoute()).toEqual({ kind: "group", slug: null, tab: null });
  });

  it("still honours the legacy query form", () => {
    at("/?g=grp_1&t=settle");
    expect(readRoute()).toEqual({ kind: "group", slug: "grp_1", tab: "settle" });
  });

  it("does not mistake a slug merely starting with s for the public route", () => {
    at("/settle-up-trip/balances");
    expect(readRoute()).toEqual({ kind: "group", slug: "settle-up-trip", tab: "balances" });
  });
});

describe("readGroupRoute", () => {
  it("reports no position on a published-settlement URL", () => {
    at("/s/tok0000000000000000001");
    expect(readGroupRoute()).toEqual({ slug: null, tab: null });
  });

  it("passes a group route straight through", () => {
    at("/goa-trip/settle");
    expect(readGroupRoute()).toEqual({ slug: "goa-trip", tab: "settle" });
  });
});

describe("reserved slugs", () => {
  it("never lets a group claim the /s prefix", () => {
    const g = group("grp_a1b4", "S");
    const slug = groupSlug(g, [g]);
    expect(slug).not.toBe("s");
    expect(slug).toBe("s-a1b4");
  });

  it("still resolves the suffixed slug back to the group", () => {
    const g = group("grp_a1b4", "S");
    expect(findGroupBySlug([g], groupSlug(g, [g]))).toBe("grp_a1b4");
  });

  it("writes a path for such a group that does not read back as public", () => {
    const g = group("grp_a1b4", "S");
    writeRoute(g, [g], "balances");
    expect(readRoute().kind).toBe("group");
    expect(window.location.pathname).toBe("/s-a1b4/balances");
  });

  it("leaves the existing clash-suffix behaviour intact", () => {
    const a = group("grp_1111", "Trip");
    const b = group("grp_2222", "Trip");
    expect(groupSlug(a, [a, b])).toBe("trip-1111");
    expect(groupSlug(b, [a, b])).toBe("trip-2222");
    // No clash, no suffix.
    expect(groupSlug(a, [a])).toBe("trip");
  });
});

describe("link helpers", () => {
  it("builds a path and an absolute link", () => {
    expect(publicSettlementPath("tok1")).toBe("/s/tok1");
    expect(publicSettlementLink("tok1")).toBe(`${window.location.origin}/s/tok1`);
  });

  it("round-trips through readRoute", () => {
    at(publicSettlementPath("tok0000000000000000001"));
    expect(readRoute()).toEqual({ kind: "public", token: "tok0000000000000000001" });
  });
});
