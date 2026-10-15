import type { ItemInput, Priority, Recurrence } from "@/lib/api";

export interface ListFormValues {
  name: string;
  description: string;
  category: string; // "none" when unset
  priority: string; // "none" when unset
  deadline: string; // YYYY-MM-DD or ""
}

export const EMPTY_LIST_FORM: ListFormValues = { name: "", description: "", category: "none", priority: "none", deadline: "" };

/** Values in the shape the API expects: unset fields become null. */
export const listPayload = (v: ListFormValues) => ({
  name: v.name.trim(),
  description: v.description.trim() || null,
  category: v.category !== "none" ? v.category : null,
  priority: v.priority !== "none" ? (v.priority as Priority) : null,
  deadline: v.deadline || null,
});

export interface ItemFormValues {
  name: string;
  description: string;
  due_date: string; // YYYY-MM-DD or ""
  priority: string; // "none" when unset
  tags: string; // "work, home"
  recurrence: string; // "none" | daily | weekly | monthly
  estimate: string; // minutes, or ""
  parent_id: string; // "none" or an item id
}

export const EMPTY_ITEM_FORM: ItemFormValues = { name: "", description: "", due_date: "", priority: "none", tags: "", recurrence: "none", estimate: "", parent_id: "none" };

/** Values in the shape the API expects: unset fields become null. */
export const itemPayload = (v: ItemFormValues): ItemInput => ({
  name: v.name.trim(),
  description: v.description.trim() || null,
  due_date: v.due_date || null,
  priority: v.priority !== "none" ? (v.priority as Priority) : null,
  tags: v.tags.trim() || null,
  recurrence: v.recurrence !== "none" ? (v.recurrence as Recurrence) : null,
  estimate_minutes: v.estimate.trim() ? Number(v.estimate) : null,
  parent_id: v.parent_id !== "none" ? Number(v.parent_id) : null,
});
