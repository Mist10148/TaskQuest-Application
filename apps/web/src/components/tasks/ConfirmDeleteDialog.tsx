import type { ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}

/** Destructive confirmation used for deleting quests and tasks. */
export const ConfirmDeleteDialog = ({ open, onOpenChange, title, description, confirmLabel, pending, onConfirm }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-destructive-text" />
          </div>
          {title}
        </DialogTitle>
        <DialogDescription className="pt-2">{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" onClick={onConfirm} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
