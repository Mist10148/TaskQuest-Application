import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OnboardingChecklist } from "./OnboardingChecklist";

const show = (xpEnabled?: boolean) =>
  render(
    <MemoryRouter>
      <OnboardingChecklist hasQuest={false} hasTask={false} claimedDaily={false} onClaimDaily={vi.fn()} claiming={false} xpEnabled={xpEnabled} />
    </MemoryRouter>
  );

describe("OnboardingChecklist", () => {
  it("offers the daily reward as a first step", () => {
    show();
    expect(screen.getByText("Claim your daily reward")).toBeInTheDocument();
  });

  it("leaves the daily reward out when XP is off, since it cannot be claimed", () => {
    show(false);
    expect(screen.queryByText("Claim your daily reward")).toBeNull();
    expect(screen.getByText("Create your first quest")).toBeInTheDocument();
  });
});
