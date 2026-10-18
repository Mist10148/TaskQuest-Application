import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

const Broken = () => {
  throw new Error("Failed to fetch dynamically imported module");
};

describe("RouteErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a reload card instead of unmounting the app", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Broken />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not load");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("renders its children when nothing fails", () => {
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <p>fine</p>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
