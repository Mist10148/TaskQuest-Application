import { Check, CheckCircle2, Clock, Filter, ListTodo, Scroll, Search, SortAsc, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CATEGORIES, PRIORITIES, SORT_OPTIONS, type ListTab } from "./constants";
import type { useListFilters } from "./useListFilters";

const TABS: Array<{ value: ListTab; label: string; icon: typeof Scroll }> = [
  { value: "all", label: "All", icon: Scroll },
  { value: "current", label: "Current", icon: ListTodo },
  { value: "expired", label: "Expired", icon: Clock },
  { value: "completed", label: "Completed", icon: CheckCircle2 },
];

type Filters = ReturnType<typeof useListFilters>;

/** Tabs, search box, filter menu and sort menu for the quest overview. */
export const ListFilters = ({ filters }: { filters: Filters }) => (
  <>
    <div className="flex flex-wrap gap-2 mb-6 p-1 bg-background-secondary rounded-lg w-fit max-w-full" role="tablist" aria-label="Quest status">
      {TABS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="tab"
          aria-selected={filters.activeTab === value}
          onClick={() => filters.setActiveTab(value)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
            filters.activeTab === value ? "bg-card text-foreground shadow-xs" : "text-foreground-muted hover:text-foreground hover:bg-card/50"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>

    <div className="flex flex-col sm:flex-row gap-4 mb-6">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
        <Input
          id="quest-search"
          aria-label={filters.searchScope === "tasks" ? "Search tasks" : "Search quests"}
          placeholder={filters.searchScope === "tasks" ? "Search task names and notes..." : "Search quests..."}
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="flex p-1 bg-background-secondary rounded-lg" role="radiogroup" aria-label="Search in">
          {(["quests", "tasks"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={filters.searchScope === scope}
              onClick={() => filters.setSearchScope(scope)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                filters.searchScope === scope ? "bg-card text-foreground shadow-xs" : "text-foreground-muted hover:text-foreground"
              )}
            >
              {scope === "quests" ? "Quests" : "Tasks"}
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="relative" aria-label="Filter quests">
              <Filter className="h-4 w-4" />
              {filters.activeFilters > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] flex items-center justify-center font-bold">
                  {filters.activeFilters}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="p-2">
              <label className="text-xs text-foreground-muted block mb-1">Category</label>
              <Select value={filters.categoryFilter} onValueChange={filters.setCategoryFilter}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="p-2">
              <label className="text-xs text-foreground-muted block mb-1">Priority</label>
              <Select value={filters.priorityFilter} onValueChange={filters.setPriorityFilter}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="p-2">
              <label className="text-xs text-foreground-muted block mb-1">Status</label>
              <Select value={filters.statusFilter} onValueChange={filters.setStatusFilter}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={filters.clearFilters}>
              <X className="h-4 w-4 mr-2" /> Clear Filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Sort quests"><SortAsc className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SORT_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} onClick={() => filters.setSortBy(o.value)}>
                {filters.sortBy === o.value && <Check className="h-4 w-4 mr-2" />}{o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </>
);
