/**
 * Monochrome line icons. Every path uses `currentColor`, so an icon inherits the
 * colour of whatever it sits in — that is what keeps the UI black-and-white.
 */
export type IconName =
  | "menu"
  | "close"
  | "settings"
  | "user"
  | "users"
  | "notebook"
  | "link"
  | "download"
  | "print"
  | "save"
  | "folder"
  | "check"
  | "plus"
  | "arrow-right"
  | "google"
  | "wallet"
  | "party"
  | "copy"
  | "share";

const PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>
  ),
  close: (
    <>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.07.07a2 2 0 1 1-2.83-2.83l.07-.07a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 8.9a1.6 1.6 0 0 0-.33-1.76L4.2 7.07a2 2 0 1 1 2.83-2.83l.07.07a1.6 1.6 0 0 0 1.76.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47 1z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
      <path d="M16.5 4.8a3.5 3.5 0 0 1 0 6.7" />
      <path d="M18 15.7c2.5.5 4 2.2 4 5.3" />
    </>
  ),
  notebook: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M9 3v18" />
      <path d="M13 8h3" />
      <path d="M13 12h3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V3h10v5" />
      <path d="M5 8h14a2 2 0 0 1 2 2v6h-4" />
      <path d="M7 16H3v-6a2 2 0 0 1 2-2" />
      <path d="M7 13h10v8H7z" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M9 3v6h6V3" />
      <path d="M8 14h8v7H8z" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  google: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M20.5 11h-8v3h4.3a5 5 0 1 1-1.4-5.2" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
      <path d="M3 8v9a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" />
      <circle cx="16.5" cy="13" r="1.2" />
    </>
  ),
  party: (
    <>
      <path d="M4 20l5.5-13L17 14.5z" />
      <path d="M15 4.5l1-1.5" />
      <path d="M19 8l1.8-.6" />
      <path d="M18.5 3.5l-1 1.8" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5a2 2 0 0 0-2 2v7.5A2.5 2.5 0 0 0 5.5 15" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.3 10.8l7.4-4.3" />
      <path d="M8.3 13.2l7.4 4.3" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  /** Extra classes; `icon` is always applied. */
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
