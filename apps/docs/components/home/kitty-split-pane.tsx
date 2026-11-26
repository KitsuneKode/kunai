"use client";

import type { HeroLane } from "@/lib/provider-sieve";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

export interface KittyTitleEntry {
  readonly id: string;
  readonly lane: HeroLane;
  readonly title: string;
  readonly subtitle: string;
  readonly year: string;
  readonly rating: string;
  readonly runtime: string;
  readonly provider: string;
  readonly fallback: string;
  readonly streamSpec: string;
  readonly audioBadges: readonly string[];
  readonly synopsis: string;
  readonly command: string;
  readonly poster: {
    readonly bgA: string;
    readonly bgB: string;
    readonly accent: string;
    readonly motif: "moon" | "dune" | "grid" | "wave" | "blade" | "horizon";
    readonly kanjiOrTag: string;
  };
}

export const KITTY_CATALOG: readonly KittyTitleEntry[] = [
  {
    id: "frieren",
    lane: "anime",
    title: "Frieren: Beyond Journey's End",
    subtitle: "Ep 01–28 · Sub & Dub",
    year: "2023",
    rating: "9.3",
    runtime: "24m",
    provider: "HiAnime",
    fallback: "KickAssAnime",
    streamSpec: "1080p HLS · AniSkip chapters",
    audioBadges: ["JA Audio", "EN Sub VTT", "EN Dub"],
    synopsis:
      "After a ten-year quest to defeat the Demon King, elven mage Frieren begins a quieter journey to understand human time.",
    command: "/anime Frieren",
    poster: {
      bgA: "#1c132d",
      bgB: "#0f1926",
      accent: "#d885f1",
      motif: "moon",
      kanjiOrTag: "葬送のフリーレン",
    },
  },
  {
    id: "chainsaw",
    lane: "anime",
    title: "Chainsaw Man",
    subtitle: "Ep 01–12 · Sub & Dub",
    year: "2022",
    rating: "8.6",
    runtime: "24m",
    provider: "KickAssAnime",
    fallback: "HiAnime",
    streamSpec: "1080p multi-audio HLS",
    audioBadges: ["JA Audio", "EN Sub VTT", "Dual"],
    synopsis:
      "Denji merges with his chainsaw devil Pochita to survive debt and joins Public Safety's Devil Hunters.",
    command: "/anime Chainsaw Man",
    poster: {
      bgA: "#2b121b",
      bgB: "#160d18",
      accent: "#ff8fb0",
      motif: "blade",
      kanjiOrTag: "チェンソーマン",
    },
  },
  {
    id: "dungeon-meshi",
    lane: "anime",
    title: "Delicious in Dungeon",
    subtitle: "Ep 01–24 · Sub & Dub",
    year: "2024",
    rating: "8.7",
    runtime: "25m",
    provider: "HiAnime",
    fallback: "AnimeGG",
    streamSpec: "1080p HLS · Multi-sub",
    audioBadges: ["JA Audio", "EN Sub", "AniSkip"],
    synopsis:
      "Broke after a dragon eats his sister, Laios leads his party back into the dungeon — cooking monsters along the way.",
    command: "/anime Delicious in Dungeon",
    poster: {
      bgA: "#231b12",
      bgB: "#12151f",
      accent: "#ebc95c",
      motif: "horizon",
      kanjiOrTag: "ダンジョン飯",
    },
  },
  {
    id: "severance",
    lane: "series",
    title: "Severance",
    subtitle: "S02 · E04 · Resume 31:18",
    year: "2025",
    rating: "8.7",
    runtime: "52m",
    provider: "Movy",
    fallback: "VidRock",
    streamSpec: "1080p HLS · Resume synced",
    audioBadges: ["EN 5.1", "EN Sub", "CC"],
    synopsis:
      "Lumon Industries employees undergo a procedure surgically separating work memories from personal life.",
    command: "/series Severance",
    poster: {
      bgA: "#0c2226",
      bgB: "#0c1317",
      accent: "#4ad0cf",
      motif: "grid",
      kanjiOrTag: "LUMON · S02",
    },
  },
  {
    id: "andor",
    lane: "series",
    title: "Andor",
    subtitle: "S02 · E01–12 · Multi-sub",
    year: "2025",
    rating: "8.5",
    runtime: "48m",
    provider: "VidRock",
    fallback: "Movy",
    streamSpec: "1080p HLS · Direct handoff",
    audioBadges: ["EN Audio", "Multi-Sub"],
    synopsis:
      "Five years before Rogue One, thief Cassian Andor is pulled into the quiet mechanics of a growing rebellion.",
    command: "/series Andor",
    poster: {
      bgA: "#241911",
      bgB: "#10141c",
      accent: "#f59a3c",
      motif: "horizon",
      kanjiOrTag: "FERRIX · S02",
    },
  },
  {
    id: "breaking-bad",
    lane: "series",
    title: "Breaking Bad",
    subtitle: "S01 · E01 · Pilot",
    year: "2008",
    rating: "9.5",
    runtime: "58m",
    provider: "Movy",
    fallback: "VidLink",
    streamSpec: "1080p HLS · Verified",
    audioBadges: ["EN Audio", "EN Sub"],
    synopsis:
      "A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing methamphetamine.",
    command: "/series Breaking Bad",
    poster: {
      bgA: "#122418",
      bgB: "#15140e",
      accent: "#54d6a0",
      motif: "grid",
      kanjiOrTag: "35 Br · 56 Ba",
    },
  },
  {
    id: "dune-2",
    lane: "movie",
    title: "Dune: Part Two",
    subtitle: "2024 · Feature · 2h 46m",
    year: "2024",
    rating: "8.5",
    runtime: "166m",
    provider: "Movy",
    fallback: "VidRock",
    streamSpec: "1080p HLS · Direct mpv",
    audioBadges: ["EN Audio", "EN Sub", "4K Ready"],
    synopsis:
      "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
    command: "/search Dune",
    poster: {
      bgA: "#2e2010",
      bgB: "#14100d",
      accent: "#ebc95c",
      motif: "dune",
      kanjiOrTag: "ARRAKIS · II",
    },
  },
  {
    id: "interstellar",
    lane: "movie",
    title: "Interstellar",
    subtitle: "2014 · Feature · 2h 49m",
    year: "2014",
    rating: "8.7",
    runtime: "169m",
    provider: "VidRock",
    fallback: "Movy",
    streamSpec: "1080p HLS · Verified",
    audioBadges: ["EN Audio", "EN Sub"],
    synopsis:
      "A team of explorers travels through a wormhole near Saturn in an attempt to ensure humanity's survival.",
    command: "/search Interstellar",
    poster: {
      bgA: "#121b2c",
      bgB: "#0c0f16",
      accent: "#5fb6ff",
      motif: "moon",
      kanjiOrTag: "GARGANTUA",
    },
  },
  {
    id: "lofi-girl",
    lane: "youtube",
    title: "Lofi Girl · Beats to Relax/Study",
    subtitle: "LIVE · 1080p + Opus Audio",
    year: "LIVE",
    rating: "HD",
    runtime: "Live",
    provider: "YouTube",
    fallback: "yt-dlp",
    streamSpec: "1080p60 + 251 Opus · Zero tabs",
    audioBadges: ["Opus 160k", "Live HLS", "No Ads"],
    synopsis:
      "Direct terminal stream via Kunai's YouTube adapter with adaptive quality ladder and zero browser overhead.",
    command: "/youtube lofi radio",
    poster: {
      bgA: "#162033",
      bgB: "#1c1324",
      accent: "#5fb6ff",
      motif: "wave",
      kanjiOrTag: "LIVE · OPUS",
    },
  },
  {
    id: "3b1b",
    lane: "youtube",
    title: "3Blue1Brown · Attention in Transformers",
    subtitle: "26m · 2160p VP9 + EN VTT",
    year: "2024",
    rating: "4K",
    runtime: "26m",
    provider: "YouTube",
    fallback: "yt-dlp",
    streamSpec: "2160p VP9 · 37 variants",
    audioBadges: ["2160p", "EN Sub VTT", "Chapters"],
    synopsis:
      "Visualizing how attention layers route semantic context across vectors inside modern language models.",
    command: "/youtube 3blue1brown",
    poster: {
      bgA: "#0e1d2e",
      bgB: "#111419",
      accent: "#4ad0cf",
      motif: "grid",
      kanjiOrTag: "4K · VP9",
    },
  },
];

function KittyPosterArtwork({ item }: { readonly item: KittyTitleEntry }) {
  const { bgA, bgB, accent, motif, kanjiOrTag } = item.poster;
  return (
    <div className="kunai-kitty-poster" aria-hidden="true">
      <svg viewBox="0 0 180 248" className="block h-full w-full">
        <defs>
          <linearGradient id={`poster-bg-${item.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={bgA} />
            <stop offset="100%" stopColor={bgB} />
          </linearGradient>
          <radialGradient id={`poster-glow-${item.id}`} cx="50%" cy="38%" r="55%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.42" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="180" height="248" fill={`url(#poster-bg-${item.id})`} />
        <rect width="180" height="248" fill={`url(#poster-glow-${item.id})`} />

        {motif === "moon" ? (
          <>
            <circle cx="90" cy="86" r="38" fill={accent} fillOpacity="0.22" />
            <circle cx="90" cy="86" r="24" fill="#f5f3ee" fillOpacity="0.92" />
            <circle cx="100" cy="80" r="21" fill={bgA} />
            <path
              d="M0 186 Q56 154 108 172 T180 162 L180 248 L0 248 Z"
              fill="#0b0b0a"
              fillOpacity="0.6"
            />
          </>
        ) : null}

        {motif === "dune" ? (
          <>
            <circle cx="122" cy="70" r="26" fill={accent} fillOpacity="0.82" />
            <path
              d="M0 158 Q62 126 118 148 T180 138 L180 248 L0 248 Z"
              fill={accent}
              fillOpacity="0.25"
            />
            <path d="M0 182 Q76 146 180 176 L180 248 L0 248 Z" fill="#0b0b0a" fillOpacity="0.72" />
          </>
        ) : null}

        {motif === "grid" ? (
          <>
            <g stroke={accent} strokeOpacity="0.24" strokeWidth="1">
              <line x1="30" y1="24" x2="30" y2="190" />
              <line x1="60" y1="24" x2="60" y2="190" />
              <line x1="90" y1="24" x2="90" y2="190" />
              <line x1="120" y1="24" x2="120" y2="190" />
              <line x1="150" y1="24" x2="150" y2="190" />
              <line x1="18" y1="60" x2="162" y2="60" />
              <line x1="18" y1="96" x2="162" y2="96" />
              <line x1="18" y1="132" x2="162" y2="132" />
            </g>
            <rect
              x="64"
              y="64"
              width="52"
              height="52"
              rx="8"
              fill={accent}
              fillOpacity="0.26"
              stroke={accent}
              strokeOpacity="0.8"
            />
          </>
        ) : null}

        {motif === "wave" ? (
          <>
            <path
              d="M12 110 Q48 76 90 108 T168 96"
              fill="none"
              stroke={accent}
              strokeWidth="3"
              strokeOpacity="0.85"
            />
            <path
              d="M12 128 Q54 96 96 124 T168 114"
              fill="none"
              stroke="#ff8fb0"
              strokeWidth="2"
              strokeOpacity="0.55"
            />
            <circle cx="90" cy="72" r="18" fill={accent} fillOpacity="0.3" />
          </>
        ) : null}

        {motif === "blade" ? (
          <>
            <polygon points="36,162 146,52 132,124 88,162" fill={accent} fillOpacity="0.35" />
            <line
              x1="34"
              y1="164"
              x2="148"
              y2="50"
              stroke="#f5f3ee"
              strokeWidth="2.5"
              strokeOpacity="0.85"
            />
          </>
        ) : null}

        {motif === "horizon" ? (
          <>
            <circle cx="90" cy="112" r="30" fill={accent} fillOpacity="0.38" />
            <rect x="0" y="116" width="180" height="132" fill="#0b0b0a" fillOpacity="0.58" />
            <line
              x1="18"
              y1="116"
              x2="162"
              y2="116"
              stroke={accent}
              strokeWidth="2"
              strokeOpacity="0.85"
            />
          </>
        ) : null}

        <rect x="10" y="10" width="76" height="18" rx="4" fill="#0b0b0a" fillOpacity="0.72" />
        <text x="17" y="22" fill="#cbc8c0" fontSize="8.5" fontFamily="ui-monospace, monospace">
          KITTY · APC
        </text>
        <text
          x="14"
          y="214"
          fill="#f5f3ee"
          fontSize="12"
          fontWeight="600"
          fontFamily="system-ui, sans-serif"
        >
          {item.title.length > 20 ? `${item.title.slice(0, 19)}…` : item.title}
        </text>
        <text x="14" y="232" fill={accent} fontSize="9.5" fontFamily="ui-monospace, monospace">
          {kanjiOrTag}
        </text>
      </svg>
    </div>
  );
}

const LANE_TABS: readonly { readonly id: HeroLane; readonly label: string }[] = [
  { id: "anime", label: "Anime" },
  { id: "series", label: "Series" },
  { id: "movie", label: "Movies" },
  { id: "youtube", label: "YouTube" },
];

export function KittySplitPane({
  activeLane,
  selectedId,
  statusLine,
  onSelectLane,
  onSelectItem,
  onPlayItem,
  onOpenPalette,
  onFallback,
}: {
  readonly activeLane: HeroLane;
  readonly selectedId: string;
  readonly statusLine: string;
  readonly onSelectLane: (lane: HeroLane) => void;
  readonly onSelectItem: (item: KittyTitleEntry) => void;
  readonly onPlayItem: (item: KittyTitleEntry) => void;
  readonly onOpenPalette?: () => void;
  readonly onFallback?: () => void;
}) {
  const laneItems = KITTY_CATALOG.filter((item) => item.lane === activeLane);
  const activeIndex = Math.max(
    0,
    laneItems.findIndex((item) => item.id === selectedId),
  );
  const activeItem = laneItems[activeIndex] ?? laneItems[0];
  const tabRefs = useRef<Partial<Record<HeroLane, HTMLButtonElement | null>>>({});
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusRef = useRef<
    | { readonly kind: "tab"; readonly lane: HeroLane }
    | { readonly kind: "row"; readonly index: number }
    | null
  >(null);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.kind === "tab") {
      tabRefs.current[pending.lane]?.focus();
    } else {
      rowRefs.current[pending.index]?.focus();
    }
    // The deps are the trigger, not inputs: focus moves after the lane or row
    // selection has committed, and the target itself is read from a ref.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [activeLane, selectedId]);

  if (!activeItem) return null;

  const handleKeyDown = (source: "tab" | "row") => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      const nextIndex = (activeIndex + 1) % laneItems.length;
      const next = laneItems[nextIndex];
      if (next) {
        pendingFocusRef.current = { kind: "row", index: nextIndex };
        onSelectItem(next);
      }
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      const prevIndex = (activeIndex - 1 + laneItems.length) % laneItems.length;
      const prev = laneItems[prevIndex];
      if (prev) {
        pendingFocusRef.current = { kind: "row", index: prevIndex };
        onSelectItem(prev);
      }
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const currentLaneIdx = LANE_TABS.findIndex((t) => t.id === activeLane);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextTab = LANE_TABS[(currentLaneIdx + delta + LANE_TABS.length) % LANE_TABS.length];
      if (nextTab) {
        pendingFocusRef.current =
          source === "tab" ? { kind: "tab", lane: nextTab.id } : { kind: "row", index: 0 };
        onSelectLane(nextTab.id);
      }
    } else if (event.key === "/") {
      event.preventDefault();
      onOpenPalette?.();
    } else if (event.key === "F" && event.shiftKey) {
      event.preventDefault();
      onFallback?.();
    }
  };

  return (
    <div className="kunai-kitty-tui">
      <div className="kunai-kitty-tui__bar">
        <div className="kunai-kitty-tui__tabs">
          {LANE_TABS.map((tab) => {
            const active = tab.id === activeLane;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                type="button"
                aria-pressed={active}
                data-lane={tab.id}
                onClick={() => onSelectLane(tab.id)}
                onKeyDown={handleKeyDown("tab")}
                className={`kunai-kitty-tui__tab ${active ? "is-active" : ""}`}
              >
                <span className="kunai-kitty-tui__tab-dot" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <span className="kunai-kitty-tui__proto">Kitty graphics · Mouse + Keyboard</span>
      </div>

      <div className="kunai-kitty-tui__grid">
        <div className="kunai-kitty-tui__list">
          {laneItems.map((item, idx) => {
            const selected = item.id === activeItem.id;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                type="button"
                aria-label={`${item.title}, ${item.subtitle}, rated ${item.rating}`}
                aria-current={selected ? "true" : undefined}
                onMouseEnter={() => onSelectItem(item)}
                onFocus={() => onSelectItem(item)}
                onClick={() => (selected ? onPlayItem(item) : onSelectItem(item))}
                onDoubleClick={() => onPlayItem(item)}
                onKeyDown={handleKeyDown("row")}
                className={`kunai-kitty-tui__row ${selected ? "is-selected" : ""}`}
              >
                <span className="kunai-kitty-tui__rail" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="kunai-kitty-tui__row-title">{item.title}</span>
                  <span className="kunai-kitty-tui__row-sub">{item.subtitle}</span>
                </span>
                <span className="kunai-kitty-tui__row-meta">
                  <span>{item.year}</span>
                  <span className="kunai-kitty-tui__row-rate">★ {item.rating}</span>
                </span>
              </button>
            );
          })}
          <p className="kunai-kitty-tui__status" aria-live="polite">
            {statusLine}
          </p>
        </div>

        <div className="kunai-kitty-tui__preview">
          <KittyPosterArtwork key={activeItem.id} item={activeItem} />
          <div className="kunai-kitty-tui__meta">
            <div className="flex items-start justify-between gap-2">
              <p className="kunai-kitty-tui__preview-title m-0">{activeItem.title}</p>
              <span className="kunai-kitty-tui__provider-chip">
                {activeItem.provider} → {activeItem.fallback}
              </span>
            </div>
            <p className="kunai-kitty-tui__preview-spec m-0">{activeItem.streamSpec}</p>
            <p className="kunai-kitty-tui__preview-desc m-0">{activeItem.synopsis}</p>
            <div className="kunai-kitty-tui__badges">
              {activeItem.audioBadges.map((badge) => (
                <span key={badge} className="kunai-kitty-tui__badge">
                  {badge}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onPlayItem(activeItem)}
              aria-label={`Simulate playing ${activeItem.title} in mpv`}
              className="kunai-kitty-tui__play"
            >
              <IconPlayerPlay className="size-3.5" stroke={2} />
              <span>Preview in mpv</span>
              <kbd className="kunai-kitty-tui__kbd">Enter</kbd>
            </button>
          </div>
        </div>
      </div>

      <div className="kunai-kitty-tui__footer" aria-hidden="true">
        <span>
          <kbd>↑↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> play
        </span>
        <span>
          <kbd>←→</kbd> lane
        </span>
        <span>
          <kbd>/</kbd> commands
        </span>
        <span>
          <kbd>⇧F</kbd> fallback
        </span>
      </div>
    </div>
  );
}
