import type { BrowseShellOption, ShellPanelLine } from "@/app-shell/types";

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
  watchedEpisodes?: number;
  totalEpisodes?: number;
  providers?: string[];
  subtitleLanguages?: string[];
};

export type DetailsPanelData = {
  primary: DetailsPanelPrimary;
  secondary: DetailsPanelSecondary | null; // null = still loading
};

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
