import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ItemFormValues } from "./forms";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: ItemFormValues;
  pending: boolean;
  onSubmit: (values: ItemFormValues) => void;
}

/** One dialog for adding and editing a task. */
export const ItemFormDialog = ({ open, onOpenChange, mode, initial, pending, onSubmit }: Props) => {
  const [form, setForm] = useState<ItemFormValues>(initial);
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);
  const creating = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {creating ? <Plus className="h-5 w-5 text-primary" /> : <Pencil className="h-5 w-5 text-primary" />}
            {creating ? "Add Task" : "Edit Task"}
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
            <label htmlFor="item-name" className="text-sm font-medium block mb-1">Task Name *</label>
            <Input id="item-name" placeholder="What needs to be done?" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </div>
          <div>
            <label htmlFor="item-desc" className="text-sm font-medium block mb-1">Description (optional)</label>
            <Textarea id="item-desc" placeholder="Add more details..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </div>
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
