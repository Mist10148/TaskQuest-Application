import type { Priority } from "@/lib/api";

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
}

export const EMPTY_ITEM_FORM: ItemFormValues = { name: "", description: "" };
