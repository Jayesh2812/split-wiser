/**
 * Invite links. A link is just the app URL carrying `?join=CODE`, so it works
 * with the relative base the PWA is built with and needs no server routing.
 */
const PARAM = "join";

export function inviteLink(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${PARAM}=${encodeURIComponent(code)}`;
}

/** The invite code in the current URL, if any. */
export function readInviteFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(PARAM);
    const code = raw?.trim().toUpperCase();
    return code ? code : null;
  } catch {
    return null;
  }
}

/**
 * Drop the param so a refresh — or the PWA restoring this URL — doesn't
 * re-prompt for a group the user already dealt with.
 */
export function clearInviteFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    /* history is unavailable in some embedded webviews — harmless */
  }
}

/** Copy helper that falls back to a toast-able string when the clipboard is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
