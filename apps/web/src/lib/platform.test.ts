import { describe, expect, it } from "vitest";
import { isApplePlatform, modKeyLabel } from "./platform";

describe("platform shortcut hints", () => {
  it("shows the command key on Apple devices and Ctrl elsewhere", () => {
    expect(modKeyLabel({ platform: "MacIntel", userAgent: "" })).toBe("⌘");
    expect(modKeyLabel({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" })).toBe("⌘");
    expect(modKeyLabel({ platform: "Win32", userAgent: "" })).toBe("Ctrl");
    expect(modKeyLabel({ platform: "Linux x86_64", userAgent: "" })).toBe("Ctrl");
  });

  it("is not Apple without a navigator", () => {
    expect(isApplePlatform(undefined)).toBe(false);
  });
});
