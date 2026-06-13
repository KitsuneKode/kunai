"use client";

import { Check, Copy, Sliders } from "lucide-react";
import { memo } from "react";

import type { HomeCliOption } from "./types";

interface CliCommandBuilderProps {
  readonly flags: readonly HomeCliOption[];
  readonly selectedFlags: readonly string[];
  readonly toggleFlag: (flag: string) => void;
  readonly searchWord: string;
  readonly setSearchWord: (word: string) => void;
  readonly buildCommandLine: () => string;
  readonly copyToClipboard: (text: string, label: string) => void;
  readonly copiedText: string | null;
}

const CliCommandBuilder = memo(function CliCommandBuilder({
  flags,
  selectedFlags,
  toggleFlag,
  searchWord,
  setSearchWord,
  buildCommandLine,
  copyToClipboard,
  copiedText,
}: CliCommandBuilderProps) {
  const showSearchParam = selectedFlags.includes("-S") || selectedFlags.includes("--search");

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
                  ? "border-[#f09cb5] bg-[#f09cb5]/5"
                  : "border-[#f4d8e4]/5 bg-[#130f17]/40 hover:border-[#f4d8e4]/15"
              }`}
              onClick={() => toggleFlag(flag.long)}
            >
              <div
                className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                  isChecked ? "border-[#f09cb5] bg-[#f09cb5] text-white" : "border-[#f4d8e4]/20"
                }`}
              >
                {isChecked ? <Check className="h-2.5 w-2.5 stroke-[4]" /> : null}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-white">
                  {flag.short ? <span className="text-[#f09cb5]">{flag.short}</span> : null}
                  <span>{flag.long}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-sans text-[10px] leading-normal font-light text-[#f4d8e4]/40">
                  {flag.description || "CLI parameter option"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flag-builder-shell flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/10 bg-[#130f17]/60 p-6 shadow-xl backdrop-blur-md">
        <div>
          <div className="mb-4 flex items-center gap-2 border-b border-[#f4d8e4]/5 pb-3">
            <Sliders className="h-4 w-4 text-[#f09cb5]" />
            <h4 className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
              Command Compiler Output
            </h4>
          </div>

          {showSearchParam ? (
            <div className="mb-5 rounded-xl border border-[#f4d8e4]/10 bg-[#0b070e]/80 p-4">
              <label
                htmlFor="search-query-field"
                className="mb-2 block text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase"
              >
                Edit search query parameter
              </label>
              <input
                id="search-query-field"
                type="text"
                className="w-full rounded-lg border border-[#f4d8e4]/10 bg-[#130f17] px-3 py-2 font-mono text-xs text-white transition-colors outline-none focus:border-[#f09cb5]"
                value={searchWord}
                onChange={(e) => setSearchWord(e.target.value)}
                aria-label="Edit command search query parameter value"
              />
            </div>
          ) : null}

          <p className="font-sans text-xs leading-relaxed font-light text-[#f4d8e4]/60">
            Select runtime configurations on the left to automatically construct a CLI call string.
            The Kunai compiler loads config parameters synchronously and pipes results directly to
            mpv.
          </p>
        </div>

        <div className="mt-6">
          <div className="flag-cmd-preview flex items-center justify-between rounded-xl border border-[#f09cb5]/30 bg-[#0b070e] p-4 shadow-inner">
            <span className="font-mono text-xs font-semibold break-all text-white select-all">
              {buildCommandLine()}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(buildCommandLine(), "cmd-line")}
              className="ml-3 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#f4d8e4]/10 bg-[#130f17] px-3 py-1.5 text-xs text-[#f09cb5] transition-colors hover:border-[#f09cb5] hover:text-white active:scale-[0.96]"
            >
              {copiedText === "cmd-line" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#8de4c2]" />
                  <span className="text-[#8de4c2]">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export { CliCommandBuilder };
