import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorCard } from "./ErrorCard";

describe("ErrorCard", () => {
  it("says what failed and uses the error's message", () => {
    render(<ErrorCard what="your quests" error={new Error("Server is down")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your quests");
    expect(screen.getByRole("alert")).toHaveTextContent("Server is down");
  });

  it("falls back to generic wording for a non-Error value", () => {
    render(<ErrorCard what="your stats" error="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again.");
  });

  it("replaces the connection advice with a custom hint", () => {
    render(<ErrorCard what="your stats" hint="Sign in again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Check your connection");
  });

  it("offers a retry only when it can, and disables it while retrying", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorCard what="x" />);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();

    rerender(<ErrorCard what="x" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorCard what="x" onRetry={onRetry} retrying />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeDisabled();
  });
});
