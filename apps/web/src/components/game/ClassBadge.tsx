import { cn } from "@/lib/utils";
import { Sword, Dices, Skull, Wand2, Target, Shield, User } from "lucide-react";

export type PlayerClass = 
  | "DEFAULT" 
  | "HERO" 
  | "GAMBLER" 
  | "ASSASSIN" 
  | "WIZARD" 
  | "ARCHER" 
  | "TANK";

interface ClassBadgeProps {
  playerClass: PlayerClass;
  size?: "sm" | "md" | "lg" | "xl";
  showName?: boolean;
  showGlow?: boolean;
  className?: string;
}

const classConfig: Record<PlayerClass, {
  name: string;
  icon: React.ElementType;
  emoji: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  description: string;
}> = {
  DEFAULT: {
    name: "Default",
    icon: User,
    emoji: "⚪",
    colorClass: "text-class-default",
    bgClass: "bg-class-default/10",
    borderClass: "border-class-default",
    description: "Balanced starter class",
  },
  HERO: {
    name: "Hero",
    icon: Sword,
    emoji: "⚔️",
    colorClass: "text-class-hero",
    bgClass: "bg-class-hero/10",
    borderClass: "border-class-hero",
    description: "+20% XP on all tasks",
  },
  GAMBLER: {
    name: "Gambler",
    icon: Dices,
    emoji: "🎲",
    colorClass: "text-class-gambler",
    bgClass: "bg-class-gambler/10",
    borderClass: "border-class-gambler",
    description: "Variable XP 0.5x-2x",
  },
  ASSASSIN: {
    name: "Assassin",
    icon: Skull,
    emoji: "🗡️",
    colorClass: "text-class-assassin",
    bgClass: "bg-class-assassin/10",
    borderClass: "border-class-assassin",
    description: "Streak bonuses stack",
  },
  WIZARD: {
    name: "Wizard",
    icon: Wand2,
    emoji: "🔮",
    colorClass: "text-class-wizard",
    bgClass: "bg-class-wizard/10",
    borderClass: "border-class-wizard",
    description: "Every 3rd task = 2x XP",
  },
  ARCHER: {
    name: "Archer",
    icon: Target,
    emoji: "🏹",
    colorClass: "text-class-archer",
    bgClass: "bg-class-archer/10",
    borderClass: "border-class-archer",
    description: "Precision multipliers",
  },
  TANK: {
    name: "Tank",
    icon: Shield,
    emoji: "🛡️",
    colorClass: "text-class-tank",
    bgClass: "bg-class-tank/10",
    borderClass: "border-class-tank",
    description: "Steady XP stacking",
  },
};

export const getClassConfig = (playerClass: PlayerClass) => classConfig[playerClass];

export const ClassBadge = ({
  playerClass,
  size = "md",
  showName = true,
  showGlow = false,
  className,
}: ClassBadgeProps) => {
  const config = classConfig[playerClass];
  const Icon = config.icon;

  const sizeClasses = {
    sm: {
      container: "px-2 py-1 gap-1",
      icon: "h-3 w-3",
      text: "text-xs",
    },
    md: {
      container: "px-3 py-1.5 gap-1.5",
      icon: "h-4 w-4",
      text: "text-sm",
    },
    lg: {
      container: "px-4 py-2 gap-2",
      icon: "h-5 w-5",
      text: "text-base",
    },
    xl: {
      container: "px-5 py-2.5 gap-2.5",
      icon: "h-6 w-6",
      text: "text-lg",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border-2 font-heading font-semibold",
        sizes.container,
        config.bgClass,
        config.borderClass,
        config.colorClass,
        showGlow && "shadow-lg",
        className
      )}
      style={showGlow ? {
        boxShadow: `0 0 15px hsl(var(--class-${playerClass.toLowerCase()}) / 0.4)`,
      } : undefined}
    >
      <Icon className={sizes.icon} />
      {showName && (
        <span className={sizes.text}>{config.name}</span>
      )}
    </div>
  );
};
