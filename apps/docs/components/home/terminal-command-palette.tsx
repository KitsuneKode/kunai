/* oxlint-disable jsx-a11y/prefer-tag-over-role */
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
  readonly onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
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
  onKeyDown,
}: TerminalCommandPaletteProps) {
  const isExpanded = open;
  const selectedCommand =
    isExpanded && selectedIndex >= 0 && selectedIndex < commands.length
      ? commands[selectedIndex]
      : undefined;
  const activeDescendantId = selectedCommand ? `palette-cmd-${selectedCommand.id}` : undefined;

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <m.span
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="kunai-command-palette"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Command palette"
          >
            <span className="palette-search-wrapper">
              <span className="kunai-text-accent mr-2 font-bold" aria-hidden="true">
                /
              </span>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isExpanded}
                aria-controls="kunai-command-palette-list"
                aria-activedescendant={activeDescendantId}
                className="palette-search-input text-fd-foreground w-full border-none bg-transparent text-xs"
                value={searchQuery.replace(/^\//, "")}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search commands..."
                aria-label="CLI commands query filter"
              />
            </span>
            <span
              id="kunai-command-palette-list"
              role="listbox"
              aria-label="Suggested commands"
              className="palette-list flex max-h-[180px] flex-col gap-0.5 overflow-y-auto p-1.5"
            >
              {commands.length === 0 ? (
                <span className="text-fd-muted-foreground px-2.5 py-3 text-center text-xs">
                  No matching commands
                </span>
              ) : (
                commands.map((cmd, index) => {
                  const isSelected = index === selectedIndex;
                  const optionId = `palette-cmd-${cmd.id}`;
                  return (
                    <button
                      type="button"
                      key={cmd.id}
                      id={optionId}
                      role="option"
                      aria-selected={isSelected}
                      className={`palette-item flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isSelected
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
                      <span className="palette-shortcut" aria-hidden="true">
                        Enter
                      </span>
                    </button>
                  );
                })
              )}
            </span>
          </m.span>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
