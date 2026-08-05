import type { Group } from "../types";

/**
 * Where you are, kept in the URL as `/<group-slug>/<tab>` so a refresh — or a
 * restored PWA — lands in the same place.
 *
 * Paths, not query params, which means the host must rewrite unknown paths to
 * index.html (see vercel.json) and the app must be built with an absolute base,
 * or nested URLs resolve assets against the wrong directory.
 */

/** Readable, URL-safe form of a group name. */
export function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * The path segment for a group. Names are neither unique nor guaranteed to be
 * URL-safe, so a clashing slug gains a short id suffix and an unusable one
 * (empty after slugifying, e.g. a name in a non-Latin script) falls back to the
 * id outright.
 */
export function groupSlug(group: Group, all: Group[]): string {
  const base = slugify(group.name);
  if (!base) return group.id;
  const clashes = all.some((g) => g.id !== group.id && slugify(g.name) === base);
  return clashes ? `${base}-${group.id.slice(-4)}` : base;
}

export interface Route {
  /** First path segment: a group slug, or an id. */
  slug: string | null;
  tab: string | null;
}

export function readRoute(): Route {
  try {
    const parts = window.location.pathname.split("/").filter(Boolean);
    // Tolerate the older ?g=&t= form so existing links keep working.
    const q = new URLSearchParams(window.location.search);
    const legacyGroup = q.get("g");
    const legacyTab = q.get("t");
    return {
      slug: parts[0] ?? legacyGroup ?? null,
      tab: parts[1] ?? legacyTab ?? null,
    };
  } catch {
    return { slug: null, tab: null };
  }
}

/** Which group a path segment refers to, if any. */
export function findGroupBySlug(groups: Group[], slug: string | null): string | null {
  if (!slug) return null;
  const bySlug = groups.find((g) => groupSlug(g, groups) === slug);
  if (bySlug) return bySlug.id;
  // A renamed group, or an id used directly — better than dumping the user at
  // the default group because the name changed under a shared link.
  return groups.find((g) => g.id === slug)?.id ?? null;
}

/**
 * Replaces rather than pushes: the goal is surviving a refresh, and pushing an
 * entry per tab tap would turn Back into a tab-by-tab rewind.
 */
export function writeRoute(group: Group | null, all: Group[], tab: string): void {
  try {
    const path = group ? `/${groupSlug(group, all)}/${tab}` : "/";
    // Preserve any query string (?join= is handled and cleared separately).
    const next = path + window.location.search + window.location.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) window.history.replaceState({}, "", next);
  } catch {
    /* history unavailable in some embedded webviews — position just isn't kept */
  }
}
