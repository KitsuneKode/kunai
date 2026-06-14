"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

type CopyButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly copiedText: string | null;
  readonly onCopy: (text: string, label: string) => void;
  readonly className?: string;
  readonly children?: ReactNode;
};

const baseClassName =
  "copy-btn relative inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-fd-border bg-fd-secondary/70 px-2.5 py-1 text-[10px] font-medium text-fd-primary transition-[transform,border-color,color,background-color] duration-150 ease-out hover:border-fd-primary hover:text-fd-foreground active:scale-[0.96]";

export function CopyButton({
  text,
  label,
  copiedText,
  onCopy,
  className = baseClassName,
  children,
}: CopyButtonProps) {
  const copied = copiedText === label;

  return (
    <button
      type="button"
      onClick={() => onCopy(text, label)}
      className={className}
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {children ?? (
        <span className="relative inline-flex h-4 w-10 items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="inline-flex items-center gap-1 text-[var(--kunai-ok)]"
              >
                <Check className="h-3 w-3" />
                <span>Copied</span>
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="inline-flex items-center gap-1"
              >
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      )}
    </button>
  );
}
