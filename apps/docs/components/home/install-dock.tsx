"use client";

import { CopyButton } from "@/components/ui/copy-button";
import { useEffect, useId, useRef, useState } from "react";

type InstallDockProps = {
  readonly unixCommand: string;
  readonly windowsCommand: string;
  readonly labelPrefix: string;
  readonly className?: string;
};

/**
 * Tactile OS-switching install dock.
 * Built on real radio inputs so the segmented indicator slides purely in CSS
 * with zero layout shift, and flashes a subtle ok-edge confirmation on copy.
 */
export function InstallDock({
  unixCommand,
  windowsCommand,
  labelPrefix,
  className,
}: InstallDockProps) {
  const groupId = useId();
  const [os, setOs] = useState<"unix" | "windows">("unix");
  const [flashed, setFlashed] = useState(false);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    const onCopied = (event: Event) => {
      // SAFETY: "kunai:copied" is only dispatched by CopyButton, always as a
      // CustomEvent whose detail is { label }; the optional chain below covers absence.
      const detail = (event as CustomEvent<{ label?: string }>).detail;
      if (!detail?.label?.startsWith(labelPrefix)) return;
      setFlashed(true);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashed(false), 620);
    };
    window.addEventListener("kunai:copied", onCopied);
    return () => {
      window.removeEventListener("kunai:copied", onCopied);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, [labelPrefix]);

  const activeCommand = os === "unix" ? unixCommand : windowsCommand;
  const copyLabel = os === "unix" ? `${labelPrefix}-unix` : `${labelPrefix}-windows`;

  return (
    <div
      className={`kunai-install-dock${flashed ? " is-copied" : ""}${className ? ` ${className}` : ""}`}
      data-os={os}
    >
      <div className="kunai-install-dock__head">
        <div
          className="kunai-install-dock__switch"
          role="radiogroup"
          aria-label="Choose install platform"
        >
          <span
            className="kunai-install-dock__thumb"
            aria-hidden="true"
            style={{ transform: os === "unix" ? "translateX(0%)" : "translateX(100%)" }}
          />
          <label className="kunai-install-dock__option">
            <input
              type="radio"
              name={`install-os-${groupId}`}
              value="unix"
              checked={os === "unix"}
              onChange={() => setOs("unix")}
              className="sr-only"
            />
            <span>Linux · macOS · Termux</span>
          </label>
          <label className="kunai-install-dock__option">
            <input
              type="radio"
              name={`install-os-${groupId}`}
              value="windows"
              checked={os === "windows"}
              onChange={() => setOs("windows")}
              className="sr-only"
            />
            <span>Windows</span>
          </label>
        </div>
        <span className="kunai-install-dock__meta" aria-hidden="true">
          {os === "unix" ? "sh" : "pwsh"}
        </span>
      </div>

      <code className="kunai-install-dock__well">
        <span className="kunai-install-dock__prompt" aria-hidden="true">
          $
        </span>
        <span className="kunai-install-dock__cmd">{activeCommand}</span>
        <CopyButton text={activeCommand} label={copyLabel} className="kunai-install-dock__copy" />
      </code>
    </div>
  );
}
