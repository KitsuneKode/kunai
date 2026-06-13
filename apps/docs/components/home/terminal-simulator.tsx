"use client";

import { Terminal as TerminalIcon, Check, Copy, ArrowRight, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { homeHero } from "../../lib/home-content";
import { HeroHeadline } from "./hero-headline";
import type { HomeCommandMetadata, HomeLogEntry, HomeProviderMetadata } from "./types";

interface TerminalSimulatorProps {
  readonly providers: readonly HomeProviderMetadata[];
  readonly commands: readonly HomeCommandMetadata[];
  readonly installCommands: readonly string[];
  readonly primaryCtaHref: string;
  readonly primaryCtaLabel: string;
  readonly secondaryCtaHref: string;
  readonly secondaryCtaLabel: string;
  readonly copyToClipboard: (text: string, label: string) => void;
  readonly copiedText: string | null;
}

const TerminalSimulator = memo(function TerminalSimulator({
  providers,
  commands,
  installCommands,
  primaryCtaHref,
  primaryCtaLabel,
  copyToClipboard,
  copiedText,
}: TerminalSimulatorProps) {
  const [terminalLogs, setTerminalLogs] = useState<readonly HomeLogEntry[]>([
    { id: "welcome-1", text: "▌ Kunai Shell v0.1.0" },
    { id: "welcome-2", text: "System verified. Dependencies: mpv 0.38, bun 1.3.12" },
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

  // 3D Card Hover States
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setMousePos({ x, y });
  };

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  // Focus palette input when open
  useEffect(() => {
    if (commandPaletteOpen && paletteInputRef.current) {
      paletteInputRef.current.focus();
    }
  }, [commandPaletteOpen]);

  // Handle outside clicks to close command palette
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (terminalStageRef.current && !terminalStageRef.current.contains(event.target as Node)) {
        setCommandPaletteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCommands = commands.filter((cmd) => {
    const q = searchQuery.toLowerCase().replace(/^\//, "");
    return (
      cmd.id.toLowerCase().includes(q) ||
      cmd.label.toLowerCase().includes(q) ||
      (cmd.aliases && cmd.aliases.some((alias: string) => alias.toLowerCase().includes(q)))
    );
  });

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
      addLog("Bypassing memory buffers...", accDelay);
      accDelay += 300;
      addLog("Resolving fresh payload keys from upstream manifest...", accDelay);
      accDelay += 500;
      addLog("[ OK ] Resolved new stream segment (No playback drift). Resuming mpv...", accDelay);
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
      commands.slice(0, 8).forEach((cmd) => {
        addLog(`  /${cmd.id.padEnd(12)} - ${cmd.description}`, accDelay);
        accDelay += 50;
      });
      addLog("Type '/' for full search overlay.", accDelay);
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

  const onPresetClick = (cmd: string) => {
    focusTerminalInput();
    runSimulatedCommand(cmd);
  };

  return (
    <div className="grid min-h-[calc(100dvh-8rem)] grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] items-center gap-10 pb-18 max-lg:min-h-0 max-lg:grid-cols-1 max-lg:pt-10">
      <div className="kunai-reveal flex flex-col justify-center">
        <div className="mb-6 flex w-fit items-center gap-2 rounded-full border border-[#f4d8e4]/10 bg-[#130f17]/40 px-3 py-1 text-[11px] tracking-widest text-[#f09cb5]/80 uppercase shadow-sm backdrop-blur-md">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-[#f09cb5]" />
          <span>{homeHero.eyebrow}</span>
        </div>

        <HeroHeadline title={homeHero.title} />

        <p className="mt-7 max-w-xl font-sans text-base leading-relaxed font-light text-pretty text-[#f4d8e4]/70 md:text-lg">
          {homeHero.description}
        </p>

        {/* Tactile Install Command in Hero */}
        <div className="mt-6 flex w-full max-w-md flex-col gap-3">
          <div className="hero-install-box flex items-center justify-between p-3 font-mono text-xs text-zinc-300">
            <div className="flex items-center gap-2 select-all">
              <span className="text-[#f09cb5]/70 select-none">$</span>
              <span>bun install -g @kitsunekode/kunai</span>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard("bun install -g @kitsunekode/kunai", "hero-install")}
              className="copy-btn shrink-0 cursor-pointer rounded-lg border border-[#f4d8e4]/10 bg-[#1e1824] px-2.5 py-1 text-[10px] text-[#f09cb5] transition-colors hover:border-[#f09cb5] hover:text-white"
            >
              {copiedText === "hero-install" ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-[#f4d8e4]/40">
            <span className="flex items-center gap-1">
              <Check className="h-3.5 w-3.5 stroke-[3] text-[#8de4c2]" />
              Bun first
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#f4d8e4]/10" />
            <span className="flex items-center gap-1">
              <Check className="h-3.5 w-3.5 stroke-[3] text-[#8de4c2]" />
              Local decryption
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#f4d8e4]/10" />
            <span className="flex items-center gap-1">
              <Check className="h-3.5 w-3.5 stroke-[3] text-[#8de4c2]" />
              No browser needed
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link className="kunai-button kunai-button-primary" href={primaryCtaHref}>
            <span>{primaryCtaLabel}</span>
            <ArrowRight className="ml-1.5 h-4 w-4 shrink-0" />
          </Link>
          <a className="kunai-button" href="#install">
            <span>Quick Start</span>
          </a>
          <button
            type="button"
            className="kunai-button flex items-center gap-2 border-[#f09cb5]/20 text-[#f09cb5]/90 hover:text-white"
            onClick={() => onPresetClick("/help")}
          >
            <TerminalIcon className="h-4 w-4 shrink-0" />
            <span>Interactive Simulator</span>
          </button>
        </div>
      </div>

      <div
        className="relative flex w-full max-w-md items-center justify-center max-lg:max-w-none"
        style={{ perspective: 1200 }}
      >
        {/* Glow behind terminal */}
        <div className="absolute inset-0 -z-10 scale-75 rounded-full bg-gradient-to-tr from-[#f09cb5]/8 to-[#8de4c2]/5 blur-3xl" />

        <motion.aside
          ref={terminalStageRef}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            setMousePos({ x: 0, y: 0 });
          }}
          animate={{
            rotateY: mousePos.x * 6,
            rotateX: -mousePos.y * 6,
            z: isHovered ? 8 : 0,
          }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className={`kunai-terminal-stage group relative w-full overflow-hidden select-none ${
            commandPaletteOpen ? "is-focused" : ""
          }`}
          style={{ transformStyle: "preserve-3d" }}
          aria-label="Kunai terminal preview"
        >
          {/* Radial spotlight glare inside terminal */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: `radial-gradient(350px circle at ${((mousePos.x + 0.5) * 100).toFixed(
                0,
              )}% ${((mousePos.y + 0.5) * 100).toFixed(
                0,
              )}%, rgba(240, 156, 181, 0.08), transparent 80%)`,
            }}
          />

          <div className="kunai-terminal-top border-b border-[#f4d8e4]/10 bg-[#0b070e]/80 backdrop-blur-md">
            <span className="flex items-center gap-1.5 text-xs text-[#f4d8e4]/80">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#f09cb5]"></span>
              kunai shell
            </span>
            <span className="text-[10px] font-semibold text-[#f09cb5]">cli active</span>
            <span className="text-[10px] text-[#f4d8e4]/40">mpv verified</span>
          </div>

          <div
            ref={terminalBodyRef}
            className="kunai-terminal-body scrollbar block max-h-[360px] min-h-[260px] w-full cursor-text bg-[#0b070e]/95 text-left backdrop-blur-sm focus:outline-none"
            onClick={focusTerminalInput}
            role="presentation"
          >
            {terminalLogs.map((line) => (
              <span
                key={line.id}
                className={`block font-mono text-xs ${
                  line.text.startsWith("kunai >")
                    ? "mt-2 font-bold text-[#f09cb5]"
                    : line.text.includes("[ OK ]") || line.text.includes("OK")
                      ? "text-[#8de4c2]"
                      : line.text.includes("[WARN]") || line.text.includes("[AIRING]")
                        ? "text-[#e4c180]"
                        : line.text.includes("[PLAY]") || line.text.includes("mpv")
                          ? "text-sky-300"
                          : line.text.includes("[QUERY]") ||
                              line.text.includes("[FETCH]") ||
                              line.text.includes("[SETUP]") ||
                              line.text.includes("[RECOVERY]")
                            ? "text-[#f09cb5]"
                            : line.text.startsWith("▌")
                              ? "font-bold text-[#f09cb5]"
                              : "text-[#f4d8e4]/50"
                }`}
              >
                {line.text}
              </span>
            ))}

            <span className="relative mt-3 flex items-center border-t border-[#f4d8e4]/5 pt-2">
              <span className="mr-2 text-xs font-bold text-[#f09cb5]">kunai &gt;</span>
              <input
                ref={terminalInputRef}
                type="text"
                className="w-full border-none bg-transparent font-mono text-xs text-white outline-none"
                value={terminalInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type '/' for commands..."
                disabled={terminalState === "running"}
                aria-label="Terminal command execution box"
              />
              <span className="kunai-cursor shrink-0"></span>
            </span>

            <AnimatePresence initial={false}>
              {commandPaletteOpen && filteredCommands.length > 0 && (
                <motion.span
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.98 }}
                  transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
                  className="kunai-command-palette block rounded-xl border border-[#f09cb5] bg-[#1e1824] shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <span className="palette-search-wrapper flex items-center border-b border-[#f4d8e4]/10 bg-[#0b070e]/80 px-3 py-2">
                    <span className="mr-2 font-bold text-[#f09cb5]">/</span>
                    <input
                      ref={paletteInputRef}
                      type="text"
                      className="palette-search-input w-full border-none bg-transparent text-xs text-white outline-none"
                      value={searchQuery.replace(/^\//, "")}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search commands..."
                      aria-label="CLI commands query filter"
                    />
                  </span>
                  <span className="palette-list block max-h-[180px] space-y-0.5 overflow-y-auto p-1.5">
                    {filteredCommands.map((cmd, index) => (
                      <button
                        type="button"
                        key={cmd.id}
                        className={`palette-item flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                          index === selectedPaletteIndex
                            ? "border-l-2 border-[#f09cb5] bg-[#281f30] text-white"
                            : "text-zinc-300 hover:bg-[#1e1824]"
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
                          <span className="font-semibold text-white">/{cmd.id}</span>
                          <span className="ml-1.5 text-[10px] text-[#f09cb5]/60">
                            ({cmd.label})
                          </span>
                          <span className="mt-0.5 block font-sans text-[10px] text-[#f4d8e4]/40">
                            {cmd.description}
                          </span>
                        </span>
                        <span className="palette-shortcut rounded border border-[#f4d8e4]/10 px-1 py-0.5 text-[9px] text-[#f4d8e4]/40">
                          Enter
                        </span>
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
                className="cursor-pointer rounded-lg border border-[#f4d8e4]/10 bg-[#130f17] px-2.5 py-1 font-mono text-[10px] text-[#f4d8e4]/80 transition-all hover:border-[#f09cb5] hover:bg-[#1e1824] hover:text-white"
              >
                {cmd}
              </button>
            ))}
          </div>

          <div className="kunai-install mt-4 rounded-xl border-t border-[#f4d8e4]/10 bg-[#0b070e]/80 p-3">
            <span className="mb-2 block text-[10px] font-semibold tracking-wider text-[#f4d8e4]/40 uppercase">
              Install CLI package
            </span>
            <div className="space-y-1.5">
              {installCommands.map((command) => (
                <code
                  key={command}
                  className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17] px-3 py-1.5 font-mono text-[11px] text-zinc-300"
                >
                  <span>{command}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(command, command)}
                    className="flex cursor-pointer items-center gap-1 rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[10px] text-[#f09cb5] transition-colors hover:border-[#f09cb5] hover:text-white"
                  >
                    {copiedText === command ? (
                      <>
                        <Check className="h-3 w-3 text-[#8de4c2]" />
                        <span className="text-[#8de4c2]">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </code>
              ))}
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );
});

export { TerminalSimulator };
