import type { BrowseShellOption, ShellPanelLine } from "@/app-shell/types";

const POSTER_AVAILABLE = "Poster available for terminal image preview";
const POSTER_MISSING = "Poster unavailable from this provider";

export type BrowseDetailsPanel = {
  title: string;
  subtitle: string;
  lines: readonly ShellPanelLine[];
  imageUrl?: string;
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
  const lines: ShellPanelLine[] = [
    {
      label: title,
      detail: option.previewBody || "No overview available yet.",
    },
    {
      label: "Poster preview",
      detail: option.previewImageUrl ? POSTER_AVAILABLE : POSTER_MISSING,
      tone: option.previewImageUrl ? "success" : "warning",
    },
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

  if (option.previewMeta?.length) {
    lines.push({
      label: "Metadata",
      detail: option.previewMeta.join("  ·  "),
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
