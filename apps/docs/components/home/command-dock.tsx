"use client";

import { KunaiFox } from "@/components/brand/kunai-fox";
import { SPRING_SETTLE, SPRING_SNAP, useHomeStage } from "@/components/home/home-stage-context";
import { InstallDock } from "@/components/home/install-dock";
import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";
import { withCssVars } from "@/lib/css-vars";
import { CANONICAL_INSTALL, NATIVE_INSTALL_PS1 } from "@/lib/install-commands";
import { filterCommands, filterProviders, type MatchRange } from "@/lib/provider-sieve";
import { Dialog } from "@base-ui/react/dialog";
import {
  IconArrowRight,
  IconDice5,
  IconDownload,
  IconSearch,
  IconServer,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import {
  AnimatePresence,
  domMax,
  LazyMotion,
  m,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DockTab = "commands" | "adapters" | "install" | "surprise";

type CommandDockProps = {
  readonly commands: readonly HomeCommandMetadata[];
  readonly providers: readonly HomeProviderMetadata[];
  readonly initialOpen?: boolean;
};

const PEEK_COMMANDS = ["/search Dune", "/recover", "/calendar"] as const;

const TABS: readonly {
  readonly id: DockTab;
  readonly label: string;
  readonly icon: typeof IconTerminal2;
}[] = [
  { id: "commands", label: "Commands", icon: IconTerminal2 },
  { id: "adapters", label: "Adapters", icon: IconServer },
  { id: "install", label: "Install", icon: IconDownload },
  { id: "surprise", label: "Surprise me", icon: IconDice5 },
];

function MatchHighlight({
  text,
  ranges,
}: {
  readonly text: string;
  readonly ranges: readonly MatchRange[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark key={`${start}-${end}`} className="kunai-sieve-mark">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

/**
 * Floating bottom command dock & morphing spring drawer.
 * - Rest state: Perfolios-style floating bottom pill with hover command word-roll.
 * - Open state: Keshav-inspired non-boring spring drawer with ResizeObserver height
 *   morphing, drag-to-dismiss handle, shared `layoutId` tabs, live 85-command Sieve,
 *   adapter jump, quick install, and click-only "Surprise me" picker.
 */
export function CommandDock({ commands, providers, initialOpen = false }: CommandDockProps) {
  const { runTerminalCommand, focusDirectory } = useHomeStage();
  const reduced = useReducedMotion();
  const dragControls = useDragControls();

  const [open, setOpen] = useState(initialOpen);
  const [visible, setVisible] = useState(false);
  const [hoveredPill, setHoveredPill] = useState(false);
  const [peekIndex, setPeekIndex] = useState(0);

  const [tab, setTab] = useState<DockTab>("commands");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Deterministic initial item for SSR; randomizes only on user click.
  const [surpriseIndex, setSurpriseIndex] = useState(0);
  const [diceTurns, setDiceTurns] = useState(0);

  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const bodyMeasureRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Show the pill past the hero, hide over install / final CTA / footer, and hide while actively scrolling down.
  useEffect(() => {
    const heroEl = document.querySelector(".kunai-home-hero");
    const installEl = document.querySelector("#install");
    const finalEl = document.querySelector(".kunai-home-final");
    const footerEl = document.querySelector(".kunai-site-footer");

    let heroVisible = true;
    let quietZoneVisible = false;
    let scrollDownHidden = false;
    let lastScrollY = window.scrollY;

    const sync = () => setVisible(!heroVisible && !quietZoneVisible && !scrollDownHidden);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === heroEl) heroVisible = entry.isIntersecting;
          if (entry.target === installEl || entry.target === finalEl || entry.target === footerEl) {
            quietZoneVisible = entry.isIntersecting;
          }
        }
        sync();
      },
      { threshold: 0.08 },
    );

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollY;
      if (delta > 14) scrollDownHidden = true;
      else if (delta < -10) scrollDownHidden = false;
      lastScrollY = y;
      sync();
    };

    if (heroEl) observer.observe(heroEl);
    if (installEl) observer.observe(installEl);
    if (finalEl) observer.observe(finalEl);
    if (footerEl) observer.observe(footerEl);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Hover-only word-roll peek (no ambient loop).
  useEffect(() => {
    if (!hoveredPill || open || reduced) return undefined;
    const timer = window.setInterval(() => {
      setPeekIndex((prev) => (prev + 1) % PEEK_COMMANDS.length);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hoveredPill, open, reduced]);

  // Global `/` shortcut opens the Kunai command drawer unless typing or inside the terminal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.closest(".kunai-terminal-stage"))
      ) {
        return;
      }
      event.preventDefault();
      setTab("commands");
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Dynamically measure drawer content so switching tabs springs height seamlessly.
  useEffect(() => {
    const node = bodyMeasureRef.current;
    if (!open || !node) return undefined;
    const update = () => setContentHeight(node.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
    // `tab`, `query` and `surpriseIndex` are triggers: each changes the drawer's
    // content, so the height is re-measured even though the effect reads a ref.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [open, tab, query, surpriseIndex]);

  useEffect(() => {
    if (open && (tab === "commands" || tab === "adapters")) {
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, tab]);

  const matchedCommands = useMemo(() => filterCommands(commands, query, 12), [commands, query]);
  const matchedProviders = useMemo(
    () => filterProviders(providers, query, "all"),
    [providers, query],
  );

  const activeListLength =
    tab === "commands" ? matchedCommands.length : tab === "adapters" ? matchedProviders.length : 0;

  const clampedIndex = activeListLength === 0 ? 0 : Math.min(selectedIndex, activeListLength - 1);

  const closeAndRun = useCallback(
    (command: string) => {
      setOpen(false);
      setQuery("");
      runTerminalCommand(command, { scroll: true });
    },
    [runTerminalCommand],
  );

  const closeAndJumpAdapter = useCallback(
    (lane: "anime" | "series" | "youtube") => {
      setOpen(false);
      setQuery("");
      focusDirectory(lane);
    },
    [focusDirectory],
  );

  const rollSurprise = useCallback(() => {
    if (commands.length <= 1) return;
    setDiceTurns((n) => n + 1);
    setSurpriseIndex((prev) => {
      let next = Math.floor(Math.random() * commands.length);
      if (next === prev) next = (prev + 1) % commands.length;
      return next;
    });
  }, [commands.length]);

  const handleListKeyDown = (event: React.KeyboardEvent) => {
    if (activeListLength === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % activeListLength);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + activeListLength) % activeListLength);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (tab === "commands") {
        const picked = matchedCommands[clampedIndex];
        if (picked) closeAndRun(`/${picked.command.id}`);
      } else if (tab === "adapters") {
        const picked = matchedProviders[clampedIndex];
        if (picked) closeAndJumpAdapter(picked.lane);
      }
    }
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 500) {
      setOpen(false);
    }
  };

  const surpriseCommand = commands[surpriseIndex] ?? commands[0];

  return (
    <LazyMotion features={domMax}>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        {/* Floating bottom pill */}
        <AnimatePresence>
          {visible && !open ? (
            <m.div
              key="dock-pill-wrap"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.94 }}
              transition={reduced ? { duration: 0.15 } : SPRING_SETTLE}
              className="kunai-dock-anchor"
            >
              <Dialog.Trigger
                ref={triggerRef}
                aria-haspopup="dialog"
                aria-expanded={open}
                onMouseEnter={() => setHoveredPill(true)}
                onMouseLeave={() => setHoveredPill(false)}
                onFocus={() => setHoveredPill(true)}
                onBlur={() => setHoveredPill(false)}
                className={`kunai-dock-pill${hoveredPill ? " is-peeking" : ""}`}
              >
                <KunaiFox pose="idle" size={18} compact className="shrink-0" />
                <span className="kunai-dock-pill__label">
                  <AnimatePresence mode="wait" initial={false}>
                    {hoveredPill && !reduced ? (
                      <m.span
                        key={PEEK_COMMANDS[peekIndex]}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                        className="font-mono text-xs text-[var(--home-text-1)]"
                      >
                        {PEEK_COMMANDS[peekIndex]}
                      </m.span>
                    ) : (
                      <m.span
                        key="rest-label"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                      >
                        Try a command
                      </m.span>
                    )}
                  </AnimatePresence>
                </span>
                <kbd className="kunai-dock-pill__kbd">/</kbd>
              </Dialog.Trigger>
            </m.div>
          ) : null}
        </AnimatePresence>

        {/* Morphing spring drawer */}
        <Dialog.Portal keepMounted>
          <AnimatePresence>
            {open ? (
              <>
                <Dialog.Backdrop
                  render={
                    <m.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                      className="kunai-drawer-scrim"
                    />
                  }
                />

                <div className="kunai-drawer-stage">
                  <Dialog.Popup
                    aria-label="Kunai command drawer"
                    render={
                      <m.div
                        drag="y"
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0.04, bottom: 0.5 }}
                        onDragEnd={handleDragEnd}
                        initial={
                          reduced
                            ? { opacity: 0 }
                            : { opacity: 0, y: 36, scale: 0.94, borderRadius: 24 }
                        }
                        animate={{ opacity: 1, y: 0, scale: 1, borderRadius: 20 }}
                        exit={
                          reduced
                            ? { opacity: 0 }
                            : { opacity: 0, y: 24, scale: 0.95, borderRadius: 24 }
                        }
                        transition={reduced ? { duration: 0.15 } : SPRING_SETTLE}
                        className="kunai-drawer-sheet"
                      />
                    }
                  >
                    {/* Header + drag handle */}
                    <div className="kunai-drawer-head">
                      <div
                        className="kunai-drawer-drag-zone"
                        onPointerDown={(event) => dragControls.start(event)}
                        aria-hidden="true"
                      >
                        <span className="kunai-drawer-handle" />
                      </div>
                      <div className="kunai-drawer-bar">
                        <div
                          className="kunai-drawer-tabs"
                          role="tablist"
                          aria-label="Drawer sections"
                        >
                          {TABS.map((item) => {
                            const Icon = item.icon;
                            const active = tab === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => {
                                  setTab(item.id);
                                  setQuery("");
                                  setSelectedIndex(0);
                                }}
                                className={`kunai-drawer-tab${active ? " is-active" : ""}`}
                              >
                                {active ? (
                                  <m.span
                                    layoutId="dock-tab"
                                    className="kunai-drawer-tab__bg"
                                    transition={reduced ? { duration: 0 } : SPRING_SNAP}
                                  />
                                ) : null}
                                <Icon className="relative z-[1] size-3.5" stroke={1.6} />
                                <span className="relative z-[1]">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        <Dialog.Close
                          aria-label="Close command drawer"
                          className="kunai-drawer-close"
                        >
                          <IconX className="size-4" stroke={1.6} />
                        </Dialog.Close>
                      </div>
                    </div>

                    {/* Spring-animated height container */}
                    <m.div
                      animate={
                        reduced || contentHeight === undefined
                          ? undefined
                          : { height: contentHeight }
                      }
                      transition={reduced ? { duration: 0 } : SPRING_SNAP}
                      className="kunai-drawer-body-clip"
                    >
                      <div ref={bodyMeasureRef} className="kunai-drawer-body">
                        <AnimatePresence mode="wait" initial={false}>
                          {tab === "commands" ? (
                            <m.div
                              key="tab-commands"
                              initial={
                                reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(3px)" }
                              }
                              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                              exit={
                                reduced
                                  ? { opacity: 0 }
                                  : { opacity: 0, y: -3, filter: "blur(2px)" }
                              }
                              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                            >
                              <div className="kunai-drawer-search">
                                <IconSearch
                                  className="size-3.5 text-[var(--home-text-4)]"
                                  stroke={1.6}
                                />
                                <input
                                  ref={searchInputRef}
                                  type="text"
                                  value={query}
                                  onChange={(event) => {
                                    setQuery(event.target.value);
                                    setSelectedIndex(0);
                                  }}
                                  onKeyDown={handleListKeyDown}
                                  placeholder={`Search ${commands.length} Kunai commands…`}
                                  aria-label="Search Kunai commands"
                                  className="kunai-drawer-search__input"
                                />
                                <span className="kunai-drawer-search__meta">
                                  Runs in the preview terminal
                                </span>
                              </div>

                              <ul className="kunai-drawer-list" aria-label="Commands">
                                {matchedCommands.length === 0 ? (
                                  <li className="kunai-drawer-empty">
                                    No commands match &ldquo;{query}&rdquo;.
                                  </li>
                                ) : (
                                  matchedCommands.map((entry, idx) => {
                                    const active = idx === clampedIndex;
                                    return (
                                      <li key={entry.command.id}>
                                        <button
                                          type="button"
                                          aria-current={active ? "true" : undefined}
                                          onMouseEnter={() => setSelectedIndex(idx)}
                                          onClick={() => closeAndRun(`/${entry.command.id}`)}
                                          className={`kunai-drawer-item${active ? " is-selected" : ""}`}
                                        >
                                          <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2">
                                              <code className="font-mono text-xs text-[var(--home-text-1)]">
                                                /
                                                <MatchHighlight
                                                  text={entry.command.id}
                                                  ranges={entry.idRanges}
                                                />
                                              </code>
                                              {entry.command.aliases?.length ? (
                                                <span className="font-mono text-xs text-[var(--home-text-4)]">
                                                  {entry.command.aliases.slice(0, 2).join(", ")}
                                                </span>
                                              ) : null}
                                            </span>
                                            <span className="mt-0.5 block truncate text-xs text-[var(--home-text-3)]">
                                              <MatchHighlight
                                                text={entry.command.description}
                                                ranges={entry.descRanges}
                                              />
                                            </span>
                                          </span>
                                          <IconArrowRight
                                            className="size-3.5 shrink-0 text-[var(--home-text-4)]"
                                            stroke={1.6}
                                          />
                                        </button>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                            </m.div>
                          ) : null}

                          {tab === "adapters" ? (
                            <m.div
                              key="tab-adapters"
                              initial={
                                reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(3px)" }
                              }
                              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                              exit={
                                reduced
                                  ? { opacity: 0 }
                                  : { opacity: 0, y: -3, filter: "blur(2px)" }
                              }
                              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                            >
                              <div className="kunai-drawer-search">
                                <IconSearch
                                  className="size-3.5 text-[var(--home-text-4)]"
                                  stroke={1.6}
                                />
                                <input
                                  ref={searchInputRef}
                                  type="text"
                                  value={query}
                                  onChange={(event) => {
                                    setQuery(event.target.value);
                                    setSelectedIndex(0);
                                  }}
                                  onKeyDown={handleListKeyDown}
                                  placeholder={`Jump to any of ${providers.length} adapters…`}
                                  aria-label="Search adapters"
                                  className="kunai-drawer-search__input"
                                />
                              </div>
                              <ul className="kunai-drawer-list" aria-label="Adapters">
                                {matchedProviders.map((entry, idx) => {
                                  const active = idx === clampedIndex;
                                  const laneColor =
                                    entry.lane === "anime"
                                      ? "var(--home-lane-anime)"
                                      : entry.lane === "youtube"
                                        ? "var(--home-lane-yt)"
                                        : "var(--home-lane-series)";
                                  return (
                                    <li key={entry.provider.id}>
                                      <button
                                        type="button"
                                        aria-current={active ? "true" : undefined}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                        onClick={() => closeAndJumpAdapter(entry.lane)}
                                        className={`kunai-drawer-item${active ? " is-selected" : ""}`}
                                        style={withCssVars({ "--lane": laneColor })}
                                      >
                                        <span className="flex min-w-0 flex-1 items-center gap-2.5">
                                          <span className="kunai-lane-dot" aria-hidden="true" />
                                          <span className="text-sm font-medium text-[var(--home-text-1)]">
                                            <MatchHighlight
                                              text={entry.provider.displayName}
                                              ranges={entry.nameRanges}
                                            />
                                          </span>
                                          <span className="truncate font-mono text-xs text-[var(--home-text-4)]">
                                            <MatchHighlight
                                              text={entry.provider.domain}
                                              ranges={entry.domainRanges}
                                            />
                                          </span>
                                        </span>
                                        <IconArrowRight
                                          className="size-3.5 shrink-0 text-[var(--home-text-4)]"
                                          stroke={1.6}
                                        />
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </m.div>
                          ) : null}

                          {tab === "install" ? (
                            <m.div
                              key="tab-install"
                              initial={
                                reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(3px)" }
                              }
                              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                              exit={
                                reduced
                                  ? { opacity: 0 }
                                  : { opacity: 0, y: -3, filter: "blur(2px)" }
                              }
                              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                              className="p-2"
                            >
                              <p className="mb-3 text-xs text-[var(--home-text-3)]">
                                Self-contained binary — Bun is embedded, only{" "}
                                <code className="text-[var(--home-text-1)]">mpv</code> is needed on
                                PATH.
                              </p>
                              <InstallDock
                                unixCommand={CANONICAL_INSTALL}
                                windowsCommand={NATIVE_INSTALL_PS1}
                                labelPrefix="drawer-install"
                              />
                            </m.div>
                          ) : null}

                          {tab === "surprise" && surpriseCommand ? (
                            <m.div
                              key="tab-surprise"
                              initial={
                                reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(3px)" }
                              }
                              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                              exit={
                                reduced
                                  ? { opacity: 0 }
                                  : { opacity: 0, y: -3, filter: "blur(2px)" }
                              }
                              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                              className="kunai-surprise-panel"
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                <m.div
                                  key={surpriseCommand.id}
                                  initial={
                                    reduced
                                      ? { opacity: 0 }
                                      : { opacity: 0, y: 6, filter: "blur(3px)" }
                                  }
                                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                  exit={
                                    reduced
                                      ? { opacity: 0 }
                                      : { opacity: 0, y: -4, filter: "blur(2px)" }
                                  }
                                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                  className="kunai-surprise-card"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <code className="font-mono text-base font-medium text-[var(--home-lane-kunai)]">
                                      /{surpriseCommand.id}
                                    </code>
                                    <span className="font-mono text-xs text-[var(--home-text-4)]">
                                      {surpriseCommand.label}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-sm leading-relaxed text-[var(--home-text-2)]">
                                    {surpriseCommand.description}
                                  </p>
                                </m.div>
                              </AnimatePresence>

                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={rollSurprise}
                                  className="kunai-surprise-roll"
                                >
                                  <m.span
                                    animate={{ rotate: reduced ? 0 : diceTurns * 90 }}
                                    transition={reduced ? { duration: 0 } : SPRING_SNAP}
                                    className="inline-flex"
                                  >
                                    <IconDice5 className="size-4" stroke={1.6} />
                                  </m.span>
                                  Roll another
                                </button>

                                <button
                                  type="button"
                                  onClick={() => closeAndRun(`/${surpriseCommand.id}`)}
                                  className="kunai-button kunai-button-primary min-h-[2.25rem] px-4 py-1.5 text-xs"
                                >
                                  Try it in terminal ↵
                                </button>
                              </div>
                            </m.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    </m.div>

                    <div className="kunai-drawer-foot" aria-hidden="true">
                      <span>↑↓ move · ↵ run · esc close</span>
                      <span className="tabular-nums">{commands.length} commands</span>
                    </div>
                  </Dialog.Popup>
                </div>
              </>
            ) : null}
          </AnimatePresence>
        </Dialog.Portal>
      </Dialog.Root>
    </LazyMotion>
  );
}
