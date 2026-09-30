"use client";

import { commandsForPalette } from "@/lib/home-presenters";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { simulatedCommandScript } from "./simulated-command-script";
import { TerminalCommandPalette } from "./terminal-command-palette";
import type { HomeCommandMetadata, HomeLogEntry, HomeProviderMetadata } from "./types";

interface TerminalSimulatorProps {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
}

const TerminalSimulator = memo(function TerminalSimulator({
  providers,
  paletteCommands,
  allCommands,
  cliVersion,
  runtimeBaseline,
}: TerminalSimulatorProps) {
  const [terminalLogs, setTerminalLogs] = useState<readonly HomeLogEntry[]>([
    { id: "welcome-1", text: `▌ Kunai Shell v${cliVersion}` },
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
  const terminalStageRef = useRef<HTMLDivElement>(null);
  const scriptTimersRef = useRef<number[]>([]);

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
      if (terminalStageRef.current && !terminalStageRef.current.contains(event.target as Node)) {
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

  // Clamp at read time instead of syncing state in an effect: a stale index
  // past the filtered list end simply reads as the last row.
  const selectedIndex =
    filteredCommands.length === 0 ? 0 : Math.min(selectedPaletteIndex, filteredCommands.length - 1);

  const focusTerminalInput = () => {
    if (terminalInputRef.current) {
      terminalInputRef.current.focus();
    }
  };

  const runSimulatedCommand = (cmdText: string) => {
    if (terminalState === "running") return;

    setCommandPaletteOpen(false);
    setTerminalState("running");
    setTerminalInput("");
    setTerminalLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-input`, text: `\nkunai > ${cmdText}` },
    ]);

    const script = simulatedCommandScript(cmdText, providers, paletteCommands);
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (commandPaletteOpen) {
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
          runSimulatedCommand(`/${selected.id}`);
        }
      } else if (e.key === "Escape") {
        setCommandPaletteOpen(false);
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
    focusTerminalInput();
    runSimulatedCommand(cmd);
  };

  return (
    <div className="relative flex w-full items-center justify-center">
      <div className="kunai-hero-glow" aria-hidden="true" />

      <aside
        ref={terminalStageRef}
        className={`kunai-terminal-stage relative w-full overflow-hidden ${
          commandPaletteOpen ? "is-focused" : ""
        }`}
        aria-label="Kunai terminal preview"
      >
        <div className="kunai-terminal-top">
          <span className="text-fd-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="kunai-status-dot kunai-status-dot--focus" />
            kunai shell
          </span>
          <span className="kunai-terminal-badges">
            <span className="kunai-step-meta tabular-nums">v{cliVersion}</span>
            <span className="kunai-step-meta">simulated</span>
          </span>
        </div>

        <div
          ref={terminalBodyRef}
          className="kunai-terminal-body scrollbar block max-h-[360px] min-h-[260px] w-full cursor-text text-left focus:outline-none"
          onClick={focusTerminalInput}
          role="presentation"
        >
          {terminalLogs.map((line) => (
            <span key={line.id} className={getLogLineClass(line.text)}>
              {line.text}
            </span>
          ))}

          <span className="kunai-terminal-input-row">
            <span className="kunai-text-accent mr-2 text-xs font-bold">kunai &gt;</span>
            <input
              ref={terminalInputRef}
              type="text"
              className="text-fd-foreground w-full border-none bg-transparent font-mono text-xs outline-none"
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
          onRun={(cmd) => runSimulatedCommand(`/${cmd.id}`)}
        />

        <div className="kunai-terminal-presets mt-4">
          <span className="kunai-step-meta shrink-0">Try one</span>
          {["/search Dune", "/discover", "/calendar", "/setup"].map((cmd) => (
            <button
              type="button"
              key={cmd}
              onClick={() => onPresetClick(cmd)}
              className="border-fd-border bg-fd-card text-fd-muted-foreground hover:border-fd-primary hover:bg-fd-accent hover:text-fd-foreground cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-[transform,border-color,background-color,color] duration-150 ease-out active:scale-[0.96]"
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
