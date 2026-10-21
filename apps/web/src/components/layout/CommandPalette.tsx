import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Command, CornerDownLeft, ListPlus, Moon, Plus, Scroll, Search, Settings } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { filterCommands, moveActive, OPEN_PALETTE_EVENT, type PaletteCommand } from "@/lib/commands";
import { NAV_ITEMS, AI_NAV_ITEM } from "./navItems";
import { useTaskSearch } from "@/hooks/useApi";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchableQuery } from "@/lib/taskSearch";
import { modKeyLabel } from "@/lib/platform";

/** `hint` is a muted note on the right (a task's quest). */
type Entry = PaletteCommand & { icon: React.ElementType; run: () => void; hint?: string };

/** Most task matches shown under the commands. */
const MAX_TASK_HITS = 8;

/** Ctrl+K / Cmd+K command palette: go to a page, start a quest or task, switch theme. */
export const CommandPalette = ({ aiEnabled }: { aiEnabled: boolean }) => {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Ctrl+K works everywhere, even inside a text field; the sidebar button and the shortcuts dialog fire the event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const close = () => setOpen(false);

  // However it closes (Escape, a click outside, Ctrl+K, choosing an entry), it opens blank next time.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const pages = aiEnabled ? [...NAV_ITEMS.slice(0, 2), AI_NAV_ITEM, ...NAV_ITEMS.slice(2)] : NAV_ITEMS;
    const go = (path: string) => () => navigate(path);
    return [
      ...pages.map((p): Entry => ({ id: `go:${p.path}`, label: p.label, group: "Go to", icon: p.icon, keywords: p.keywords, run: go(p.path) })),
      { id: "go:/settings", label: "Settings", group: "Go to", icon: Settings, keywords: "preferences account", run: go("/settings") },
      { id: "new-quest", label: "New quest", group: "Actions", icon: Plus, keywords: "create list add", run: go("/tasks?new=quest") },
      { id: "new-task", label: "New task", group: "Actions", icon: ListPlus, keywords: "create item add todo", run: go("/tasks?new=task") },
      { id: "theme", label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme", group: "Actions", icon: Moon, keywords: "toggle theme dark light appearance", run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
    ];
  }, [aiEnabled, navigate, resolvedTheme, setTheme]);

  // Tasks whose name or description match (the server does the matching); only asked while the palette is open.
  const debouncedQuery = useDebouncedValue(query);
  const taskQuery = useTaskSearch(open ? searchableQuery(debouncedQuery) : null);
  const taskEntries = useMemo<Entry[]>(
    () =>
      (searchableQuery(query) ? taskQuery.data?.tasks ?? [] : []).slice(0, MAX_TASK_HITS).map((t): Entry => ({
        id: `task:${t.id}`,
        label: t.name,
        group: "Tasks",
        icon: Scroll,
        hint: t.list_name,
        run: () => navigate(`/tasks?list=${t.list_id}&task=${t.id}`),
      })),
    [query, taskQuery.data, navigate],
  );
  const results = useMemo(() => [...filterCommands(entries, query), ...taskEntries], [entries, query, taskEntries]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  // Task hits arrive after the debounce and the request: until then "no match" would be a false answer.
  const searching = searchableQuery(query) !== null && (debouncedQuery !== query || taskQuery.isFetching);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    entry.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(moveActive(activeIndex, 1, results.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(moveActive(activeIndex, -1, results.length)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[activeIndex]); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" onKeyDown={onKeyDown}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to search pages, actions and tasks, use the arrow keys and Enter to choose.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search pages, actions and tasks…"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={results[activeIndex] ? `palette-${results[activeIndex].id}` : undefined}
            aria-label="Search commands"
            className="h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-foreground-muted"
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-foreground-muted" role="status">{searching ? "Searching tasks…" : "No matching command."}</li>}
          {results.map((r, i) => {
            const Icon = r.icon;
            const showGroup = i === 0 || results[i - 1].group !== r.group;
            return (
              <li key={r.id} role="presentation">
                {showGroup && <p className="px-3 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-foreground-muted" aria-hidden>{r.group}</p>}
                <div
                  id={`palette-${r.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(r)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === activeIndex ? "bg-primary text-primary-foreground" : "hover:bg-background-secondary")}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{r.label}</span>
                  {r.hint && <span className={cn("max-w-[40%] truncate text-xs", i === activeIndex ? "opacity-80" : "text-foreground-muted")}>{r.hint}</span>}
                  {i === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 opacity-80" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-xs text-foreground-muted">
          <Command className="h-3 w-3" aria-hidden /> {modKeyLabel()}+K toggles this palette
        </p>
      </DialogContent>
    </Dialog>
  );
};
