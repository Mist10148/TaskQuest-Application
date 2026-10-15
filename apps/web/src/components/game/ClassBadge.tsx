import { cn } from "@/lib/utils";
import { Sword, Dices, Skull, Wand2, Target, Shield, User, Flower2, Hammer, Compass, Ghost, Sun, Music, FlaskConical, Leaf, Hourglass, HeartHandshake } from "lucide-react";

export type PlayerClass = 
  | "DEFAULT" 
  | "HERO" 
  | "GAMBLER" 
  | "ASSASSIN" 
  | "WIZARD" 
  | "ARCHER" 
  | "TANK"
  | "MONK"
  | "ARTISAN"
  | "RANGER"
  | "NECROMANCER"
  | "PALADIN"
  | "WARDEN"
  | "CHRONOMANCER"
  | "DRUID"
  | "ALCHEMIST"
  | "BARD";

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
    description: "Flat bonus on every action",
  },
  GAMBLER: {
    name: "Gambler",
    icon: Dices,
    emoji: "🎲",
    colorClass: "text-class-gambler",
    bgClass: "bg-class-gambler/10",
    borderClass: "border-class-gambler",
    description: "Random bonus, some bad luck",
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
    description: "Combo and Burst bonuses",
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
  MONK: {
    name: "Monk",
    icon: Flower2,
    emoji: "🧘",
    colorClass: "text-class-monk",
    bgClass: "bg-class-monk/10",
    borderClass: "border-class-monk",
    description: "Rhythm of daily activity",
  },
  ARTISAN: {
    name: "Artisan",
    icon: Hammer,
    emoji: "🛠️",
    colorClass: "text-class-artisan",
    bgClass: "bg-class-artisan/10",
    borderClass: "border-class-artisan",
    description: "Projects and finished lists",
  },
  RANGER: {
    name: "Ranger",
    icon: Compass,
    emoji: "🧭",
    colorClass: "text-class-ranger",
    bgClass: "bg-class-ranger/10",
    borderClass: "border-class-ranger",
    description: "Rewards finishing early",
  },
  NECROMANCER: {
    name: "Necromancer",
    icon: Ghost,
    emoji: "💀",
    colorClass: "text-class-necromancer",
    bgClass: "bg-class-necromancer/10",
    borderClass: "border-class-necromancer",
    description: "Revives overdue tasks",
  },
  PALADIN: {
    name: "Paladin",
    icon: Sun,
    emoji: "⚜️",
    colorClass: "text-class-paladin",
    bgClass: "bg-class-paladin/10",
    borderClass: "border-class-paladin",
    description: "Rewards HIGH priority work",
  },
  BARD: {
    name: "Bard",
    icon: Music,
    emoji: "🎵",
    colorClass: "text-class-bard",
    bgClass: "bg-class-bard/10",
    borderClass: "border-class-bard",
    description: "Rewards hopping between lists",
  },
  ALCHEMIST: {
    name: "Alchemist",
    icon: FlaskConical,
    emoji: "⚗️",
    colorClass: "text-class-alchemist",
    bgClass: "bg-class-alchemist/10",
    borderClass: "border-class-alchemist",
    description: "Rewards every priority honestly",
  },
  DRUID: {
    name: "Druid",
    icon: Leaf,
    emoji: "🌿",
    colorClass: "text-class-druid",
    bgClass: "bg-class-druid/10",
    borderClass: "border-class-druid",
    description: "Rewards steady habits",
  },
  CHRONOMANCER: {
    name: "Chronomancer",
    icon: Hourglass,
    emoji: "⏳",
    colorClass: "text-class-chronomancer",
    bgClass: "bg-class-chronomancer/10",
    borderClass: "border-class-chronomancer",
    description: "Rewards finishing tasks after a focus session",
  },
  WARDEN: {
    name: "Warden",
    icon: HeartHandshake,
    emoji: "🤝",
    colorClass: "text-class-warden",
    bgClass: "bg-class-warden/10",
    borderClass: "border-class-warden",
    description: "Rewards working together",
  },
};


export const ClassBadge = ({
  playerClass,
  size = "md",
  showName = true,
  showGlow = false,
  className,
}: ClassBadgeProps) => {
  // A class the UI does not know yet (added server-side) renders as the neutral default.
  const known = playerClass in classConfig;
  const config = classConfig[known ? playerClass : "DEFAULT"];
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
        boxShadow: `0 0 15px hsl(var(--class-${(known ? playerClass : "DEFAULT").toLowerCase()}) / 0.4)`,
      } : undefined}
    >
      <Icon className={sizes.icon} />
      {showName && (
        <span className={sizes.text}>{known ? config.name : playerClass.charAt(0) + playerClass.slice(1).toLowerCase()}</span>
      )}
    </div>
  );
};
