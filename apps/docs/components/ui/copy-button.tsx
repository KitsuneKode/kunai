"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyAndAnnounce } from "@/lib/clipboard-copy";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type CopyButtonProps = {
  readonly text: string;
  readonly label?: string;
  readonly className?: string;
  readonly children?: ReactNode;
};

export function CopyButton({ text, label = "copy", className, children }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const revertTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current !== null) window.clearTimeout(revertTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    () =>
      copyAndAnnounce(text, label, {
        writeText: (value) => navigator.clipboard.writeText(value),
        onCopied: () => {
          setCopied(true);
          if (revertTimerRef.current !== null) window.clearTimeout(revertTimerRef.current);
          revertTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
        },
        // Announced rather than wired: the fox reacts to a successful copy, and
        // this button should not have to know that a fox exists.
        announce: (name) =>
          window.dispatchEvent(new CustomEvent("kunai:copied", { detail: { label: name } })),
      }),
    [label, text],
  );

  return (
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
        {children ?? (
          <span
            className={`relative inline-flex h-4 min-w-[3.75rem] items-center justify-center gap-1 tabular-nums transition-colors duration-150 ${
              copied ? "text-[var(--kunai-ok)]" : ""
            }`}
          >
            <span className="relative inline-flex size-3 items-center justify-center">
              <IconCopy
                className={`absolute size-3 transition-[opacity,transform,filter] duration-180 ease-[var(--ease-out)] ${
                  copied ? "scale-50 opacity-0 blur-[2px]" : "blur-0 scale-100 opacity-100"
                }`}
                stroke={1.5}
                data-icon="inline-start"
                aria-hidden="true"
              />
              <IconCheck
                className={`absolute size-3 transition-[opacity,transform,filter] duration-180 ease-[var(--ease-out)] ${
                  copied ? "blur-0 scale-100 opacity-100" : "scale-50 opacity-0 blur-[2px]"
                }`}
                stroke={1.75}
                data-icon="inline-start"
                aria-hidden="true"
              />
            </span>
            <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">Copy command</TooltipContent>
    </Tooltip>
  );
}
