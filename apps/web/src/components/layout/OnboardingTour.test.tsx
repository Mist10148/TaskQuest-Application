import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnboardingTour } from "./OnboardingTour";

const mount = () => render(<MemoryRouter><OnboardingTour /></MemoryRouter>);
const wait = { timeout: 3000 };

describe("OnboardingTour", () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  afterEach(cleanup);

  it("resumes at the step it was on when another page mounts it again", async () => {
    const first = mount();
    await screen.findByText("Step 1 of 4", undefined, wait);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    first.unmount(); // the next route mounts its own layout and tour

    mount();
    expect(await screen.findByText("Step 3 of 4", undefined, wait)).toBeInTheDocument();
  });

  it("stays away for good after Skip", async () => {
    const first = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }, wait));
    first.unmount();
    mount();
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.queryByRole("region", { name: "Welcome tour" })).toBeNull();
  });
});
