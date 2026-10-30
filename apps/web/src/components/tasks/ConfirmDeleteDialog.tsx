import type { ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/i18n/useT";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * Destructive confirmation used for deleting quests and tasks. An alert dialog: it is announced as one, and a click outside
 * does not dismiss it. The caller closes it once the delete has gone through, so it stays open while `pending`.
 */
export const ConfirmDeleteDialog = ({ open, onOpenChange, title, description, confirmLabel, pending, onConfirm }: Props) => {
  const t = useT();
  return (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="sm:max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-destructive-text" aria-hidden />
          </div>
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="pt-2">{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="gap-2 sm:gap-0">
        <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
        {/* While pending the label stays for screen readers, so the button keeps its name next to the spinner. */}
        <Button variant="destructive" onClick={onConfirm} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span className="sr-only">{confirmLabel}</span></> : confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  );
};
