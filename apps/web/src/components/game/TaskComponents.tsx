import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Check, Calendar, GripVertical, Pencil, Trash2 } from "lucide-react";

interface TaskItemProps {
  id: number;
  name: string;
  description?: string;
  completed: boolean;
  priority?: "LOW" | "MEDIUM" | "HIGH" | null;
  onToggle?: (id: number) => void;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
  onDragStart?: (e: React.DragEvent, id: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent, id: number) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, id: number) => void;
  draggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  className?: string;
}

const priorityConfig = {
  HIGH: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" },
  MEDIUM: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", dot: "bg-yellow-500" },
  LOW: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", dot: "bg-blue-500" },
};

export const TaskItem = ({ 
  id, name, description, completed, priority, 
  onToggle, onEdit, onDelete, 
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, 
  draggable = false, isDragOver = false, isDragging = false,
  className 
}: TaskItemProps) => {
  const priorityStyles = priority ? priorityConfig[priority] : null;

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    onDragStart?.(e, id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver?.(e, id);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDrop?.(e, id);
  };

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group flex items-start gap-2 sm:gap-3 rounded-lg border bg-card p-3 sm:p-4 transition-all duration-200",
        completed && "opacity-60",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragOver && "border-primary bg-primary/10 shadow-[0_0_20px_rgba(99,102,241,0.3)]",
        isDragging && "opacity-50 scale-[0.98]",
        !isDragOver && "border-border hover:border-primary/30 hover:shadow-[0_0_15px_rgba(99,102,241,0.15)]",
        className
      )}
    >
      {/* Drag Handle */}
      {draggable && (
        <div className="flex-shrink-0 mt-0.5 text-foreground-muted/50 hover:text-foreground-muted transition-colors cursor-grab active:cursor-grabbing">
          <GripVertical className="h-5 w-5" />
        </div>
      )}
      
      {/* Checkbox */}
      <button
        onClick={() => onToggle?.(id)}
        className={cn("flex-shrink-0 mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all", completed ? "bg-success border-success shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "border-border hover:border-primary hover:shadow-[0_0_10px_rgba(99,102,241,0.3)]")}
      >
        {completed && <Check className="h-3 w-3 text-white" />}
      </button>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn("font-medium text-sm sm:text-base", completed && "line-through text-foreground-muted")}>{name}</p>
        {description && <p className={cn("text-xs sm:text-sm mt-1 line-clamp-2", completed ? "text-foreground-muted/60" : "text-foreground-muted")}>{description}</p>}
      </div>
      
      {/* Priority Dot */}
      {priorityStyles && <div className={cn("flex-shrink-0 h-2 w-2 rounded-full mt-2 shadow-[0_0_8px_currentColor]", priorityStyles.dot)} />}
      
      {/* Action Buttons */}
      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onEdit && (
          <button onClick={() => onEdit(id)} className="p-1.5 rounded-md hover:bg-background-secondary text-foreground-muted hover:text-primary transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(id)} className="p-1.5 rounded-md hover:bg-destructive/20 text-foreground-muted hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
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
  const isOverdue = deadline && new Date(deadline) < new Date() && progress < 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={cn("relative overflow-hidden rounded-xl border border-border bg-card p-5 cursor-pointer transition-all duration-300 hover:border-primary/30 hover:shadow-lg", priorityStyles?.border, className)}
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
          <span>{isOverdue ? "Overdue: " : ""}{new Date(deadline).toLocaleDateString()}</span>
        </div>
      )}
    </motion.div>
  );
};
