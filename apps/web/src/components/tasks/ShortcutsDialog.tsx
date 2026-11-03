import { Keyboard, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/lib/commands";
import { modKeyLabel } from "@/lib/platform";
import { GO_TO_KEYS } from "@/lib/goTo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MessageKey } from "@/i18n/messages";
import { useT } from "@/i18n/useT";

/** The keys, and the catalog entry that says what each does. */
const SHORTCUTS: Array<[string, MessageKey]> = [
  ["n", "shortcuts.newItem"],
  ["/", "shortcuts.search"],
  ["s", "shortcuts.select"],
  ["j / k", "shortcuts.move"],
  ["x", "shortcuts.complete"],
  ["i", "shortcuts.details"],
  ["e", "shortcuts.edit"],
  ["d", "shortcuts.delete"],
  ["1 / 2 / 3", "shortcuts.views"],
  ["Shift A", "shortcuts.selectAll"],
  ["Esc", "shortcuts.escape"],
  ["?", "shortcuts.help"],
];

/** Keyboard shortcut cheat sheet, opened with "?". */
export const ShortcutsDialog = ({ open, onOpenChange, aiEnabled = false }: { open: boolean; onOpenChange: (open: boolean) => void; aiEnabled?: boolean }) => {
  const t = useT();
  const rows: Array<[string, string]> = [
    ...SHORTCUTS.map(([key, text]): [string, string] => [key, t(text)]),
    [`${modKeyLabel()} K`, t("shortcuts.palette")],
    // "g d Dashboard, g t Today …": the go-to keys that work on every page.
    [t("shortcuts.goToKey"), t("shortcuts.goTo", { keys: GO_TO_KEYS.filter((g) => !g.ai || aiEnabled).map((g) => `${g.key} ${g.label}`).join(", ") })],
  ];
  return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-primary-text" /> {t("shortcuts.title")}</DialogTitle>
        <DialogDescription>{t("shortcuts.hint")}</DialogDescription>
      </DialogHeader>
      <dl className="space-y-2 py-2">
        {rows.map(([key, text]) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <dt><kbd className="inline-flex min-w-8 justify-center rounded-md border border-border bg-background-secondary px-2 py-1 font-mono text-xs">{key}</kbd></dt>
            <dd className="text-foreground-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => { onOpenChange(false); openCommandPalette(); }}>
        <Search className="h-4 w-4" aria-hidden /> {t("shortcuts.openPalette")}
      </Button>
    </DialogContent>
  </Dialog>
  );
};
