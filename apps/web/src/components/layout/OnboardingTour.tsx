import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampStep, hasSeenTour, markTourSeen, START_TOUR_EVENT, TOUR_STEPS } from "@/lib/tour";

/**
 * Four-step welcome card shown once to new players and replayable from Settings. It is a small
 * non-modal card (the page stays usable), dismissible with Skip, the close button or Escape.
 */
export const OnboardingTour = () => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Let the page paint first; never pop up on top of a view the instant it loads.
    const id = window.setTimeout(() => {
      if (!hasSeenTour()) setOpen(true);
    }, 800);
    const onStart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener(START_TOUR_EVENT, onStart);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        markTourSeen();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const finish = () => {
    markTourSeen();
    setOpen(false);
  };

  if (!open) return null;
  const index = clampStep(step);
  const current = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  return (
    <section
      role="region"
      aria-label="Welcome tour"
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-primary/40 bg-card p-4 shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
    >
      <button type="button" onClick={finish} aria-label="Close tour" className="absolute right-3 top-3 rounded p-1 text-foreground-muted hover:text-foreground">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <p className="text-xs font-medium text-foreground-muted" aria-live="polite">Step {index + 1} of {TOUR_STEPS.length}</p>
      <h2 className="mt-1 pr-6 font-heading text-lg font-semibold">{current.title}</h2>
      <p className="mt-1 text-sm text-foreground-muted">{current.body}</p>
      {current.to && (
        <Link to={current.to} className="mt-2 inline-block text-sm font-medium text-primary-text underline underline-offset-2">{current.toLabel}</Link>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={finish}>Skip</Button>
        <div className="flex gap-2">
          {index > 0 && <Button variant="outline" size="sm" onClick={() => setStep(index - 1)}>Back</Button>}
          <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : setStep(index + 1))}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </section>
  );
};
