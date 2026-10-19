import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  useItemComments: vi.fn(),
  useItemActivity: vi.fn(),
  useAddComment: vi.fn(),
  useDeleteComment: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);

import { TaskThread } from "./TaskThread";

const loaded = <T,>(data: T) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false });

describe("TaskThread", () => {
  const add = vi.fn();
  const remove = vi.fn();
  beforeEach(() => {
    add.mockReset();
    remove.mockReset();
    hooks.useAddComment.mockReturnValue({ mutate: add, isPending: false });
    hooks.useDeleteComment.mockReturnValue({ mutate: remove, isPending: false });
    hooks.useItemComments.mockReturnValue(
      loaded({ comments: [{ id: 1, body: "On it", author: { name: "Sam", isYou: false }, createdAt: new Date().toISOString(), canDelete: true }] })
    );
    hooks.useItemActivity.mockReturnValue(loaded({ activity: [{ id: 9, kind: "priority", actor: { name: "Me", isYou: true }, from: "LOW", to: "HIGH", createdAt: new Date().toISOString() }] }));
  });

  it("lists comments, posts a new one and deletes one", async () => {
    render(<TaskThread itemId={7} canComment />);
    expect(screen.getByText("On it")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Write a comment" }), "Done tomorrow");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(add).toHaveBeenCalledWith("Done tomorrow", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Delete comment from Sam" }));
    expect(remove).toHaveBeenCalledWith(1);
  });

  it("hides the comment box from viewers", () => {
    render(<TaskThread itemId={7} canComment={false} />);
    expect(screen.queryByRole("textbox", { name: "Write a comment" })).toBeNull();
  });

  it("shows the history as sentences", async () => {
    render(<TaskThread itemId={7} canComment />);
    await userEvent.click(screen.getByRole("button", { name: /activity/i }));
    expect(screen.getByText("You changed the priority from Low to High")).toBeInTheDocument();
  });
});
