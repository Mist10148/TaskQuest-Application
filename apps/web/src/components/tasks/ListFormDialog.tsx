import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localToday } from "@/lib/dates";
import { CATEGORIES, PRIORITIES } from "./constants";
import type { ListFormValues } from "./forms";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: ListFormValues;
  pending: boolean;
  onSubmit: (values: ListFormValues) => void;
}

/** One dialog for creating and editing a quest (they share every field). */
export const ListFormDialog = ({ open, onOpenChange, mode, initial, pending, onSubmit }: Props) => {
  const [form, setForm] = useState<ListFormValues>(initial);
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const set = <K extends keyof ListFormValues>(key: K, value: ListFormValues[K]) => setForm((f) => ({ ...f, [key]: value }));
  const creating = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {creating ? <Plus className="h-5 w-5 text-primary" /> : <Pencil className="h-5 w-5 text-primary" />}
            {creating ? "Create Quest" : "Edit Quest"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          <div>
            <label htmlFor="list-name" className="text-sm font-medium block mb-1">Name *</label>
            <Input id="list-name" placeholder="Quest name..." value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </div>
          <div>
            <label htmlFor="list-desc" className="text-sm font-medium block mb-1">Description (optional)</label>
            <Textarea id="list-desc" placeholder="What's this quest about?" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Category</label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.filter((c) => c.value !== "all").map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Priority</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.filter((p) => p.value !== "all").map((p) => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label htmlFor="list-deadline" className="text-sm font-medium block mb-1">Deadline (optional)</label>
            <Input id="list-deadline" type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} min={creating ? localToday() : undefined} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : creating ? <Plus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {creating ? "Create" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
