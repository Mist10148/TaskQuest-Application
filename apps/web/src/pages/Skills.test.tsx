import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill, SkillTree } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useSkills: vi.fn(),
  useSkillPreview: vi.fn(),
  useUnlockSkill: vi.fn(),
  useRespecSkills: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ refresh: vi.fn().mockResolvedValue(undefined), user: { user: { player_class: "DEFAULT" } } }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Skills from "./Skills";

const skill = (over: Partial<Skill> = {}): Skill => ({ id: "QUICK", name: "Quick Learner", emoji: "📚", description: "More XP", maxLevel: 3, cost: 50, requires: null, currentLevel: 0, ...over });
const tree = (over: Partial<SkillTree> = {}): SkillTree =>
  ({ classKey: "DEFAULT", name: "Default", description: "Everyone's tree", emoji: "⭐", classOwned: true, skills: [skill()], ...over }) as SkillTree;
const load = (skillTrees: SkillTree[], userXP = 500) =>
  hooks.useSkills.mockReturnValue({ data: { skillTrees, userXP, playerClass: "DEFAULT" }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
const show = () => render(<MemoryRouter><Skills /></MemoryRouter>);

describe("Skills page", () => {
  const unlock = vi.fn();
  beforeEach(() => {
    unlock.mockReset().mockResolvedValue({});
    hooks.useSkillPreview.mockReturnValue({ data: undefined });
    hooks.useUnlockSkill.mockReturnValue({ mutateAsync: unlock, isPending: false, variables: undefined });
    hooks.useRespecSkills.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("says in words which class trees you do not own", () => {
    load([tree(), tree({ classKey: "WIZARD", name: "Wizard", emoji: "🧙", classOwned: false })]);
    show();
    expect(screen.getByRole("tab", { name: /Wizard\s*\(class not owned\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Default" })).toHaveAttribute("aria-selected", "true");
  });

  it("links a tree you do not own to the Classes page", async () => {
    load([tree(), tree({ classKey: "WIZARD", name: "Wizard", emoji: "🧙", classOwned: false })]);
    show();
    await userEvent.click(screen.getByRole("tab", { name: /Wizard/ }));
    expect(screen.getByText("Class Not Owned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Classes" })).toHaveAttribute("href", "/classes");
  });

  it("points the tabs at the panel only while it is shown", () => {
    hooks.useSkills.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    show();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    load([tree()]);
    show();
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-controls", "skill-tabpanel");
  });

  it("says where skills come from when there are no trees", () => {
    load([]);
    show();
    expect(screen.getByText(/No skill trees to show yet/)).toBeInTheDocument();
  });

  it("unlocks a skill only after the confirmation", async () => {
    load([tree()]);
    show();
    await userEvent.click(screen.getByRole("button", { name: /Unlock \(50 XP\)/ }));
    expect(unlock).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("button").find((b) => /50 XP/.test(b.textContent ?? "") && b.closest('[role="alertdialog"]'));
    expect(confirm).toBeDefined();
    await userEvent.click(confirm!);
    expect(unlock).toHaveBeenCalled();
  });
});
