export type SplitType = "equal" | "shares" | "exact";

/** How a group is stored and who can write to it. */
export type GroupKind = "local" | "shared";

export interface Member {
  id: string;
  name: string;
  /**
   * Firebase uid of the real person occupying this slot.
   * Only set in shared groups; always undefined in solo groups.
   */
  uid?: string | null;
}

export interface Split {
  type: SplitType;
  /** member ids participating in this expense */
  among: string[];
  /** per-member weight (shares) or amount (exact); ignored for equal */
  shares: Record<string, number>;
}

/** How often an expense repeats. Absent means one-off. */
export type Recurrence = "weekly" | "monthly";

export interface Transaction {
  id: string;
  description: string;
  category: string; // emoji
  /** In `currency` if set, otherwise in the group's currency. */
  amount: number;
  date: string; // YYYY-MM-DD
  note: string;
  /**
   * Member who paid. Remains the single source of truth for one-payer expenses;
   * when `payers` is set this is the largest contributor, kept so that older
   * clients and existing queries still read something sensible.
   */
  paidBy: string;
  /**
   * Several people paying for one expense, as member id -> amount in `amount`'s
   * currency. Absent for the common single-payer case. Must sum to `amount`.
   */
  payers?: Record<string, number>;
  /**
   * Currency this transaction was actually paid in, when it differs from the
   * group's. Absent means the group currency.
   */
  currency?: string;
  /** Group-currency units per unit of `currency`. Absent means 1. */
  rate?: number;
  /** Set on a template expense that repeats; instances carry `repeatOf`. */
  recurrence?: Recurrence;
  /** Id of the recurring template this instance was generated from. */
  repeatOf?: string;
  createdAt: number;
  /** Last edit, used to pick a winner when a concurrent edit duplicates a row. */
  updatedAt?: number;
  /** uid of whoever last edited it (shared groups only). */
  updatedByUid?: string | null;
  split: Split;
  /** uid of whoever recorded it (shared groups only) — for attribution. */
  addedByUid?: string | null;
  /**
   * "payment" marks a settlement — one member repaying another. Deliberately
   * ABSENT for expenses: cloud.ts removes transactions with arrayRemove(), which
   * needs an exact match against documents written before this field existed.
   */
  kind?: "payment";
}

export interface Group {
  id: string;
  name: string;
  currency: string;
  createdAt: number;
  members: Member[];
  transactions: Transaction[];

  /** "local" (default, offline-only) or "shared" (Firestore-backed). */
  kind: GroupKind;
  /* ---- shared-group fields (undefined for local groups) ---- */
  ownerUid?: string | null;
  /** uids allowed to read/write this group — mirrors members[].uid. */
  memberUids?: string[];
  /** short code others type to join */
  inviteCode?: string | null;
}

export interface Settings {
  greedyMode: boolean;
}

export interface AppState {
  schema: number;
  activeGroupId: string | null;
  settings: Settings;
  groups: Group[];
}

/** One suggested payment in a settlement plan. */
export interface Transfer {
  from: string; // member id (payer)
  to: string; // member id (receiver)
  amount: number;
}

/** A settlement being recorded: one member repaying another. */
export interface PaymentDraft {
  from: string; // member id paying
  to: string; // member id receiving
  amount: number;
  date: string;
  note: string;
}

/** Draft used by the add/edit transaction form. */
export interface TxDraft {
  description: string;
  category: string;
  amount: number;
  date: string;
  note: string;
  paidBy: string;
  split: Split;
  payers?: Record<string, number>;
  currency?: string;
  rate?: number;
  recurrence?: Recurrence;
}

/** Minimal shape of the signed-in Google user we care about. */
export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
}
