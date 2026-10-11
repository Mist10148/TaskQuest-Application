import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePushConfig } from "@/hooks/useApi";
import { browserSupportsPush, currentPermission, currentSubscription, disablePush, enablePush, pushStatus, PUSH_STATUS_TEXT, type PushStatus } from "@/lib/push";
import { SettingRow } from "./SettingsSection";

/** Turn push notifications on or off for this browser, with the reason when it cannot be on. */
export const PushSettings = () => {
  const config = usePushConfig();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(currentPermission());

  const refresh = useCallback(async () => {
    setPermission(currentPermission());
    setSubscribed(Boolean(await currentSubscription().catch(() => null)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status: PushStatus = pushStatus({ supported: browserSupportsPush(), serverEnabled: Boolean(config.data?.enabled), permission, subscribed });

  const toggle = async () => {
    setBusy(true);
    try {
      if (status === "on") {
        await disablePush();
        toast.success("Push notifications are off for this browser.");
      } else {
        await enablePush(config.data?.publicKey ?? "");
        toast.success("Push notifications are on for this browser.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change push notifications.");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const canToggle = status === "on" || status === "off";

  return (
    <SettingRow label="Reminders on this device" description="Deadline and task reminders as browser notifications, in addition to Discord. Each browser is turned on separately.">
      <div className="flex flex-col gap-2 sm:items-end">
        <Button type="button" variant={status === "on" ? "secondary" : "glow"} size="sm" disabled={!canToggle || busy || config.isLoading} onClick={() => void toggle()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : status === "on" ? "Turn off" : "Turn on"}
        </Button>
        <p className="max-w-xs text-xs text-foreground-muted sm:text-right" role="status" data-testid="push-status">
          {PUSH_STATUS_TEXT[status]}
        </p>
      </div>
    </SettingRow>
  );
};
