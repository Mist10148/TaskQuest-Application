import { formatDeadline, isPastDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Calendar } from "lucide-react";

const priorityConfig = {
  HIGH: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" },
  MEDIUM: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", dot: "bg-yellow-500" },
  LOW: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", dot: "bg-blue-500" },
};

interface TaskListCardProps {
  name: string;
  description?: string;
  category?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | string | null;
  deadline?: string;
  itemsCompleted: number;
  itemsTotal: number;
  onClick?: () => void;
  className?: string;
}

const categoryEmojis: Record<string, string> = {
  School: "📚", Work: "💼", Home: "🏠", Personal: "👤", Shopping: "🛒", Fitness: "💪", Health: "💪", Finance: "💰", Other: "📌"
};

export const TaskListCard = ({ name, description, category, priority, deadline, itemsCompleted, itemsTotal, onClick, className }: TaskListCardProps) => {
  const progress = itemsTotal > 0 ? (itemsCompleted / itemsTotal) * 100 : 0;
  const priorityStyles = priority && priorityConfig[priority as keyof typeof priorityConfig] ? priorityConfig[priority as keyof typeof priorityConfig] : null;
  const categoryEmoji = category ? categoryEmojis[category] || "📋" : "📋";
  const isOverdue = isPastDeadline(deadline) && progress < 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `Open quest ${name}`,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      className={cn("relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", onClick && "cursor-pointer", priorityStyles?.border, className)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{categoryEmoji}</span>
          <h3 className="font-heading font-semibold text-lg truncate">{name}</h3>
        </div>
        {priorityStyles && (
          <div className={cn("px-2 py-1 rounded-full text-xs font-medium", priorityStyles.bg, priorityStyles.color)}>{priority}</div>
        )}
      </div>
      {description && <p className="text-sm text-foreground-muted mb-4 line-clamp-2">{description}</p>}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1.5">
          <span className="text-foreground-muted">Progress</span>
          <span className={cn("font-medium", progress === 100 ? "text-success" : "")}>{itemsCompleted}/{itemsTotal}</span>
        </div>
        <div className="h-2 rounded-full bg-background-secondary overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500", progress === 100 ? "bg-success" : "bg-primary")} style={{ width: `${progress}%` }} />
        </div>
      </div>
      {deadline && (
        <div className={cn("flex items-center gap-1.5 text-sm", isOverdue ? "text-destructive" : "text-foreground-muted")}>
          <Calendar className="h-3.5 w-3.5" />
          <span>{isOverdue ? "Overdue: " : ""}{formatDeadline(deadline)}</span>
        </div>
      )}
    </motion.div>
  );
};
