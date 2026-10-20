import { Keyboard, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/lib/commands";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: Array<[string, string]> = [
  ["n", "New quest, or new task inside a quest"],
  ["/", "Search quests, or focus quick add inside a quest"],
  ["s", "Select several tasks (inside a quest)"],
  ["j / k", "Move down or up the tasks (inside a quest)"],
  ["x", "Complete or reopen the highlighted task"],
  ["i", "Open the details of the highlighted task"],
  ["e", "Edit the highlighted task"],
  ["d", "Delete the highlighted task (with Undo)"],
  ["Esc", "Leave select mode or go back to the quest log"],
  ["?", "Show this list"],
  ["Ctrl K", "Command palette: go to a page, new quest or task, switch theme (works anywhere)"],
];

/** Keyboard shortcut cheat sheet, opened with "?". */
export const ShortcutsDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-primary-text" /> Keyboard shortcuts</DialogTitle>
        <DialogDescription>Shortcuts work when you are not typing in a field.</DialogDescription>
      </DialogHeader>
      <dl className="space-y-2 py-2">
        {SHORTCUTS.map(([key, text]) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <dt><kbd className="inline-flex min-w-8 justify-center rounded-md border border-border bg-background-secondary px-2 py-1 font-mono text-xs">{key}</kbd></dt>
            <dd className="text-foreground-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => { onOpenChange(false); openCommandPalette(); }}>
        <Search className="h-4 w-4" aria-hidden /> Open command palette
      </Button>
    </DialogContent>
  </Dialog>
);
