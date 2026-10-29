import type { BrowseLibraryFilterAvailability } from "@/app/search/browse-local-filter-facts";
import type { ShellMode } from "@/domain/types";

export type SearchFilterChipOption = {
  readonly value: string | null;
  readonly label: string;
  readonly detail: string;
};

const LANGS: readonly [string, string][] = [
  ["en", "English"],
  ["ja", "Japanese"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["ko", "Korean"],
  ["it", "Italian"],
  ["ru", "Russian"],
  ["pt", "Portuguese"],
];

const GENRES: readonly string[] = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Supernatural",
  "Thriller",
  "Sports",
  "Mecha",
  "Sci-Fi",
  "Slice of Life",
];

const YEARS = ["2026", "2025", "2024", "2023", "2022", "2020"] as const;
const ACTIVE_REMOVE = "active (select to remove)";

/**
 * Check whether a specific filter chip is currently active in the search query.
 * Matches literal token occurrences and compound genre lists.
 */
export function isFilterChipActive(query: string, chipValue: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.includes(chipValue)) return true;

  if (chipValue.startsWith("genre:")) {
    const genre = chipValue.slice(6);
    return tokens.some((t) => t.startsWith("genre:") && t.slice(6).split(",").includes(genre));
  }

  return false;
}

/**
 * Combobox facet toggler ($shadcn pattern):
 * - If the chip is already in the query, toggling it removes it.
 * - If an exclusive facet (type, sort, mode, rating, year, release, audio, subtitles, etc.)
 *   already exists in the query, selecting another value replaces the existing facet.
 * - Non-exclusive facets (e.g. genre) toggle individually.
 * - Freeform search query text is preserved.
 */
export function toggleSearchFilterChip(query: string, chip: string): string {
  const trimmed = query.trim();
  if (!trimmed) return chip;

  const colonIdx = chip.indexOf(":");
  if (colonIdx === -1) {
    const tokens = trimmed.split(/\s+/);
    if (tokens.includes(chip)) {
      return tokens.filter((t) => t !== chip).join(" ");
    }
    return `${trimmed} ${chip}`;
  }

  const prefix = chip.slice(0, colonIdx);
  const isExclusive = prefix !== "genre";
  const tokens = trimmed.split(/\s+/);

  if (isExclusive) {
    const existingIndex = tokens.findIndex((t) => t.startsWith(`${prefix}:`));
    if (existingIndex !== -1) {
      if (tokens[existingIndex] === chip) {
        tokens.splice(existingIndex, 1);
        return tokens.join(" ");
      }
      tokens[existingIndex] = chip;
      return tokens.join(" ");
    }
    return `${trimmed} ${chip}`;
  } else {
    const existingIndex = tokens.findIndex((t) => t === chip);
    if (existingIndex !== -1) {
      tokens.splice(existingIndex, 1);
      return tokens.join(" ");
    }
    return `${trimmed} ${chip}`;
  }
}

/**
 * Guided-facet chips for the `/filters` combobox sheet.
 * Follows shadcn Combobox / Command pattern:
 * - Active chips display [✓] and "(active · select to remove)".
 * - Inactive chips display [ ] when currentQuery is supplied.
 * - Facets are catalog-scoped so tokens that cannot apply are never advertised.
 */
export function buildSearchFilterChipOptions(context: {
  readonly sessionMode: ShellMode;
  readonly library: BrowseLibraryFilterAvailability;
  readonly currentQuery?: string;
}): SearchFilterChipOption[] {
  const { sessionMode, library, currentQuery } = context;
  const isYoutube = sessionMode === "youtube";

  const opt = (value: string, baseLabel: string, baseDetail: string): SearchFilterChipOption => {
    if (currentQuery === undefined) {
      return { value, label: baseLabel, detail: baseDetail };
    }
    const active = isFilterChipActive(currentQuery, value);
    return {
      value,
      label: `${active ? "[✓] " : "[ ] "}${baseLabel}`,
      detail: active
        ? baseDetail
          ? `${baseDetail} · ${ACTIVE_REMOVE}`
          : ACTIVE_REMOVE
        : baseDetail,
    };
  };

  return [
    // ── Type (catalog-scoped) ──
    ...(isYoutube
      ? [
          opt("type:video", "YouTube · Videos", "Only videos"),
          opt("type:short", "YouTube · Shorts", "Only Shorts"),
          opt("type:playlist", "YouTube · Playlists", "Only playlists"),
          opt("type:channel", "YouTube · Channels", "Only channels"),
        ]
      : [
          opt("type:movie", "Type · Movies", "Only movies"),
          opt("type:series", "Type · Series", "Only TV / series"),
        ]),
    // ── Cross-mode switches ──
    ...(sessionMode !== "anime"
      ? [opt("mode:anime", "Type · Anime", "Search anime catalogs")]
      : []),
    ...(sessionMode !== "youtube" ? [opt("mode:youtube", "Type · YouTube", "Search YouTube")] : []),
    // ── Audio / Dub (first-class language options) ──
    ...LANGS.map(([code, name]) =>
      opt(
        `audio:${code}`,
        `Audio · ${name}${code === "en" ? " (Dub)" : code === "ja" ? " (Original)" : ""}`,
        `${name} audio`,
      ),
    ),
    // ── Subtitles ──
    ...LANGS.map(([code, name]) => opt(`subtitles:${code}`, `Subtitles · ${name}`, "")),
    // ── Genre ──
    ...GENRES.map((name) =>
      opt(`genre:${name.toLowerCase().replace(/\s+/g, "-")}`, `Genre · ${name}`, ""),
    ),
    // ── Year ──
    ...YEARS.map((y) => opt(`year:${y}`, `Year · ${y}`, "")),
    ...(library.release
      ? [
          opt("release:today", "Release · Today", "Releasing today"),
          opt("release:this-week", "Release · This week", "Airing this week"),
          opt("release:upcoming", "Release · Upcoming", "Not yet aired"),
        ]
      : []),
    // ── Rating ──
    opt("rating:9", "Rating · 9+", "Top rated"),
    opt("rating:8", "Rating · 8+", "Highly rated"),
    opt("rating:7", "Rating · 7+", "Well rated"),
    ...(library.watched
      ? [
          opt("watched:watching", "Library · Continue watching", "In-progress"),
          opt("watched:completed", "Library · Completed", "Finished"),
          opt("watched:unwatched", "Library · Unwatched", "Not started"),
        ]
      : []),
    ...(library.downloaded
      ? [opt("downloaded:true", "Library · Downloaded", "Available offline")]
      : []),
    // ── Sort ──
    opt("sort:popular", "Sort · Popular", "Most popular"),
    opt("sort:rating", "Sort · Top rated", "Highest score"),
    opt("sort:recent", "Sort · Recent", "Newly added"),
    // ── Provider ──
    opt("provider:allanime", "Provider · allanime", "Filter to allanime"),
    { value: null, label: "Cancel", detail: "" },
  ];
}
