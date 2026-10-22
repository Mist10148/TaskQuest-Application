import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useChat: vi.fn(), send: vi.fn(), acknowledgeCreated: vi.fn(), threadsLoading: false }));
vi.mock("@/hooks/useChat", () => ({ useChat: mocks.useChat }));
vi.mock("@/hooks/useApi", () => ({
  useChatThreads: () => ({ data: mocks.threadsLoading ? undefined : { threads: [{ id: "t1", title: "Plans" }] }, isLoading: mocks.threadsLoading, isError: false, refetch: vi.fn(), isFetching: false }),
  useDeleteThread: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { features: { ai: true } } }) }));
vi.mock("@/contexts/PreferencesContext", () => ({ usePreferences: () => ({ reduceMotion: true }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import Chat from "./Chat";

const chatState = (over: Record<string, unknown> = {}) => ({
  threadId: null,
  createdThreadId: null,
  acknowledgeCreated: mocks.acknowledgeCreated,
  messages: [],
  pending: [],
  isStreaming: false,
  notice: null,
  historyLoading: false,
  historyFailed: false,
  historyMissing: false,
  retryHistory: vi.fn(),
  send: mocks.send,
  respond: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  ...over,
});

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat" element={<><Chat /><Where /></>} />
        <Route path="/chat/:threadId" element={<><Chat /><Where /></>} />
      </Routes>
    </MemoryRouter>
  );

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Chat page", () => {
  beforeEach(() => {
    mocks.send.mockReset().mockResolvedValue("ok");
    mocks.acknowledgeCreated.mockReset();
  });

  it("moves a brand-new conversation to its own URL and acknowledges it", () => {
    mocks.useChat.mockReturnValue(chatState({ createdThreadId: "new-1" }));
    renderAt("/chat");
    expect(screen.getByTestId("where")).toHaveTextContent("/chat/new-1");
    expect(mocks.acknowledgeCreated).toHaveBeenCalled();
  });

  it("does not pull the reader back to a created thread once they opened another one", () => {
    mocks.useChat.mockReturnValue(chatState({ createdThreadId: "new-1" }));
    renderAt("/chat/t1");
    expect(screen.getByTestId("where")).toHaveTextContent("/chat/t1");
  });

  it("keeps the draft when Enter is pressed while a reply is streaming", async () => {
    mocks.useChat.mockReturnValue(chatState({ isStreaming: true, messages: [{ id: "a", role: "assistant", text: "…", sources: [], tools: [], streaming: true }] }));
    renderAt("/chat");
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "next question{Enter}");
    expect(box).toHaveValue("next question");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("shows a loading state instead of the suggestions while history loads", () => {
    mocks.useChat.mockReturnValue(chatState({ historyLoading: true }));
    renderAt("/chat/t1");
    expect(screen.getByText(/loading conversation/i)).toBeInTheDocument();
    expect(screen.queryByText(/what should i do first today/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  });

  it("offers a retry when history fails to load", async () => {
    const retryHistory = vi.fn();
    mocks.useChat.mockReturnValue(chatState({ historyFailed: true, retryHistory }));
    renderAt("/chat/t1");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retryHistory).toHaveBeenCalled();
  });

  it("sends a missing conversation back to a new chat", () => {
    mocks.useChat.mockReturnValue(chatState({ historyMissing: true }));
    renderAt("/chat/gone");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/chat$/);
  });

  it("disables the suggestions while an action waits for approval", () => {
    mocks.useChat.mockReturnValue(chatState({ pending: [{ id: "p", tool: "x", summary: "Do it" }] }));
    renderAt("/chat");
    expect(screen.getByRole("button", { name: /what should i do first today/i })).toBeDisabled();
  });

  it("marks the open conversation and labels the mobile toggle", () => {
    mocks.useChat.mockReturnValue(chatState());
    renderAt("/chat/t1");
    expect(screen.getByRole("button", { name: "Plans" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /show conversations/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("says who is speaking in each message", () => {
    mocks.useChat.mockReturnValue(chatState({
      messages: [
        { id: "u", role: "user", text: "Hello", sources: [], tools: [] },
        { id: "a", role: "assistant", text: "Hi there", sources: [], tools: [] },
      ],
    }));
    renderAt("/chat/t1");
    expect(screen.getByText("You said:")).toBeInTheDocument();
    expect(screen.getByText("Assistant said:")).toBeInTheDocument();
  });

  it("on a phone, the conversation list takes focus, hides the chat behind it, and Escape returns to the toggle", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    mocks.useChat.mockReturnValue(chatState());
    renderAt("/chat/t1");
    const toggle = screen.getByRole("button", { name: /show conversations/i });
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /new chat/i })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Message", hidden: true }).closest("section")).toHaveAttribute("inert");
    await userEvent.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    expect(toggle.closest("section")).not.toHaveAttribute("inert");
  });

  it("New chat starts over even on /chat, where the address does not change", async () => {
    const reset = vi.fn();
    mocks.useChat.mockReturnValue(chatState({ reset }));
    renderAt("/chat");
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(reset).toHaveBeenCalled();
  });

  it("shows placeholder rows while the conversations load", () => {
    mocks.threadsLoading = true;
    mocks.useChat.mockReturnValue(chatState());
    renderAt("/chat");
    expect(screen.getByRole("status", { name: "Loading conversations" })).toBeInTheDocument();
    mocks.threadsLoading = false;
  });

  it("copies a finished answer, but not one still being written", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.useChat.mockReturnValue(chatState({
      messages: [
        { id: "a", role: "assistant", text: "Start with math", sources: [], tools: [] },
        { id: "b", role: "assistant", text: "Then", sources: [], tools: [], streaming: true },
      ],
    }));
    renderAt("/chat/t1");
    const buttons = screen.getAllByRole("button", { name: "Copy" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(writeText).toHaveBeenCalledWith("Start with math");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
