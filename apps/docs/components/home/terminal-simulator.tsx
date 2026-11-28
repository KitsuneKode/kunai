"use client";

import { useHomeStage } from "@/components/home/home-stage-context";
import {
  KITTY_CATALOG,
  KittySplitPane,
  type KittyTitleEntry,
} from "@/components/home/kitty-split-pane";
import { commandsForPalette } from "@/lib/home-presenters";
import type { HeroLane } from "@/lib/provider-sieve";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { simulatedCommandScript } from "./simulated-command-script";
import { TerminalCommandPalette } from "./terminal-command-palette";
import type { HomeCommandMetadata, HomeLogEntry, HomeProviderMetadata } from "./types";

interface TerminalSimulatorProps {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly cliVersion: string;
  readonly publishedVersion?: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
}

/**
 * The command the demo types for a visitor who has not touched the terminal.
 *
 * A search for a real title shows the whole promise in one run: query,
 * provider, verified stream, hand-off to mpv. It is the same script a visitor
 * gets from the "/search Dune" preset, so the demo is not a second code path.
 */
const DEMO_COMMAND = "/search Dune";
/** Quiet beat after mount before the first character, so the page lands first. */
const DEMO_START_MS = 1100;
/** Per-character delay; jittered so it reads as typing, not a ticker. */
const DEMO_KEY_MS = 55;
const DEMO_KEY_JITTER_MS = 40;
/** Pause between the last character and Enter. */
const DEMO_SUBMIT_MS = 380;

const TerminalSimulator = memo(function TerminalSimulator({
  providers,
  paletteCommands,
  allCommands,
  cliVersion,
  publishedVersion,
  runtimeBaseline,
}: TerminalSimulatorProps) {
  const versionBadge = publishedVersion ? `v${publishedVersion}` : `v${cliVersion} · next`;
  const { activeLane, setActiveLane, registerTerminalRunner } = useHomeStage();
  const [viewMode, setViewMode] = useState<"kitty" | "log">("kitty");
  const [selectedTitleId, setSelectedTitleId] = useState<string>("frieren");
  const [terminalLogs, setTerminalLogs] = useState<readonly HomeLogEntry[]>([
    { id: "welcome-1", text: `▌ Kunai Shell ${versionBadge}` },
    {
      id: "welcome-2",
      text: `Requires mpv ${runtimeBaseline.mpv}. The binary install embeds bun ${runtimeBaseline.bun}.`,
    },
    { id: "welcome-3", text: "Simulated shell. Type '/' or pick a command below to try one." },
  ]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPaletteIndex, setSelectedPaletteIndex] = useState(0);
  const [terminalState, setTerminalState] = useState<"idle" | "typing" | "running">("idle");
  const [terminalInput, setTerminalInput] = useState("");

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const terminalStageRef = useRef<HTMLDivElement>(null);
  const scriptTimersRef = useRef<number[]>([]);
  // The demo stops for good the first time the visitor does anything. Held in
  // refs because the typing loop runs on timers that outlive any one render.
  const interactedRef = useRef(false);
  const demoTypingRef = useRef(false);
  const runCommandRef = useRef<(command: string) => void>(() => {});

  const filteredCommands = useMemo(
    () => commandsForPalette(paletteCommands, allCommands, searchQuery),
    [allCommands, paletteCommands, searchQuery],
  );

  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  useEffect(() => {
    if (commandPaletteOpen && paletteInputRef.current) {
      paletteInputRef.current.focus();
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        terminalStageRef.current &&
        event.target instanceof Node &&
        !terminalStageRef.current.contains(event.target)
      ) {
        setCommandPaletteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const timers = scriptTimersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
    };
  }, []);

  // The demo. Skipped entirely under reduced motion, where a terminal that types
  // by itself is motion with nothing to opt out of it but this check.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let timer: number | undefined;
    let typed = 0;

    const submit = () => {
      demoTypingRef.current = false;
      if (interactedRef.current) return;
      runCommandRef.current(DEMO_COMMAND);
    };
    const typeNext = () => {
      if (interactedRef.current) return;
      typed += 1;
      setTerminalInput(DEMO_COMMAND.slice(0, typed));
      timer = window.setTimeout(
        typed < DEMO_COMMAND.length ? typeNext : submit,
        typed < DEMO_COMMAND.length
          ? DEMO_KEY_MS + Math.random() * DEMO_KEY_JITTER_MS
          : DEMO_SUBMIT_MS,
      );
    };

    timer = window.setTimeout(() => {
      if (interactedRef.current) return;
      demoTypingRef.current = true;
      typeNext();
    }, DEMO_START_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Anything the visitor does ends the demo. If it was mid-word, the half-typed
  // command goes with it: leaving "/sea" in the box reads as their typo.
  const endDemo = () => {
    interactedRef.current = true;
    if (demoTypingRef.current) {
      demoTypingRef.current = false;
      setTerminalInput("");
    }
  };

  // Clamp at read time instead of syncing state in an effect: a stale index
  // past the filtered list end simply reads as the last row.
  const selectedIndex =
    filteredCommands.length === 0 ? 0 : Math.min(selectedPaletteIndex, filteredCommands.length - 1);

  const focusTerminalInput = () => {
    if (terminalInputRef.current) {
      terminalInputRef.current.focus();
    }
  };

  const runSimulatedCommand = useCallback(
    (cmdText: string) => {
      // Interruptible: cancel any in-flight simulated script so external triggers
      // (mode ribbon, provider preview, bottom dock) always respond immediately.
      for (const id of scriptTimersRef.current) window.clearTimeout(id);
      scriptTimersRef.current.length = 0;

      setCommandPaletteOpen(false);
      setTerminalState("running");
      setTerminalInput("");
      setTerminalLogs((prev) => [
        ...prev,
        { id: `${Date.now()}-input`, text: `\nkunai > ${cmdText}` },
      ]);

      const script = simulatedCommandScript(cmdText, providers, allCommands);
      for (const step of script.steps) {
        scriptTimersRef.current.push(
          window.setTimeout(() => {
            setTerminalLogs((prev) => [
              ...prev,
              { id: `${Date.now()}-${Math.random()}`, text: step.line },
            ]);
          }, step.at),
        );
      }
      scriptTimersRef.current.push(
        window.setTimeout(() => {
          setTerminalState("idle");
        }, script.doneAt),
      );
    },
    [providers, allCommands],
  );

  useEffect(() => {
    runCommandRef.current = runSimulatedCommand;
    registerTerminalRunner((cmd: string) => {
      interactedRef.current = true;
      demoTypingRef.current = false;
      // Kitty view shows one log line; a user command needs the full log.
      setViewMode("log");
      runSimulatedCommand(cmd);
    });
    return () => registerTerminalRunner(null);
  }, [runSimulatedCommand, registerTerminalRunner]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (commandPaletteOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setCommandPaletteOpen(false);
        const returnTarget = paletteReturnFocusRef.current;
        paletteReturnFocusRef.current = null;
        if (returnTarget && returnTarget.isConnected) {
          returnTarget.focus();
        } else if (viewMode === "log") {
          focusTerminalInput();
        }
        return;
      }
      if (filteredCommands.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedPaletteIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedPaletteIndex(
          (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          setViewMode("log");
          runSimulatedCommand(`/${selected.id}`);
        }
      }
    } else {
      if (e.key === "Enter") {
        runSimulatedCommand(terminalInput || "/help");
      } else if (e.key === "/") {
        setCommandPaletteOpen(true);
        setSearchQuery("");
        setSelectedPaletteIndex(0);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTerminalInput(value);
    if (value.startsWith("/")) {
      setCommandPaletteOpen(true);
      setSearchQuery(value);
    } else {
      setCommandPaletteOpen(false);
    }
  };

  const getLogLineClass = (text: string): string => {
    if (text.startsWith("kunai >")) return "kunai-log-line kunai-log-line--prompt";
    if (text.includes("[ OK ]") || text.includes("OK")) return "kunai-log-line kunai-log-line--ok";
    if (text.includes("[WARN]") || text.includes("[AIRING]"))
      return "kunai-log-line kunai-log-line--warn";
    if (text.includes("[PLAY]") || text.includes("mpv"))
      return "kunai-log-line kunai-log-line--play";
    if (text.includes("[MODE]") || text.includes("[CMD]")) {
      return "kunai-log-line kunai-log-line--mode";
    }
    if (
      text.includes("[QUERY]") ||
      text.includes("[FETCH]") ||
      text.includes("[SETUP]") ||
      text.includes("[RECOVERY]")
    ) {
      return "kunai-log-line kunai-log-line--query";
    }
    if (text.startsWith("▌")) return "kunai-log-line kunai-log-line--brand";
    return "kunai-log-line kunai-log-line--muted";
  };

  const onPresetClick = (cmd: string) => {
    setViewMode("log");
    focusTerminalInput();
    runSimulatedCommand(cmd);
  };

  const handleKittySelectLane = (lane: HeroLane) => {
    setActiveLane(lane, { runDemo: false });
    const first = KITTY_CATALOG.find((item) => item.lane === lane);
    if (first) setSelectedTitleId(first.id);
  };

  const handleKittyPlay = (item: KittyTitleEntry) => {
    setSelectedTitleId(item.id);
    setViewMode("log");
    runSimulatedCommand(item.command);
  };

  const latestStatusLine =
    terminalLogs[terminalLogs.length - 1]?.text.replace(/^\n+/, "") ??
    `Kunai Shell ${versionBadge} · ready`;

  return (
    <div className="relative flex w-full items-center justify-center">
      <aside
        ref={terminalStageRef}
        className={`kunai-terminal-stage relative w-full overflow-hidden ${
          commandPaletteOpen ? "is-focused" : ""
        }`}
        aria-label="Kunai terminal preview"
        onPointerDownCapture={endDemo}
        onKeyDownCapture={endDemo}
        onFocusCapture={endDemo}
      >
        <div className="kunai-terminal-top">
          <span className="kunai-window-dots" aria-hidden="true">
            <span className="kunai-window-dot kunai-window-dot--close" />
            <span className="kunai-window-dot kunai-window-dot--min" />
            <span className="kunai-window-dot kunai-window-dot--max" />
          </span>
          <span className="kunai-terminal-title">
            {viewMode === "kitty" ? "kunai — kitty · graphics" : "kunai — zsh"}
          </span>
          <span className="kunai-terminal-badges">
            <span className="kunai-terminal-view-switch">
              <button
                type="button"
                onClick={() => setViewMode("kitty")}
                aria-pressed={viewMode === "kitty"}
                className={`kunai-terminal-view-btn ${viewMode === "kitty" ? "is-active" : ""}`}
              >
                Kitty TUI
              </button>
              <button
                type="button"
                onClick={() => setViewMode("log")}
                aria-pressed={viewMode === "log"}
                className={`kunai-terminal-view-btn ${viewMode === "log" ? "is-active" : ""}`}
              >
                Shell log
              </button>
            </span>
            <span className="tabular-nums">{versionBadge}</span>
          </span>
        </div>

        {viewMode === "kitty" ? (
          <KittySplitPane
            activeLane={activeLane}
            selectedId={selectedTitleId}
            statusLine={latestStatusLine}
            onSelectLane={handleKittySelectLane}
            onSelectItem={(item) => setSelectedTitleId(item.id)}
            onPlayItem={handleKittyPlay}
            onOpenPalette={() => {
              paletteReturnFocusRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setCommandPaletteOpen(true);
              setSearchQuery("");
              setSelectedPaletteIndex(0);
            }}
            onFallback={() => onPresetClick("/fallback")}
          />
        ) : (
          <div
            ref={terminalBodyRef}
            className="kunai-terminal-body block h-[22rem] w-full cursor-text text-left focus:outline-none"
            onClick={focusTerminalInput}
            role="presentation"
          >
            {terminalLogs.map((line) => (
              <span key={line.id} className={getLogLineClass(line.text)}>
                {line.text}
              </span>
            ))}

            <span className="kunai-terminal-input-row">
              <span className="kunai-text-accent mr-2 shrink-0 text-xs font-semibold whitespace-nowrap">
                kunai &gt;
              </span>
              <input
                ref={terminalInputRef}
                type="text"
                className="text-fd-foreground focus-visible:ring-ring w-full border-none bg-transparent font-mono text-base outline-none focus-visible:ring-2 sm:text-xs"
                value={terminalInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type '/' for commands..."
                disabled={terminalState === "running"}
                aria-label="Terminal command execution box"
              />
              <span className="kunai-cursor shrink-0" />
            </span>
          </div>
        )}

        {/* The palette hangs off the stage, not the scrolling body: inside
            `.kunai-terminal-body` its `top` resolves against scrolled content,
            so once logs overflow she renders above the visible region. */}
        <TerminalCommandPalette
          open={commandPaletteOpen}
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          searchQuery={searchQuery}
          inputRef={paletteInputRef}
          onSearchChange={setSearchQuery}
          onSelectIndex={setSelectedPaletteIndex}
          onRun={(cmd) => {
            setViewMode("log");
            runSimulatedCommand(`/${cmd.id}`);
          }}
          onKeyDown={handleKeyDown}
        />

        <div className="kunai-terminal-presets mt-4">
          <span className="kunai-step-meta shrink-0">Try one</span>
          {["/anime Frieren", "/search Dune", "/discover", "/calendar", "/recover"].map((cmd) => (
            <button
              type="button"
              key={cmd}
              onClick={() => onPresetClick(cmd)}
              className="focus-visible:ring-ring focus-visible:border-fd-primary min-h-[26px] cursor-pointer rounded-full border border-[var(--home-hair-strong)] bg-[var(--home-raise-1)] px-3 py-1 font-mono text-xs text-[var(--home-text-3)] transition-[transform,border-color,background-color,color] duration-150 ease-[var(--ease-out)] hover:border-[var(--kunai-accent)] hover:bg-[var(--home-raise-2)] hover:text-[var(--home-text-1)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {cmd}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
});

export { TerminalSimulator };
