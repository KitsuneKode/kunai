"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";

type CopyButtonProps = {
  readonly text: string;
  readonly label?: string;
  readonly className?: string;
  readonly children?: ReactNode;
  /** @deprecated Use local state - kept for gradual migration */
  readonly copiedText?: string | null;
  /** @deprecated Use local state - kept for gradual migration */
  readonly onCopy?: (text: string, label: string) => void;
};

export function CopyButton({
  text,
  label = "copy",
  className,
  children,
  copiedText: externalCopied,
  onCopy: externalOnCopy,
}: CopyButtonProps) {
  const [localCopied, setLocalCopied] = useState(false);
  const copied = externalCopied !== undefined ? externalCopied === label : localCopied;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text);
    if (externalOnCopy) {
      externalOnCopy(text, label);
      return;
    }
    setLocalCopied(true);
    window.setTimeout(() => setLocalCopied(false), 1800);
  }, [externalOnCopy, label, text]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className={className}
              aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
            />
          }
        >
          {children ?? (
            <span className="relative inline-flex h-4 min-w-10 items-center justify-center gap-1 tabular-nums">
              <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                  <motion.span
                    key="copied"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="inline-flex items-center gap-1 text-[var(--kunai-ok)]"
                  >
                    <IconCheck className="size-3" stroke={1.5} data-icon="inline-start" />
                    <span className="text-[10px]">Copied</span>
                  </motion.span>
                ) : (
                  <motion.span
                    key="copy"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="inline-flex items-center gap-1"
                  >
                    <IconCopy className="size-3" stroke={1.5} data-icon="inline-start" />
                    <span className="text-[10px]">Copy</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top">Copy command</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
