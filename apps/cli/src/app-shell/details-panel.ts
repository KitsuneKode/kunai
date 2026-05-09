import type { BrowseShellOption, ShellPanelLine } from "@/app-shell/types";

const POSTER_AVAILABLE = "Poster available for companion preview";
const POSTER_MISSING = "Poster unavailable from this provider";

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
  const lines: ShellPanelLine[] = [
    {
      label: "Title",
      detail: title,
      tone: "success",
    },
    ...(option.previewMeta?.length
      ? [
          {
            label: "Quick facts",
            detail: option.previewMeta.join("  ·  "),
          },
        ]
      : []),
    {
      label: "Overview",
      detail: option.previewBody || "No overview available yet.",
    },
    {
      label: "Artwork",
      detail: option.previewImageUrl ? POSTER_AVAILABLE : POSTER_MISSING,
      tone: option.previewImageUrl ? "success" : "warning",
    },
    {
      label: "Trailer",
      detail: "Trailer links are not part of the current search contract yet.",
      tone: "neutral",
    },
    ...facts.filter((fact) => fact.label !== "Poster" && fact.label !== "Rating"),
  ];

  if (option.previewRating) {
    lines.push({
      label: "Rating",
      detail: option.previewRating,
      tone: "success",
    });
  } else {
    lines.push({
      label: "Rating",
      detail: "Rating unavailable from this provider response",
      tone: "neutral",
    });
  }

  for (const fact of option.previewFacts ?? []) {
    lines.push(fact);
  }

  lines.push({
    label: "Next step",
    detail: option.previewNote ?? "Press Enter to open this title.",
  });

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

  if (!option.previewImageUrl) {
    facts.push({
      label: "Artwork",
      detail: "Not supplied by this provider",
      tone: "neutral",
    });
  }

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
