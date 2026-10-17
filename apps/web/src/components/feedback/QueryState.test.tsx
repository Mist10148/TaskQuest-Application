import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryState } from "./QueryState";

type Q = Parameters<typeof QueryState<string>>[0]["query"];

const query = (over: Partial<Q>): Q => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn() as unknown as Q["refetch"],
  isFetching: false,
  ...over,
});

const show = (q: Q) =>
  render(
    <QueryState query={q} what="your thing" skeleton={<p>loading…</p>}>
      {(data) => <p>got {data}</p>}
    </QueryState>,
  );

describe("QueryState", () => {
  it("shows the skeleton while the first load is in flight", () => {
    const { container } = show(query({ isLoading: true }));
    expect(screen.getByText("loading…")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows an error card and retries through refetch", async () => {
    const refetch = vi.fn();
    show(query({ isError: true, error: new Error("nope"), refetch: refetch as unknown as Q["refetch"] }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your thing");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("treats a finished request with no data as an error", () => {
    show(query({}));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders the children with the data", () => {
    show(query({ data: "42" }));
    expect(screen.getByText("got 42")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders falsy-but-present data (an empty string) as content, not an error", () => {
    show(query({ data: "" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
