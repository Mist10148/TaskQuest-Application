import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ useTaskSearch: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));

import { TaskSearchResults } from "./TaskSearchResults";

describe("TaskSearchResults", () => {
  beforeEach(() => hooks.useTaskSearch.mockReset());

  it("asks for two characters before searching", () => {
    hooks.useTaskSearch.mockReturnValue({ data: undefined, isFetching: false, isError: false });
    render(<TaskSearchResults query="a" onOpen={() => {}} />);
    expect(screen.getByText(/at least two characters/)).toBeInTheDocument();
  });

  it("announces that a search is running", () => {
    hooks.useTaskSearch.mockReturnValue({ data: undefined, isFetching: true, isError: false });
    render(<TaskSearchResults query="milk" onOpen={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Searching your tasks…");
  });

  it("says when nothing matches", () => {
    hooks.useTaskSearch.mockReturnValue({ data: { lists: [], tasks: [] }, isFetching: false, isError: false });
    render(<TaskSearchResults query="milk" onOpen={() => {}} />);
    expect(screen.getByText('No tasks match "milk".')).toBeInTheDocument();
  });
});
