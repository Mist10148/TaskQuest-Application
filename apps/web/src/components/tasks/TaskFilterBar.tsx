import { FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_FILTER, isFiltering, type GroupBy, type TaskFilter } from "@/lib/taskFilters";

interface Props {
  filter: TaskFilter;
  onFilter: (next: TaskFilter) => void;
  /** Tags used in this quest (the tag filter is hidden when there are none). */
  tags: readonly string[];
  /** Offer the assignee filter (a shared quest). */
  showAssignee?: boolean;
  /** Grouping only applies to the list view; leave it out to hide the control. */
  groupBy?: GroupBy;
  onGroupBy?: (next: GroupBy) => void;
  shown: number;
  total: number;
}

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Narrow a quest's tasks by status, priority, due date and tag, and (in the list view) group them under headings. */
export const TaskFilterBar = ({ filter, onFilter, tags, showAssignee, groupBy, onGroupBy, shown, total }: Props) => {
  const set = (patch: Partial<TaskFilter>) => onFilter({ ...filter, ...patch });
  const active = isFiltering(filter);
  return (
    <div role="group" aria-label="Filter tasks" className="mb-4 flex flex-wrap items-center gap-2">
      <select aria-label="Status" className={selectClass} value={filter.status} onChange={(e) => set({ status: e.target.value as TaskFilter["status"] })}>
        <option value="all">All tasks</option>
        <option value="open">Open</option>
        <option value="done">Done</option>
      </select>
      <select aria-label="Priority" className={selectClass} value={filter.priority} onChange={(e) => set({ priority: e.target.value as TaskFilter["priority"] })}>
        <option value="any">Any priority</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
        <option value="none">No priority</option>
      </select>
      <select aria-label="Due" className={selectClass} value={filter.due} onChange={(e) => set({ due: e.target.value as TaskFilter["due"] })}>
        <option value="any">Any due date</option>
        <option value="overdue">Overdue</option>
        <option value="today">Due today</option>
        <option value="week">Next 7 days</option>
        <option value="none">No due date</option>
      </select>
      {tags.length > 0 && (
        <select aria-label="Tag" className={selectClass} value={filter.tag} onChange={(e) => set({ tag: e.target.value })}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>
      )}
      {showAssignee && (
        <select aria-label="Assignee" className={selectClass} value={filter.assignee} onChange={(e) => set({ assignee: e.target.value as TaskFilter["assignee"] })}>
          <option value="any">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
      )}
      {groupBy !== undefined && onGroupBy && (
        <select aria-label="Group by" className={selectClass} value={groupBy} onChange={(e) => onGroupBy(e.target.value as GroupBy)}>
          <option value="none">No grouping</option>
          <option value="priority">Group by priority</option>
          <option value="due">Group by due date</option>
          <option value="tag">Group by tag</option>
        </select>
      )}
      {active && (
        <>
          <span className="text-xs text-foreground-muted" aria-live="polite">
            Showing {shown} of {total}
          </span>
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={() => onFilter(DEFAULT_FILTER)}>
            <FilterX className="h-3.5 w-3.5" aria-hidden /> Clear filters
          </Button>
        </>
      )}
    </div>
  );
};
