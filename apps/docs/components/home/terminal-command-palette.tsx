"use client";

import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import type { RefObject } from "react";

import type { HomeCommandMetadata } from "./types";

interface TerminalCommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly HomeCommandMetadata[];
  readonly selectedIndex: number;
  readonly searchQuery: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onSearchChange: (value: string) => void;
  readonly onSelectIndex: (index: number) => void;
  readonly onRun: (command: HomeCommandMetadata) => void;
}

export function TerminalCommandPalette({
  open,
  commands,
  selectedIndex,
  searchQuery,
  inputRef,
  onSearchChange,
  onSelectIndex,
  onRun,
}: TerminalCommandPaletteProps) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {open && commands.length > 0 && (
          <m.span
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="kunai-command-palette"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <span className="palette-search-wrapper">
              <span className="kunai-text-accent mr-2 font-bold">/</span>
              <input
                ref={inputRef}
                type="text"
                className="palette-search-input text-fd-foreground w-full border-none bg-transparent text-xs outline-none"
                value={searchQuery.replace(/^\//, "")}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search commands..."
                aria-label="CLI commands query filter"
              />
            </span>
            <span className="palette-list flex max-h-[180px] flex-col gap-0.5 overflow-y-auto p-1.5">
              {commands.map((cmd, index) => (
                <button
                  type="button"
                  key={cmd.id}
                  className={`palette-item flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    index === selectedIndex
                      ? "is-selected"
                      : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun(cmd);
                  }}
                  onMouseEnter={() => onSelectIndex(index)}
                >
                  <span>
                    <span className="text-fd-foreground font-semibold">/{cmd.id}</span>
                    <span className="kunai-text-accent ml-1.5 text-[10px] opacity-60">
                      ({cmd.label})
                    </span>
                    <span className="kunai-step-meta mt-0.5 block">{cmd.description}</span>
                  </span>
                  <span className="palette-shortcut">Enter</span>
                </button>
              ))}
            </span>
          </m.span>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
