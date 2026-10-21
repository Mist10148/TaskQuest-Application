import { useEffect, useMemo, useState } from "react";
import type { ListWithCounts } from "@/lib/api";
import { compareDeadlines, isPastDeadline } from "@/lib/dates";
import { PRIORITY_ORDER, type ListTab } from "./constants";
import { loadQuestLogPrefs, saveQuestLogPrefs } from "@/lib/questLogPrefs";

const isComplete = (list: ListWithCounts) => list.itemsTotal > 0 && list.itemsCompleted === list.itemsTotal;

/** Search, filter, tab and sort state for the quest overview, plus the resulting list. */
export type SearchScope = "quests" | "tasks";

export function useListFilters(lists: ListWithCounts[]) {
  // The tab, filters and sort are remembered in this browser, so coming back to the quest log keeps them; the search text is not.
  const [saved] = useState(loadQuestLogPrefs);
  const [searchQuery, setSearchQuery] = useState("");
  // "tasks" searches inside task names and descriptions on the server; "quests" filters the loaded quests here.
  const [searchScope, setSearchScope] = useState<SearchScope>(saved.searchScope);
  const [categoryFilter, setCategoryFilter] = useState(saved.categoryFilter);
  const [priorityFilter, setPriorityFilter] = useState(saved.priorityFilter);
  const [statusFilter, setStatusFilter] = useState(saved.statusFilter);
  const [activeTab, setActiveTab] = useState<ListTab>(saved.activeTab);
  const [sortBy, setSortBy] = useState(saved.sortBy);
  useEffect(() => {
    saveQuestLogPrefs({ searchScope, categoryFilter, priorityFilter, statusFilter, activeTab, sortBy });
  }, [searchScope, categoryFilter, priorityFilter, statusFilter, activeTab, sortBy]);

  const visible = useMemo(() => {
    const query = searchScope === "quests" ? searchQuery.toLowerCase() : "";
    return lists
      .filter((list) => !query || list.name.toLowerCase().includes(query) || list.category?.toLowerCase().includes(query))
      .filter((list) => categoryFilter === "all" || (categoryFilter === "none" ? !list.category : list.category === categoryFilter))
      .filter((list) => priorityFilter === "all" || (priorityFilter === "none" ? !list.priority : list.priority === priorityFilter))
      .filter((list) => statusFilter === "all" || (statusFilter === "completed" ? isComplete(list) : !isComplete(list)))
      .filter((list) => {
        if (activeTab === "all") return true;
        const done = isComplete(list);
        const expired = isPastDeadline(list.deadline) && !done;
        if (activeTab === "completed") return done;
        if (activeTab === "expired") return expired;
        return !done && !expired; // current
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "newest": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          case "oldest": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          case "name_asc": return a.name.localeCompare(b.name);
          case "name_desc": return b.name.localeCompare(a.name);
          case "priority": return (PRIORITY_ORDER[a.priority || ""] ?? 3) - (PRIORITY_ORDER[b.priority || ""] ?? 3);
          case "deadline": return compareDeadlines(a.deadline, b.deadline);
          default: return 0;
        }
      });
  }, [lists, searchQuery, searchScope, categoryFilter, priorityFilter, statusFilter, activeTab, sortBy]);

  const activeFilters = [categoryFilter !== "all", priorityFilter !== "all", statusFilter !== "all"].filter(Boolean).length;
  const clearFilters = () => {
    setCategoryFilter("all");
    setPriorityFilter("all");
    setStatusFilter("all");
  };

  return {
    visible,
    activeFilters,
    clearFilters,
    searchQuery, setSearchQuery,
    searchScope, setSearchScope,
    categoryFilter, setCategoryFilter,
    priorityFilter, setPriorityFilter,
    statusFilter, setStatusFilter,
    activeTab, setActiveTab,
    sortBy, setSortBy,
  };
}
