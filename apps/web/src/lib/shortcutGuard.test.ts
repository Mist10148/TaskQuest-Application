import { afterEach, describe, expect, it } from "vitest";
import { shortcutBlocked } from "./shortcutGuard";

const keyOn = (target: Element) => {
  const e = new KeyboardEvent("keydown", { key: "d", bubbles: true });
  Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("shortcutBlocked", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lets a key on the page through, and blocks it in a field", () => {
    document.body.innerHTML = `<div id="row" tabindex="0"></div><input id="field" />`;
    expect(shortcutBlocked(keyOn(document.getElementById("row")!))).toBe(false);
    expect(shortcutBlocked(keyOn(document.getElementById("field")!))).toBe(true);
  });

  it("blocks a letter typed in an open menu or select list, which jumps to an option", () => {
    document.body.innerHTML = `<div role="menu"><div id="item" role="menuitem"></div></div>`;
    expect(shortcutBlocked(keyOn(document.getElementById("item")!))).toBe(true);
    document.body.innerHTML = `<div id="row" tabindex="0"></div><div role="listbox"><div role="option"></div></div>`;
    expect(shortcutBlocked(keyOn(document.getElementById("row")!)), "an open list anywhere holds the keys").toBe(true);
  });

  it("blocks a letter on a closed select's button, and while a dialog is open", () => {
    document.body.innerHTML = `<button id="select" role="combobox"></button>`;
    expect(shortcutBlocked(keyOn(document.getElementById("select")!))).toBe(true);
    document.body.innerHTML = `<div id="row" tabindex="0"></div><div role="dialog"></div>`;
    expect(shortcutBlocked(keyOn(document.getElementById("row")!))).toBe(true);
  });
});
