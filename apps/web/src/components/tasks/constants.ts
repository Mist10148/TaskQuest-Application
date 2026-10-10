export const CATEGORIES = [
  { value: "all", label: "All Categories", emoji: "📋" },
  { value: "none", label: "None", emoji: "➖" },
  { value: "School", label: "School", emoji: "📚" },
  { value: "Work", label: "Work", emoji: "💼" },
  { value: "Personal", label: "Personal", emoji: "🏠" },
  { value: "Health", label: "Health", emoji: "💪" },
  { value: "Finance", label: "Finance", emoji: "💰" },
  { value: "Shopping", label: "Shopping", emoji: "🛒" },
  { value: "Fitness", label: "Fitness", emoji: "🏃" },
  { value: "Other", label: "Other", emoji: "📌" },
];

export const PRIORITIES = [
  { value: "all", label: "All", emoji: "🔘" },
  { value: "none", label: "None", emoji: "➖" },
  { value: "HIGH", label: "High", emoji: "🔴" },
  { value: "MEDIUM", label: "Medium", emoji: "🟡" },
  { value: "LOW", label: "Low", emoji: "🔵" },
];

export const SORT_OPTIONS = [
  { value: "newest", label: "📅 Newest First" },
  { value: "oldest", label: "📅 Oldest First" },
  { value: "name_asc", label: "🔤 Name A-Z" },
  { value: "name_desc", label: "🔤 Name Z-A" },
  { value: "priority", label: "⚡ Priority" },
  { value: "deadline", label: "⏰ Deadline" },
];

export const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export type ListTab = "all" | "current" | "expired" | "completed";
