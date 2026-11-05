// @vitest-environment jsdom
// Copyright 2026 Anviq LLC. All rights reserved.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }) };
});
vi.mock("../lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "u2" } } }) },
}));
vi.mock("@anviq/ui-web", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogAction: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  AlertDialogCancel: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  AlertDialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
vi.mock("lucide-react", () => ({ ChevronLeft: () => null }));
vi.mock("./ConfirmIdentityDialog", () => ({
  useIdentityConfirmation: () => ({
    withIdentityConfirmation: <T,>(action: () => Promise<T>) => action(),
    identityDialog: null,
  }),
}));

const rpc = vi.hoisted(() => ({
  organizations: {
    list: vi.fn(),
    personalSpace: vi.fn(),
    myInvitations: vi.fn(),
    acceptInvitation: vi.fn(),
    create: vi.fn(),
    members: vi.fn(),
    invitations: vi.fn(),
    invite: vi.fn(),
    setRole: vi.fn(),
    removeMember: vi.fn(),
    transferOwnership: vi.fn(),
    cancelInvitation: vi.fn(),
    leave: vi.fn(),
    remove: vi.fn(),
    memory: vi.fn(),
    memoryProposals: vi.fn(),
    proposeMemory: vi.fn(),
    decideMemoryProposal: vi.fn(),
    setMemory: vi.fn(),
    events: vi.fn(),
  },
}));
const selectSpace = vi.hoisted(() => vi.fn(() => true));
vi.mock("../lib/rpc", () => ({ rpc, selectSpace }));

import { TeamSettings } from "./TeamSettings";

let container: HTMLDivElement;
let root: Root;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeamSettings />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === name);

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rpc.organizations.list.mockResolvedValue([
    { id: "t1", name: "Acme", role: "admin", memberCount: 2, spaceId: "s-acme" },
  ]);
  rpc.organizations.personalSpace.mockResolvedValue({ spaceId: "s-me" });
  rpc.organizations.myInvitations.mockResolvedValue([]);
  rpc.organizations.members.mockResolvedValue([
    { userId: "u1", name: "Ana", email: "ana@anviq.test", role: "owner", joinedAt: "2026-01-01" },
    { userId: "u2", name: "Ben", email: "ben@anviq.test", role: "admin", joinedAt: "2026-01-02" },
    { userId: "u3", name: "Cy", email: "cy@anviq.test", role: "member", joinedAt: "2026-01-03" },
  ]);
  rpc.organizations.invitations.mockResolvedValue([]);
  rpc.organizations.memory.mockResolvedValue({
    content: "Refunds need a manager",
    revision: 2,
    updatedAt: null,
    canEdit: false,
  });
  rpc.organizations.events.mockResolvedValue([]);
  rpc.organizations.memoryProposals.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TeamSettings", () => {
  it("lists personal and team spaces and switches into a team", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await render();
    expect(container.textContent).toContain("Personal");
    expect(container.textContent).toContain("Acme");
    await act(async () => button("Open")?.click());
    expect(selectSpace).toHaveBeenCalledWith("s-me");
    vi.unstubAllGlobals();
  });

  it("lets an admin invite but not change roles or hand over ownership", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    expect(container.textContent).toContain("ana@anviq.test");
    expect(container.querySelector("select[aria-label='Role']")).toBeNull();
    expect(container.querySelector('[aria-label="Make Ben the owner"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove Ana"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove Ben"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove Cy"]')).not.toBeNull();
  });

  it("asks before removing someone", async () => {
    rpc.organizations.removeMember.mockResolvedValue({ ok: true });
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove Cy"]')?.click(),
    );
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Remove Cy?");
    expect(rpc.organizations.removeMember).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector<HTMLElement>('[role="alertdialog"] button:last-child')?.click(),
    );
    expect(rpc.organizations.removeMember).toHaveBeenCalledWith({
      organizationId: "t1",
      userId: "u3",
    });
  });

  it("offers an invitation addressed to the person", async () => {
    rpc.organizations.myInvitations.mockResolvedValue([
      {
        id: "inv-1",
        organizationName: "Globex",
        inviterName: "Cy",
        role: "member",
        expiresAt: "2026-02-01",
      },
    ]);
    rpc.organizations.acceptInvitation.mockResolvedValue({
      organizationId: "g",
      spaceId: "s-globex",
    });
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    await render();
    expect(container.textContent).toContain("Globex");
    await act(async () => button("Join")?.click());
    expect(rpc.organizations.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
    expect(selectSpace).toHaveBeenCalledWith("s-globex");
    vi.unstubAllGlobals();
  });

  it("shows company memory read-only to a member and editable to an admin", async () => {
    rpc.organizations.setMemory.mockResolvedValue({ revision: 3 });
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    const box = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(box?.value).toBe("Refunds need a manager");
    expect(box?.readOnly).toBe(true);
    expect(button("Save")).toBeUndefined();

    rpc.organizations.memory.mockResolvedValue({
      content: "Refunds need a manager",
      revision: 2,
      updatedAt: null,
      canEdit: true,
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.click();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(false);
  });

  it("lets a member suggest a note and an admin approve what is waiting", async () => {
    rpc.organizations.proposeMemory.mockResolvedValue({ id: "p1" });
    rpc.organizations.decideMemoryProposal.mockResolvedValue({ ok: true });
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Suggest a note"]');
    expect(field).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "Greet people by name");
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = field?.closest("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(rpc.organizations.proposeMemory).toHaveBeenCalledWith({
      organizationId: "t1",
      content: "Greet people by name",
    });
  });

  it("shows an admin each waiting suggestion with Approve and Reject", async () => {
    rpc.organizations.memory.mockResolvedValue({
      content: "",
      revision: 0,
      updatedAt: null,
      canEdit: true,
    });
    rpc.organizations.memoryProposals.mockResolvedValue([
      {
        id: "p1",
        content: "Greet people by name",
        proposedBy: "Ben",
        mine: false,
        createdAt: "2026-01-01",
      },
    ]);
    rpc.organizations.decideMemoryProposal.mockResolvedValue({ ok: true });
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    expect(container.textContent).toContain("Greet people by name");
    expect(container.querySelector('input[aria-label="Suggest a note"]')).toBeNull();
    await act(async () => button("Approve")?.click());
    expect(rpc.organizations.decideMemoryProposal).toHaveBeenCalledWith({
      proposalId: "p1",
      approve: true,
    });
  });
  it("lets only the owner delete a team, then returns to the personal space", async () => {
    rpc.organizations.list.mockResolvedValue([
      { id: "t1", name: "Acme", role: "owner", memberCount: 1, spaceId: "s-acme" },
    ]);
    rpc.organizations.remove.mockResolvedValue({ ok: true });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    expect(button("Leave team")).toBeUndefined();
    await act(async () => button("Delete team")?.click());
    expect(container.textContent).toContain("Delete Acme?");
    expect(rpc.organizations.remove).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll("[role='alertdialog'] button")]
        .find((item) => item.textContent === "Delete team")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await settle();
    expect(rpc.organizations.remove).toHaveBeenCalledWith({ organizationId: "t1" });
    expect(selectSpace).toHaveBeenCalledWith("s-me");
    vi.unstubAllGlobals();
  });
});
