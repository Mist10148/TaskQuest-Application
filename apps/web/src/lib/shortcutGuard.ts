/** True while the user is typing somewhere a shortcut key should be a letter, not a command. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Menus, select lists and comboboxes jump to an option on a typed letter, so the letter is theirs, not a shortcut's. */
const PICKER = '[role="menu"], [role="menubar"], [role="listbox"], [role="combobox"]';

/**
 * Should a single-key shortcut leave this key alone? While typing, inside (or with) an open menu or select list, which
 * use letters to jump to an option, and while a dialog is open (Escape then belongs to the dialog).
 */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  if (isTyping(e.target)) return true;
  if (e.target instanceof Element && e.target.closest(PICKER)) return true;
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
}
