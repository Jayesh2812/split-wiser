// @vitest-environment jsdom
/**
 * Cloud-mode suite: Firebase is mocked as configured and a fake signed-in user
 * is supplied, so the shared-group flow is exercised with no network access.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { AuthUser, Group } from "./types";

const USER: AuthUser = {
  uid: "u1",
  name: "Alex Doe",
  email: "alex@example.com",
  photoURL: null,
};

vi.mock("./lib/firebase", () => ({
  isCloudConfigured: () => true,
  getAuthOrNull: () => null,
  getDbOrNull: () => null,
}));

let signedIn: AuthUser | null = USER;
const authListeners = new Set<() => void>();

vi.mock("./lib/auth", () => ({
  getUser: () => signedIn,
  isAuthReady: () => true,
  subscribeAuth: (l: () => void) => {
    authListeners.add(l);
    return () => authListeners.delete(l);
  },
  signInWithGoogle: vi.fn(async () => {
    signedIn = USER;
    authListeners.forEach((l) => l());
    return USER;
  }),
  signOutUser: vi.fn(async () => {
    signedIn = null;
    authListeners.forEach((l) => l());
  }),
}));

/** In-memory stand-in for Firestore. */
const cloudGroups: Group[] = [];
let snapshotCb: ((groups: Group[]) => void) | null = null;
const emit = () => snapshotCb?.([...cloudGroups]);

vi.mock("./lib/cloud", () => ({
  createSharedGroup: vi.fn(async (name: string, currency: string, user: AuthUser) => {
    const g: Group = {
      id: "cloud1",
      name,
      currency,
      createdAt: 0,
      members: [{ id: `mem_${user.uid}`, name: user.name, uid: user.uid }],
      transactions: [],
      kind: "shared",
      ownerUid: user.uid,
      memberUids: [user.uid],
      inviteCode: "XY7K2M",
    };
    cloudGroups.push(g);
    emit();
    return g;
  }),
  subscribeMyGroups: vi.fn((_uid: string, cb: (groups: Group[]) => void) => {
    snapshotCb = cb;
    cb([...cloudGroups]);
    return () => {
      snapshotCb = null;
    };
  }),
  joinByInviteCode: vi.fn(async (code: string) => {
    if (code !== "XY7K2M") return { ok: false as const, reason: "not-found" as const };
    return { ok: true as const, groupId: "cloud1", alreadyMember: false };
  }),
  addCloudTransaction: vi.fn(async () => {}),
  updateCloudTransaction: vi.fn(async () => {}),
  deleteCloudTransaction: vi.fn(async () => {}),
  addCloudMember: vi.fn(async () => {}),
  removeCloudMember: vi.fn(async () => {}),
  renameCloudMember: vi.fn(async () => {}),
  updateGroupMeta: vi.fn(async () => {}),
  deleteSharedGroup: vi.fn(async () => {}),
  leaveSharedGroup: vi.fn(async () => {}),
  makeInviteCode: () => "XY7K2M",
}));

const { App } = await import("./App");
const { resetAll } = await import("./lib/store");
const cloud = await import("./lib/cloud");

beforeEach(() => {
  localStorage.clear();
  resetAll();
  cloudGroups.length = 0;
  snapshotCb = null;
  signedIn = USER;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("App — cloud mode (shared groups)", () => {
  it("enables the shared option and shows the account button", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    const shared = screen.getByText("Invite real people").closest("button") as HTMLButtonElement;
    expect(shared.disabled).toBe(false);
    expect(screen.getByText("Google sign-in required")).toBeTruthy();
  });

  it("creates a shared group and surfaces its invite code", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    fireEvent.click(screen.getByText("Invite real people"));

    // Signed in already, so the form offers creation directly.
    fireEvent.change(screen.getByPlaceholderText("e.g. Goa Trip, Flatmates"), {
      target: { value: "Goa Trip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create shared group" }));

    await waitFor(() => expect(cloud.createSharedGroup).toHaveBeenCalledOnce());
    // The creator is a member, and the group is live in the UI.
    await waitFor(() => expect(screen.getByText("Goa Trip")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Shared group/, { selector: "b" })).toBeTruthy();
    expect(screen.getByText("XY7K2M")).toBeTruthy();
    // Cloud groups are not part of local JSON backups.
    expect(screen.queryByText("Backup JSON")).toBeNull();
  });

  it("routes expense writes in a shared group to Firestore", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    fireEvent.click(screen.getByText("Invite real people"));
    fireEvent.click(screen.getByRole("button", { name: "Create shared group" }));
    await waitFor(() => expect(cloud.createSharedGroup).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "＋ Add" }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(cloud.addCloudTransaction).toHaveBeenCalledOnce());
    const [groupId, tx] = vi.mocked(cloud.addCloudTransaction).mock.calls[0]!;
    expect(groupId).toBe("cloud1");
    expect(tx.amount).toBe(60);
    expect(tx.addedByUid).toBe("u1"); // attributed to the signed-in user
  });

  it("joins an existing group with an invite code", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));

    fireEvent.change(screen.getByPlaceholderText("ABC123"), { target: { value: "xy7k2m" } });
    fireEvent.click(screen.getByRole("button", { name: "Join group" }));

    await waitFor(() => expect(cloud.joinByInviteCode).toHaveBeenCalledOnce());
    // Code is normalised to upper case before lookup.
    expect(vi.mocked(cloud.joinByInviteCode).mock.calls[0]![0]).toBe("XY7K2M");
  });

  it("reports an unknown invite code", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));
    fireEvent.change(screen.getByPlaceholderText("ABC123"), { target: { value: "NOPE12" } });
    fireEvent.click(screen.getByRole("button", { name: "Join group" }));
    await waitFor(() => expect(screen.getByText("No group found for that code.")).toBeTruthy());
  });

  it("asks an anonymous visitor to sign in before joining", async () => {
    signedIn = null;
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Join group" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps solo groups working while signed in", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    fireEvent.click(screen.getByText("Just me tracking"));
    fireEvent.change(document.querySelector<HTMLTextAreaElement>("textarea")!, {
      target: { value: "Bob\nCara" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(screen.getByText(/2 members/)).toBeTruthy();
    expect(cloud.createSharedGroup).not.toHaveBeenCalled();
  });
});
