import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyMember, PartyOverview, PartyStatus } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useParty: vi.fn(),
  useClaimParty: vi.fn(),
  useClaimPartyFocus: vi.fn(),
  useCreateParty: vi.fn(),
  useDisbandParty: vi.fn(),
  useInvitePartyPreview: vi.fn(),
  useInviteToParty: vi.fn(),
  useKickPartyMember: vi.fn(),
  useLeaveParty: vi.fn(),
  useRespondToPartyInvite: vi.fn(),
  useRevokePartyInvite: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Party from "./Party";

const member = (over: Partial<PartyMember>): PartyMember => ({ memberKey: "k1", name: "amy", count: 3, isYou: false, isOwner: false, ...over });
const status = (over: Partial<PartyStatus> = {}): PartyStatus =>
  ({
    party: { id: 1, name: "Night Owls", isOwner: true },
    weekStart: "2030-01-07",
    resetsAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
    perMember: 12,
    minToClaim: 6,
    yourCount: 3,
    target: 24,
    progress: 7,
    reward: 60,
    members: [member({ memberKey: "me", name: "me", isYou: true, isOwner: true, count: 4 }), member({})],
    invites: [],
    limit: 6,
    reached: false,
    claimed: false,
    claimable: false,
    ...over,
  }) as PartyStatus;
const load = (data: PartyOverview) => hooks.useParty.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Party />
    </QueryClientProvider>
  );

describe("Party page", () => {
  const kick = vi.fn();
  beforeEach(() => {
    kick.mockReset();
    const idle = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
    for (const name of Object.keys(hooks) as Array<keyof typeof hooks>) if (name !== "useParty") hooks[name].mockReturnValue(idle);
    hooks.useKickPartyMember.mockReturnValue({ ...idle, mutate: kick });
  });

  it("offers to create a party, and lists invitations, when you are in none", () => {
    load({ party: null, invites: [{ id: 5, partyName: "Readers", ownerName: "bob", createdAt: "2030-01-08T00:00:00Z", expiresAt: "2030-01-15T00:00:00Z" }] });
    show();
    expect(screen.getByText(/Readers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create/ })).toBeInTheDocument();
  });

  it("names the owner and each member's count in words", () => {
    load({ party: status(), invites: [] });
    show();
    const rows = screen.getAllByTestId("party-member");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Owner:")).toHaveClass("sr-only");
    expect(within(rows[0]).getByText("4 of 12 tasks")).toHaveClass("sr-only");
    expect(within(rows[1]).queryByText("Owner:")).toBeNull();
  });

  it("removes a member only after the owner confirms", async () => {
    load({ party: status(), invites: [] });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove amy from the party" }));
    expect(kick).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getAllByRole("button").find((b) => b.textContent !== "Cancel");
    await userEvent.click(confirm!);
    expect(kick).toHaveBeenCalled();
  });

  it("does not let a member remove anyone", () => {
    load({ party: status({ party: { id: 1, name: "Night Owls", isOwner: false } }), invites: [] });
    show();
    expect(screen.queryByRole("button", { name: /Remove .* from the party/ })).toBeNull();
  });
});
