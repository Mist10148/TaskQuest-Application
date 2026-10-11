import { useRef, useState } from "react";
import { Copy, Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCalendarToken, useImportData } from "@/hooks/useApi";
import { SettingRow } from "./SettingsSection";

const MAX_IMPORT_BYTES = 1_000_000; // the server accepts 1 MB for imports

/** Calendar feed address for a token, on this site's own origin. */
const feedUrl = (token: string) => `${window.location.origin}/api/calendar/${token}.ics`;

/** Download your data (JSON or CSV) and bring a JSON export back in. */
export const DataSettings = () => {
  const importData = useImportData();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
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
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <SettingRow label="Export your data" description="Everything you own: quests, tasks, dates and tags.">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href="/api/user/export" download><Download className="h-4 w-4 mr-2" />JSON</a></Button>
          <Button asChild variant="outline" size="sm"><a href="/api/user/export.csv" download><Download className="h-4 w-4 mr-2" />CSV</a></Button>
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
    </div>
  );
};

/** Subscribe to your deadlines from Google Calendar, Apple Calendar or Outlook. */
export const CalendarFeed = ({ token }: { token: string | null | undefined }) => {
  const { create, revoke } = useCalendarToken();
  const [shown, setShown] = useState(false);
  const url = token ? feedUrl(token) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Feed address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it by hand.");
    }
  };

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
        <Button type="button" variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          <RefreshCw className="h-4 w-4 mr-2" />New address
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-destructive-text" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
          <Trash2 className="h-4 w-4 mr-2" />Turn off
        </Button>
      </div>
    </div>
  );
};
