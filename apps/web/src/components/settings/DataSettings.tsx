import { useRef, useState } from "react";
import { Copy, Download, FileSpreadsheet, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCalendarToken, useCsvImport, useImportData } from "@/hooks/useApi";
import { ApiError, apiUrl, type CsvImportCheck } from "@/lib/api";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { csvCounts, csvErrorLines, csvFileProblem } from "@/lib/csvImport";
import { SettingRow } from "./SettingsSection";

const MAX_IMPORT_BYTES = 1_000_000; // the server accepts 1 MB for imports

/** Calendar feed address for a token: on the API's own host, which is this site's unless VITE_API_URL splits them. */
const feedUrl = (token: string) => apiUrl(`/api/calendar/${token}.ics`);

/** Check a spreadsheet, show what it contains and any row problems, then import it only if it is clean. */
const CsvImport = () => {
  const { check, run } = useCsvImport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportCheck | null>(null);
  const [fileName, setFileName] = useState("");

  const reset = () => {
    setText(null);
    setResult(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // The text is kept, so the picker can be cleared now: choosing the same file again after fixing it must fire a change.
    if (fileRef.current) fileRef.current.value = "";
    const problem = csvFileProblem(file);
    if (problem) return void toast.error(problem);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setResult(await check.mutateAsync(content));
    } catch (error) {
      reset();
      toast.error(error instanceof Error ? error.message : "Couldn't read that file.");
    }
  };

  const doImport = async () => {
    if (text === null) return;
    try {
      const done = await run.mutateAsync(text);
      toast.success(`Imported ${csvCounts(done.lists, done.items)}`, { description: "Imports never award XP." });
      reset();
    } catch (error) {
      // The server re-checks everything; if it found problems we missed (or quota), show them in place.
      if (error instanceof ApiError && error.details && typeof error.details === "object" && "errors" in error.details) {
        const d = error.details as Pick<CsvImportCheck, "errors" | "errorCount">;
        setResult((prev) => (prev ? { ...prev, ok: false, errors: d.errors, errorCount: d.errorCount } : prev));
      } else toast.error(error instanceof Error ? error.message : "Import failed.");
    }
  };

  return (
    <SettingRow label="Import from CSV" description="Adds quests and tasks from a spreadsheet (a TaskQuest CSV export, or columns like list, task, due, priority, tags, repeat, done). Nothing you have is changed, and imports earn no XP.">
      <div className="w-full sm:max-w-md space-y-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="import-csv-file" aria-label="Choose a CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button type="button" variant="outline" size="sm" disabled={check.isPending || run.isPending} onClick={() => fileRef.current?.click()}>
          {check.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}Choose CSV file
        </Button>
        {result && (
          <div className="rounded-lg border border-border p-3 space-y-3 text-sm" aria-live="polite">
            <p className="font-medium break-all">{fileName}</p>
            <p className="text-foreground-muted">
              {result.rows} row{result.rows === 1 ? "" : "s"} found: {csvCounts(result.lists, result.items)}.
            </p>
            {result.preview.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <caption className="sr-only">First rows of the file</caption>
                  <thead className="text-foreground-muted"><tr><th className="pr-3 py-1">Row</th><th className="pr-3">Quest</th><th className="pr-3">Task</th><th>Due</th></tr></thead>
                  <tbody>
                    {result.preview.map((r) => (
                      <tr key={r.row} className="border-t border-border">
                        <td className="pr-3 py-1">{r.row}</td><td className="pr-3 break-words">{r.list}</td><td className="pr-3 break-words">{r.task || "(empty quest)"}</td><td>{r.due_date ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.errorCount > 0 && (
              <div role="alert" className="text-destructive-text">
                <p className="font-medium">Nothing was imported. Fix {result.errorCount} problem{result.errorCount === 1 ? "" : "s"} and choose the file again:</p>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {csvErrorLines(result.errors, result.errorCount).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={result.errorCount > 0 || result.items + result.lists === 0 || run.isPending} onClick={() => void doImport()}>
                {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Import
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={run.isPending} onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </SettingRow>
  );
};

/** Download your data (JSON or CSV) and bring a JSON export or a CSV back in. */
export const DataSettings = () => {
  const importData = useImportData();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) return void toast.error("That file is too large to import (1 MB limit).");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        return void toast.error("That file isn't valid JSON. Import a TaskQuest export.");
      }
      try {
        const result = await importData.mutateAsync(parsed);
        toast.success(`Imported ${result.lists} quest${result.lists === 1 ? "" : "s"} and ${result.items} task${result.items === 1 ? "" : "s"}`, {
          description: "Imports never award XP.",
        });
      } catch {
        /* error toast shown by the mutation hook */
      }
    } finally {
      // Reset so picking the same file again fires onChange.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <SettingRow label="Export your data" description="Everything you own: quests, tasks, dates and tags.">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href={apiUrl("/api/user/export")} download><Download className="h-4 w-4 mr-2" />JSON</a></Button>
          <Button asChild variant="outline" size="sm"><a href={apiUrl("/api/user/export.csv")} download><Download className="h-4 w-4 mr-2" />CSV</a></Button>
        </div>
      </SettingRow>
      <SettingRow label="Import from JSON" description="Adds quests from a TaskQuest export. Nothing you have is changed, and imports earn no XP.">
        <div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" disabled={importData.isPending} onClick={() => fileRef.current?.click()}>
            {importData.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Choose file
          </Button>
        </div>
      </SettingRow>
      <CsvImport />
    </div>
  );
};

/** Subscribe to your deadlines from Google Calendar, Apple Calendar or Outlook. */
export const CalendarFeed = ({ token, loading = false }: { token: string | null | undefined; loading?: boolean }) => {
  const { create, revoke } = useCalendarToken();
  const [shown, setShown] = useState(false);
  // Both change the address every subscribed calendar uses, so they ask first.
  const [confirm, setConfirm] = useState<"rotate" | "off" | null>(null);
  const url = token ? feedUrl(token) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Feed address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it by hand.");
    }
  };

  // The token is fetched separately; until it arrives "Create feed" must not show (it would rotate an existing feed).
  if (loading && !token) {
    return (
      <SettingRow label="Calendar feed" description="Loading your feed...">
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading calendar feed" />
      </SettingRow>
    );
  }

  if (!token) {
    return (
      <SettingRow label="Calendar feed" description="Show list deadlines and task due dates in your calendar app.">
        <Button type="button" variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create feed
        </Button>
      </SettingRow>
    );
  }

  return (
    <div className="py-3 space-y-3">
      <div>
        <p className="font-medium text-sm sm:text-base">Calendar feed</p>
        <p className="text-xs sm:text-sm text-foreground-muted">Add this address as a subscribed calendar. Anyone with it can see your deadlines, so keep it private.</p>
      </div>
      <div className="flex gap-2">
        <Input readOnly aria-label="Calendar feed address" value={shown ? url : url.replace(token, "•".repeat(12))} onFocus={(e) => { setShown(true); e.currentTarget.select(); }} onBlur={() => setShown(false)} className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" aria-label="Copy feed address" onClick={() => void copy()}><Copy className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={create.isPending} onClick={() => setConfirm("rotate")}>
          <RefreshCw className="h-4 w-4 mr-2" />New address
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-destructive-text" disabled={revoke.isPending} onClick={() => setConfirm("off")}>
          <Trash2 className="h-4 w-4 mr-2" />Turn off
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm === "off" ? "Turn off the calendar feed?" : "Make a new feed address?"}
        description={
          <p>
            {confirm === "off"
              ? "Calendars subscribed to this feed stop updating. You can create a new feed later."
              : "The current address stops working at once, so every calendar subscribed to it needs the new one."}
          </p>
        }
        confirmLabel={confirm === "off" ? "Turn off" : "New address"}
        onConfirm={() => {
          if (confirm === "off") revoke.mutate();
          else create.mutate();
          setConfirm(null);
        }}
      />
    </div>
  );
};
