import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Sparkles, Zap, LogOut, ExternalLink, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateSettings, useResetProgress } from "@/hooks/useApi";
import { toast } from "sonner";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const { user, logout, refresh, useMock } = useAuth();
  const updateSettings = useUpdateSettings();
  const resetProgress = useResetProgress();
  
  const dbUser = user?.user || {};
  const [gamification, setGamification] = useState(dbUser.gamification_enabled ?? true);
  const [automation, setAutomation] = useState(dbUser.automation_enabled ?? true);
  const [autoDelete, setAutoDelete] = useState(dbUser.auto_delete_old_lists ?? true);
  const [confirmText, setConfirmText] = useState("");

  const handleToggle = async (key: string, value: boolean) => {
    if (key === 'gamification') setGamification(value);
    else if (key === 'automation') setAutomation(value);
    else if (key === 'autoDelete') setAutoDelete(value);

    if (useMock) {
      toast.success('Settings updated!');
      return;
    }
    try {
      const fieldName = key === 'gamification' ? 'gamification_enabled' :
                        key === 'automation' ? 'automation_enabled' :
                        'auto_delete_old_lists';
      await updateSettings.mutateAsync({ [fieldName]: value });
      toast.success('Settings updated!');
      refresh();
    } catch {
      toast.error('Failed to update settings');
    }
  };

  const handleReset = async () => {
    if (confirmText !== "RESET") {
      toast.error('Please type RESET to confirm');
      return;
    }
    
    try {
      await resetProgress.mutateAsync();
      toast.success('All progress has been reset!');
      setConfirmText("");
      refresh();
    } catch {
      toast.error('Failed to reset progress');
    }
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to log out?')) {
      await logout();
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2">Settings</h1>
            <p className="text-foreground-muted text-sm sm:text-base">Manage your preferences</p>
          </motion.div>
        </div>

        {/* Gamification Settings */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl bg-card border border-border p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-xp/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-5 w-5 text-xp" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold">Gamification</h2>
              <p className="text-sm text-foreground-muted truncate">XP rewards and leveling</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm sm:text-base">Enable Gamification</p>
              <p className="text-xs sm:text-sm text-foreground-muted">Earn XP for tasks</p>
            </div>
            <Switch checked={gamification} onCheckedChange={(v) => handleToggle('gamification', v)} />
          </div>
        </motion.div>

        {/* Automation Settings */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl bg-card border border-border p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold">Automation</h2>
              <p className="text-sm text-foreground-muted truncate">Reminders and actions</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm sm:text-base">Enable Automation</p>
              <p className="text-xs sm:text-sm text-foreground-muted">Get deadline reminders</p>
            </div>
            <Switch checked={automation} onCheckedChange={(v) => handleToggle('automation', v)} />
          </div>
        </motion.div>

        {/* Auto-Delete Settings */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }} className="rounded-xl bg-card border border-border p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
              <Trash2 className="h-5 w-5 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold">Auto-Delete</h2>
              <p className="text-sm text-foreground-muted truncate">Automatically clean up old lists</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm sm:text-base">Auto-Delete Old Lists</p>
              <p className="text-xs sm:text-sm text-foreground-muted">Delete expired/completed lists after 5 days</p>
            </div>
            <Switch checked={autoDelete} onCheckedChange={(v) => handleToggle('autoDelete', v)} />
          </div>
        </motion.div>

        {/* Discord Bot */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl bg-card border border-border p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-[#5865F2]/20 flex items-center justify-center flex-shrink-0">
              <svg className="h-5 w-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold">Discord Bot</h2>
              <p className="text-sm text-foreground-muted truncate">Manage from Discord</p>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-foreground-muted mb-4">Use the TaskQuest Discord bot to manage tasks, play games, and track progress directly from Discord.</p>
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <a href="#" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Add Bot to Server</a>
          </Button>
        </motion.div>

        {/* Danger Zone */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="rounded-xl bg-card border border-destructive/30 p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-destructive/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold text-destructive">Danger Zone</h2>
              <p className="text-sm text-foreground-muted truncate">Irreversible actions</p>
            </div>
          </div>
          
          <div className="space-y-4 border-t border-border pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm sm:text-base">Reset All Progress</p>
                <p className="text-xs sm:text-sm text-foreground-muted">Delete all data and start fresh</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full sm:w-auto">Reset Progress</Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-md mx-4">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive">⚠️ Reset All Progress?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will permanently delete:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>All your quests and tasks</li>
                        <li>All achievements</li>
                        <li>All XP and levels</li>
                        <li>All purchased classes</li>
                        <li>All unlocked skills</li>
                        <li>All game history</li>
                      </ul>
                      <p className="font-semibold pt-2">Type <span className="text-destructive">RESET</span> to confirm:</p>
                      <input 
                        type="text" 
                        value={confirmText} 
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                        placeholder="Type RESET"
                      />
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <AlertDialogCancel className="w-full sm:w-auto" onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleReset} 
                      disabled={confirmText !== "RESET" || resetProgress.isPending}
                      className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {resetProgress.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Reset Everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </motion.div>

        {/* Account */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="rounded-xl bg-card border border-border p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-foreground/10 flex items-center justify-center flex-shrink-0">
              <SettingsIcon className="h-5 w-5 text-foreground-muted" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold">Account</h2>
              <p className="text-sm text-foreground-muted truncate">Manage your account</p>
            </div>
          </div>
          <Button variant="outline" className="w-full sm:w-auto" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />Log Out
          </Button>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
