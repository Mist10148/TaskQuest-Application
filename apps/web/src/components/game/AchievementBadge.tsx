import { cn } from "@/lib/utils";
import { Trophy, Lock } from "lucide-react";
import { motion } from "framer-motion";

interface AchievementBadgeProps {
  name: string;
  description: string;
  icon?: string;
  unlocked: boolean;
  unlockedAt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const AchievementBadge = ({
  name,
  description,
  icon = "🏆",
  unlocked,
  unlockedAt,
  size = "md",
  className,
}: AchievementBadgeProps) => {
  const sizeClasses = {
    sm: {
      container: "p-3",
      icon: "text-2xl",
      title: "text-sm",
      desc: "text-xs",
    },
    md: {
      container: "p-4",
      icon: "text-3xl",
      title: "text-base",
      desc: "text-sm",
    },
    lg: {
      container: "p-5",
      icon: "text-4xl",
      title: "text-lg",
      desc: "text-base",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={unlocked ? { scale: 1.02 } : undefined}
      className={cn(
        "relative rounded-xl border transition-all duration-300",
        sizes.container,
        unlocked
          ? "bg-card border-xp/50 shadow-lg shadow-xp/10 cursor-pointer"
          : "bg-background-secondary border-border grayscale opacity-60",
        className
      )}
    >
      {/* Glow effect for unlocked */}
      {unlocked && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-xp/10 via-transparent to-transparent" />
      )}

      <div className="relative flex items-start gap-3">
        {/* Icon */}
        <div className={cn(
          "flex-shrink-0 flex items-center justify-center rounded-lg w-12 h-12",
          unlocked ? "bg-xp/20" : "bg-background-tertiary"
        )}>
          {unlocked ? (
            <span className={sizes.icon}>{icon}</span>
          ) : (
            <Lock className="h-5 w-5 text-foreground-muted" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className={cn(
            "font-heading font-semibold truncate",
            sizes.title,
            unlocked ? "text-foreground" : "text-foreground-muted"
          )}>
            {name}
          </h4>
          <p className={cn(
            "text-foreground-muted line-clamp-2 mt-0.5",
            sizes.desc
          )}>
            {description}
          </p>
          {unlocked && unlockedAt && (
            <p className="text-xs text-xp mt-1">
              Unlocked {unlockedAt}
            </p>
          )}
        </div>

        {/* Trophy indicator */}
        {unlocked && (
          <Trophy className="h-4 w-4 text-xp flex-shrink-0" />
        )}
      </div>
    </motion.div>
  );
};
