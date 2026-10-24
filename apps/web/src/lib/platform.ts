/** True on macOS, iPadOS and iOS, where the command key stands in for Ctrl in shortcuts. */
export function isApplePlatform(nav: Pick<Navigator, "platform" | "userAgent"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  return /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || "");
}

/** The modifier key to show in shortcut hints: "⌘" on Apple devices, "Ctrl" elsewhere. */
export function modKeyLabel(nav?: Pick<Navigator, "platform" | "userAgent">): string {
  return isApplePlatform(nav ?? (typeof navigator === "undefined" ? undefined : navigator)) ? "⌘" : "Ctrl";
}
