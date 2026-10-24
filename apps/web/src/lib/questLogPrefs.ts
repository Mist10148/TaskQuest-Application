/** The quest log's tab, filters and sort, remembered in this browser (the search text is not). */
export interface QuestLogPrefs {
  searchScope: "quests" | "tasks";
  categoryFilter: string;
  priorityFilter: string;
  statusFilter: string;
  activeTab: "all" | "current" | "expired" | "completed";
  sortBy: string;
}

export const DEFAULT_QUEST_LOG_PREFS: QuestLogPrefs = {
  searchScope: "quests",
  categoryFilter: "all",
  priorityFilter: "all",
  statusFilter: "all",
  activeTab: "all",
  sortBy: "newest",
};

const PREFS_KEY = "taskquest:quest-log";
const SCOPES = ["quests", "tasks"];
const STATUSES = ["all", "active", "completed"];
const TABS = ["all", "current", "expired", "completed"];
const SORTS = ["newest", "oldest", "name_asc", "name_desc", "priority", "deadline"];
/** Category and priority values are short words ("Work", "HIGH", "none"); anything else is ignored. */
const SHORT_VALUE = /^[\w -]{1,50}$/;

/** The saved choices, each checked; anything unreadable or unknown falls back to the default. */
export function loadQuestLogPrefs(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): QuestLogPrefs {
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) ?? "{}") as Partial<Record<keyof QuestLogPrefs, unknown>>;
    const pick = <T extends string>(value: unknown, allowed: string[] | RegExp, fallback: T): T =>
      typeof value === "string" && (Array.isArray(allowed) ? allowed.includes(value) : allowed.test(value)) ? (value as T) : fallback;
    const d = DEFAULT_QUEST_LOG_PREFS;
    return {
      searchScope: pick(saved.searchScope, SCOPES, d.searchScope),
      categoryFilter: pick(saved.categoryFilter, SHORT_VALUE, d.categoryFilter),
      priorityFilter: pick(saved.priorityFilter, SHORT_VALUE, d.priorityFilter),
      statusFilter: pick(saved.statusFilter, STATUSES, d.statusFilter),
      activeTab: pick(saved.activeTab, TABS, d.activeTab),
      sortBy: pick(saved.sortBy, SORTS, d.sortBy),
    };
  } catch {
    return { ...DEFAULT_QUEST_LOG_PREFS };
  }
}

export function saveQuestLogPrefs(prefs: QuestLogPrefs, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the choice just is not remembered */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
