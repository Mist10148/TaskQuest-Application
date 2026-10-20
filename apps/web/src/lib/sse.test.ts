import { afterEach, describe, expect, it, vi } from "vitest";
import { aiApi, ApiError, parseSseFrame, type ChatEvent } from "./api";
import { OFFLINE_MESSAGE } from "./online";

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

afterEach(() => vi.unstubAllGlobals());

describe("parseSseFrame", () => {
  it("reads the event name and JSON data", () => {
    expect(parseSseFrame('event: token\ndata: {"text":"hi"}')).toEqual({ event: "token", data: { text: "hi" } });
  });

  it("joins multi-line data and defaults the name to message", () => {
    expect(parseSseFrame('data: {"a":\ndata: 1}')).toEqual({ event: "message", data: { a: 1 } });
  });

  it("ignores comments, empty frames and bad JSON", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
    expect(parseSseFrame("")).toBeNull();
    expect(parseSseFrame("event: token\ndata: {nope")).toBeNull();
  });
});

describe("chat streaming", () => {
  it("reports a dropped connection as offline, not 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await aiApi.chatStream({ message: "hi" }, () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(OFFLINE_MESSAGE);
  });

  it("keeps a character split across chunks in an unterminated last frame", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"é"}');
    const cut = bytes.length - 3; // inside the two-byte é
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(streamOf(bytes.slice(0, cut), bytes.slice(cut)), { status: 200 })));
    const events: ChatEvent[] = [];
    await aiApi.chatStream({ message: "hi" }, (e) => events.push(e));
    expect(events).toEqual([{ event: "token", data: { text: "é" } }]);
  });

  it("escapes the thread id in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(streamOf(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await aiApi.resumeStream("../x", true, () => undefined);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/ai/chat/..%2Fx/resume");
  });
});
