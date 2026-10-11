import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, Bot, CalendarDays, ExternalLink, Loader2, LogOut, Palette, Settings as SettingsIcon, Sparkles, Zap, Database } from "lucide-react";
import { userApi, type User } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { SettingRow, SettingsSection, SwitchRow } from "@/components/settings/SettingsSection";
import { ReminderSettings } from "@/components/settings/ReminderSettings";
import { PushSettings } from "@/components/settings/PushSettings";
import { CalendarFeed, DataSettings } from "@/components/settings/DataSettings";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useUpdateSettings, useResetProgress, usePushConfig } from "@/hooks/useApi";
import { resetTour, startTour } from "@/lib/tour";

// Optional: set VITE_BOT_INVITE_URL at build time to show an "Add the bot" button.
const BOT_INVITE_URL = /^https:\/\//.test(import.meta.env.VITE_BOT_INVITE_URL || "") ? (import.meta.env.VITE_BOT_INVITE_URL as string) : "";

const SWITCH_FIELDS = {
  gamification: "gamification_enabled",
  automation: "automation_enabled",
  autoDelete: "auto_delete_old_lists",
  ai: "ai_enabled",
  weekly: "weekly_digest",
} as const;

type SwitchKey = keyof typeof SWITCH_FIELDS;

const Settings = () => {
  const { user, logout, refresh } = useAuth();
  const updateSettings = useUpdateSettings();
  // Hidden unless the server has VAPID keys (web push is optional).
  const pushAvailable = Boolean(usePushConfig().data?.enabled);
  const resetProgress = useResetProgress();
  const { reduceMotion, setReduceMotion, sound, setSound } = usePreferences();
  const [confirmText, setConfirmText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const dbUser: Partial<User> = user?.user ?? {};
  // The feed token is a secret, so /api/auth/me no longer carries it; it is fetched only while the feed is on.
  // The key sits under "auth" so creating or revoking the feed (which invalidates "auth") refreshes it.
  const calendar = useQuery({ queryKey: ["auth", "calendar-token", Boolean(dbUser.has_calendar_token)], queryFn: userApi.getCalendarToken, enabled: Boolean(dbUser.has_calendar_token) });
  // The server row is the source of truth; switches follow it after each save.
  const on = (value: boolean | number | undefined, fallback: boolean) => Boolean(value ?? fallback);

  // Fields with a save in flight: their control is disabled so a second click cannot race the first.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const save = async (patch: Parameters<typeof updateSettings.mutateAsync>[0]) => {
    const fields = Object.keys(patch);
    setSaving((prev) => new Set([...prev, ...fields]));
    try {
      // The switch already moved (optimistic update); one toast confirms the save, and the hook shows the error.
      await updateSettings.mutateAsync(patch);
      toast.success("Settings saved");
    } catch {
      /* error toast shown by the mutation hook; the control snapped back to the saved value */
    } finally {
      setSaving((prev) => new Set([...prev].filter((f) => !fields.includes(f))));
    }
  };
  const toggle = (key: SwitchKey, value: boolean) => save({ [SWITCH_FIELDS[key]]: value });

  const handleReset = async () => {
    if (confirmText !== "RESET") return void toast.error("Please type RESET to confirm");
    try {
      await resetProgress.mutateAsync();
      toast.success("All progress has been reset!");
      setResetOpen(false);
      setConfirmText("");
      await refresh();
    } catch {
      /* error toast shown by the mutation hook; the dialog stays open with RESET still typed */
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2">Settings</h1>
            <p className="text-foreground-muted text-sm sm:text-base">Manage your preferences</p>
          </motion.div>
        </div>

        <SettingsSection icon={<Palette className="h-5 w-5 text-primary-text" />} title="Appearance" description="This device only" delay={0.05}>
          <SettingRow label="Theme" description="Follow your system, or pick one.">
            <ThemeToggle />
          </SettingRow>
          <SwitchRow label="Reduce motion" description="Turn off animations and the confetti. Your system setting is respected too." checked={reduceMotion} onChange={setReduceMotion} />
          <SwitchRow label="Game sounds" description="Short sound effects in the arcade games." checked={sound} onChange={setSound} />
          <SettingRow label="Welcome tour" description="A four-step intro to quests, XP, classes and shortcuts.">
            <Button variant="outline" size="sm" onClick={() => { resetTour(); startTour(); }}>Replay tour</Button>
          </SettingRow>
        </SettingsSection>

        <SettingsSection icon={<Sparkles className="h-5 w-5 text-xp" />} title="Gamification" description="XP rewards and leveling" tint="bg-xp/20" delay={0.1}>
          <SwitchRow label="Enable gamification" description="Earn XP for tasks" checked={on(dbUser.gamification_enabled, true)} disabled={saving.has("gamification_enabled")} onChange={(v) => void toggle("gamification", v)} />
        </SettingsSection>

        <SettingsSection icon={<Zap className="h-5 w-5 text-primary-text" />} title="Reminders & automation" description="When and how TaskQuest nudges you on Discord" delay={0.15}>
          <ReminderSettings
            user={dbUser}
            automation={on(dbUser.automation_enabled, true)}
            weeklyDigest={on(dbUser.weekly_digest, false)}
            autoDelete={on(dbUser.auto_delete_old_lists, true)}
            onToggle={(key, value) => void toggle(key, value)}
            onSave={(patch) => void save(patch)}
            saving={saving}
          />
        </SettingsSection>

        {pushAvailable && (
          <SettingsSection icon={<Bell className="h-5 w-5 text-primary-text" />} title="Push notifications" description="Reminders as browser notifications" delay={0.16}>
            <PushSettings />
          </SettingsSection>
        )}

        <SettingsSection icon={<CalendarDays className="h-5 w-5 text-primary-text" />} title="Calendar feed" description="Deadlines in Google, Apple or Outlook Calendar" delay={0.17}>
          <CalendarFeed token={dbUser.has_calendar_token ? calendar.data?.token : null} loading={Boolean(dbUser.has_calendar_token) && calendar.isPending} />
        </SettingsSection>

        <SettingsSection icon={<Database className="h-5 w-5 text-primary-text" />} title="Your data" description="Export and import" delay={0.18}>
          <DataSettings />
        </SettingsSection>

        {user?.features?.aiAvailable && (
          <SettingsSection icon={<Bot className="h-5 w-5 text-primary-text" />} title="AI Assistant" description="Summaries, priorities and chat" delay={0.19}>
            <SwitchRow
              label="Enable AI features"
              description="Your quests are sent to Google Gemini only when you use an AI feature."
              checked={on(dbUser.ai_enabled, true)}
              disabled={saving.has("ai_enabled")}
              onChange={(v) => void toggle("ai", v)}
            />
          </SettingsSection>
        )}

        {BOT_INVITE_URL && (
          <SettingsSection icon={<ExternalLink className="h-5 w-5 text-[#5865F2]" />} title="Discord Bot" description="Manage from Discord" tint="bg-[#5865F2]/20" delay={0.2}>
            <div className="py-3">
              <p className="text-xs sm:text-sm text-foreground-muted mb-4">Use the TaskQuest Discord bot to manage tasks, play games, and track progress directly from Discord.</p>
              <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                <a href={BOT_INVITE_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Add Bot to Server</a>
              </Button>
            </div>
          </SettingsSection>
        )}

        <SettingsSection icon={<AlertTriangle className="h-5 w-5 text-destructive-text" />} title="Danger Zone" description="Irreversible actions" danger delay={0.25}>
          <SettingRow label="Reset all progress" description="Delete all data, including AI chats and summaries, and start fresh.">
            <AlertDialog
              open={resetOpen}
              onOpenChange={(open) => {
                if (resetProgress.isPending) return; // do not close while the request is running
                setResetOpen(open);
                if (!open) setConfirmText("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="w-full sm:w-auto">Reset Progress</Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md mx-4">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive-text">⚠️ Reset all progress?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>This will permanently delete:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>All your quests and tasks</li>
                        <li>All achievements, XP and levels</li>
                        <li>All purchased classes and unlocked skills</li>
                        <li>All game history</li>
                        <li>All AI chats, summaries and search data</li>
                      </ul>
                      <p className="font-semibold pt-2">Type <span className="text-destructive-text">RESET</span> to confirm:</p>
                      <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        aria-label="Type RESET to confirm"
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                        placeholder="Type RESET"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                  <AlertDialogCancel className="w-full sm:w-auto" disabled={resetProgress.isPending}>Cancel</AlertDialogCancel>
                  <Button
                    type="button"
                    onClick={() => void handleReset()}
                    disabled={confirmText !== "RESET" || resetProgress.isPending}
                    variant="destructive"
                    className="w-full sm:w-auto"
                  >
                    {resetProgress.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Reset Everything
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingRow>
        </SettingsSection>

        <SettingsSection icon={<SettingsIcon className="h-5 w-5 text-foreground-muted" />} title="Account" description="Manage your account" tint="bg-foreground/10" delay={0.3}>
          <div className="py-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto"><LogOut className="h-4 w-4 mr-2" />Log Out</Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-sm mx-4">
                <AlertDialogHeader>
                  <AlertDialogTitle>Log out?</AlertDialogTitle>
                  <AlertDialogDescription>You'll need to sign in with Discord again to come back.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Stay</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void logout()}>Log out</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SettingsSection>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
