import { useState } from "react";
import { FileStack, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApplyTemplate, useDeleteTemplate, useTemplates } from "@/hooks/useApi";
import { TEMPLATE_MAX_COUNT, templateSummary } from "@/lib/templates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new quest's id once a template has been applied. */
  onApplied: (listId: number) => void;
}

/** Your saved templates: turn one into a new quest, or delete it. Saving happens from a quest's page. */
export const TemplatesDialog = ({ open, onOpenChange, onApplied }: Props) => {
  const templates = useTemplates();
  const apply = useApplyTemplate();
  const remove = useDeleteTemplate();
  const saved = templates.data?.length ?? 0;
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const use = async (id: number) => {
    setApplyingId(id);
    try {
      const result = await apply.mutateAsync({ id });
      onOpenChange(false);
      onApplied(result.list.id);
    } catch {
      /* error toast shown by the mutation hook */
    }
    setApplyingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmId(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileStack className="h-5 w-5 text-primary-text" />Quest templates</DialogTitle>
          <DialogDescription>Start a new quest with a ready-made set of tasks. Tasks pay XP like any new task, within the daily limits.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
          {templates.isLoading ? (
            <div className="flex justify-center py-6" aria-busy="true"><Loader2 className="h-5 w-5 animate-spin text-foreground-muted" /></div>
          ) : templates.isError ? (
            <p className="text-sm text-destructive-text" role="alert">Could not load your templates. <button type="button" className="underline" onClick={() => void templates.refetch()}>Try again</button></p>
          ) : (templates.data ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted py-4 text-center">No templates yet. Open a quest and choose "Save as template".</p>
          ) : (
            (templates.data ?? []).map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{t.name}</p>
                  <p className="text-xs text-foreground-muted break-words">{templateSummary(t)}</p>
                </div>
                {confirmId === t.id ? (
                  <div className="flex gap-1 shrink-0" role="group" aria-label={`Delete ${t.name}?`}>
                    <Button type="button" size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(t.id, { onSuccess: () => toast.success(`Deleted the template "${t.name}"`), onSettled: () => setConfirmId(null) })}>Delete</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Keep</Button>
                  </div>
                ) : (
                  <div className="flex gap-1 shrink-0">
                    <Button type="button" size="sm" disabled={apply.isPending} onClick={() => void use(t.id)}>
                      {applyingId === t.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Use
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="text-destructive-text" aria-label={`Delete template ${t.name}`} onClick={() => setConfirmId(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {saved > 0 && (
          <p className="text-xs text-foreground-muted">
            {saved} of {TEMPLATE_MAX_COUNT} templates saved{saved >= TEMPLATE_MAX_COUNT ? ": delete one to save another." : "."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};
