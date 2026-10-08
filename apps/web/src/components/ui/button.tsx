import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold font-heading tracking-wide ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-transparent text-foreground hover:bg-card hover:border-primary/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-card hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Gaming variants
        discord: "bg-[#5865F2] text-primary-foreground hover:bg-[#4752C4] shadow-lg shadow-[#5865F2]/25 hover:shadow-[#5865F2]/40 hover:-translate-y-0.5",
        xp: "bg-gradient-to-r from-xp to-xp-glow text-xp-foreground hover:shadow-lg hover:shadow-xp/30 hover:-translate-y-0.5 font-bold",
        success: "bg-success text-success-foreground hover:bg-success/90 hover:shadow-lg hover:shadow-success/25",
        hero: "border-2 border-primary/30 bg-primary/10 text-primary-foreground hover:bg-primary/20 hover:border-primary/50 backdrop-blur-sm",
        glass: "bg-card/50 backdrop-blur-md border border-border/50 text-foreground hover:bg-card/80 hover:border-primary/30",
        glow: "bg-primary text-primary-foreground shadow-lg shadow-primary/40 hover:shadow-primary/60 hover:-translate-y-0.5",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-12 rounded-lg px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
