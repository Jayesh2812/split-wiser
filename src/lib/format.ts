/** Greyscale ramp — light enough that dark initials stay readable on top. */
export const AVATAR_COLORS = [
  "#f5f5f5", "#d4d4d4", "#b8b8b8", "#a0a0a0", "#8c8c8c",
  "#e5e5e5", "#c4c4c4", "#ababab", "#949494", "#7d7d7d",
];

export const CATEGORIES = [
  "🧾", "🍔", "🛒", "🏠", "🚕", "✈️", "🎬", "⚡",
  "💊", "🎁", "☕", "🍺", "⛽", "🏨", "📱", "🐾",
];

/** Absolute money with the group's currency symbol. */
export function money(currency: string, n: number): string {
  return currency + (Math.abs(Number(n) || 0)).toFixed(2);
}

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = String(name || "?").trim().split(/\s+/);
  const a = (parts[0]?.[0] ?? "?").toUpperCase();
  const b = parts[1]?.[0]?.toUpperCase() ?? "";
  return a + b;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function safeName(s: string): string {
  return (
    String(s || "group")
      .replace(/[^\w-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "group"
  );
}

export function dateStamp(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
