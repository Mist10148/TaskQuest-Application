import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localToday } from "@/lib/dates";
import { CATEGORIES, PRIORITIES, TEXT_LIMITS } from "./constants";
import type { ListFormValues } from "./forms";
import { useT } from "@/i18n/useT";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: ListFormValues;
  /** Identifies what is being edited (the list id); the form only resets when this or `open` changes. */
  resetKey?: number | null;
  pending: boolean;
  onSubmit: (values: ListFormValues) => void;
}

/** One dialog for creating and editing a quest (they share every field). */
export const ListFormDialog = ({ open, onOpenChange, mode, initial, resetKey = null, pending, onSubmit }: Props) => {
  const t = useT();
  const [form, setForm] = useState<ListFormValues>(initial);
  const [nameError, setNameError] = useState("");
  // Background refetches change `initial`; only reset when the dialog opens or a different list is edited,
  // so typing is never wiped.
  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  });
  useEffect(() => {
    if (open) {
      setForm(initialRef.current);
      setNameError("");
    }
  }, [open, resetKey]);

  const set = <K extends keyof ListFormValues>(key: K, value: ListFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));
  const creating = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {creating ? <Plus className="h-5 w-5 text-primary-text" /> : <Pencil className="h-5 w-5 text-primary-text" />}
            {t(creating ? "quest.createTitle" : "quest.editTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t(creating ? "quest.createHint" : "quest.editHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return setNameError(t("quest.nameMissing"));
            setNameError("");
            onSubmit(form);
          }}
        >
          <div>
            <label htmlFor="list-name" className="text-sm font-medium block mb-1">{t("quest.name")}</label>
            <Input id="list-name" placeholder={t("quest.namePlaceholder")} value={form.name} onChange={(e) => { set("name", e.target.value); setNameError(""); }} autoFocus required maxLength={TEXT_LIMITS.LIST_NAME} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "list-name-error" : undefined} />
            {nameError && <p id="list-name-error" role="alert" className="text-xs text-destructive-text mt-1">{nameError}</p>}
          </div>
          <div>
            <label htmlFor="list-desc" className="text-sm font-medium block mb-1">{t("quest.description")}</label>
            <Textarea id="list-desc" placeholder={t("quest.descriptionPlaceholder")} value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={TEXT_LIMITS.DESCRIPTION} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="list-category" className="text-sm font-medium block mb-1">{t("quest.category")}</label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger id="list-category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.filter((c) => c.value !== "all").map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="list-priority" className="text-sm font-medium block mb-1">{t("quest.priority")}</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger id="list-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.filter((p) => p.value !== "all").map((p) => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label htmlFor="list-deadline" className="text-sm font-medium block mb-1">{t("quest.deadline")}</label>
            <Input id="list-deadline" type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} min={creating ? localToday() : undefined} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : creating ? <Plus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {t(creating ? "quest.create" : "quest.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
