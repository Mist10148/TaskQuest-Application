import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  colorScheme?: "default" | "xp" | "success" | "primary" | "destructive";
  className?: string;
}

export const StatCard = ({
  icon,
  label,
  value,
  subValue,
  trend,
  colorScheme = "default",
  className,
}: StatCardProps) => {
  const colorClasses = {
    default: {
      iconBg: "bg-card",
      iconColor: "text-foreground-muted",
      valueColor: "text-foreground",
      glow: "",
      border: "hover:border-foreground-muted/30",
    },
    xp: {
      iconBg: "bg-xp/10",
      iconColor: "text-xp",
      valueColor: "text-xp",
      glow: "hover:shadow-[0_0_20px_rgba(234,179,8,0.2)]",
      border: "hover:border-xp/30",
    },
    success: {
      iconBg: "bg-success/10",
      iconColor: "text-success",
      valueColor: "text-success",
      glow: "hover:shadow-[0_0_20px_rgba(34,197,94,0.2)]",
      border: "hover:border-success/30",
    },
    primary: {
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      valueColor: "text-primary",
      glow: "hover:shadow-[0_0_20px_rgba(99,102,241,0.2)]",
      border: "hover:border-primary/30",
    },
    destructive: {
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      valueColor: "text-destructive",
      glow: "hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]",
      border: "hover:border-destructive/30",
    },
  };

  const colors = colorClasses[colorScheme];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -2 }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-3 sm:p-5 transition-all duration-300",
        colors.border,
        colors.glow,
        className
      )}
    >
      {/* Top neon line */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-px opacity-0 transition-opacity",
        colorScheme === 'xp' ? 'bg-gradient-to-r from-transparent via-xp/50 to-transparent' :
        colorScheme === 'success' ? 'bg-gradient-to-r from-transparent via-success/50 to-transparent' :
        colorScheme === 'primary' ? 'bg-gradient-to-r from-transparent via-primary/50 to-transparent' :
        colorScheme === 'destructive' ? 'bg-gradient-to-r from-transparent via-destructive/50 to-transparent' :
        'bg-gradient-to-r from-transparent via-foreground-muted/30 to-transparent'
      )} style={{ opacity: 0.5 }} />
      
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] sm:text-sm font-medium text-foreground-muted mb-0.5 sm:mb-1 truncate">
            {label}
          </span>
          <span className={cn(
            "text-xl sm:text-3xl font-bold font-heading tracking-wide",
            colors.valueColor
          )}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {subValue && (
            <span className="text-[10px] sm:text-sm text-foreground-muted mt-0.5 sm:mt-1 flex items-center gap-1 truncate">
              {trend === "up" && <span className="text-success">↑</span>}
              {trend === "down" && <span className="text-destructive">↓</span>}
              {subValue}
            </span>
          )}
        </div>
        <div className={cn(
          "rounded-lg p-2 sm:p-3 flex-shrink-0 transition-all",
          colors.iconBg
        )}>
          <span className={cn("text-base sm:text-xl", colors.iconColor)}>
            {icon}
          </span>
        </div>
      </div>
    </motion.div>
  );
};
