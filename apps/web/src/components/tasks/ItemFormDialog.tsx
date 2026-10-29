import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { quickDueDates } from "@/lib/dates";
import { PRIORITIES, TEXT_LIMITS } from "./constants";
import type { ItemFormValues } from "./forms";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/messages";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: ItemFormValues;
  /** Top-level tasks this task could be a subtask of (empty when it has subtasks itself). */
  parentOptions: Array<{ id: number; name: string }>;
  pending: boolean;
  onSubmit: (values: ItemFormValues) => void;
}

const REPEATS: Array<{ value: string; label: MessageKey }> = [
  { value: "none", label: "task.repeat.none" },
  { value: "daily", label: "task.repeat.daily" },
  { value: "weekly", label: "task.repeat.weekly" },
  { value: "monthly", label: "task.repeat.monthly" },
];

/** One dialog for adding and editing a task and its details. */
export const ItemFormDialog = ({ open, onOpenChange, mode, initial, parentOptions, pending, onSubmit }: Props) => {
  const t = useT();
  const [form, setForm] = useState<ItemFormValues>(initial);
  const [nameError, setNameError] = useState("");
  useEffect(() => {
    if (open) {
      setForm(initial);
      setNameError("");
    }
  }, [open, initial]);
  const set = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));
  const creating = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {creating ? <Plus className="h-5 w-5 text-primary-text" /> : <Pencil className="h-5 w-5 text-primary-text" />}
            {t(creating ? "task.addTitle" : "task.editTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t(creating ? "task.addHint" : "task.editHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return setNameError(t("task.nameMissing"));
            setNameError("");
            onSubmit(form);
          }}
        >
          <div>
            <label htmlFor="item-name" className="text-sm font-medium block mb-1">{t("task.name")}</label>
            <Input id="item-name" placeholder={t("task.namePlaceholder")} value={form.name} onChange={(e) => { set("name", e.target.value); setNameError(""); }} autoFocus required maxLength={TEXT_LIMITS.ITEM_NAME} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "item-name-error" : undefined} />
            {nameError && <p id="item-name-error" role="alert" className="text-xs text-destructive-text mt-1">{nameError}</p>}
          </div>
          <div>
            <label htmlFor="item-desc" className="text-sm font-medium block mb-1">{t("task.description")}</label>
            <Textarea id="item-desc" placeholder={t("task.descriptionPlaceholder")} value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={TEXT_LIMITS.DESCRIPTION} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-due" className="text-sm font-medium block mb-1">{t("task.due")}</label>
              <Input id="item-due" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
              <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={t("task.quickDue")}>
                {quickDueDates().map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => set("due_date", q.value)}
                    aria-pressed={form.due_date === q.value}
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground-muted transition-colors hover:border-primary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-foreground"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="item-priority" className="text-sm font-medium block mb-1">{t("task.priority")}</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger id="item-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.filter((p) => p.value !== "all").map((p) => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-repeat" className="text-sm font-medium block mb-1">{t("task.repeat")}</label>
              <Select value={form.recurrence} onValueChange={(v) => set("recurrence", v)}>
                <SelectTrigger id="item-repeat"><SelectValue /></SelectTrigger>
                <SelectContent>{REPEATS.map((r) => <SelectItem key={r.value} value={r.value}>{t(r.label)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="item-tags" className="text-sm font-medium block mb-1">{t("task.tags")}</label>
              <Input id="item-tags" placeholder="work, urgent" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="item-estimate" className="text-sm font-medium block mb-1">{t("task.estimate")}</label>
            <Input id="item-estimate" type="number" inputMode="numeric" min={1} max={600} placeholder="25" value={form.estimate} onChange={(e) => set("estimate", e.target.value)} />
            <p className="text-xs text-foreground-muted mt-1">{t("task.estimateHint")}</p>
          </div>
          {parentOptions.length > 0 && (
            <div>
              <label htmlFor="item-parent" className="text-sm font-medium block mb-1">{t("task.parent")}</label>
              <Select value={form.parent_id} onValueChange={(v) => set("parent_id", v)}>
                <SelectTrigger id="item-parent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("task.noParent")}</SelectItem>
                  {parentOptions.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : creating ? <Plus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {t(creating ? "task.add" : "task.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
