import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@/lib/api";

const api = vi.hoisted(() => ({ thread: vi.fn(), chatStream: vi.fn(), resumeStream: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), aiApi: api }));
vi.mock("@/hooks/useApi", () => ({
  invalidateProgress: vi.fn(),
  showAchievementNotifications: vi.fn(),
  showError: vi.fn(),
  showXPNotification: vi.fn(),
}));

import { ApiError } from "@/lib/api";
import { applyEvent, useChat, type ChatMessage } from "./useChat";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: "a", role: "assistant", text: "", sources: [], tools: [], streaming: true, ...over });

/** A chat stream that answers with one token and then finishes on `threadId`. */
const answerOn = (threadId: string) => async (_body: unknown, onEvent: (e: ChatEvent) => void) => {
  onEvent({ event: "token", data: { text: "Hi" } } as ChatEvent);
  onEvent({ event: "done", data: { threadId } } as ChatEvent);
};

describe("applyEvent", () => {
  it("appends tokens to the streaming reply", () => {
    const next = applyEvent([assistant({ text: "He" })], { event: "token", data: { text: "llo" } } as ChatEvent);
    expect(next[0].text).toBe("Hello");
  });

  it("stops streaming on done", () => {
    expect(applyEvent([assistant()], { event: "done", data: { threadId: "t" } } as ChatEvent)[0].streaming).toBe(false);
  });

  it("keeps partial text on error and fills an empty reply with the message", () => {
    const err = { event: "error", data: { message: "Oops" } } as ChatEvent;
    expect(applyEvent([assistant({ text: "partial" })], err)[0].text).toBe("partial");
    expect(applyEvent([assistant()], err)[0].text).toBe("Oops");
  });

  it("does not add a source twice", () => {
    const src = { event: "sources", data: [{ id: "s1" }] } as unknown as ChatEvent;
    expect(applyEvent(applyEvent([assistant()], src), src)[0].sources).toHaveLength(1);
  });
});

describe("useChat", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
  });

  it("reports the thread a new conversation created, once", async () => {
    api.chatStream.mockImplementation(answerOn("new-1"));
    const { result } = renderHook(() => useChat(null), { wrapper });
    await act(() => result.current.send("hello"));
    expect(result.current.createdThreadId).toBe("new-1");
    act(() => result.current.acknowledgeCreated());
    expect(result.current.createdThreadId).toBeNull();
  });

  it("never reports an existing thread as created", async () => {
    api.thread.mockResolvedValue({ messages: [], pendingConfirm: [] });
    api.chatStream.mockImplementation(answerOn("old-1"));
    const { result } = renderHook(() => useChat("old-1"), { wrapper });
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    await act(() => result.current.send("hello"));
    expect(result.current.createdThreadId).toBeNull();
  });

  it("refuses to send while the history is loading, so the draft can be kept", async () => {
    api.thread.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useChat("t1"), { wrapper });
    expect(result.current.historyLoading).toBe(true);
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.send("hello"); });
    expect(outcome).toBe("blocked");
    expect(api.chatStream).not.toHaveBeenCalled();
  });

  it("flags a missing thread and lets a failed load be retried", async () => {
    api.thread.mockRejectedValueOnce(new ApiError("Not found", 404));
    const missing = renderHook(() => useChat("gone"), { wrapper });
    await waitFor(() => expect(missing.result.current.historyMissing).toBe(true));

    api.thread.mockRejectedValueOnce(new ApiError("Boom", 500)).mockResolvedValueOnce({ messages: [{ role: "user", text: "earlier" }], pendingConfirm: [] });
    const { result } = renderHook(() => useChat("t2"), { wrapper });
    await waitFor(() => expect(result.current.historyFailed).toBe(true));
    act(() => result.current.retryHistory());
    await waitFor(() => expect(result.current.messages.map((m) => m.text)).toEqual(["earlier"]));
    expect(result.current.historyFailed).toBe(false);
  });
});
