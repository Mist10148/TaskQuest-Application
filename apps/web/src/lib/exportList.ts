import type { Item, ListWithItems } from "./api";

/**
 * One quest as a file, built in the browser from what is already loaded. The CSV has the same columns as the full export
 * (Settings > Export), so it can be imported again; the Markdown is a checklist to paste into notes or a chat.
 */

const CSV_HEADER = ["list", "task", "subtask_of", "done", "due_date", "priority", "tags", "repeat", "list_deadline", "list_category", "description"];

/** Like the server's export: a cell a spreadsheet could run as a formula gets a leading apostrophe (the importer takes it off). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^'?[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parents first, each followed by its subtasks, in the quest's order. */
function ordered(items: Item[]): Item[] {
  const byPosition = [...items].sort((a, b) => a.position - b.position || a.id - b.id);
  const top = byPosition.filter((i) => !i.parent_id || !items.some((p) => p.id === i.parent_id));
  return top.flatMap((t) => [t, ...byPosition.filter((c) => c.parent_id === t.id)]);
}

export function listToCsv(list: ListWithItems): string {
  const names = new Map(list.items.map((i) => [i.id, i.name]));
  const rows: unknown[][] = [CSV_HEADER];
  if (!list.items.length) rows.push([list.name, "", "", "", "", "", "", "", list.deadline, list.category, ""]);
  for (const i of ordered(list.items)) {
    rows.push([list.name, i.name, i.parent_id ? names.get(i.parent_id) ?? "" : "", i.completed ? "yes" : "no", i.due_date, i.priority, i.tags, i.recurrence, list.deadline, list.category, i.description]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A task's details after its name: "(due 2030-01-10, HIGH, #home #bills)". */
function details(i: Item): string {
  const parts = [i.due_date ? `due ${String(i.due_date).slice(0, 10)}` : "", i.priority ?? "", i.recurrence ? `repeats ${i.recurrence}` : "", ...(i.tags ? i.tags.split(",").filter(Boolean).map((t) => `#${t}`) : [])].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** Markdown has no way to quote "[x]" or a leading "#" in plain text, so only the characters that would break the line are escaped. */
const mdText = (s: string) => s.replace(/\r?\n/g, " ").replace(/([\\`*_[\]])/g, "\\$1");

export function listToMarkdown(list: ListWithItems): string {
  const lines = [`# ${mdText(list.name)}`, ""];
  if (list.description) lines.push(mdText(list.description), "");
  if (list.deadline) lines.push(`Due ${String(list.deadline).slice(0, 10)}`, "");
  for (const i of ordered(list.items)) {
    const indent = i.parent_id ? "  " : "";
    lines.push(`${indent}- [${i.completed ? "x" : " "}] ${mdText(i.name)}${details(i)}`);
  }
  if (!list.items.length) lines.push("_No tasks yet._");
  return lines.join("\n") + "\n";
}

/** A file name from the quest's name: letters, digits and dashes only. */
export function exportFileName(list: Pick<ListWithItems, "name">, extension: "csv" | "md"): string {
  const base = list.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "quest";
  return `${base}.${extension}`;
}

/** Hand the browser a file to save. */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
