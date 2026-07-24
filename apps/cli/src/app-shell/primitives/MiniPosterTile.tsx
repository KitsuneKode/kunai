import { Text } from "ink";
import React from "react";

import type { KittyPlacementSlot } from "../kitty-placement-registry";
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
 * Compact poster tile for list rows and cards.
 *
 * Default: chafa symbols inside Ink (`inkEmbedded`) so scrolling never claims
 * Kitty placements. Pass `allowKitty` + `placementSlot` for post-play discovery
 * multi-image Kitty budgets — then inkEmbedded is off and siblings coexist via
 * the placement registry.
 */
export function MiniPosterTile({
  url,
  title,
  enabled,
  rows = 2,
  cols = 4,
  debounceMs = 160,
  placeholderColor = palette.dim,
  allowKitty = false,
  placementSlot,
  square = false,
}: {
  readonly url?: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly rows?: number;
  readonly cols?: number;
  readonly debounceMs?: number;
  readonly placeholderColor?: string;
  /** When true with placementSlot, use Kitty-native instead of chafa. */
  readonly allowKitty?: boolean;
  readonly placementSlot?: KittyPlacementSlot;
  /** Prefer square aspect (channel avatars): cols ≈ rows. */
  readonly square?: boolean;
}) {
  const tileCols = square ? Math.max(2, Math.min(cols, rows + 1)) : cols;
  const tileRows = square ? Math.max(2, Math.min(rows, tileCols)) : rows;
  const useKitty = allowKitty && Boolean(placementSlot);
  const { poster } = usePosterPreview(url, {
    rows: tileRows,
    cols: tileCols,
    enabled: enabled && Boolean(url),
    variant: "preview",
    inkEmbedded: !useKitty,
    allowKitty: useKitty,
    preserveTerminalImages: !useKitty,
    placementSlot: useKitty ? placementSlot : undefined,
    debounceMs,
  });

  if (!url) {
    return <Text color={placeholderColor}>{initialsOf(title)}</Text>;
  }

  if (poster.kind !== "none" && poster.placeholder) {
    return <Text>{poster.placeholder}</Text>;
  }

  // Tiles never signal load state. A rail of these all flipping initials → "…" →
  // art on every ↑/↓ reads as noise, and the ellipsis is one cell where the
  // initials are two, so the row reflows on each transition. Initials hold the
  // slot until the image is ready; spinners belong to large single-poster
  // surfaces only (see usePosterPreview's spinner contract).
  return <Text color={placeholderColor}>{initialsOf(title)}</Text>;
}
