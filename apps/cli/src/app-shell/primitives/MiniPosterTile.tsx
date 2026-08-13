import { Text } from "ink";
import React from "react";

import type { KittyPlacementSlot } from "../kitty-placement-registry";
import { palette } from "../shell-theme";
import { PosterOutput } from "../SixelPosterPane";
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
 * / episode mini-card budgets — then inkEmbedded is off and siblings coexist via
 * the placement registry. On sixel terminals the same path yields measured
 * overlays (Windows Terminal), matching the rail/hero graphics path.
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
  allowSixel = true,
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
  /** When true with placementSlot, use Kitty/Sixel instead of half-block text. */
  readonly allowKitty?: boolean;
  /** Permit measured Sixel overlays when the terminal is sixel-capable. */
  readonly allowSixel?: boolean;
  readonly placementSlot?: KittyPlacementSlot;
  /** Prefer square aspect (channel avatars): cols ≈ rows. */
  readonly square?: boolean;
}) {
  const tileCols = square ? Math.max(2, Math.min(cols, rows + 1)) : cols;
  const tileRows = square ? Math.max(2, Math.min(rows, tileCols)) : rows;
  // allowKitty gates the framebuffer path (Kitty *or* Sixel) in renderPoster.
  const useGraphics = allowKitty && Boolean(placementSlot);
  const { poster } = usePosterPreview(url, {
    rows: tileRows,
    cols: tileCols,
    enabled: enabled && Boolean(url),
    variant: "preview",
    inkEmbedded: !useGraphics,
    allowKitty: useGraphics,
    allowSixel: useGraphics && allowSixel,
    preserveTerminalImages: !useGraphics,
    placementSlot: useGraphics ? placementSlot : undefined,
    debounceMs,
  });

  if (!url) {
    return <Text color={placeholderColor}>{initialsOf(title)}</Text>;
  }

  if (poster.kind !== "none") {
    return <PosterOutput poster={poster} />;
  }

  // Tiles never signal load state. A rail of these all flipping initials → "…" →
  // art on every ↑/↓ reads as noise, and the ellipsis is one cell where the
  // initials are two, so the row reflows on each transition. Initials hold the
  // slot until the image is ready; spinners belong to large single-poster
  // surfaces only (see usePosterPreview's spinner contract).
  return <Text color={placeholderColor}>{initialsOf(title)}</Text>;
}
