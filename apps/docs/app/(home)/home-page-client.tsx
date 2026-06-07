"use client";

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

// =============================================================================
// SUBCOMPONENT: TerminalSimulator (Memoized)
// =============================================================================
interface CommandMetadata {
  readonly id: string;
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly description: string;
}

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
  secondaryCtaHref,
  secondaryCtaLabel,
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

      addLog(`🔍 Querying metadata catalogs for "${query}"...`, accDelay);
      accDelay += 600;
      addLog(`✨ Match found: "${query}" (Release verified, 2024)`, accDelay);
      accDelay += 400;
      addLog("📡 Fetching active streams from verification cache...", accDelay);
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
          `⚡ Selected provider: ${primaryProvider.displayName} (${primaryProvider.domain})`,
          accDelay,
        );
        accDelay += 500;
        addLog(`🔄 Resolving stream parameters [status: ${primaryProvider.status}]...`, accDelay);
        accDelay += 700;
        if (primaryProvider.capabilities.includes("quality-ranked")) {
          addLog("🟢 Stream verified: 1080p selected (variants: 720p, 480p)", accDelay);
        } else {
          addLog("🟢 Stream verified: direct-http source resolved", accDelay);
        }
        accDelay += 400;
      }

      addLog("🎬 Launching mpv player window...", accDelay);
      accDelay += 600;
      addLog(`[mpv] Playing "${query}" - superviser handoff established.`, accDelay);
      accDelay += 500;
      addLog("[mpv] Press 'r' to recover stream, 'f' to try fallback, 'Esc' to return.", accDelay);
    } else if (cmdText.startsWith("/discover") || cmdText === "discover") {
      addLog("📡 Querying catalog recommendation engine...", accDelay);
      accDelay += 500;
      addLog("📊 Reading local SQLite continuation weights...", accDelay);
      accDelay += 400;
      addLog("\n🔥 Trending Today [Discover]:", accDelay);
      accDelay += 200;
      addLog("  1. Frieren: Beyond Journey's End (Series) [Anime]", accDelay);
      accDelay += 100;
      addLog("  2. Dune: Part Two (Movie) [Sci-Fi]", accDelay);
      accDelay += 100;
      addLog("  3. Erased (Series) [Mystery]", accDelay);
      accDelay += 400;
      addLog("\n💡 Pick a selection using arrow keys and press Enter to launch.", accDelay);
    } else if (cmdText.startsWith("/calendar") || cmdText === "calendar") {
      addLog("📅 Fetching release calendar schedule...", accDelay);
      accDelay += 600;
      addLog("Releasing Today (Source Sync):", accDelay);
      accDelay += 200;
      addLog("  🟢 [Airing Now] Oshi no Ko S3 Ep 02 - Direct HTTP resolved", accDelay);
      accDelay += 150;
      addLog("  🟡 [Airing in 3h] Re:Zero S3 Ep 14 - MAL synced", accDelay);
      accDelay += 150;
      addLog("  ⚪ [Aired 12h ago] House of the Dragon S3 Ep 03", accDelay);
      accDelay += 300;
      addLog("\nReady. Check commands bar for offline sync schedules.", accDelay);
    } else if (cmdText.startsWith("/setup") || cmdText === "setup" || cmdText.includes("setup")) {
      addLog("⚙️ Initializing Setup Wizard...", accDelay);
      accDelay += 400;
      addLog("Checking dependencies...", accDelay);
      accDelay += 300;
      addLog("  mpv: OK (0.38.0)", accDelay);
      addLog("  chafa (kitty graphics): OK", accDelay);
      addLog("  sqlite3: OK", accDelay);
      accDelay += 400;
      addLog("Configure default media directories:", accDelay);
      addLog("  📁 Download path: ~/Downloads/kunai", accDelay);
      addLog("  💾 Cache DB limit: 512MB", accDelay);
      accDelay += 300;
      addLog("Configuration atomic-written to ~/.config/kunai/config.json", accDelay);
    } else if (cmdText.startsWith("/recover") || cmdText === "recover") {
      addLog("♻️ Recovery sequence initiated.", accDelay);
      accDelay += 300;
      addLog("Bypassing memory buffers...", accDelay);
      accDelay += 300;
      addLog("Resolving fresh payload keys from upstream manifest...", accDelay);
      accDelay += 500;
      addLog("🟢 Resolved new stream segment (No playback drift). Resuming mpv...", accDelay);
    } else if (cmdText.startsWith("/fallback") || cmdText === "fallback") {
      addLog("⚠️ Fallback sequence requested.", accDelay);
      accDelay += 300;
      addLog("Switching stream source from current provider...", accDelay);
      accDelay += 450;
      addLog("Connecting to fallback provider: Miruro (domain: miruro.tv)...", accDelay);
      accDelay += 500;
      addLog("🟢 Miruro stream resolved at 720p. Playback restored.", accDelay);
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
    <div className="grid min-h-[calc(100dvh-8rem)] grid-cols-[minmax(0,1.02fr)_minmax(360px,0.78fr)] items-center gap-12 pb-18 max-lg:min-h-0 max-lg:grid-cols-1 max-lg:pt-10">
      <div className="kunai-reveal">
        <p className="kunai-eyebrow">{homeHero.eyebrow}</p>
        <h1 className="m-0 max-w-5xl bg-gradient-to-br from-white via-white to-pink-200 bg-clip-text text-6xl leading-[0.93] font-black tracking-tight text-balance text-transparent md:text-7xl xl:text-8xl">
          {homeHero.title}
        </h1>
        <p className="text-fd-muted-foreground mt-7 max-w-2xl text-lg leading-8 text-pretty">
          {homeHero.description}
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link className="kunai-button kunai-button-primary" href={primaryCtaHref}>
            {primaryCtaLabel}
          </Link>
          <Link className="kunai-button" href={secondaryCtaHref}>
            {secondaryCtaLabel}
          </Link>
          <button
            type="button"
            className="kunai-button flex animate-pulse items-center gap-2 border-pink-500/20 text-pink-300"
            onClick={() => onPresetClick("/help")}
          >
            <span>🖥️ Run simulator</span>
          </button>
        </div>
      </div>

      <aside
        ref={terminalStageRef}
        className={`kunai-terminal-stage kunai-reveal kunai-reveal-late ${commandPaletteOpen ? "is-focused" : ""}`}
        aria-label="Kunai terminal preview"
      >
        <div className="kunai-terminal-top">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-pink-400/80"></span>
            kunai shell
          </span>
          <span className="font-semibold text-pink-300/80">cli active</span>
          <span className="kunai-muted">mpv verified</span>
        </div>

        <div
          ref={terminalBodyRef}
          className="kunai-terminal-body scrollbar block w-full cursor-text text-left focus:outline-none"
        >
          {terminalLogs.map((line) => (
            <span
              key={line.id}
              className={`block ${
                line.text.startsWith("kunai >")
                  ? "mt-2 font-bold text-pink-300"
                  : line.text.startsWith("🟢") ||
                      line.text.startsWith("✔") ||
                      line.text.includes("OK")
                    ? "text-emerald-300"
                    : line.text.startsWith("⚠️") || line.text.startsWith("🟡")
                      ? "text-amber-300"
                      : line.text.startsWith("🎬") || line.text.includes("mpv")
                        ? "text-sky-300"
                        : line.text.startsWith("🔥") || line.text.startsWith("📅")
                          ? "text-pink-300"
                          : line.text.startsWith("▌")
                            ? "font-bold text-pink-300"
                            : "kunai-muted"
              }`}
            >
              {line.text}
            </span>
          ))}

          <span className="mt-3 flex items-center border-t border-pink-500/5 pt-2">
            <span className="mr-2 font-bold text-pink-300">kunai &gt;</span>
            <input
              ref={terminalInputRef}
              type="text"
              className="w-full border-none bg-transparent font-mono text-sm text-white outline-none"
              value={terminalInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type '/' for commands..."
              disabled={terminalState === "running"}
              aria-label="Terminal command execution box"
            />
            <span className="kunai-cursor"></span>
          </span>

          {commandPaletteOpen && filteredCommands.length > 0 ? (
            <span
              className="kunai-command-palette block"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <span className="palette-search-wrapper flex">
                <span className="mr-2 font-bold text-pink-300">/</span>
                <input
                  ref={paletteInputRef}
                  type="text"
                  className="palette-search-input"
                  value={searchQuery.replace(/^\//, "")}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search commands..."
                  aria-label="CLI commands query filter"
                />
              </span>
              <span className="palette-list block">
                {filteredCommands.map((cmd, index) => (
                  <button
                    type="button"
                    key={cmd.id}
                    className={`palette-item flex w-full items-center justify-between text-left ${index === selectedPaletteIndex ? "is-selected" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const runCmd = `/${cmd.id}`;
                      setTerminalInput(runCmd);
                      runSimulatedCommand(runCmd);
                    }}
                    onMouseEnter={() => setSelectedPaletteIndex(index)}
                  >
                    <span>
                      <span className="font-semibold text-pink-100">/{cmd.id}</span>
                      <span className="ml-2 text-pink-400/60">({cmd.label})</span>
                      <span className="mt-0.5 block font-sans text-[11px] text-pink-100/40">
                        {cmd.description}
                      </span>
                    </span>
                    <span className="palette-shortcut">Enter</span>
                  </button>
                ))}
              </span>
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            onClick={() => onPresetClick("/search Dune")}
            className="cursor-pointer rounded border border-pink-500/20 bg-pink-500/10 px-2.5 py-1 font-mono text-[11px] text-pink-300 transition-all hover:border-pink-300"
          >
            /search Dune
          </button>
          <button
            type="button"
            onClick={() => onPresetClick("/discover")}
            className="cursor-pointer rounded border border-pink-500/20 bg-pink-500/10 px-2.5 py-1 font-mono text-[11px] text-pink-300 transition-all hover:border-pink-300"
          >
            /discover
          </button>
          <button
            type="button"
            onClick={() => onPresetClick("/calendar")}
            className="cursor-pointer rounded border border-pink-500/20 bg-pink-500/10 px-2.5 py-1 font-mono text-[11px] text-pink-300 transition-all hover:border-pink-300"
          >
            /calendar
          </button>
          <button
            type="button"
            onClick={() => onPresetClick("/setup")}
            className="cursor-pointer rounded border border-pink-500/20 bg-pink-500/10 px-2.5 py-1 font-mono text-[11px] text-pink-300 transition-all hover:border-pink-300"
          >
            /setup
          </button>
        </div>

        <div className="kunai-install">
          <span>Install CLI package</span>
          {installCommands.map((command) => (
            <code key={command}>
              <span>{command}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(command, command)}
                className="cursor-pointer rounded border border-pink-500/20 bg-pink-500/5 px-1.5 py-0.5 text-[10px] text-pink-300 hover:text-white"
              >
                {copiedText === command ? "Copied! ✓" : "Copy"}
              </button>
            </code>
          ))}
        </div>
      </aside>
    </div>
  );
});

// =============================================================================
// SUBCOMPONENT: ProvidersCatalog (Memoized)
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
    <div className="grid w-full gap-4">
      <div className="flex flex-wrap gap-2 border-b border-pink-500/10 pb-4">
        {providers.map((provider) => (
          <button
            type="button"
            key={provider.id}
            onClick={() => setActiveProviderId(provider.id)}
            className={`provider-interactive-tab ${
              activeProviderId === provider.id ? "is-active" : ""
            }`}
          >
            {provider.displayName}
            {provider.recommended ? <span className="ml-1 text-[9px] text-pink-200">★</span> : null}
          </button>
        ))}
      </div>

      {activeProvider ? (
        <div className="provider-details-card">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="m-0 flex items-center gap-2 text-xl font-bold text-white">
                {activeProvider.displayName}
                <span className="font-mono text-xs font-normal text-pink-400">
                  ({activeProvider.domain})
                </span>
              </h3>
              <p className="mt-1 font-mono text-sm text-pink-300/80">
                Provider ID: "{activeProvider.id}"
              </p>
            </div>

            <div className="flex gap-2">
              <span
                className={`chip-tag ${
                  activeProvider.status === "active"
                    ? "chip-tag-ok"
                    : activeProvider.status === "candidate"
                      ? "chip-tag-warning"
                      : ""
                }`}
              >
                status: {activeProvider.status}
              </span>

              {activeProvider.recommended ? (
                <span className="chip-tag chip-tag-ok">Recommended</span>
              ) : null}
            </div>
          </div>

          <p className="mt-3 text-sm leading-6 text-pink-100/90">{activeProvider.description}</p>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-pink-500/10 pt-4 text-xs">
            <div>
              <strong className="mb-1 block text-pink-300">Supported Media Kinds</strong>
              <div className="flex flex-wrap gap-1.5">
                {activeProvider.mediaKinds.map((kind) => (
                  <span
                    key={kind}
                    className="rounded border border-pink-500/20 bg-pink-500/10 px-2 py-0.5 text-[10px] tracking-wider text-pink-300 uppercase"
                  >
                    {kind}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <strong className="mb-1 block text-pink-300">Capabilities</strong>
              <div className="flex flex-wrap gap-1">
                {activeProvider.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="rounded border border-pink-500/10 px-1.5 py-0.5 font-mono text-[10px] text-pink-100/70"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {activeProvider.notes && activeProvider.notes.length > 0 ? (
            <div className="mt-5 rounded border border-pink-500/10 bg-pink-500/5 p-3 text-xs leading-5">
              <strong className="mb-1.5 block text-pink-300">
                Runtime & Verification notes (from source)
              </strong>
              <ul className="list-disc space-y-1.5 pl-4 text-pink-100/70">
                {activeProvider.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

// =============================================================================
// SUBCOMPONENT: CliCommandBuilder (Memoized)
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
    <div className="grid grid-cols-[1fr_0.8fr] gap-6 max-lg:grid-cols-1">
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {flags.slice(0, 12).map((flag) => {
          const isChecked = selectedFlags.includes(flag.long);
          return (
            <button
              type="button"
              key={flag.long}
              className={`flag-checkbox-wrapper text-left ${isChecked ? "is-checked" : ""}`}
              onClick={() => toggleFlag(flag.long)}
            >
              <div
                className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                  isChecked ? "border-pink-400 bg-pink-500" : "border-pink-500/30"
                }`}
              >
                {isChecked ? <span className="text-[9px] text-white">✓</span> : null}
              </div>
              <div>
                <div className="font-mono text-xs font-semibold text-white">
                  {flag.short ? <span className="mr-1 text-pink-300">{flag.short}</span> : null}
                  <span>{flag.long}</span>
                </div>
                <div className="mt-0.5 line-clamp-1 font-sans text-[10px] text-pink-200/50">
                  {flag.description || "CLI parameter option"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flag-builder-shell flex flex-col justify-between">
        <div>
          <h4 className="mb-2 text-xs font-bold tracking-wider text-pink-300 uppercase">
            Command Output
          </h4>

          {showSearchParam ? (
            <div className="mb-4 rounded border border-pink-500/10 bg-pink-500/5 p-2.5">
              <label htmlFor="search-query-field" className="mb-1 block text-[10px] text-pink-300">
                Edit search query
              </label>
              <input
                id="search-query-field"
                type="text"
                className="w-full rounded border border-pink-500/30 bg-pink-500/10 px-2 py-1 font-mono text-xs text-white outline-none focus:border-pink-400"
                value={searchWord}
                onChange={(e) => setSearchWord(e.target.value)}
                aria-label="Edit command search query parameter value"
              />
            </div>
          ) : null}

          <p className="text-xs leading-5 text-pink-200/70">
            Toggle options on the left. The CLI uses `bun` for script runtime execution, meaning
            startup is sub-50ms.
          </p>
        </div>

        <div className="mt-4">
          <div className="flag-cmd-preview">
            <span className="break-all select-all">{buildCommandLine()}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(buildCommandLine(), "cmd-line")}
              className="ml-2 cursor-pointer rounded border border-pink-500/20 bg-pink-500/10 px-2 py-1 text-[11px] text-pink-300 hover:text-white"
            >
              {copiedText === "cmd-line" ? "Copied! ✓" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// =============================================================================
// MAIN COMPONENT: HomePage
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

  return (
    <main className="kunai-home mx-auto w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      {/* 1. Hero & Interactive Terminal Simulator */}
      <section className="kunai-hero pb-18">
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

      {/* 2. Real Active Providers Catalog */}
      <section className="kunai-band">
        <div>
          <p className="kunai-eyebrow">Providers Catalog</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Active scraper modules linked in codebase.
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-7">
            Kunai loads provider adapters directly from the{" "}
            <code className="font-mono text-pink-300">packages/providers</code> package. No cloud
            proxies or web scrapers needed; fully local decryption engines.
          </p>
        </div>

        <ProvidersCatalog
          providers={providers}
          activeProviderId={activeProviderId}
          setActiveProviderId={setActiveProviderId}
        />
      </section>

      {/* 3. Interactive CLI Command Builder */}
      <section className="kunai-flow-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Interactive Builder</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Compose CLI commands visually.
          </h2>
          <p className="text-fd-muted-foreground mt-4 max-w-3xl leading-7">
            Kunai features a predictable argument layout. Toggle options below to compile a command
            line, see its parsed description, and copy it to run directly in your local terminal.
          </p>
        </div>

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
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Playback path</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            One readable path from intent to recovery.
          </h2>
        </div>
        <div className="kunai-flow">
          {homeFlow.map((step, index) => (
            <article className={`kunai-flow-card kunai-state-${step.state}`} key={step.title}>
              <div className="flex items-start justify-between">
                <span className="text-[11px]">{String(index + 1).padStart(2, "0")}</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    step.state === "focus"
                      ? "bg-pink-400"
                      : step.state === "ready"
                        ? "bg-emerald-400"
                        : step.state === "warn"
                          ? "bg-amber-400"
                          : step.state === "danger"
                            ? "bg-rose-400"
                            : "bg-zinc-500"
                  }`}
                ></span>
              </div>
              <h3 className="text-white">{step.title}</h3>
              <p className="mt-2 text-xs leading-5">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 5. Experience Promises */}
      <section className="kunai-band">
        <div>
          <p className="kunai-eyebrow">Experience promise</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Designed for the moment the provider does not behave.
          </h2>
        </div>
        <div className="kunai-highlight-grid">
          {homeHighlights.map((item) => (
            <article className="kunai-highlight" key={item.label}>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 6. Docs Map */}
      <section className="kunai-docs-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Docs map</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Pick the guide by the job in front of you.
          </h2>
        </div>
        <div className="grid gap-5">
          {homeSections.map((section) => (
            <section className="kunai-doc-row" key={section.title}>
              <div>
                <p className="kunai-eyebrow">{section.eyebrow}</p>
                <h3 className="text-white">{section.title}</h3>
                <p className="mt-2 text-xs">{section.description}</p>
              </div>
              <div className="kunai-doc-links">
                {section.items.map((item) => (
                  <Link className="kunai-doc-card" href={item.href} key={item.href}>
                    <span>{item.title}</span>
                    <small className="mt-1 text-xs leading-5">{item.description}</small>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {/* 7. Proof Grid */}
      <section className="kunai-proof-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Reliability posture</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Useful feedback without leaking private runtime state.
          </h2>
        </div>
        <div className="kunai-proof-grid">
          {homeProof.map((item) => (
            <article className="kunai-proof" key={item.label}>
              <span>{item.label}</span>
              <strong className="text-white">{item.value}</strong>
              <p className="mt-3 text-xs leading-5">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 8. Final Call to Action */}
      <section className="kunai-final">
        <div>
          <p className="kunai-eyebrow">Start here</p>
          <h2 className="bg-gradient-to-br from-white to-pink-200 bg-clip-text text-transparent">
            Install once. Keep playback explainable.
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="kunai-button" href={homeHero.primaryCta.href}>
            {homeHero.primaryCta.label}
          </Link>
          <Link className="kunai-button" href="/docs/users/diagnostics-and-reporting">
            Debug a session
          </Link>
        </div>
      </section>
    </main>
  );
}
