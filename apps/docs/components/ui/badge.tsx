import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
  {
    variants: {
      variant: {
        default: "border-fd-border bg-fd-secondary text-fd-foreground",
        accent: "border-fd-primary/30 bg-fd-primary/10 text-fd-primary",
        ok: "border-[color-mix(in_oklab,var(--kunai-ok)_30%,transparent)] bg-[color-mix(in_oklab,var(--kunai-ok)_12%,transparent)] text-[var(--kunai-ok)]",
        muted: "bg-fd-muted text-fd-muted-foreground border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
