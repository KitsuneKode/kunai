import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[transform,border-color,color,background-color,box-shadow] duration-[var(--dur-press)] ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-[var(--color-fd-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-fd-background)] focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-fd-border bg-fd-secondary text-fd-foreground hover:border-fd-primary/40 hover:bg-fd-accent border shadow-[var(--kunai-shadow-sm)]",
        primary:
          "border-fd-primary/30 bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 border",
        ghost: "hover:bg-fd-accent hover:text-fd-accent-foreground border border-transparent",
        outline: "border-fd-border hover:bg-fd-accent border bg-transparent",
        link: "text-fd-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 rounded-md px-3 text-xs",
        lg: "min-h-11 rounded-lg px-6",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
