import { useMemo } from "react";
import type { User } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SettingRow, SwitchRow } from "./SettingsSection";

const selectClass =
  "h-9 w-full sm:w-64 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Supported = { supportedValuesOf?: (key: string) => string[] };

/** Every IANA time zone the browser knows (falls back to a short list on old browsers). */
function listTimeZones(): string[] {
  const zones = (Intl as unknown as Supported).supportedValuesOf?.("timeZone");
  return zones?.length ? zones : ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney"];
}

const detectedZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

interface Props {
  user: Partial<User>;
  automation: boolean;
  weeklyDigest: boolean;
  autoDelete: boolean;
  onToggle: (key: "automation" | "weekly" | "autoDelete", value: boolean) => void;
  onSave: (patch: { timezone?: string | null; reminder_hour?: number }) => void;
}

/** Deadline reminders: on/off, the time zone and hour they arrive, the weekly digest and auto-delete. */
export const ReminderSettings = ({ user, automation, weeklyDigest, autoDelete, onToggle, onSave }: Props) => {
  const zones = useMemo(listTimeZones, []);
  const zone = user.timezone || "";
  const detected = detectedZone();

  return (
    <div>
      <SwitchRow label="Deadline reminders" description="A Discord DM when a list is due, and one more if it goes overdue." checked={automation} onChange={(v) => onToggle("automation", v)} />
      <SettingRow label="Time zone" description={zone ? "Deadlines are dates; this decides when your day starts." : "Not set: reminders use UTC dates."}>
        <div className="flex flex-col gap-2 sm:items-end">
          <select
            aria-label="Time zone"
            className={selectClass}
            value={zone}
            onChange={(e) => onSave({ timezone: e.target.value || null })}
          >
            <option value="">UTC (not set)</option>
            {zones.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
          {detected && detected !== zone && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onSave({ timezone: detected })}>
              Use this device's zone ({detected})
            </Button>
          )}
        </div>
      </SettingRow>
      <SettingRow label="Reminder hour" description="When in your day reminders and the weekly digest arrive.">
        <select aria-label="Reminder hour" className={selectClass} value={user.reminder_hour ?? 9} onChange={(e) => onSave({ reminder_hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{hourLabel(h)}</option>
          ))}
        </select>
      </SettingRow>
      <SwitchRow label="Weekly digest" description="A Monday DM with your week: tasks finished, XP, streak and overdue lists." checked={weeklyDigest} onChange={(v) => onToggle("weekly", v)} />
      <SwitchRow label="Auto-delete finished lists" description="Delete a list 5 days after all of its tasks are done. Unfinished lists are never deleted." checked={autoDelete} onChange={(v) => onToggle("autoDelete", v)} />
    </div>
  );
};
