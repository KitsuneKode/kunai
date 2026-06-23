"use client";

import { CopyButton } from "@/components/ui/copy-button";
import { Check, Sliders } from "lucide-react";
import { memo } from "react";

import type { HomeCliOption } from "./types";

interface CliCommandBuilderProps {
  readonly flags: readonly HomeCliOption[];
  readonly selectedFlags: readonly string[];
  readonly toggleFlag: (flag: string) => void;
  readonly searchWord: string;
  readonly setSearchWord: (word: string) => void;
  readonly buildCommandLine: () => string;
}

const CliCommandBuilder = memo(function CliCommandBuilder({
  flags,
  selectedFlags,
  toggleFlag,
  searchWord,
  setSearchWord,
  buildCommandLine,
}: CliCommandBuilderProps) {
  const showSearchParam = selectedFlags.includes("-S") || selectedFlags.includes("--search");
  const commandLine = buildCommandLine();

  return (
    <div className="grid grid-cols-[1fr_0.9fr] gap-8 max-lg:grid-cols-1">
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {flags.slice(0, 12).map((flag) => {
          const isChecked = selectedFlags.includes(flag.long);
          return (
            <button
              type="button"
              key={flag.long}
              className={`flag-checkbox-wrapper flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors duration-200 ${
                isChecked
                  ? "border-[var(--kunai-accent)] bg-[color-mix(in_oklab,var(--kunai-accent)_5%,transparent)]"
                  : "border-fd-border bg-fd-card/40 hover:border-fd-primary/30"
              }`}
              onClick={() => toggleFlag(flag.long)}
            >
              <div
                className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                  isChecked
                    ? "border-[var(--kunai-accent)] bg-[var(--kunai-accent)] text-white"
                    : "border-fd-border"
                }`}
              >
                {isChecked ? <Check className="h-2.5 w-2.5 stroke-[4]" /> : null}
              </div>
              <div className="flex-1">
                <div className="text-fd-foreground flex items-center gap-1.5 font-mono text-xs font-bold">
                  {flag.short ? (
                    <span className="text-[var(--kunai-accent)]">{flag.short}</span>
                  ) : null}
                  <span>{flag.long}</span>
                </div>
                <div className="text-fd-muted-foreground mt-1 line-clamp-2 font-sans text-[10px] leading-normal">
                  {flag.description || "CLI parameter option"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flag-builder-shell border-fd-border bg-fd-card/60 flex flex-col justify-between rounded-2xl border p-6 shadow-xl backdrop-blur-md">
        <div>
          <div className="border-fd-border mb-4 flex items-center gap-2 border-b pb-3">
            <Sliders className="h-4 w-4 text-[var(--kunai-accent)]" />
            <h4 className="text-fd-muted-foreground text-[11px] font-bold tracking-wider uppercase">
              Command output
            </h4>
          </div>

          {showSearchParam ? (
            <div className="border-fd-border bg-fd-background/80 mb-5 rounded-xl border p-4">
              <label
                htmlFor="search-query-field"
                className="mb-2 block text-[10px] font-bold tracking-wider text-[var(--kunai-accent)] uppercase"
              >
                Search query
              </label>
              <input
                id="search-query-field"
                type="text"
                className="border-fd-border bg-fd-card text-fd-foreground w-full rounded-lg border px-3 py-2 font-mono text-xs transition-colors outline-none focus:border-[var(--kunai-accent)]"
                value={searchWord}
                onChange={(e) => setSearchWord(e.target.value)}
                aria-label="Edit command search query parameter value"
              />
            </div>
          ) : null}

          <p className="text-fd-muted-foreground text-xs leading-relaxed">
            Select flags on the left to build a launch command you can paste into your shell.
          </p>
        </div>

        <div className="mt-6">
          <div className="flag-cmd-preview border-fd-primary/30 bg-fd-background flex items-center justify-between rounded-xl border p-4 shadow-inner">
            <span className="text-fd-foreground font-mono text-xs font-semibold break-all select-all">
              {commandLine}
            </span>
            <CopyButton text={commandLine} label="cmd-line" className="ml-3 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
});

export { CliCommandBuilder };
