"use client";

import {
  SPRING_SETTLE,
  SPRING_SNAP,
  SPRING_SOFT,
  useHomeStage,
} from "@/components/home/home-stage-context";
import type { HomeProviderMetadata } from "@/components/home/types";
import { withCssVars } from "@/lib/css-vars";
import {
  countProvidersByLane,
  filterProviders,
  type DirectoryLane,
  type DirectoryLaneFilter,
  type MatchRange,
} from "@/lib/provider-sieve";
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconSearch,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, domMax, LazyMotion, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProviderDirectoryProps = {
  readonly providers: readonly HomeProviderMetadata[];
};

const LANE_META = {
  anime: {
    label: "Anime",
    colorVar: "var(--home-lane-anime)",
    command: "/anime Frieren",
  },
  series: {
    label: "Series & Movies",
    colorVar: "var(--home-lane-series)",
    command: "/series Dune",
  },
  youtube: {
    label: "YouTube",
    colorVar: "var(--home-lane-yt)",
    command: "/youtube lofi radio",
  },
} satisfies Record<
  DirectoryLane,
  { readonly label: string; readonly colorVar: string; readonly command: string }
>;

const CAPABILITIES = [
  { id: "search", label: "Search" },
  { id: "episode-list", label: "Episodes" },
  { id: "source-resolve", label: "Direct resolve" },
  { id: "subtitle-resolve", label: "Subtitles" },
  { id: "multi-source", label: "Multi-source" },
  { id: "quality-ranked", label: "Quality ranked" },
] as const;

const LANE_ORDER: readonly DirectoryLane[] = ["anime", "series", "youtube"];

function HighlightText({
  text,
  ranges,
}: {
  readonly text: string;
  readonly ranges: readonly MatchRange[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`${start}-${end}`} className="kunai-sieve-mark">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * Interactive adapter directory combining:
 * - Headroom-style proportional lane scanner (computed from `mediaKinds`)
 * - Sieve subsequence fuzzy filter with highlighted character spans
 * - Perfolios-style persistent floating preview card gliding along the active row
 */
export function ProviderDirectory({ providers }: ProviderDirectoryProps) {
  const { directoryLane, setDirectoryLane, runTerminalCommand } = useHomeStage();
  const reduced = useReducedMotion();

  const [query, setQuery] = useState("");
  const [hoveredScannerLane, setHoveredScannerLane] = useState<DirectoryLane | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewY, setPreviewY] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const intentTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const previewVisibleRef = useRef(false);

  const counts = useMemo(() => countProvidersByLane(providers), [providers]);
  const ranked = useMemo(
    () => filterProviders(providers, query, directoryLane),
    [providers, query, directoryLane],
  );

  const activePreview = useMemo(
    () => ranked.find((entry) => entry.provider.id === previewId) ?? ranked[0] ?? null,
    [ranked, previewId],
  );

  useEffect(() => {
    return () => {
      if (intentTimer.current !== null) window.clearTimeout(intentTimer.current);
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  const positionPreviewFor = useCallback((id: string) => {
    const row = rowRefs.current[id];
    const list = listRef.current;
    if (!row || !list) return;
    const maxOffset = Math.max(0, list.offsetHeight - 260);
    setPreviewY(Math.min(Math.max(0, row.offsetTop - 16), maxOffset));
  }, []);

  const handleRowEnter = useCallback(
    (id: string) => {
      if (leaveTimer.current !== null) {
        window.clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      positionPreviewFor(id);

      // Emil's tooltip pattern: 80ms intent delay on first open, instant handoff between rows.
      if (previewVisibleRef.current) {
        setPreviewId(id);
        return;
      }
      if (intentTimer.current !== null) window.clearTimeout(intentTimer.current);
      intentTimer.current = window.setTimeout(() => {
        previewVisibleRef.current = true;
        setPreviewId(id);
      }, 80);
    },
    [positionPreviewFor],
  );

  const handleListLeave = useCallback(() => {
    if (intentTimer.current !== null) {
      window.clearTimeout(intentTimer.current);
      intentTimer.current = null;
    }
    leaveTimer.current = window.setTimeout(() => {
      previewVisibleRef.current = false;
    }, 120);
  }, []);

  const handlePreviewEnter = useCallback(() => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const scannerReadoutLane: DirectoryLane | null =
    hoveredScannerLane ?? (directoryLane !== "all" ? directoryLane : null);

  const filterOptions: readonly {
    readonly id: DirectoryLaneFilter;
    readonly label: string;
    readonly count: number;
    readonly laneVar?: string;
  }[] = [
    { id: "all", label: "All", count: providers.length },
    {
      id: "anime",
      label: "Anime",
      count: counts.anime.total,
      laneVar: LANE_META.anime.colorVar,
    },
    {
      id: "series",
      label: "Series & Movies",
      count: counts.series.total,
      laneVar: LANE_META.series.colorVar,
    },
    {
      id: "youtube",
      label: "YouTube",
      count: counts.youtube.total,
      laneVar: LANE_META.youtube.colorVar,
    },
  ];

  return (
    <LazyMotion features={domMax}>
      <div className="kunai-directory">
        {/* Headroom-style proportional lane scanner */}
        <div className="kunai-scanner">
          <div className="kunai-scanner__head">
            <AnimatePresence mode="popLayout" initial={false}>
              {scannerReadoutLane ? (
                <m.p
                  key={scannerReadoutLane}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                  className="kunai-scanner__readout"
                  style={withCssVars({ "--lane": LANE_META[scannerReadoutLane].colorVar })}
                >
                  <span className="kunai-lane-dot" aria-hidden="true" />
                  <span className="font-medium text-[var(--home-text-1)]">
                    {LANE_META[scannerReadoutLane].label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {counts[scannerReadoutLane].total}{" "}
                    {counts[scannerReadoutLane].total === 1 ? "adapter" : "adapters"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {counts[scannerReadoutLane].recommended} recommended
                  </span>
                </m.p>
              ) : (
                <m.p
                  key="overview"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                  className="kunai-scanner__readout"
                >
                  <span className="text-[var(--home-text-2)]">Lane breakdown</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {counts.anime.total} anime, {counts.series.total} series &amp; movies,{" "}
                    {counts.youtube.total} YouTube
                  </span>
                </m.p>
              )}
            </AnimatePresence>
            {directoryLane !== "all" ? (
              <button
                type="button"
                onClick={() => setDirectoryLane("all")}
                className="kunai-scanner__clear"
              >
                Clear lane
              </button>
            ) : null}
          </div>

          <fieldset
            className="kunai-scanner__bar m-0 border-0 p-0"
            aria-label="Filter adapters by media lane"
          >
            <legend className="sr-only">Filter adapters by media lane</legend>
            {LANE_ORDER.map((lane) => {
              const total = counts[lane].total;
              if (total === 0) return null;
              const isFocused = hoveredScannerLane === lane || directoryLane === lane;
              const isDimmed =
                (hoveredScannerLane !== null && hoveredScannerLane !== lane) ||
                (directoryLane !== "all" && directoryLane !== lane && hoveredScannerLane === null);
              return (
                <m.button
                  key={lane}
                  type="button"
                  layout={!reduced}
                  transition={reduced ? { duration: 0 } : SPRING_SOFT}
                  aria-pressed={directoryLane === lane}
                  aria-label={`${LANE_META[lane].label}: ${total} adapters`}
                  onMouseEnter={() => setHoveredScannerLane(lane)}
                  onMouseLeave={() =>
                    setHoveredScannerLane((prev) => (prev === lane ? null : prev))
                  }
                  onFocus={() => setHoveredScannerLane(lane)}
                  onBlur={() => setHoveredScannerLane(null)}
                  onClick={() => setDirectoryLane(directoryLane === lane ? "all" : lane)}
                  className={`kunai-scanner__seg${isDimmed ? " is-dimmed" : ""}`}
                  style={withCssVars(
                    { "--lane": LANE_META[lane].colorVar },
                    { flexGrow: isFocused ? total * 1.35 : total },
                  )}
                />
              );
            })}
          </fieldset>
        </div>

        {/* Segmented lane pills + Sieve fuzzy search */}
        <div className="kunai-dir-controls">
          <fieldset className="kunai-dir-pills m-0 border-0" aria-label="Adapter lanes">
            <legend className="sr-only">Adapter lanes</legend>
            {filterOptions.map((option) => {
              const active = directoryLane === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDirectoryLane(option.id)}
                  className={`kunai-dir-pill${active ? " is-active" : ""}`}
                  style={option.laneVar ? withCssVars({ "--lane": option.laneVar }) : undefined}
                >
                  {active ? (
                    <m.span
                      layoutId="dir-pill"
                      className="kunai-dir-pill__bg"
                      transition={reduced ? { duration: 0 } : SPRING_SNAP}
                    />
                  ) : null}
                  {option.laneVar ? <span className="kunai-lane-dot" aria-hidden="true" /> : null}
                  <span className="relative z-[1]">{option.label}</span>
                  <span className="kunai-dir-pill__count relative z-[1] tabular-nums">
                    {option.count}
                  </span>
                </button>
              );
            })}
          </fieldset>

          <div className="kunai-sieve-box">
            <IconSearch
              className="kunai-sieve-box__icon size-3.5 shrink-0"
              stroke={1.6}
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter adapters"
              aria-label="Filter adapters by name, domain, or capability"
              className="kunai-sieve-box__input"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear adapter filter"
                className="kunai-sieve-box__clear"
              >
                <IconX className="size-3.5" stroke={1.6} />
              </button>
            ) : null}
          </div>
        </div>

        <output aria-live="polite" className="sr-only">
          {ranked.length} {ranked.length === 1 ? "adapter" : "adapters"} shown
        </output>

        {/* Directory list + persistent right-gutter floating preview card */}
        <div className="kunai-dir-stage" onMouseLeave={handleListLeave}>
          <div>
            <div className="kunai-dir-colhead" aria-hidden="true">
              <span>Adapter</span>
              <span>Host</span>
              <span title="Search · Episodes · Resolve · Subtitles · Multi · Quality">
                S E R Sub M Q
              </span>
              <span className="text-right">Status</span>
            </div>
            <ul ref={listRef} className="kunai-row-list">
              {ranked.length === 0 ? (
                <li className="kunai-row-empty">
                  No adapters match &ldquo;{query}&rdquo;.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setDirectoryLane("all");
                    }}
                    className="kunai-row-empty__reset"
                  >
                    Reset filter
                  </button>
                </li>
              ) : (
                ranked.map((entry) => {
                  const { provider, lane, nameRanges, domainRanges } = entry;
                  const laneMeta = LANE_META[lane];
                  const isDimmed = hoveredScannerLane !== null && hoveredScannerLane !== lane;
                  const isActive = previewId === provider.id;
                  const isExpanded = expandedId === provider.id;
                  const caps = new Set(provider.capabilities);
                  const descId = `provider-desc-${provider.id}`;

                  return (
                    <m.li
                      key={provider.id}
                      ref={(node) => {
                        rowRefs.current[provider.id] = node;
                      }}
                      layout={reduced ? false : "position"}
                      transition={reduced ? { duration: 0 } : SPRING_SNAP}
                      onMouseEnter={() => handleRowEnter(provider.id)}
                      className={`kunai-row-item${isActive ? " is-active" : ""}${
                        isDimmed ? " is-dimmed" : ""
                      }`}
                      style={withCssVars({ "--lane": laneMeta.colorVar })}
                    >
                      <div className="kunai-dir-row">
                        <Link
                          href={`/docs/users/providers#${provider.id}`}
                          aria-describedby={descId}
                          onFocus={() => handleRowEnter(provider.id)}
                          className="kunai-dir-row__link"
                        >
                          <span className="kunai-dir-row__name">
                            <span className="kunai-lane-dot" aria-hidden="true" />
                            <span>
                              <HighlightText text={provider.displayName} ranges={nameRanges} />
                            </span>
                          </span>

                          <span className="kunai-dir-row__domain">
                            <HighlightText text={provider.domain} ranges={domainRanges} />
                          </span>

                          <span className="kunai-dir-row__caps" aria-hidden="true">
                            {CAPABILITIES.map((cap) => (
                              <span
                                key={cap.id}
                                title={`${cap.label}: ${caps.has(cap.id) ? "supported" : "not declared"}`}
                                className={`kunai-cap-glyph${caps.has(cap.id) ? " is-on" : ""}`}
                              >
                                {caps.has(cap.id) ? "✓" : "·"}
                              </span>
                            ))}
                          </span>

                          <span className="kunai-dir-row__meta">
                            {provider.recommended &&
                            (provider.id === "hianime" ||
                              provider.id === "vidlink" ||
                              provider.id === "youtube") ? (
                              <span className="kunai-rec-chip">Primary</span>
                            ) : null}
                            <IconArrowRight className="kunai-row-arrow size-4" stroke={1.5} />
                          </span>
                        </Link>

                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={`Inspect ${provider.displayName} details`}
                          onClick={() => setExpandedId(isExpanded ? null : provider.id)}
                          className="kunai-dir-row__toggle"
                        >
                          <IconChevronDown
                            className={`size-4 transition-transform duration-180 ease-[var(--ease-out)] ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            stroke={1.6}
                          />
                        </button>

                        <span id={descId} className="sr-only">
                          {laneMeta.label} adapter at {provider.domain}. {provider.description}
                        </span>
                      </div>

                      {/* Inline mobile/touch disclosure */}
                      <AnimatePresence initial={false}>
                        {isExpanded ? (
                          <m.div
                            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={reduced ? { duration: 0.15 } : SPRING_SETTLE}
                            className="kunai-dir-mobile-detail"
                          >
                            <div className="kunai-dir-mobile-detail__inner">
                              <p className="m-0 text-sm leading-relaxed text-[var(--home-text-3)]">
                                {provider.description}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {CAPABILITIES.map((cap) => (
                                  <span
                                    key={cap.id}
                                    className={`kunai-preview-cap${caps.has(cap.id) ? " is-on" : ""}`}
                                  >
                                    {caps.has(cap.id) ? (
                                      <IconCheck className="size-3" stroke={2} />
                                    ) : (
                                      <span aria-hidden="true">·</span>
                                    )}
                                    {cap.label}
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  runTerminalCommand(laneMeta.command, { scroll: true })
                                }
                                className="kunai-preview-try mt-3"
                              >
                                <IconTerminal2 className="size-3.5" stroke={1.6} />
                                Try {laneMeta.label.toLowerCase()} in terminal
                              </button>
                            </div>
                          </m.div>
                        ) : null}
                      </AnimatePresence>
                    </m.li>
                  );
                })
              )}
            </ul>
          </div>

          {/* Persistent desktop floating preview card (Perfolios-style right gutter) */}
          <div className="kunai-dir-gutter" aria-hidden="true">
            <AnimatePresence>
              {activePreview ? (
                <m.aside
                  key="provider-preview-shell"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: previewY }}
                  animate={{ opacity: 1, scale: 1, y: previewY }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  transition={reduced ? { duration: 0.15 } : SPRING_SNAP}
                  onMouseEnter={handlePreviewEnter}
                  onMouseLeave={handleListLeave}
                  className="kunai-preview-card kunai-spotlight"
                  style={withCssVars({ "--lane": LANE_META[activePreview.lane].colorVar })}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <m.div
                      key={activePreview.provider.id}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(3px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3, filter: "blur(2px)" }}
                      transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <div className="kunai-preview-card__head">
                        <div className="flex items-center gap-2">
                          <span className="kunai-lane-dot" />
                          <span className="text-base font-medium text-[var(--home-text-1)]">
                            {activePreview.provider.displayName}
                          </span>
                        </div>
                        <span className="kunai-preview-lane-chip">
                          {LANE_META[activePreview.lane].label}
                        </span>
                      </div>

                      <p className="kunai-preview-card__domain">{activePreview.provider.domain}</p>
                      <p className="kunai-preview-card__desc">
                        {activePreview.provider.description}
                      </p>

                      <div className="kunai-preview-card__caps">
                        {CAPABILITIES.map((cap) => {
                          const has = activePreview.provider.capabilities.includes(cap.id);
                          return (
                            <span
                              key={cap.id}
                              className={`kunai-preview-cap${has ? " is-on" : ""}`}
                            >
                              {has ? <IconCheck className="size-3" stroke={2} /> : <span>·</span>}
                              {cap.label}
                            </span>
                          );
                        })}
                      </div>

                      {activePreview.provider.notes[0] ? (
                        <p className="kunai-preview-card__note">
                          {activePreview.provider.notes[0]}
                        </p>
                      ) : null}

                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() =>
                          runTerminalCommand(LANE_META[activePreview.lane].command, {
                            scroll: true,
                          })
                        }
                        className="kunai-preview-try mt-4 w-full justify-center"
                      >
                        <IconTerminal2 className="size-3.5" stroke={1.6} />
                        Try in terminal
                      </button>
                    </m.div>
                  </AnimatePresence>
                </m.aside>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </LazyMotion>
  );
}
