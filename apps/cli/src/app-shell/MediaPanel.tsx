// Renders a MediaPanelModel for Now Playing and Post-play
//
// One Sakura sectioned panel for every content kind (movie/series/anime/video):
//   poster → header (title + badge + secondary) → ── details ── facts
//          → ── synopsis ── → ── prev/up next ── mini-cards → progress
//
// Named Kitty/Sixel slots for the primary poster plus prev/next mini-cards on
// post-play (and up-next during Now Playing). An empty poster is the framed
// initial tile from the details sheet, at a fixed height, never a petal
// floating in blank rail space. Sections use light rose-dim ── label ── rules
// instead of one long left border.

import { Box, Text } from "ink";
import React from "react";

import type { KittyPlacementSlot } from "./kitty-placement-registry";
import type { MediaPanelFact, MediaPanelMiniCard, MediaPanelModel } from "./media-panel-model";
import { plainBorderStyle, plainModeEnabled } from "./plain-mode";
import { PosterInitialBlock } from "./poster-initial-block";
import { MiniPosterTile } from "./primitives/MiniPosterTile";
import { ProgressBar } from "./primitives/ProgressBar";
import { SakuraPetal } from "./primitives/SakuraPetal";
import { measureColumns, padColumnsEnd, truncateLine, wrapText } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import { PosterOutput } from "./SixelPosterPane";
import { usePosterPreview } from "./use-poster-preview";
import { useShellDimensions } from "./use-viewport-policy";

const SYNOPSIS_MAX_LINES = 3;
const FACT_LABEL_WIDTH = 8;
/** Fixed poster tile. Below this terminal width the tile drops so text keeps the row. */
const POSTER_TILE_ROWS = 8;
const POSTER_TILE_COLS = 14;
const POSTER_TILE_MIN_COLUMNS = 48;
/** Episode stills: wide enough for Kitty/Sixel detail without crowding the rail text. */
const MINI_CARD_THUMB_COLS = 12;
const MINI_CARD_THUMB_ROWS = 5;

function miniCardPlacementSlot(
  card: MediaPanelMiniCard,
  panelSlot: KittyPlacementSlot,
): KittyPlacementSlot | undefined {
  if (panelSlot === "postplay-rail") {
    if (card.kind === "prev") return "postplay-prev";
    if (card.kind === "next") return "postplay-next";
    return undefined;
  }
  if (panelSlot === "playing-rail" && card.kind === "next") {
    return "playing-next";
  }
  return undefined;
}

// ── Section divider (── label ──) ──────────────────────────────────────────

function SectionLabel({ label, width }: { readonly label: string; readonly width: number }) {
  const text = label.toLowerCase();
  if (plainModeEnabled()) {
    return (
      <Box marginTop={1}>
        <Text color={palette.text} bold>
          {text.toUpperCase()}
        </Text>
      </Box>
    );
  }
  const sideLen = Math.max(0, width - measureColumns(text) - 2);
  const left = Math.min(2, sideLen);
  const right = Math.max(0, sideLen - left);
  return (
    <Box marginTop={1} flexDirection="row" flexWrap="nowrap">
      <Text color={palette.lineSoft}>{"─".repeat(left)}</Text>
      <Text color={palette.muted}> {text} </Text>
      <Text color={palette.lineSoft}>{"─".repeat(right)}</Text>
    </Box>
  );
}

// ── Poster slot (the single Kitty image budget) ────────────────────────────

function PosterSlot({
  title,
  url,
  width,
  placementSlot,
  allowKitty = true,
  allowSixel = true,
}: {
  readonly title: string;
  readonly url?: string;
  readonly width: number;
  readonly placementSlot: import("./kitty-placement-registry").KittyPlacementSlot;
  /** When false, render text inside Ink so a sibling owns the Kitty budget. */
  readonly allowKitty?: boolean;
  /** Allow the measured Sixel overlay; unchanged frames are deduplicated by its manager. */
  readonly allowSixel?: boolean;
}) {
  const { cols } = useShellDimensions();
  const tileCols = Math.min(POSTER_TILE_COLS, Math.max(8, width));
  const useKitty = allowKitty;
  // When Kitty is denied for this panel, still bind the slot so disable/cleanup
  // releases any prior Kitty placement instead of ghosting under chafa.
  const { poster } = usePosterPreview(url, {
    rows: POSTER_TILE_ROWS,
    cols: tileCols,
    enabled: Boolean(url) && cols >= POSTER_TILE_MIN_COLUMNS,
    variant: "detail",
    debounceMs: 120,
    allowKitty: useKitty,
    allowSixel,
    inkEmbedded: !useKitty,
    preserveTerminalImages: false,
    placementSlot,
  });
  if (cols < POSTER_TILE_MIN_COLUMNS) return null;
  if (poster.kind !== "none") {
    return (
      <Box width={width} height={POSTER_TILE_ROWS} justifyContent="center" alignItems="center">
        <PosterOutput
          poster={poster}
          // Playback stats render every second. The pane itself still
          // repaints when it commits, but unrelated timer frames must not resend
          // a large Sixel payload and make Windows Terminal blink.
          repaintAfterInkRender={placementSlot !== "playing-rail"}
        />
      </Box>
    );
  }
  return (
    <Box width={width} flexDirection="row" justifyContent="center">
      <PosterInitialBlock title={title} width={tileCols} height={POSTER_TILE_ROWS} />
    </Box>
  );
}

// ── Facts (aligned label / value rows) ──────────────────────────────────────

/** Spoken fact line. The model stores the visual glyphs; plain mode does not. */
function plainFactLine(fact: MediaPanelFact): string {
  if (fact.label === "♥" || (fact.label === "favourite" && fact.value === "favourite")) {
    return "favourite: yes";
  }
  if (fact.label === "score") {
    return `score: ${fact.value.replace(/^★\s*/u, "")}`;
  }
  if (fact.label === "live") {
    if (fact.value.includes("upcoming")) return "[upcoming]";
    if (fact.value.includes("was live")) return "[was live]";
    return "[live]";
  }
  return `${fact.label}: ${fact.value}`;
}

function FactRows({
  facts,
  width,
}: {
  readonly facts: readonly MediaPanelFact[];
  readonly width: number;
}) {
  if (facts.length === 0) return null;
  if (plainModeEnabled()) {
    return (
      <Box flexDirection="column">
        {facts.map((fact) => (
          <Text
            key={`${fact.label}:${fact.value}`}
            color={fact.tone ? statusColor(fact.tone) : palette.text}
          >
            {plainFactLine(fact)}
          </Text>
        ))}
      </Box>
    );
  }
  const valueWidth = Math.max(6, width - FACT_LABEL_WIDTH - 1);
  return (
    <Box flexDirection="column">
      {facts.map((fact) => (
        <Box key={`${fact.label}:${fact.value}`} flexDirection="row" flexWrap="nowrap">
          <Text color={palette.muted}>
            {padColumnsEnd(truncateLine(fact.label, FACT_LABEL_WIDTH), FACT_LABEL_WIDTH)}{" "}
          </Text>
          <Text color={fact.tone ? statusColor(fact.tone) : palette.textDim}>
            {truncateLine(fact.value, valueWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Mini-card (prev / up next / resume) ─────────────────────────────────────

function MiniCard({
  card,
  title,
  width,
  active,
  allowKitty,
  allowSixel,
  placementSlot,
}: {
  readonly card: MediaPanelMiniCard;
  readonly title: string;
  readonly width: number;
  readonly active: boolean;
  readonly allowKitty: boolean;
  readonly allowSixel: boolean;
  readonly placementSlot?: KittyPlacementSlot;
}) {
  const accent = card.kind === "resume" ? palette.accent : palette.text;
  if (plainModeEnabled()) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={accent} bold>
          {truncateLine(card.label, width)}
        </Text>
        {card.meta ? <Text color={palette.muted}>{truncateLine(card.meta, width)}</Text> : null}
      </Box>
    );
  }
  const thumbCols = Math.min(MINI_CARD_THUMB_COLS, Math.max(8, width - 10));
  const textWidth = Math.max(6, width - thumbCols - 3);
  const useGraphics = allowKitty && Boolean(placementSlot);
  return (
    <Box flexDirection="row" flexWrap="nowrap" marginTop={1}>
      <Box
        width={thumbCols}
        minHeight={useGraphics ? MINI_CARD_THUMB_ROWS : 3}
        justifyContent="center"
        alignItems="center"
      >
        {card.thumbUrl ? (
          <MiniPosterTile
            url={card.thumbUrl}
            title={title}
            cols={thumbCols}
            rows={useGraphics ? MINI_CARD_THUMB_ROWS : 3}
            enabled
            allowKitty={useGraphics}
            allowSixel={allowSixel}
            placementSlot={placementSlot}
          />
        ) : (
          <SakuraPetal mode="placeholder" active={active} bold={false} />
        )}
      </Box>
      <Box flexDirection="column" marginLeft={1}>
        <Text color={accent} bold>
          {truncateLine(card.label, textWidth)}
        </Text>
        {card.meta ? <Text color={palette.muted}>{truncateLine(card.meta, textWidth)}</Text> : null}
      </Box>
    </Box>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export const MediaPanel = React.memo(function MediaPanel({
  model,
  railWidth,
  active = true,
  placementSlot,
  allowKitty = true,
  allowSixel = true,
}: {
  readonly model: MediaPanelModel;
  readonly railWidth: number;
  /** Viewport visibility — pauses petal animation when off-screen. */
  readonly active?: boolean;
  /** Required named slot — callers must pass postplay-rail / playing-rail explicitly. */
  readonly placementSlot: import("./kitty-placement-registry").KittyPlacementSlot;
  /** Prefer hero Kitty on post-play when next-up owns the primary slot. */
  readonly allowKitty?: boolean;
  /** Permit framebuffer Sixel output. Keep false on high-frequency surfaces. */
  readonly allowSixel?: boolean;
}) {
  const plain = plainModeEnabled();
  const innerWidth = Math.max(12, railWidth - (plain ? 0 : 3));
  const synopsisLines = model.synopsis
    ? wrapText(model.synopsis, innerWidth, SYNOPSIS_MAX_LINES)
    : [];

  return (
    <Box
      flexDirection="column"
      width={plain ? undefined : railWidth}
      paddingLeft={plain ? 0 : 2}
      borderStyle={plainBorderStyle("single", plain)}
      borderColor={plain ? undefined : palette.lineSoft}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
    >
      {plain ? null : (
        <PosterSlot
          title={model.title}
          url={model.posterUrl}
          width={innerWidth}
          placementSlot={placementSlot}
          allowKitty={allowKitty}
          allowSixel={allowSixel}
        />
      )}

      {/* Header: badge + title + secondary line */}
      <Box marginTop={1}>
        <Text color={palette.accent}>{plain ? model.kindBadge : `❀ ${model.kindBadge}`}</Text>
      </Box>
      <Text color={palette.text} bold>
        {truncateLine(model.title, innerWidth)}
      </Text>
      {model.secondary ? (
        <Text color={palette.muted}>{truncateLine(model.secondary, innerWidth)}</Text>
      ) : null}

      {/* Details facts */}
      {model.facts.length > 0 ? (
        <>
          <SectionLabel label="details" width={innerWidth} />
          <FactRows facts={model.facts} width={innerWidth} />
        </>
      ) : null}

      {/* Synopsis (clamped) */}
      {synopsisLines.length > 0 ? (
        <>
          <SectionLabel label="synopsis" width={innerWidth} />
          <Box flexDirection="column">
            {synopsisLines.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key -- clamped, stable order
              <Text key={`syn-${index}`} color={palette.textDim}>
                {line}
              </Text>
            ))}
          </Box>
        </>
      ) : null}

      {/* Prev / up next / resume mini-cards — Kitty/Sixel when slotted */}
      {model.miniCards.map((card) => (
        <React.Fragment key={card.kind}>
          <SectionLabel label={card.section} width={innerWidth} />
          <MiniCard
            card={card}
            title={model.title}
            width={innerWidth}
            active={active}
            allowKitty={allowKitty}
            allowSixel={allowSixel}
            placementSlot={miniCardPlacementSlot(card, placementSlot)}
          />
        </React.Fragment>
      ))}

      {/* Progress */}
      {model.progress ? (
        <Box marginTop={1} flexDirection="row" flexWrap="nowrap">
          <ProgressBar
            value={model.progress.percent}
            max={100}
            width={Math.max(8, innerWidth - measureColumns(model.progress.label) - 1)}
            color={palette.accent}
          />
          <Text color={palette.muted}> {model.progress.label}</Text>
        </Box>
      ) : null}
    </Box>
  );
});
