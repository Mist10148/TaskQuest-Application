import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkPatch, EMPTY_BULK_EDIT, type BulkEditValues } from "@/lib/bulkEdit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  pending: boolean;
  onApply: (values: BulkEditValues) => void;
}

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Change the priority and due date of the selected tasks together. */
export const BulkEditDialog = ({ open, onOpenChange, count, pending, onApply }: Props) => {
  const [values, setValues] = useState<BulkEditValues>(EMPTY_BULK_EDIT);
  const valid = bulkPatch(values) !== null;
  const set = (patch: Partial<BulkEditValues>) => setValues((v) => ({ ...v, ...patch }));

  // Every way of closing (Cancel, Apply, Escape) must leave the next opening blank.
  useEffect(() => {
    if (!open) setValues(EMPTY_BULK_EDIT);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {count} {count === 1 ? "task" : "tasks"}</DialogTitle>
          <DialogDescription>Only the fields you change are touched.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onApply(values);
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="bulk-priority" className="text-sm font-medium">Priority</label>
            <select id="bulk-priority" className={selectClass} value={values.priority} onChange={(e) => set({ priority: e.target.value as BulkEditValues["priority"] })}>
              <option value="keep">Keep as it is</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="none">No priority</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bulk-due-mode" className="text-sm font-medium">Due date</label>
            <select id="bulk-due-mode" className={selectClass} value={values.dueMode} onChange={(e) => set({ dueMode: e.target.value as BulkEditValues["dueMode"] })}>
              <option value="keep">Keep as it is</option>
              <option value="set">Set a date</option>
              <option value="clear">Remove the date</option>
            </select>
            {values.dueMode === "set" && <Input aria-label="New due date" type="date" value={values.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || pending} aria-label={pending ? "Applying changes" : undefined}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Apply"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
