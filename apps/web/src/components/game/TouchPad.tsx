import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsUp, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";

type Layout = "dpad" | "jump" | "shooter";

interface KeySpec {
  label: string;
  key: string;
  code?: string;
  icon: React.ElementType;
  /** Hold-to-repeat keys send keydown on press and keyup on release (movement); others send only keydown (actions). */
  hold?: boolean;
  className?: string;
}

const LAYOUTS: Record<Layout, KeySpec[]> = {
  dpad: [
    { label: "Up", key: "ArrowUp", icon: ArrowUp, className: "col-start-2" },
    { label: "Left", key: "ArrowLeft", icon: ArrowLeft, className: "col-start-1 row-start-2" },
    { label: "Down", key: "ArrowDown", icon: ArrowDown, className: "col-start-2 row-start-2" },
    { label: "Right", key: "ArrowRight", icon: ArrowRight, className: "col-start-3 row-start-2" },
  ],
  jump: [{ label: "Jump", key: "ArrowUp", code: "Space", icon: ChevronsUp, className: "col-span-3 h-16" }],
  shooter: [
    { label: "Move left", key: "ArrowLeft", icon: ArrowLeft, hold: true, className: "col-start-1" },
    { label: "Fire", key: " ", code: "Space", icon: Crosshair, className: "col-start-2" },
    { label: "Move right", key: "ArrowRight", icon: ArrowRight, hold: true, className: "col-start-3" },
  ],
};

const send = (type: "keydown" | "keyup", spec: KeySpec) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: spec.key, code: spec.code ?? spec.key, bubbles: true, cancelable: true }));

/**
 * On-screen controls for touch devices. They send the same keyboard events the games already
 * listen for, so there is one control path. Shown only where the primary pointer is coarse (touch).
 */
export const TouchPad = ({ layout, className }: { layout: Layout; className?: string }) => (
  <div
    className={cn("mt-4 hidden w-full max-w-xs select-none grid-cols-3 gap-2 pointer-coarse:grid", className)}
    role="group"
    aria-label="Touch controls"
    onContextMenu={(e) => e.preventDefault()}
  >
    {LAYOUTS[layout].map((spec) => (
      <button
        key={spec.label}
        type="button"
        aria-label={spec.label}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          send("keydown", spec);
        }}
        onPointerUp={() => spec.hold && send("keyup", spec)}
        onPointerCancel={() => spec.hold && send("keyup", spec)}
        className={cn(
          "flex h-14 touch-none items-center justify-center rounded-xl border border-border bg-card text-foreground active:bg-primary/30 active:border-primary",
          spec.className
        )}
      >
        <spec.icon className="h-6 w-6" aria-hidden />
      </button>
    ))}
  </div>
);
