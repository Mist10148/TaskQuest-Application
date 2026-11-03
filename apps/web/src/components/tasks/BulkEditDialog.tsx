import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkPatch, bulkTagProblem, EMPTY_BULK_EDIT, type BulkEditValues } from "@/lib/bulkEdit";
import { useT } from "@/i18n/useT";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  pending: boolean;
  onApply: (values: BulkEditValues) => void;
}

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Change the priority, due date and tags of the selected tasks together. */
export const BulkEditDialog = ({ open, onOpenChange, count, pending, onApply }: Props) => {
  const t = useT();
  const [values, setValues] = useState<BulkEditValues>(EMPTY_BULK_EDIT);
  const valid = bulkPatch(values) !== null;
  const tagProblem = values.tags.trim() || values.tagMode === "add" || values.tagMode === "remove" ? bulkTagProblem(values) : null;
  const set = (patch: Partial<BulkEditValues>) => setValues((v) => ({ ...v, ...patch }));

  // Every way of closing (Cancel, Apply, Escape) must leave the next opening blank.
  useEffect(() => {
    if (!open) setValues(EMPTY_BULK_EDIT);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{count === 1 ? t("bulkEdit.titleOne") : t("bulkEdit.titleMany", { count })}</DialogTitle>
          <DialogDescription>{t("bulkEdit.hint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onApply(values);
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="bulk-priority" className="text-sm font-medium">{t("bulkEdit.priority")}</label>
            <select id="bulk-priority" className={selectClass} value={values.priority} onChange={(e) => set({ priority: e.target.value as BulkEditValues["priority"] })}>
              <option value="keep">{t("bulkEdit.keep")}</option>
              <option value="HIGH">{t("priority.HIGH")}</option>
              <option value="MEDIUM">{t("priority.MEDIUM")}</option>
              <option value="LOW">{t("priority.LOW")}</option>
              <option value="none">{t("bulkEdit.noPriority")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bulk-due-mode" className="text-sm font-medium">{t("bulkEdit.dueDate")}</label>
            <select id="bulk-due-mode" className={selectClass} value={values.dueMode} onChange={(e) => set({ dueMode: e.target.value as BulkEditValues["dueMode"] })}>
              <option value="keep">{t("bulkEdit.keep")}</option>
              <option value="set">{t("bulkEdit.setDate")}</option>
              <option value="clear">{t("bulkEdit.clearDate")}</option>
            </select>
            {values.dueMode === "set" && <Input aria-label={t("bulkEdit.newDate")} type="date" value={values.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bulk-tag-mode" className="text-sm font-medium">{t("bulkEdit.tags")}</label>
            <select id="bulk-tag-mode" className={selectClass} value={values.tagMode} onChange={(e) => set({ tagMode: e.target.value as BulkEditValues["tagMode"] })}>
              <option value="keep">{t("bulkEdit.keepTags")}</option>
              <option value="add">{t("bulkEdit.addTags")}</option>
              <option value="remove">{t("bulkEdit.removeTags")}</option>
              <option value="replace">{t("bulkEdit.replaceTags")}</option>
            </select>
            {values.tagMode !== "keep" && (
              <>
                <Input
                  aria-label={t(values.tagMode === "remove" ? "bulkEdit.tagsToRemove" : values.tagMode === "add" ? "bulkEdit.tagsToAdd" : "bulkEdit.newTags")}
                  aria-invalid={tagProblem ? true : undefined}
                  aria-describedby="bulk-tag-help"
                  placeholder={t(values.tagMode === "replace" ? "bulkEdit.replacePlaceholder" : "bulkEdit.tagsPlaceholder")}
                  value={values.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                />
                <p id="bulk-tag-help" className={tagProblem ? "text-xs text-destructive-text" : "text-xs text-foreground-muted"}>
                  {tagProblem ?? t("bulkEdit.tagsHelp")}
                </p>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!valid || pending} aria-label={pending ? t("bulkEdit.applying") : undefined}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("bulkEdit.apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
