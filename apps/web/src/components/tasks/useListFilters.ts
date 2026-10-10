import { useMemo, useState } from "react";
import type { ListWithCounts } from "@/lib/api";
import { compareDeadlines, isPastDeadline } from "@/lib/dates";
import { PRIORITY_ORDER, type ListTab } from "./constants";

const isComplete = (list: ListWithCounts) => list.itemsTotal > 0 && list.itemsCompleted === list.itemsTotal;

/** Search, filter, tab and sort state for the quest overview, plus the resulting list. */
export function useListFilters(lists: ListWithCounts[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<ListTab>("all");
  const [sortBy, setSortBy] = useState("newest");

  const visible = useMemo(() => {
    const query = searchQuery.toLowerCase();
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
  }, [lists, searchQuery, categoryFilter, priorityFilter, statusFilter, activeTab, sortBy]);

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
    categoryFilter, setCategoryFilter,
    priorityFilter, setPriorityFilter,
    statusFilter, setStatusFilter,
    activeTab, setActiveTab,
    sortBy, setSortBy,
  };
}
