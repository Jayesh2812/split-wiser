/**
 * Where you are, kept in the URL so a refresh — or restoring the PWA — lands in
 * the same place. Query params rather than a path, so this works with the
 * relative base the app is built with and needs no server rewrites.
 */
const GROUP = "g";
const TAB = "t";

export interface Route {
  group: string | null;
  tab: string | null;
}

export function readRoute(): Route {
  try {
    const q = new URLSearchParams(window.location.search);
    return { group: q.get(GROUP) || null, tab: q.get(TAB) || null };
  } catch {
    return { group: null, tab: null };
  }
}

/**
 * Replaces rather than pushes: the goal is surviving a refresh, and pushing a
 * history entry per tab tap would turn Back into a tab-by-tab rewind.
 */
export function writeRoute(group: string | null, tab: string): void {
  try {
    const url = new URL(window.location.href);
    if (group) url.searchParams.set(GROUP, group);
    else url.searchParams.delete(GROUP);
    url.searchParams.set(TAB, tab);
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState({}, "", next);
    }
  } catch {
    /* history unavailable in some embedded webviews — position just isn't kept */
  }
}
