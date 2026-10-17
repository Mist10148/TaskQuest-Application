import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceResult, shouldAnnounceResult } from "./push";

describe("shouldAnnounceResult", () => {
  it("is true only for a hidden page with notifications allowed", () => {
    expect(shouldAnnounceResult({ hidden: true, permission: "granted" })).toBe(true);
    expect(shouldAnnounceResult({ hidden: false, permission: "granted" })).toBe(false);
    expect(shouldAnnounceResult({ hidden: true, permission: "default" })).toBe(false);
    expect(shouldAnnounceResult({ hidden: true, permission: "denied" })).toBe(false);
    expect(shouldAnnounceResult({ hidden: true, permission: "unsupported" })).toBe(false);
  });
});

describe("announceResult", () => {
  const showNotification = vi.fn();
  const getRegistration = vi.fn();
  let visibility: DocumentVisibilityState = "hidden";

  beforeEach(() => {
    showNotification.mockReset().mockResolvedValue(undefined);
    getRegistration.mockReset().mockResolvedValue({ showNotification });
    visibility = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "granted" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("shows one notification through the service worker, tagged and pointing back at this page", async () => {
    expect(await announceResult({ title: "Your summary is ready", body: "Math is half done" })).toBe(true);
    expect(getRegistration).toHaveBeenCalledWith("/sw.js");
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe("Your summary is ready");
    expect(options).toMatchObject({ body: "Math is half done", tag: "ai-result", icon: "/taskquest-icon.svg", data: { url: window.location.href } });
  });

  it("stays silent while the page is visible", async () => {
    visibility = "visible";
    expect(await announceResult({ title: "t", body: "b" })).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("stays silent without permission, and never asks for it", async () => {
    const request = vi.fn();
    vi.stubGlobal("Notification", { permission: "default", requestPermission: request });
    expect(await announceResult({ title: "t", body: "b" })).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("stays silent when push was never turned on (no service worker registered)", async () => {
    getRegistration.mockResolvedValue(undefined);
    expect(await announceResult({ title: "t", body: "b" })).toBe(false);
  });

  it("never throws, whatever the browser does", async () => {
    showNotification.mockRejectedValue(new Error("blocked"));
    expect(await announceResult({ title: "t", body: "b" })).toBe(false);
    getRegistration.mockRejectedValue(new Error("no sw"));
    expect(await announceResult({ title: "t", body: "b" })).toBe(false);
  });

  it("clips a long title and body", async () => {
    await announceResult({ title: "T".repeat(300), body: "B".repeat(900) });
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toHaveLength(100);
    expect(options.body).toHaveLength(300);
  });
});
