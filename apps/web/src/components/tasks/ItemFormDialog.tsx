import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITIES, TEXT_LIMITS } from "./constants";
import type { ItemFormValues } from "./forms";

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

const REPEATS = [
  { value: "none", label: "No repeat" },
  { value: "daily", label: "🔁 Daily" },
  { value: "weekly", label: "🔁 Weekly" },
  { value: "monthly", label: "🔁 Monthly" },
];

/** One dialog for adding and editing a task and its details. */
export const ItemFormDialog = ({ open, onOpenChange, mode, initial, parentOptions, pending, onSubmit }: Props) => {
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
            {creating ? "Add Task" : "Edit Task"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return setNameError("Give your task a name.");
            setNameError("");
            onSubmit(form);
          }}
        >
          <div>
            <label htmlFor="item-name" className="text-sm font-medium block mb-1">Task Name *</label>
            <Input id="item-name" placeholder="What needs to be done?" value={form.name} onChange={(e) => { set("name", e.target.value); setNameError(""); }} autoFocus required maxLength={TEXT_LIMITS.ITEM_NAME} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "item-name-error" : undefined} />
            {nameError && <p id="item-name-error" role="alert" className="text-xs text-destructive-text mt-1">{nameError}</p>}
          </div>
          <div>
            <label htmlFor="item-desc" className="text-sm font-medium block mb-1">Description (optional)</label>
            <Textarea id="item-desc" placeholder="Add more details..." value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={TEXT_LIMITS.DESCRIPTION} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-due" className="text-sm font-medium block mb-1">Due date</label>
              <Input id="item-due" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Priority</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.filter((p) => p.value !== "all").map((p) => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Repeat</label>
              <Select value={form.recurrence} onValueChange={(v) => set("recurrence", v)}>
                <SelectTrigger aria-label="Repeat"><SelectValue /></SelectTrigger>
                <SelectContent>{REPEATS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="item-tags" className="text-sm font-medium block mb-1">Tags</label>
              <Input id="item-tags" placeholder="work, urgent" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="item-estimate" className="text-sm font-medium block mb-1">Estimate (minutes)</label>
            <Input id="item-estimate" type="number" inputMode="numeric" min={1} max={600} placeholder="25" value={form.estimate} onChange={(e) => set("estimate", e.target.value)} />
            <p className="text-xs text-foreground-muted mt-1">Finish it right after a focus session of about that length for a bonus.</p>
          </div>
          {parentOptions.length > 0 && (
            <div>
              <label className="text-sm font-medium block mb-1">Subtask of</label>
              <Select value={form.parent_id} onValueChange={(v) => set("parent_id", v)}>
                <SelectTrigger aria-label="Subtask of"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not a subtask</SelectItem>
                  {parentOptions.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : creating ? <Plus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {creating ? "Add Task" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
