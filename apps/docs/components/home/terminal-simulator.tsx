"use client";

import { commandsForPalette } from "@/lib/home-presenters";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useMotionTemplate,
  useSpring,
} from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
      text: `System verified. Dependencies: mpv ${runtimeBaseline.mpv}, bun ${runtimeBaseline.bun}`,
    },
    { id: "welcome-3", text: "Ready. Type '/' or click a preset below to try." },
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

  const rotateXValue = useMotionValue(0);
  const rotateYValue = useMotionValue(0);
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  const rotateX = useSpring(rotateXValue, { stiffness: 350, damping: 28 });
  const rotateY = useSpring(rotateYValue, { stiffness: 350, damping: 28 });
  const glareBackground = useMotionTemplate`radial-gradient(350px circle at ${glareX}% ${glareY}%, var(--kunai-mesh-a), transparent 80%)`;

  const filteredCommands = useMemo(
    () => commandsForPalette(paletteCommands, allCommands, searchQuery),
    [allCommands, paletteCommands, searchQuery],
  );

  const handleMouseMove = useCallback((_e: React.MouseEvent<HTMLDivElement>) => {
    // Keep the terminal calm — no 3D tilt on the docs home.
  }, []);

  const handleMouseLeave = useCallback(() => {
    rotateXValue.set(0);
    rotateYValue.set(0);
    glareX.set(50);
    glareY.set(50);
  }, [glareX, glareY, rotateXValue, rotateYValue]);

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
    if (selectedPaletteIndex >= filteredCommands.length) {
      setSelectedPaletteIndex(0);
    }
  }, [filteredCommands.length, selectedPaletteIndex]);

  const focusTerminalInput = () => {
    if (terminalInputRef.current) {
      terminalInputRef.current.focus();
    }
  };

  const runSimulatedCommand = (cmdText: string) => {
    if (terminalState === "running") return;

    setCommandPaletteOpen(false);
    setTerminalState("running");

    const addLog = (line: string, delay: number) => {
      setTimeout(() => {
        setTerminalLogs((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, text: line }]);
      }, delay);
    };

    setTerminalInput("");
    setTerminalLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-input`, text: `\nkunai > ${cmdText}` },
    ]);

    let accDelay = 100;

    if (cmdText.startsWith("/search ") || cmdText.startsWith("search ") || cmdText === "search") {
      const parts = cmdText.split(" ");
      const query = parts.slice(1).join(" ") || "Dune";

      addLog(`[QUERY] Querying metadata catalogs for "${query}"...`, accDelay);
      accDelay += 600;
      addLog(`[ OK ] Match found: "${query}" (Release verified, 2024)`, accDelay);
      accDelay += 400;
      addLog("[FETCH] Fetching active streams from verification cache...", accDelay);
      accDelay += 500;

      const isAnime = query.toLowerCase().match(/(naruto|piece|totoro|titan|frieren|re:zero|oshi)/);
      const eligibleProviders = providers.filter((p) => {
        const kindsSet = new Set(p.mediaKinds.map((k) => k.toLowerCase()));
        return isAnime ? kindsSet.has("anime") : kindsSet.has("movie") || kindsSet.has("series");
      });

      const primaryProvider =
        eligibleProviders.find((p) => p.recommended) || eligibleProviders[0] || providers[0];

      if (primaryProvider) {
        addLog(
          `[INFO] Selected provider: ${primaryProvider.displayName} (${primaryProvider.domain})`,
          accDelay,
        );
        accDelay += 500;
        addLog(
          `[INFO] Resolving stream parameters [status: ${primaryProvider.status}]...`,
          accDelay,
        );
        accDelay += 700;
        if (primaryProvider.capabilities.includes("quality-ranked")) {
          addLog("[ OK ] Stream verified: 1080p selected (variants: 720p, 480p)", accDelay);
        } else {
          addLog("[ OK ] Stream verified: direct-http source resolved", accDelay);
        }
        accDelay += 400;
      }

      addLog("[PLAY] Launching mpv player window...", accDelay);
      accDelay += 600;
      addLog(`[mpv] Playing "${query}" - supervisor handoff established.`, accDelay);
      accDelay += 500;
      addLog("[mpv] Press 'r' to recover stream, 'f' to try fallback, 'Esc' to return.", accDelay);
    } else if (cmdText.startsWith("/discover") || cmdText === "discover") {
      addLog("[QUERY] Querying catalog recommendation engine...", accDelay);
      accDelay += 500;
      addLog("[INFO] Reading local SQLite continuation weights...", accDelay);
      accDelay += 400;
      addLog("\nTrending Today [Discover]:", accDelay);
      accDelay += 200;
      addLog("  1. Frieren: Beyond Journey's End (Series) [Anime]", accDelay);
      accDelay += 100;
      addLog("  2. Dune: Part Two (Movie) [Sci-Fi]", accDelay);
      accDelay += 100;
      addLog("  3. Erased (Series) [Mystery]", accDelay);
      accDelay += 400;
      addLog("\nUse arrow keys and press Enter to launch.", accDelay);
    } else if (cmdText.startsWith("/calendar") || cmdText === "calendar") {
      addLog("[FETCH] Fetching release calendar schedule...", accDelay);
      accDelay += 600;
      addLog("Releasing Today (Source Sync):", accDelay);
      accDelay += 200;
      addLog("  [AIRING] Oshi no Ko S3 Ep 02 - Direct HTTP resolved", accDelay);
      accDelay += 150;
      addLog("  [AIRING] Re:Zero S3 Ep 14 - MAL synced (in 3h)", accDelay);
      accDelay += 150;
      addLog("  [AIRING] House of the Dragon S3 Ep 03 (Aired 12h ago)", accDelay);
      accDelay += 300;
      addLog("\nReady. Check commands bar for offline sync schedules.", accDelay);
    } else if (cmdText.startsWith("/setup") || cmdText === "setup" || cmdText.includes("setup")) {
      addLog("[SETUP] Initializing Setup Wizard...", accDelay);
      accDelay += 400;
      addLog("Checking dependencies...", accDelay);
      accDelay += 300;
      addLog("  mpv: OK (0.38.0)", accDelay);
      addLog("  chafa (kitty graphics): OK", accDelay);
      addLog("  sqlite3: OK", accDelay);
      accDelay += 400;
      addLog("Configure default media directories:", accDelay);
      addLog("  Download path: ~/Downloads/kunai", accDelay);
      addLog("  Cache DB limit: 512MB", accDelay);
      accDelay += 300;
      addLog("Configuration atomic-written to ~/.config/kunai/config.json", accDelay);
    } else if (cmdText.startsWith("/recover") || cmdText === "recover") {
      addLog("[RECOVERY] Recovery sequence initiated.", accDelay);
      accDelay += 300;
      addLog("Requesting a fresh stream from the active provider...", accDelay);
      accDelay += 500;
      addLog("[ OK ] Resolved new stream segment (no playback drift). Resuming mpv...", accDelay);
    } else if (cmdText.startsWith("/fallback") || cmdText === "fallback") {
      addLog("[WARN] Fallback sequence requested.", accDelay);
      accDelay += 300;
      addLog("Switching stream source from current provider...", accDelay);
      accDelay += 450;
      addLog("Connecting to fallback provider: Miruro (domain: miruro.tv)...", accDelay);
      accDelay += 500;
      addLog("[ OK ] Miruro stream resolved at 720p. Playback restored.", accDelay);
    } else if (cmdText.startsWith("/help") || cmdText === "help") {
      addLog("Help Manual - Context Commands:", accDelay);
      accDelay += 150;
      paletteCommands.forEach((cmd) => {
        addLog(`  /${cmd.id.padEnd(12)} - ${cmd.description}`, accDelay);
        accDelay += 50;
      });
      addLog("Type '/' for more commands or open the CLI reference.", accDelay);
    } else {
      addLog(`Evaluating unknown command: "${cmdText}"`, accDelay);
      accDelay += 300;
      addLog("Command not recognized. Type '/' for suggestions, or '/help'.", accDelay);
    }

    setTimeout(() => {
      setTerminalState("idle");
    }, accDelay);
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
        const selected = filteredCommands[selectedPaletteIndex];
        if (selected) {
          const runCmd = `/${selected.id}`;
          setTerminalInput(runCmd);
          runSimulatedCommand(runCmd);
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
    <div className="relative flex w-full items-center justify-center" style={{ perspective: 1200 }}>
      <div className="kunai-hero-glow" aria-hidden="true" />

      <motion.aside
        ref={terminalStageRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={`kunai-terminal-stage group relative w-full overflow-hidden select-none ${
          commandPaletteOpen ? "is-focused" : ""
        }`}
        style={{ transformStyle: "preserve-3d", rotateX, rotateY }}
        aria-label="Kunai terminal preview"
      >
        <motion.div
          className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: glareBackground }}
        />

        <div className="kunai-terminal-top">
          <span className="text-fd-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="kunai-status-dot kunai-status-dot--focus" />
            kunai shell
          </span>
          <span className="kunai-text-accent text-[10px] font-semibold">cli active</span>
          <span className="kunai-step-meta">mpv verified</span>
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

          <AnimatePresence initial={false}>
            {commandPaletteOpen && filteredCommands.length > 0 && (
              <motion.span
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
                className="kunai-command-palette"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <span className="palette-search-wrapper">
                  <span className="kunai-text-accent mr-2 font-bold">/</span>
                  <input
                    ref={paletteInputRef}
                    type="text"
                    className="palette-search-input text-fd-foreground w-full border-none bg-transparent text-xs outline-none"
                    value={searchQuery.replace(/^\//, "")}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search commands..."
                    aria-label="CLI commands query filter"
                  />
                </span>
                <span className="palette-list flex max-h-[180px] flex-col gap-0.5 overflow-y-auto p-1.5">
                  {filteredCommands.map((cmd, index) => (
                    <button
                      type="button"
                      key={cmd.id}
                      className={`palette-item flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        index === selectedPaletteIndex
                          ? "is-selected"
                          : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const runCmd = `/${cmd.id}`;
                        setTerminalInput(runCmd);
                        runSimulatedCommand(runCmd);
                      }}
                      onMouseEnter={() => setSelectedPaletteIndex(index)}
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
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
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
      </motion.aside>
    </div>
  );
});

export { TerminalSimulator };
