import type { BrowseShellOption, ShellPanelLine } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

export type DetailsPanelPrimary = {
  title: string;
  type: "movie" | "series";
  year?: string;
  genres?: string[];
  synopsis?: string;
  posterPath?: string | null;
};

export type DetailsPanelSecondary = {
  seriesState: "airing" | "ended" | "complete" | "upcoming" | null;
  nextAirDate?: string;
  seasonLabel?: string;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  providers?: string[];
  subtitleLanguages?: string[];
};

export type DetailsPanelData = {
  primary: DetailsPanelPrimary;
  secondary: DetailsPanelSecondary | null; // null = still loading
};

function isSearchResultValue(value: unknown): value is SearchResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "title" in value
  );
}

function parseEpisodeProgress(detail: string | undefined): {
  watchedEpisodes?: number;
  totalEpisodes?: number;
} {
  if (!detail) return {};
  const match = detail.match(/(\d+)\s*of\s*(\d+)\s*eps?/i);
  if (match) {
    return {
      watchedEpisodes: Number(match[1]),
      totalEpisodes: Number(match[2]),
    };
  }
  const percentMatch = detail.match(/(\d+)%/);
  if (percentMatch) {
    return { watchedEpisodes: Number(percentMatch[1]) };
  }
  return {};
}

export function buildDetailsPanelDataFromBrowseOption<T>(
  option: BrowseShellOption<T> | undefined,
): DetailsPanelData {
  if (!option) {
    return {
      primary: {
        title: "No selection",
        type: "series",
        synopsis: "Search for a title to preview details here.",
      },
      secondary: null,
    };
  }

  const meta = option.previewMeta ?? [];
  const typeLabel = meta.find((value) => value === "Series" || value === "Movie");
  const year = meta.find((value) => /^\d{4}$/.test(value));
  const genres = meta.filter(
    (value) =>
      value !== typeLabel &&
      value !== year &&
      !value.endsWith(" episodes") &&
      !/(?:★|\d(?:\.\d)?\/10)/.test(value),
  );
  return {
    primary: {
      title: option.previewTitle ?? option.label,
      type: typeLabel === "Movie" ? "movie" : "series",
      year,
      genres: genres.length > 0 ? genres.slice(0, 3) : undefined,
      synopsis: option.previewBody || undefined,
      posterPath: option.previewImageUrl ?? null,
    },
    secondary: null,
  };
}

export function resolveBrowseDetailsSecondary<T>(
  option: BrowseShellOption<T> | undefined,
  {
    providerName,
  }: {
    providerName?: string;
  } = {},
): DetailsPanelSecondary {
  if (!option) {
    return { seriesState: null };
  }

  const progressFact = option.previewFacts?.find(
    (fact) => fact.label === "Local progress" || fact.label === "Watch history",
  );
  const progress = parseEpisodeProgress(progressFact?.detail);

  let subtitleLanguages: string[] | undefined;
  let seriesState: DetailsPanelSecondary["seriesState"] = null;

  const airingHint = option.previewMeta?.some((value) => /airing|releasing|ongoing/i.test(value));
  const endedHint = option.previewMeta?.some((value) => /ended|complete|finished/i.test(value));

  if (isSearchResultValue(option.value)) {
    const result = option.value;
    if (result.subtitleAvailability === "hardsub") {
      subtitleLanguages = ["hardsub"];
    } else if (result.subtitleAvailability === "softsub") {
      subtitleLanguages = ["softsub"];
    }
    if (result.type === "series") {
      const progressPct =
        progress.watchedEpisodes && progress.totalEpisodes
          ? progress.watchedEpisodes / progress.totalEpisodes
          : 0;
      if (progressPct >= 1) {
        seriesState = "complete";
      } else if (endedHint) {
        seriesState = "ended";
      } else if (airingHint) {
        seriesState = "airing";
      } else if (progress.watchedEpisodes && progress.watchedEpisodes > 0) {
        seriesState = "upcoming";
      }
    }
    if (!progress.totalEpisodes && result.episodeCount) {
      progress.totalEpisodes = result.episodeCount;
    }
  } else if (airingHint) {
    seriesState = "airing";
  } else if (endedHint) {
    seriesState = "ended";
  }

  const providers = providerName ? [providerName] : undefined;
  const seasonLabel =
    option.previewMeta?.find((value) => /^S\d+\b/i.test(value)) ??
    option.previewFacts?.find((fact) => fact.label === "Season")?.detail;

  return {
    seriesState,
    seasonLabel,
    watchedEpisodes: progress.watchedEpisodes,
    totalEpisodes: progress.totalEpisodes,
    providers,
    subtitleLanguages,
  };
}

const POSTER_AVAILABLE = "Poster available for companion preview";
const POSTER_MISSING = "Poster unavailable from this provider";
const LOCAL_FACT_LABELS = new Set(["Local progress", "Offline"]);

export type BrowseDetailsPanel = {
  title: string;
  subtitle: string;
  lines: readonly ShellPanelLine[];
  imageUrl?: string;
};

export type BrowseCompanionPanel = {
  title: string;
  metaLine: string;
  body: string;
  facts: readonly ShellPanelLine[];
};

export function buildBrowseDetailsPanel<T>(
  option: BrowseShellOption<T> | undefined,
): BrowseDetailsPanel {
  if (!option) {
    return {
      title: "Title overview",
      subtitle: "No selected title yet",
      lines: [
        {
          label: "Nothing selected",
          detail: "Search for a title, move through results, then press d to inspect it.",
          tone: "warning",
        },
      ],
    };
  }

  const title = option.previewTitle ?? option.label;
  const facts = getStructuredPreviewFacts(option);
  const previewFacts = option.previewFacts ?? [];
  const localFacts = previewFacts.filter((fact) => LOCAL_FACT_LABELS.has(fact.label));
  const nonLocalFacts = previewFacts.filter(
    (fact) =>
      !LOCAL_FACT_LABELS.has(fact.label) && fact.label !== "Poster" && fact.label !== "Rating",
  );
  const quickFacts = facts.filter((fact) => fact.label !== "Poster" && fact.label !== "Rating");
  const lines: ShellPanelLine[] = [
    { label: "─── Selection", detail: "", tone: "info" },
    {
      label: "Title",
      detail: title,
      tone: "success",
    },
    ...(option.previewMeta?.length
      ? [
          {
            label: "At a glance",
            detail: option.previewMeta.join("  ·  "),
          },
        ]
      : []),
    {
      label: "Open",
      detail: option.previewNote ?? "Press Enter to open this title.",
      tone: "info",
    },
    ...(localFacts.length > 0
      ? [{ label: "─── Local", detail: "", tone: "info" as const }, ...localFacts]
      : []),
    { label: "─── Details", detail: "", tone: "info" },
    ...quickFacts,
    {
      label: "Rating",
      detail: option.previewRating ?? "Not supplied by this provider response",
      tone: option.previewRating ? "success" : "neutral",
    },
    { label: "─── Synopsis", detail: "", tone: "info" },
    {
      label: "Overview",
      detail: option.previewBody || "No overview available yet.",
    },
    { label: "─── Availability", detail: "", tone: "info" },
    {
      label: "Artwork",
      detail: option.previewImageUrl ? POSTER_AVAILABLE : POSTER_MISSING,
      tone: option.previewImageUrl ? "success" : "warning",
    },
    ...nonLocalFacts,
  ];

  return {
    title: "Title overview",
    subtitle: title,
    lines,
    imageUrl: option.previewImageUrl,
  };
}

export function buildBrowseCompanionPanel<T>(
  option: BrowseShellOption<T> | undefined,
  {
    selectedDetail,
  }: {
    selectedDetail: string;
  },
): BrowseCompanionPanel {
  if (!option) {
    return {
      title: "No selection yet",
      metaLine: "Ready to search",
      body: "Type a title and press Enter to search.",
      facts: selectedDetail ? [{ label: "Context", detail: selectedDetail }] : [],
    };
  }

  return {
    title: option.previewTitle ?? option.label,
    metaLine: buildPreviewMetaLine(option),
    body: option.previewBody || "No overview available yet.",
    facts: buildCompanionFacts(option),
  };
}

export function buildPreviewMetaLine<T>(option: BrowseShellOption<T>): string {
  const meta = option.previewMeta ?? [];
  const type = meta.find((value) => value === "Series" || value === "Movie");
  const year = meta.find((value) => /^\d{4}$/.test(value));
  const episodes = meta.find((value) => value.endsWith(" episodes"));
  const rating = option.previewRating ?? meta.find((value) => /(?:★|\d(?:\.\d)?\/10)/.test(value));
  const parts = uniqueStrings([year, type, episodes, rating]);
  return parts.length > 0 ? parts.join("  ·  ") : "Provider result";
}

function getStructuredPreviewFacts<T>(option: BrowseShellOption<T>): ShellPanelLine[] {
  const meta = option.previewMeta ?? [];
  const type = meta.find((value) => value === "Series" || value === "Movie");
  const year = meta.find((value) => /^\d{4}$/.test(value));
  const episodes = meta.find((value) => value.endsWith(" episodes"));

  return [
    {
      label: "Type",
      detail: type ?? "Unknown",
      tone: type ? "neutral" : "warning",
    },
    ...(year
      ? [
          {
            label: "Year",
            detail: year,
          },
        ]
      : []),
    ...(episodes
      ? [
          {
            label: "Episodes",
            detail: episodes.replace(" episodes", ""),
          },
        ]
      : []),
    {
      label: "Rating",
      detail: option.previewRating ?? "Rating unavailable from this provider response",
      tone: option.previewRating ? "success" : "neutral",
    },
    {
      label: "Poster",
      detail: option.previewImageUrl ? "Available" : "Unavailable",
      tone: option.previewImageUrl ? "success" : "warning",
    },
  ];
}

function buildCompanionFacts<T>(option: BrowseShellOption<T>): ShellPanelLine[] {
  const facts: ShellPanelLine[] = [];
  const providerFacts = option.previewFacts ?? [];

  for (const fact of providerFacts) {
    if (fact.label === "Poster" || fact.label === "Rating") continue;
    facts.push(fact);
  }

  return facts;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
