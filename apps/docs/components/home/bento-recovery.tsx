"use client";

import { BentoTile } from "@/components/home/bento-tile";
import { RECOVERY_STEPS, recoveryStep } from "@/lib/home-bento";
import { useId, useState, type KeyboardEvent } from "react";

/**
 * "Recovery built in": pick a command, read what the shell does.
 *
 * Three commands in the order to reach for them, each a tab. Selecting one prints
 * the lines that command produces, one after another, in a small terminal pane.
 * The lines restate documented behaviour (`lib/home-bento.ts`), and they name no
 * provider because which one comes next depends on the title and the day. Under
 * `prefers-reduced-motion` the lines are simply there: the stagger is built from a
 * motion token that is zero in that mode.
 *
 * A vertical tablist: arrow keys move between the commands, only the selected one
 * is in the tab order, and the pane is announced politely when it changes.
 */
export function BentoRecovery({
  className,
  detail,
}: {
  readonly className?: string;
  readonly detail: string | undefined;
}) {
  const [commandId, setCommandId] = useState(() => recoveryStep("recover").commandId);
  const ids = useId();
  const step = recoveryStep(commandId);

  const move = (direction: 1 | -1) => {
    const index = RECOVERY_STEPS.findIndex((candidate) => candidate.commandId === commandId);
    const next =
      RECOVERY_STEPS[(index + direction + RECOVERY_STEPS.length) % RECOVERY_STEPS.length];
    if (!next) return;
    setCommandId(next.commandId);
    document.getElementById(`${ids}-tab-${next.commandId}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else return;
    event.preventDefault();
  };

  return (
    <BentoTile className={className} label="Recovery built in" detail={detail}>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div
          role="tablist"
          aria-label="Recovery command"
          aria-orientation="vertical"
          className="flex flex-col gap-2"
        >
          {RECOVERY_STEPS.map((candidate) => {
            const selected = candidate.commandId === commandId;
            return (
              <button
                key={candidate.commandId}
                type="button"
                role="tab"
                id={`${ids}-tab-${candidate.commandId}`}
                aria-selected={selected}
                aria-controls={`${ids}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setCommandId(candidate.commandId)}
                onKeyDown={onKeyDown}
                className={`focus-visible:ring-ring flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] outline-none focus-visible:ring-2 active:scale-[0.99] ${
                  selected
                    ? "border-[var(--kunai-accent-deep)] bg-[color-mix(in_oklab,var(--kunai-accent)_9%,transparent)]"
                    : "border-[var(--kunai-line)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_40%,transparent)]"
                }`}
              >
                <code className="text-fd-foreground font-mono text-xs">/{candidate.alias}</code>
                <span className="text-fd-muted-foreground text-xs leading-5">
                  {candidate.summary}
                </span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${ids}-panel`}
          aria-labelledby={`${ids}-tab-${step.commandId}`}
          aria-live="polite"
          className="kunai-bento-term flex min-h-[9.5rem] flex-col gap-2 rounded-xl border border-[var(--kunai-line)] p-4 font-mono text-xs"
        >
          <p className="text-fd-muted-foreground m-0">
            <span aria-hidden="true">kunai › </span>
            <span className="text-fd-foreground">/{step.alias}</span>
          </p>
          {/* Keyed by the command so the stagger replays each time one is chosen. */}
          <ol key={step.commandId} className="m-0 flex list-none flex-col gap-1.5 p-0">
            {step.lines.map((line, index) => {
              const last = index === step.lines.length - 1;
              return (
                <li
                  key={line}
                  style={{ animationDelay: `calc(${index} * var(--dur-press))` }}
                  className="kunai-bento-line flex gap-2 leading-5"
                >
                  <span
                    aria-hidden="true"
                    className={last ? "text-[var(--kunai-ok)]" : "text-fd-muted-foreground"}
                  >
                    {last ? "✓" : "›"}
                  </span>
                  <span className={last ? "text-fd-foreground" : "text-fd-muted-foreground"}>
                    {line}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </BentoTile>
  );
}
