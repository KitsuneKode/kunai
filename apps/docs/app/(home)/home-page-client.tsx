"use client";

import { motion, AnimatePresence } from "framer-motion";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";
import {
  Terminal as TerminalIcon,
  Cpu,
  Check,
  Copy,
  ArrowRight,
  Sparkles,
  Sliders,
  Star,
} from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import metadata from "../../lib/generated-metadata.json";
import {
  homeFlow,
  homeHero,
  homeHighlights,
  homeProof,
  homeSections,
} from "../../lib/home-content";

interface CliOption {
  readonly short: string;
  readonly long: string;
  readonly description: string;
}

interface ProviderMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly string[];
  readonly capabilities: readonly string[];
  readonly status: string;
  readonly notes: readonly string[];
}

interface LogEntry {
  readonly id: string;
  readonly text: string;
}

interface CommandMetadata {
  readonly id: string;
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly description: string;
}

// =============================================================================
// SUBCOMPONENT: TerminalSimulator (Memoized with 3D Tilt and Glare)
// =============================================================================
interface TerminalSimulatorProps {
  readonly providers: readonly ProviderMetadata[];
  readonly commands: readonly CommandMetadata[];
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
  const [terminalLogs, setTerminalLogs] = useState<readonly LogEntry[]>([
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
    <div className="grid min-h-[calc(100dvh-8rem)] grid-cols-[1.1fr_0.9fr] items-center gap-12 pb-18 max-lg:min-h-0 max-lg:grid-cols-1 max-lg:pt-10">
      <div className="kunai-reveal flex flex-col justify-center">
        <div className="mb-6 flex w-fit items-center gap-2 rounded-full border border-[#f4d8e4]/10 bg-[#130f17]/40 px-3 py-1 text-[11px] tracking-widest text-[#f09cb5]/80 uppercase shadow-sm backdrop-blur-md">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-[#f09cb5]" />
          <span>{homeHero.eyebrow}</span>
        </div>

        <h1 className="m-0 max-w-5xl bg-gradient-to-br from-white via-[#f4d8e4] to-[#f09cb5] bg-clip-text font-serif text-6xl leading-[0.98] font-light tracking-tight text-balance text-transparent md:text-7xl xl:text-8xl">
          {homeHero.title}
        </h1>

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
        className="relative flex w-full items-center justify-center"
        style={{ perspective: 1200 }}
      >
        {/* Glow behind terminal */}
        <div className="absolute inset-0 -z-10 scale-75 rounded-full bg-gradient-to-tr from-[#f09cb5]/10 to-transparent blur-3xl" />

        <motion.aside
          ref={terminalStageRef}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            setMousePos({ x: 0, y: 0 });
          }}
          animate={{
            rotateY: mousePos.x * 12,
            rotateX: -mousePos.y * 12,
            z: isHovered ? 16 : 0,
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

            <AnimatePresence>
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

// =============================================================================
// SUBCOMPONENT: ProvidersCatalog (Redesigned with Framer Motion LayoutId)
// =============================================================================
interface ProvidersCatalogProps {
  readonly providers: readonly ProviderMetadata[];
  readonly activeProviderId: string;
  readonly setActiveProviderId: (id: string) => void;
}

const ProvidersCatalog = memo(function ProvidersCatalog({
  providers,
  activeProviderId,
  setActiveProviderId,
}: ProvidersCatalogProps) {
  const activeProvider = providers.find((p) => p.id === activeProviderId) || providers[0];

  return (
    <div className="grid w-full gap-5">
      <div className="relative z-0 flex flex-wrap gap-2 border-b border-[#f4d8e4]/5 pb-4">
        {providers.map((provider) => {
          const isActive = activeProviderId === provider.id;
          return (
            <button
              type="button"
              key={provider.id}
              onClick={() => setActiveProviderId(provider.id)}
              className={`relative cursor-pointer rounded-lg px-4 py-2 text-xs font-bold transition-all duration-200 ${
                isActive
                  ? "text-white"
                  : "border border-[#f4d8e4]/5 bg-[#130f17] text-[#f4d8e4]/50 hover:border-[#f4d8e4]/20 hover:text-white"
              }`}
            >
              {provider.displayName}
              {provider.recommended ? (
                <Star className="ml-1 inline-block h-3 w-3 fill-current align-middle text-[#f09cb5]" />
              ) : null}

              {/* Smooth active background transition */}
              {isActive && (
                <motion.div
                  layoutId="activeProviderBg"
                  className="absolute inset-0 -z-10 rounded-lg border border-[#f09cb5]/30 bg-gradient-to-tr from-[#c86884] to-[#8c2a44] shadow-lg"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeProvider ? (
          <motion.div
            key={activeProvider.id}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.985 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.08 }}
            className="provider-details-card rounded-2xl border border-[#f4d8e4]/10 bg-[#130f17]/60 p-6 shadow-xl backdrop-blur-md"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="m-0 flex items-center gap-2 font-serif text-2xl font-light text-white">
                  <span>{activeProvider.displayName}</span>
                  <span className="font-mono text-xs font-normal text-[#f4d8e4]/45">
                    ({activeProvider.domain})
                  </span>
                </h3>
                <p className="mt-1 font-mono text-[11px] text-[#f09cb5]">
                  Provider ID: &quot;{activeProvider.id}&quot;
                </p>
              </div>

              <div className="flex gap-2">
                <span
                  className={`chip-tag rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ${
                    activeProvider.status === "active"
                      ? "border-[#8de4c2]/20 bg-[#8de4c2]/10 text-[#8de4c2]"
                      : "border-[#e4c180]/20 bg-[#e4c180]/10 text-[#e4c180]"
                  }`}
                >
                  status: {activeProvider.status}
                </span>

                {activeProvider.recommended ? (
                  <span className="chip-tag rounded-lg border border-[#8de4c2]/20 bg-[#8de4c2]/15 px-2.5 py-1 text-[10px] font-bold text-[#8de4c2]">
                    <Star className="mr-1 inline-block h-3.5 w-3.5 fill-current align-middle text-[#8de4c2]" />{" "}
                    Recommended
                  </span>
                ) : null}
              </div>
            </div>

            <p className="mt-3 font-sans text-sm leading-relaxed font-light text-zinc-300">
              {activeProvider.description}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-6 border-t border-[#f4d8e4]/5 pt-5 text-xs">
              <div>
                <strong className="mb-2 block text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                  Supported Media Kinds
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.mediaKinds.map((kind) => (
                    <span
                      key={kind}
                      className="rounded-lg border border-[#f09cb5]/20 bg-[#f09cb5]/5 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase"
                    >
                      {kind}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <strong className="mb-2 block text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                  Scraper Capabilities
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="rounded-lg border border-[#f4d8e4]/5 bg-[#1e1824]/50 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {activeProvider.notes && activeProvider.notes.length > 0 ? (
              <div className="mt-6 rounded-xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-4 text-xs leading-relaxed">
                <div className="mb-2 flex items-center gap-1.5 text-[#f09cb5]">
                  <Cpu className="h-3.5 w-3.5" />
                  <strong className="text-[11px] font-bold tracking-wider uppercase">
                    Scraper & Verification Details
                  </strong>
                </div>
                <ul className="list-disc space-y-1.5 pl-4 font-sans font-light text-[#f4d8e4]/70">
                  {activeProvider.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

// =============================================================================
// SUBCOMPONENT: CliCommandBuilder (Redesigned with Premium Dashboard feel)
// =============================================================================
interface CliCommandBuilderProps {
  readonly flags: readonly CliOption[];
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
              className={`flag-checkbox-wrapper flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-all duration-300 ${
                isChecked
                  ? "border-[#f09cb5] bg-[#f09cb5]/5"
                  : "border-[#f4d8e4]/5 bg-[#130f17]/40 hover:border-[#f4d8e4]/15"
              }`}
              onClick={() => toggleFlag(flag.long)}
            >
              <div
                className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border transition-all ${
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
                className="w-full rounded-lg border border-[#f4d8e4]/10 bg-[#130f17] px-3 py-2 font-mono text-xs text-white transition-all outline-none focus:border-[#f09cb5]"
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
              className="ml-3 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#f4d8e4]/10 bg-[#130f17] px-3 py-1.5 text-xs text-[#f09cb5] transition-colors hover:border-[#f09cb5] hover:text-white"
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

// =============================================================================
// MAIN COMPONENT: HomePage Redesign
// =============================================================================
export default function HomePage() {
  const providers = (metadata.providers || []) as readonly ProviderMetadata[];
  const commands = metadata.commands || [];
  const flags = useMemo(() => (metadata.cliOptions || []) as readonly CliOption[], []);

  // Provider Tab State
  const [activeProviderId, setActiveProviderId] = useState<string>(providers[0]?.id || "miruro");

  // Flag Builder State
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);
  const selectedFlagSet = useMemo(() => new Set(selectedFlags), [selectedFlags]);
  const [searchWord, setSearchWord] = useState("Dune");

  // Copied state
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // OS Selector state for installation section
  const [activeOs, setActiveOs] = useState<"linux" | "macos" | "windows">("linux");

  // Hydration guard
  const [mounted, setMounted] = useState(false);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (typeof window !== "undefined") {
      gsap.registerPlugin(ScrollTrigger);
    }

    // GSAP Word-by-word reveal for hero title
    if (headlineRef.current) {
      const text = headlineRef.current.innerText;
      const words = text.split(" ");
      headlineRef.current.innerHTML = words
        .map(
          (word) =>
            `<span class="inline-block opacity-0 translate-y-6 transform transition-all duration-300 mr-2">${word}</span>`,
        )
        .join("");

      gsap.to(headlineRef.current.querySelectorAll("span"), {
        opacity: 1,
        y: 0,
        stagger: 0.05,
        duration: 0.8,
        ease: "power4.out",
        delay: 0.1,
      });
    }

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, [mounted]);

  const toggleFlag = useCallback((flagLong: string) => {
    setSelectedFlags((prev) =>
      prev.includes(flagLong) ? prev.filter((f) => f !== flagLong) : [...prev, flagLong],
    );
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => {
      setCopiedText(null);
    }, 1800);
  }, []);

  const buildCommandLine = useCallback(() => {
    let base = "kunai";
    const shortFlags: string[] = [];
    const longFlags: string[] = [];
    for (const flag of flags) {
      if (!selectedFlagSet.has(flag.long)) continue;
      if (flag.short) {
        shortFlags.push(flag.short.replace("-", ""));
      } else {
        longFlags.push(flag.long);
      }
    }

    if (shortFlags.length > 0) {
      base += ` -${shortFlags.join("")}`;
    }

    const hasSearch = selectedFlagSet.has("-S") || selectedFlagSet.has("--search");
    if (hasSearch) {
      base += ` -S "${searchWord}"`;
    }

    longFlags.forEach((flag) => {
      if (flag !== "--search") {
        base += ` ${flag}`;
      }
    });

    return base;
  }, [flags, searchWord, selectedFlagSet]);

  if (!mounted) {
    // Fallback render to prevent hydration flicker
    return (
      <main className="kunai-home mx-auto w-[min(1400px,calc(100vw-32px))] py-8 opacity-0 max-md:w-[min(760px,calc(100vw-20px))]">
        <div className="h-screen" />
      </main>
    );
  }

  return (
    <main className="kunai-home mx-auto w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      {/* Film Grain Texture for editorial atmosphere */}
      <div className="grain-overlay" />

      {/* Background drifting ambient mesh glows */}
      <div className="pointer-events-none absolute top-10 left-1/4 -z-10 h-[350px] w-[500px] animate-[pulse-glow_12s_infinite] rounded-full bg-gradient-to-tr from-[#f09cb5]/5 to-purple-500/5 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 -z-10 h-[400px] w-[400px] animate-[pulse-glow_16s_infinite] rounded-full bg-gradient-to-tr from-[#8de4c2]/5 to-[#c86884]/5 blur-[140px]" />
      <div className="ambient-glow-bottom" />

      {/* 1. Hero & Interactive Terminal Simulator */}
      <section className="kunai-hero pb-18">
        <h1 ref={headlineRef} className="sr-only">
          {homeHero.title}
        </h1>
        <TerminalSimulator
          providers={providers}
          commands={commands}
          installCommands={homeHero.installCommands}
          primaryCtaHref={homeHero.primaryCta.href}
          primaryCtaLabel={homeHero.primaryCta.label}
          secondaryCtaHref={homeHero.secondaryCta.href}
          secondaryCtaLabel={homeHero.secondaryCta.label}
          copyToClipboard={copyToClipboard}
          copiedText={copiedText}
        />
      </section>

      {/* Prerequisites & Installation Section */}
      <section id="install" className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Quick Setup</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Get started in 3 simple steps.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Kunai runs on any machine with Bun and mpv. Select your operating system to see the
            exact commands.
          </p>
        </motion.div>

        <div className="install-section">
          {/* OS Selector Tabs */}
          <div className="mb-8 flex gap-3 border-b border-[#f4d8e4]/5 pb-6">
            {(["linux", "macos", "windows"] as const).map((os) => (
              <button
                type="button"
                key={os}
                onClick={() => setActiveOs(os)}
                className={`os-tab-button text-[11px] tracking-wider uppercase ${
                  activeOs === os ? "active" : ""
                }`}
              >
                {os === "macos" ? "macOS" : os}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-1">
            {/* Step 1: Prerequisites */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 01
                  </span>
                  <span className="prereq-badge installed flex items-center gap-1.5">
                    <Check className="h-3 w-3 stroke-[3] text-[#8de4c2]" />
                    <span>Prerequisites</span>
                  </span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Install Dependencies
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Kunai requires <code className="font-mono text-zinc-200">mpv</code> for video
                  playback and <code className="font-mono text-zinc-200">bun</code> as the CLI
                  runtime.
                </p>
              </div>
              <div className="space-y-2">
                {activeOs === "linux" && (
                  <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                    <span>sudo apt install mpv chafa</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard("sudo apt install mpv chafa", "apt-install")}
                      className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                    >
                      {copiedText === "apt-install" ? "Copied" : "Copy"}
                    </button>
                  </code>
                )}
                {activeOs === "macos" && (
                  <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                    <span>brew install mpv chafa</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard("brew install mpv chafa", "brew-install")}
                      className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                    >
                      {copiedText === "brew-install" ? "Copied" : "Copy"}
                    </button>
                  </code>
                )}
                {activeOs === "windows" && (
                  <div className="rounded-lg border border-[#e4c180]/10 bg-[#e4c180]/5 p-2.5 text-[10px] font-light text-[#e4c180]">
                    Install{" "}
                    <a
                      href="https://bun.sh"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-white"
                    >
                      Bun for Windows
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://mpv.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-white"
                    >
                      mpv player
                    </a>
                    , then ensure they are in your path variables.
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-[#f4d8e4]/40">
                  <span>Verify with:</span>
                  <code className="rounded bg-[#130f17] px-1 py-0.5">mpv --version</code>
                </div>
              </div>
            </div>

            {/* Step 2: Global Install */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 02
                  </span>
                  <span className="font-mono text-[9px] text-[#f4d8e4]/40">CLI Package</span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Install Kunai Shell
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Install the package globally using Bun's package manager. This gives you the
                  unified command entry.
                </p>
              </div>
              <div className="space-y-2">
                <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                  <span>bun install -g @kitsunekode/kunai</span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard("bun install -g @kitsunekode/kunai", "global-install")
                    }
                    className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                  >
                    {copiedText === "global-install" ? "Copied" : "Copy"}
                  </button>
                </code>
                <div className="font-mono text-[9px] text-[#f4d8e4]/40">
                  Prefer Bun for global CLI packages as it executes sub-second.
                </div>
              </div>
            </div>

            {/* Step 3: Setup configuration */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 03
                  </span>
                  <span className="font-mono text-[9px] text-[#f4d8e4]/40">First Run</span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Initialize Configuration
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Initialize settings, select default folders, verify system libraries, and setup
                  Discord Rich Presence.
                </p>
              </div>
              <div className="space-y-2">
                <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                  <span>kunai --setup</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("kunai --setup", "setup-cli")}
                    className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                  >
                    {copiedText === "setup-cli" ? "Copied" : "Copy"}
                  </button>
                </code>
                <div className="font-mono text-[9px] text-[#f4d8e4]/40">
                  This writes atomic JSON to{" "}
                  <code className="rounded bg-[#130f17] px-1 py-0.5">~/.config/kunai</code>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Real Active Providers Catalog */}
      <section className="kunai-band relative">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Scrapers Catalog</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Active Scrapers local in codebase.
          </h2>
          <p className="mt-4 font-sans text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Kunai resolves source files directly using custom, localized decryptors located in{" "}
            <code className="rounded border border-[#f4d8e4]/5 bg-[#1e1824]/60 px-1.5 py-0.5 font-mono text-[#f09cb5]">
              packages/providers
            </code>
            . Fully sandboxed and browserless parsing engine.
          </p>
        </motion.div>

        <ProvidersCatalog
          providers={providers}
          activeProviderId={activeProviderId}
          setActiveProviderId={setActiveProviderId}
        />
      </section>

      {/* 3. Interactive CLI Command Builder */}
      <section className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Interactive Builder</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Compose commands visually.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Construct argument scripts dynamically. Choose flags to compile the command line string,
            inspect option descriptions, and execute it locally in your shell.
          </p>
        </motion.div>

        <CliCommandBuilder
          flags={flags}
          selectedFlags={selectedFlags}
          toggleFlag={toggleFlag}
          searchWord={searchWord}
          setSearchWord={setSearchWord}
          buildCommandLine={buildCommandLine}
          copyToClipboard={copyToClipboard}
          copiedText={copiedText}
        />
      </section>

      {/* 4. Playback Path Flow */}
      <section className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Playback path</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            One readable path from intent to recovery.
          </h2>
        </motion.div>
        <div className="kunai-flow">
          {homeFlow.map((step, index) => (
            <article
              className={`kunai-flow-card premium-card-hover kunai-state-${step.state} flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-5 backdrop-blur-md`}
              key={step.title}
              style={{ animation: "none", animationDelay: `${index * 60}ms` }}
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[10px] text-[#f4d8e4]/30">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`h-2.5 w-2.5 animate-pulse rounded-full shadow-sm ${
                      step.state === "focus"
                        ? "bg-[#f09cb5] shadow-[#f09cb5]/30"
                        : step.state === "ready"
                          ? "bg-[#8de4c2] shadow-[#8de4c2]/30"
                          : step.state === "warn"
                            ? "bg-[#e4c180] shadow-[#e4c180]/30"
                            : step.state === "danger"
                              ? "bg-[#ff8084] shadow-[#ff8084]/30"
                              : "bg-[#f4d8e4]/20"
                    }`}
                  ></span>
                </div>
                <h3 className="mt-5 font-serif text-lg leading-snug font-light text-white">
                  {step.title}
                </h3>
                <p className="mt-3 font-sans text-xs leading-relaxed font-light text-zinc-400">
                  {step.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 5. Experience Promises */}
      <section className="kunai-band">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Experience promise</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Designed for provider drift.
          </h2>
        </motion.div>
        <div className="kunai-highlight-grid">
          {homeHighlights.map((item) => (
            <article
              className="kunai-highlight premium-card-hover flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-5 backdrop-blur-md"
              key={item.label}
              style={{ animation: "none" }}
            >
              <div>
                <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                  {item.label}
                </span>
                <p className="margin-top-5 mt-4 font-sans text-sm leading-relaxed font-light text-zinc-300">
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 6. Docs Map */}
      <section className="kunai-docs-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Guides map</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Select guide by specific operational role.
          </h2>
        </motion.div>
        <div className="grid gap-6">
          {homeSections.map((section) => (
            <section
              className="kunai-doc-row flex flex-col gap-6 rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-6 backdrop-blur-md lg:grid lg:grid-cols-[0.4fr_1fr]"
              key={section.title}
              style={{ animation: "none" }}
            >
              <div className="flex flex-col justify-between py-2">
                <div>
                  <p className="kunai-eyebrow text-[10px]">{section.eyebrow}</p>
                  <h3 className="mt-2 font-serif text-xl leading-snug font-light text-white">
                    {section.title}
                  </h3>
                  <p className="mt-2 font-sans text-xs leading-relaxed font-light text-zinc-400">
                    {section.description}
                  </p>
                </div>
              </div>
              <div className="kunai-doc-links">
                {section.items.map((item) => (
                  <Link
                    className="kunai-doc-card premium-card-hover group flex flex-col justify-between rounded-xl border border-[#f4d8e4]/5 bg-[#0b070e]/80 p-5"
                    href={item.href}
                    key={item.href}
                  >
                    <div>
                      <span className="font-serif text-base font-light text-white transition-colors duration-200 group-hover:text-[#f09cb5]">
                        {item.title}
                      </span>
                      <small className="mt-2 block font-sans text-xs leading-relaxed font-light text-zinc-400">
                        {item.description}
                      </small>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {/* 7. Proof Grid */}
      <section className="kunai-proof-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Reliability posture</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Insightful metadata telemetry.
          </h2>
        </motion.div>
        <div className="kunai-proof-grid grid grid-cols-3 gap-6 max-lg:grid-cols-1">
          {homeProof.map((item) => (
            <article
              className="kunai-proof premium-card-hover flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-6 backdrop-blur-md"
              key={item.label}
              style={{ animation: "none" }}
            >
              <div>
                <span className="font-mono text-[9px] font-bold tracking-wider text-[#f09cb5] uppercase">
                  {item.label}
                </span>
                <strong className="mt-4 block font-serif text-3xl font-light tracking-tight text-white">
                  {item.value}
                </strong>
                <p className="mt-3 font-sans text-xs leading-relaxed font-light text-zinc-400">
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 8. Final Call to Action */}
      <section className="kunai-final flex items-center justify-between gap-6 rounded-2xl border border-[#f4d8e4]/10 bg-gradient-to-tr from-[#130f17] to-[#1e1824] p-8 max-md:flex-col">
        <div>
          <p className="kunai-eyebrow">Start here</p>
          <h2 className="mt-2 max-w-xl bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif text-3xl leading-[1.1] font-light text-transparent md:text-4xl">
            Install once. Keep stream pipeline diagnostic-rich.
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap gap-4">
          <Link
            className="kunai-button kunai-button-primary shadow-lg"
            href={homeHero.primaryCta.href}
          >
            <span>{homeHero.primaryCta.label}</span>
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
          <Link
            className="kunai-button border-[#f4d8e4]/15 hover:border-[#f09cb5]"
            href="/docs/users/diagnostics-and-reporting"
          >
            <span>Debug a session</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
