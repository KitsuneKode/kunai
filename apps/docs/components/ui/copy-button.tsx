"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyAndAnnounce } from "@/lib/clipboard-copy";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";

type CopyButtonProps = {
  readonly text: string;
  readonly label?: string;
  readonly className?: string;
  readonly children?: ReactNode;
};

export function CopyButton({ text, label = "copy", className, children }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    () =>
      copyAndAnnounce(text, label, {
        writeText: (value) => navigator.clipboard.writeText(value),
        onCopied: () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        },
        // Announced rather than wired: the fox reacts to a successful copy, and
        // this button should not have to know that a fox exists.
        announce: (name) =>
          window.dispatchEvent(new CustomEvent("kunai:copied", { detail: { label: name } })),
      }),
    [label, text],
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void handleCopy();
              }}
              className={className}
              aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
            />
          }
        >
          <LazyMotion features={domAnimation}>
            <AnimatePresence mode="wait" initial={false}>
              {children ??
                (copied ? (
                  <m.span
                    key="copied"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="relative inline-flex h-4 min-w-10 items-center justify-center gap-1 text-[var(--kunai-ok)] tabular-nums"
                  >
                    <IconCheck className="size-3" stroke={1.5} data-icon="inline-start" />
                    <span className="text-[10px]">Copied</span>
                  </m.span>
                ) : (
                  <m.span
                    key="copy"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="relative inline-flex h-4 min-w-10 items-center justify-center gap-1 tabular-nums"
                  >
                    <IconCopy className="size-3" stroke={1.5} data-icon="inline-start" />
                    <span className="text-[10px]">Copy</span>
                  </m.span>
                ))}
            </AnimatePresence>
          </LazyMotion>
        </TooltipTrigger>
        <TooltipContent side="top">Copy command</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
