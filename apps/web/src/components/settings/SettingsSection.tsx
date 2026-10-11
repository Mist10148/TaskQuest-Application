import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Tint for the icon tile, e.g. "bg-primary/20". */
  tint?: string;
  danger?: boolean;
  delay?: number;
  children: ReactNode;
}

/** A titled card in the settings page. */
export const SettingsSection = ({ icon, title, description, tint = "bg-primary/20", danger, delay = 0, children }: SectionProps) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    aria-labelledby={`settings-${title.replace(/\W+/g, "-").toLowerCase()}`}
    className={cn("rounded-xl bg-card border p-4 sm:p-6 mb-4 sm:mb-6", danger ? "border-destructive/30" : "border-border")}
  >
    <div className="flex items-center gap-3 mb-4">
      <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0", danger ? "bg-destructive/20" : tint)}>{icon}</div>
      <div className="min-w-0">
        <h2 id={`settings-${title.replace(/\W+/g, "-").toLowerCase()}`} className={cn("font-heading font-semibold", danger && "text-destructive")}>{title}</h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
    </div>
    <div className="border-t border-border">{children}</div>
  </motion.section>
);

interface RowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

/** One setting: text on the left, the control on the right. */
export const SettingRow = ({ label, description, children }: RowProps) => (
  <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 [&+&]:border-t [&+&]:border-border">
    <div className="min-w-0">
      <p className="font-medium text-sm sm:text-base">{label}</p>
      {description && <p className="text-xs sm:text-sm text-foreground-muted">{description}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

/** A switch row with an accessible name. */
export const SwitchRow = ({ label, description, checked, disabled, onChange }: { label: string; description?: string; checked: boolean; /** True while this setting is being saved. */ disabled?: boolean; onChange: (value: boolean) => void }) => (
  <SettingRow label={label} description={description}>
    <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-busy={disabled || undefined} aria-label={label} />
  </SettingRow>
);
