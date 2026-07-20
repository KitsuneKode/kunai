import { Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";
import { usePosterPreview } from "../use-poster-preview";

function initialsOf(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

/**
 * Compact text-mode poster tile for list rows and cards. Renders a chafa preview
 * inside Ink (`inkEmbedded`) only when `enabled` — typically the settled/focused
 * row — so scrolling a list never spawns one chafa fetch per visible row;
 * unfocused rows fall back to cheap title initials. Callers that navigate rapidly
 * (calendar) should keep `enabled` false while `navigating` so intermediate
 * selection changes never arm the debounce. `preserveTerminalImages`
 * keeps a tile render from wiping a coexisting Kitty hero placement.
 *
 * This consolidates the per-shell mini-poster components (queue, notifications,
 * calendar, post-play) so the selection-only fetch policy lives in one place.
 */
export function MiniPosterTile({
  url,
  title,
  enabled,
  rows = 2,
  cols = 4,
  debounceMs = 160,
  placeholderColor = palette.dim,
}: {
  readonly url?: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly rows?: number;
  readonly cols?: number;
  readonly debounceMs?: number;
  readonly placeholderColor?: string;
}) {
  const { poster, posterState } = usePosterPreview(url, {
    rows,
    cols,
    enabled: enabled && Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs,
  });

  if (!url) {
    return <Text color={placeholderColor}>{initialsOf(title)}</Text>;
  }

  if (poster.kind !== "none" && poster.placeholder) {
    return <Text>{poster.placeholder}</Text>;
  }

  const fallback = posterState === "loading" ? "…" : initialsOf(title);
  return <Text color={placeholderColor}>{fallback}</Text>;
}
