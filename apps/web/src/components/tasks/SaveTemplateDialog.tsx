import { useEffect, useState } from "react";
import { FilePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSaveAsTemplate } from "@/hooks/useApi";
import { defaultTemplateName } from "@/lib/templates";
import { TEXT_LIMITS } from "./constants";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: number;
  listName: string;
}

/** Name and save the current quest's tasks as a template (due dates and progress are not kept). */
export const SaveTemplateDialog = ({ open, onOpenChange, listId, listName }: Props) => {
  const save = useSaveAsTemplate();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(defaultTemplateName(listName));
  }, [open, listName]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ listId, name: name.trim() });
      onOpenChange(false);
    } catch {
      /* error toast shown by the mutation hook (for example a taken name) */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FilePlus className="h-5 w-5 text-primary-text" />Save as template</DialogTitle>
          <DialogDescription>Keeps this quest's tasks (names, notes, priorities, tags and repeats) so you can start a new quest from them later.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div>
            <label htmlFor="template-name" className="text-sm font-medium block mb-1">Template name</label>
            <Input id="template-name" value={name} maxLength={TEXT_LIMITS.LIST_NAME} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>{save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
