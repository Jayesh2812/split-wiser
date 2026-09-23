// @vitest-environment jsdom
/**
 * Cloud-mode suite: Firebase is mocked as configured and a fake signed-in user
 * is supplied, so the shared-group flow is exercised with no network access.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { AuthUser, Group } from "./types";

const USER: AuthUser = {
  uid: "u1",
  name: "Alex Doe",
  email: "alex@example.com",
  photoURL: null,
};

vi.mock("./lib/firebase", () => ({
  isCloudConfigured: () => true,
  // Only memberEmails.ts reaches for the raw Firebase auth object, and only to
  // mint an ID token for the lookup endpoint. Everything else goes via ./lib/auth.
  getAuthOrNull: () => ({
    currentUser: signedIn ? { getIdToken: async () => "id-token" } : null,
  }),
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
  lookupInviteCode: vi.fn(async (code: string) => {
    if (code !== "XY7K2M") return { ok: false as const, reason: "not-found" as const };
    return { ok: true as const, code, groupId: "cloud1", groupName: "Goa Trip" };
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
  replaceCloudMember: vi.fn(async () => {}),
  updateGroupMeta: vi.fn(async () => {}),
  deleteSharedGroup: vi.fn(async () => {}),
  leaveSharedGroup: vi.fn(async () => {}),
  makeInviteCode: () => "XY7K2M",
  makePublicToken: () => "tok0000000000000000001",
  // repo.ts does `import * as cloud`, so anything missing here is undefined at
  // call time rather than a module-resolution error.
  publishSettlement: vi.fn(async (g: Group) => {
    const token = g.publicToken || "tok0000000000000000001";
    const publishedAt = 1_700_000_000_000;
    const target = cloudGroups.find((x) => x.id === g.id);
    if (target) {
      target.publicToken = token;
      target.publishedAt = publishedAt;
      target.publishedFingerprint = "deadbeefdeadbeef";
      emit();
    }
    return { token, publishedAt };
  }),
  unpublishSettlement: vi.fn(async (g: Group) => {
    const target = cloudGroups.find((x) => x.id === g.id);
    if (target) {
      target.publicToken = null;
      target.publishedAt = null;
      target.publishedFingerprint = null;
      emit();
    }
  }),
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
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

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
    // Cloud groups are not part of local JSON backups.
    expect(screen.queryByText("Backup JSON")).toBeNull();

    // The code itself lives with the rest of membership, on the Members tab.
    fireEvent.click(screen.getByRole("button", { name: /Manage members/ }));
    expect(screen.getByText("XY7K2M")).toBeTruthy();
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

  it("names the group and asks for confirmation before joining by code", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));

    fireEvent.change(screen.getByPlaceholderText("ABC123"), { target: { value: "xy7k2m" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Confirmation step names the group; nothing has been joined yet.
    await waitFor(() => expect(screen.getByText("Join this group?")).toBeTruthy());
    expect(screen.getByText("Goa Trip")).toBeTruthy();
    expect(cloud.joinByInviteCode).not.toHaveBeenCalled();
    // Code is normalised to upper case before lookup.
    expect(vi.mocked(cloud.lookupInviteCode).mock.calls[0]![0]).toBe("XY7K2M");

    fireEvent.click(screen.getByRole("button", { name: "Join group" }));
    await waitFor(() => expect(cloud.joinByInviteCode).toHaveBeenCalledOnce());
    expect(vi.mocked(cloud.joinByInviteCode).mock.calls[0]![0]).toBe("XY7K2M");
  });

  it("backs out of the confirmation without joining", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));
    fireEvent.change(screen.getByPlaceholderText("ABC123"), { target: { value: "XY7K2M" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Join this group?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByPlaceholderText("ABC123")).toBeTruthy();
    expect(cloud.joinByInviteCode).not.toHaveBeenCalled();
  });

  it("opens an invite link straight into the confirmation, then clears the URL", async () => {
    window.history.replaceState({}, "", "/?join=xy7k2m");
    render(<App />);

    // No code entry — the link resolves itself and names the group.
    await waitFor(() => expect(screen.getByText("Join this group?")).toBeTruthy());
    expect(screen.getByText("Goa Trip")).toBeTruthy();
    expect(vi.mocked(cloud.lookupInviteCode).mock.calls[0]![0]).toBe("XY7K2M");
    expect(cloud.joinByInviteCode).not.toHaveBeenCalled();

    // The join param is dropped so a refresh doesn't re-prompt. Other params
    // remain: the app also keeps the current group and tab in the URL.
    expect(new URLSearchParams(window.location.search).has("join")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Join group" }));
    await waitFor(() => expect(cloud.joinByInviteCode).toHaveBeenCalledOnce());
  });

  it("asks an invite-link visitor to sign in first", async () => {
    signedIn = null;
    window.history.replaceState({}, "", "/?join=XY7K2M");
    render(<App />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(cloud.lookupInviteCode).not.toHaveBeenCalled();
  });

  it("reports an unknown invite code", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));
    fireEvent.change(screen.getByPlaceholderText("ABC123"), { target: { value: "NOPE12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("No group found for that code.")).toBeTruthy());
    expect(cloud.joinByInviteCode).not.toHaveBeenCalled();
  });

  it("asks an anonymous visitor to sign in before joining", async () => {
    signedIn = null;
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(screen.getByText("Join with code"));
    // Sign-in is the only path forward — no code entry, no join button.
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("ABC123")).toBeNull();
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
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

describe("App — publishing a final settlement", () => {
  /** Seed a shared group straight through the snapshot listener. */
  const seed = (patch: Partial<Group> = {}) => {
    cloudGroups.push({
      id: "cloud1",
      name: "Goa Trip",
      currency: "₹",
      createdAt: 0,
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_sam", name: "Sam", uid: null },
      ],
      transactions: [],
      kind: "shared",
      ownerUid: "u1",
      memberUids: ["u1"],
      inviteCode: "XY7K2M",
      ...patch,
    });
  };

  const openSettings = () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  };

  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("offers publishing to the owner of a shared group", () => {
    seed();
    openSettings();
    expect(screen.getByRole("button", { name: /Publish settlement/ })).toBeTruthy();
  });

  it("publishes without sending any group secret to the public document", async () => {
    seed();
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /Publish settlement/ }));

    await waitFor(() => expect(cloud.publishSettlement).toHaveBeenCalledOnce());
    const [, snapshot, fp] = vi.mocked(cloud.publishSettlement).mock.calls[0]!;
    const json = JSON.stringify(snapshot);
    for (const secret of ["XY7K2M", "u1", "mem_u1", "mem_sam", "cloud1", "alex@example.com"]) {
      expect(json, `snapshot must not contain ${secret}`).not.toContain(secret);
    }
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("shows the public link once published", async () => {
    seed({ publicToken: "tok0000000000000000001", publishedAt: 1_700_000_000_000 });
    openSettings();
    const link = screen.getByText(/\/s\/tok0000000000000000001$/);
    // Scoped: the invite block above has its own "Copy link" button.
    const block = within(link.closest(".field") as HTMLElement);
    expect(block.getByRole("button", { name: /Copy link/ })).toBeTruthy();
    expect(block.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  it("warns and offers Republish when the group no longer matches the page", () => {
    seed({
      publicToken: "tok0000000000000000001",
      publishedAt: 1_700_000_000_000,
      publishedFingerprint: "0000000000000000", // deliberately not the current snapshot
    });
    openSettings();
    expect(screen.getByText(/no longer matches this group/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Republish/ })).toBeTruthy();
  });

  it("stays quiet when the published page is up to date", async () => {
    const { buildSnapshot, fingerprint } = await import("./lib/snapshot");
    seed();
    // Fingerprint the group exactly as the app will, so nothing is stale.
    const g = cloudGroups[0]!;
    g.publicToken = "tok0000000000000000001";
    g.publishedAt = 1_700_000_000_000;
    g.publishedFingerprint = fingerprint(buildSnapshot(g, false));

    openSettings();
    expect(screen.queryByText(/no longer matches this group/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Republish/ })).toBeNull();
    expect(screen.getByText(/^Published /)).toBeTruthy();
  });

  it("stops sharing on request", async () => {
    seed({ publicToken: "tok0000000000000000001", publishedAt: 1_700_000_000_000 });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(cloud.unpublishSettlement).toHaveBeenCalledOnce());
  });

  it("gives a non-owner member disclosure but no controls", () => {
    seed({
      ownerUid: "u2",
      memberUids: ["u1", "u2"],
      publicToken: "tok0000000000000000001",
      publishedAt: 1_700_000_000_000,
    });
    openSettings();
    expect(screen.getByText(/owner has published/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish settlement/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
    // Nor either destructive option: leaving moved to the Members tab, and
    // deleting is the owner's alone.
    expect(screen.queryByRole("button", { name: "Leave this group" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete this group/ })).toBeNull();
  });

  it("refuses to publish while offline", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    seed();
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /Publish settlement/ }));
    await waitFor(() => expect(screen.getByText(/You're offline/)).toBeTruthy());
    expect(cloud.publishSettlement).not.toHaveBeenCalled();
    onLine.mockRestore();
  });
});

describe("App — the Members tab", () => {
  const seed = (patch: Partial<Group> = {}) => {
    cloudGroups.push({
      id: "cloud1",
      name: "Goa Trip",
      currency: "₹",
      createdAt: 0,
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_sam", name: "Sam", uid: null },
      ],
      transactions: [],
      kind: "shared",
      ownerUid: "u1",
      memberUids: ["u1"],
      inviteCode: "XY7K2M",
      ...patch,
    });
  };

  const openMembers = () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
  };

  it("shows a signed-in member's email and the invite code", () => {
    seed();
    openMembers();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText("XY7K2M")).toBeTruthy();
    // A name-only participant has no address of their own to show.
    const sam = screen
      .getByText("Sam")
      .closest(".member-row") as HTMLElement;
    expect(within(sam).getByText("No email yet")).toBeTruthy();
  });

  it("backfills the signed-in user's own email when the group has none", async () => {
    seed({ members: [{ id: "mem_u1", name: "Alex Doe", uid: "u1" }] });
    openMembers();
    await waitFor(() => expect(cloud.replaceCloudMember).toHaveBeenCalledOnce());
    const [, , next] = vi.mocked(cloud.replaceCloudMember).mock.calls[0]!;
    expect(next.email).toBe("alex@example.com");
  });

  it("writes nothing when the stored email already matches the account", async () => {
    seed();
    openMembers();
    await waitFor(() => expect(screen.getByText("alex@example.com")).toBeTruthy());
    expect(cloud.replaceCloudMember).not.toHaveBeenCalled();
  });

  it("offers a server lookup for members who never shared an address", async () => {
    seed({
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_u2", name: "Priya", uid: "u2" },
        { id: "mem_sam", name: "Sam", uid: null },
      ],
      memberUids: ["u1", "u2"],
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, filled: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    openMembers();

    // Sam is name-only and has no account to look up, so only Priya is counted.
    expect(screen.getByText(/1 member hasn't shared an email yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fetch emails/ }));
    await waitFor(() => expect(screen.getByText("Filled in 1 email")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("says so plainly when no lookup endpoint is deployed", async () => {
    seed({
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_u2", name: "Priya", uid: "u2" },
      ],
      memberUids: ["u1", "u2"],
    });
    // A static host answers the missing route with the app shell.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );
    openMembers();
    fireEvent.click(screen.getByRole("button", { name: /Fetch emails/ }));
    await waitFor(() => expect(screen.getByText(/isn't set up on this deployment/)).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it("offers the lookup to the owner alone", () => {
    seed({
      ownerUid: "u2", // signed-in user u1 is an ordinary member here
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_u2", name: "Priya", uid: "u2" },
      ],
      memberUids: ["u1", "u2"],
    });
    openMembers();
    expect(screen.queryByRole("button", { name: /Fetch emails/ })).toBeNull();
    expect(screen.queryByText(/hasn't shared an email yet/)).toBeNull();
  });

  it("explains a refusal aimed at a non-owner", async () => {
    seed({
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1", email: "alex@example.com" },
        { id: "mem_u2", name: "Priya", uid: "u2" },
      ],
      memberUids: ["u1", "u2"],
    });
    // The endpoint is the thing that actually enforces it, so the UI has to
    // handle being told no even when it believed otherwise.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, reason: "not-admin" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    openMembers();
    fireEvent.click(screen.getByRole("button", { name: /Fetch emails/ }));
    await waitFor(() =>
      expect(screen.getByText("Only the group's owner can fetch emails.")).toBeTruthy(),
    );
    vi.unstubAllGlobals();
  });

  it("hides the lookup once everyone's address is in", () => {
    seed();
    openMembers();
    expect(screen.queryByRole("button", { name: /Fetch emails/ })).toBeNull();
  });

  it("is where a non-owner leaves the group", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    seed({ ownerUid: "u2", memberUids: ["u1", "u2"] });
    openMembers();
    fireEvent.click(screen.getByRole("button", { name: "Leave this group" }));
    await waitFor(() => expect(cloud.leaveSharedGroup).toHaveBeenCalledOnce());
  });
});

describe("App — who may set the settlement mode", () => {
  /** Seed a shared group and open its Settle Up tab. */
  const openSettle = (patch: Partial<Group> = {}) => {
    cloudGroups.push({
      id: "cloud1",
      name: "Goa Trip",
      currency: "₹",
      createdAt: 0,
      members: [
        { id: "mem_u1", name: "Alex Doe", uid: "u1" },
        { id: "mem_u2", name: "Sam", uid: "u2" },
      ],
      transactions: [],
      kind: "shared",
      ownerUid: "u1",
      memberUids: ["u1", "u2"],
      inviteCode: "XY7K2M",
      ...patch,
    });
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
  };

  const modeSwitch = () =>
    document.querySelector<HTMLInputElement>(".settle-mode .switch input")!;

  it("lets the owner toggle the mode and writes it to the group", async () => {
    openSettle();
    const box = modeSwitch();
    expect(box.disabled).toBe(false);

    fireEvent.click(box);
    await waitFor(() => expect(cloud.updateGroupMeta).toHaveBeenCalledOnce());
    const [groupId, patch] = vi.mocked(cloud.updateGroupMeta).mock.calls[0]!;
    expect(groupId).toBe("cloud1");
    expect(patch).toEqual({ greedy: true });
  });

  it("shows a member the mode but will not let them change it", () => {
    openSettle({ ownerUid: "u2", greedy: true });
    const box = modeSwitch();
    expect(box.disabled).toBe(true);
    // Still reports the group's mode — disabled must not mean uninformative.
    expect(box.checked).toBe(true);
    expect(screen.getByText("The group's admin sets this for everyone.")).toBeTruthy();
  });

  it("writes nothing when a member's click is ignored", () => {
    openSettle({ ownerUid: "u2" });
    fireEvent.click(modeSwitch());
    expect(cloud.updateGroupMeta).not.toHaveBeenCalled();
  });

  it("gives every member the same plan regardless of their device preference", () => {
    // The old device-wide toggle is on, but a shared group must ignore it.
    localStorage.setItem(
      "splitwiser.state.v1",
      JSON.stringify({ schema: 1, activeGroupId: null, settings: { greedyMode: true }, groups: [] }),
    );
    openSettle({ ownerUid: "u2" });
    expect(modeSwitch().checked).toBe(false);
  });

  it("leaves the owner free to set the mode on their own solo group", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create your first group"));
    fireEvent.click(screen.getByText("Just me tracking"));
    fireEvent.change(document.querySelector<HTMLTextAreaElement>("textarea")!, {
      target: { value: "Alex, Sam" },
    });
    fireEvent.click(screen.getByText("Create group"));
    fireEvent.click(screen.getByRole("tab", { name: "Settle Up" }));
    expect(modeSwitch().disabled).toBe(false);
  });
});
