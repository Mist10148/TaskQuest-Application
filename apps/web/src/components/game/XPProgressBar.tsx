import { cn } from "@/lib/utils";

interface XPProgressBarProps {
  currentXP: number;
  xpToNextLevel: number;
  level: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const XPProgressBar = ({
  currentXP,
  xpToNextLevel,
  level,
  showLabel = true,
  size = "md",
  className,
}: XPProgressBarProps) => {
  const progress = Math.min((currentXP / xpToNextLevel) * 100, 100);

  const sizeClasses = {
    sm: "h-2",
    md: "h-4",
    lg: "h-6",
  };

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-foreground-muted">
            Level {level}
          </span>
          <span className="text-sm font-medium text-xp">
            {currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
          </span>
        </div>
      )}
      <div
        className={cn(
          "w-full rounded-full bg-background-secondary overflow-hidden relative",
          sizeClasses[size]
        )}
        style={{
          boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.3)",
        }}
      >
        {/* Background shimmer effect */}
        <div className="absolute inset-0 bg-shimmer bg-[length:200%_100%] animate-shimmer opacity-20" />
        
        {/* Progress fill */}
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden",
            sizeClasses[size]
          )}
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, hsl(var(--xp)) 0%, hsl(45 100% 60%) 50%, hsl(var(--xp)) 100%)",
            boxShadow: "0 0 10px hsl(var(--xp) / 0.5)",
          }}
        >
          {/* Shine effect */}
          <div 
            className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent"
            style={{ height: "50%" }}
          />
        </div>
      </div>
    </div>
  );
};
