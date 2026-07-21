// =============================================================================
// MediaPanel.tsx — renders a MediaPanelModel for Now Playing and Post-play
//
// One Sakura sectioned panel for every content kind (movie/series/anime/video):
//   poster → header (title + badge + secondary) → ── details ── facts
//          → ── synopsis ── → ── prev/up next ── mini-cards → progress
//
// Single named Kitty slot for the poster (placement registry); mini-card thumbnails
// use chafa MiniPosterTile. Empty poster/thumb slots show the ❀ petal placeholder rather
// than initials or blank space. Sections use light rose-dim ── label ── rules
// instead of one long left border.
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import type { MediaPanelFact, MediaPanelMiniCard, MediaPanelModel } from "./media-panel-model";
import { MiniPosterTile } from "./primitives/MiniPosterTile";
import { ProgressBar } from "./primitives/ProgressBar";
import { SakuraPetal } from "./primitives/SakuraPetal";
import { measureColumns, padColumnsEnd, truncateLine, wrapText } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

const SYNOPSIS_MAX_LINES = 3;
const FACT_LABEL_WIDTH = 8;

// ── Section divider (── label ──) ──────────────────────────────────────────

function SectionLabel({ label, width }: { readonly label: string; readonly width: number }) {
  const text = label.toLowerCase();
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
  url,
  width,
  active,
  placementSlot,
  allowKitty = true,
}: {
  readonly url?: string;
  readonly width: number;
  readonly active: boolean;
  readonly placementSlot: import("./kitty-placement-registry").KittyPlacementSlot;
  /** When false, render chafa inside Ink so a sibling owns the Kitty budget. */
  readonly allowKitty?: boolean;
}) {
  const innerCols = Math.max(10, width - 2);
  const useKitty = allowKitty;
  // When Kitty is denied for this panel, still bind the slot so disable/cleanup
  // releases any prior Kitty placement instead of ghosting under chafa.
  const { poster } = usePosterPreview(url, {
    rows: 12,
    cols: innerCols,
    enabled: Boolean(url),
    variant: "detail",
    debounceMs: 120,
    allowKitty: useKitty,
    inkEmbedded: !useKitty,
    preserveTerminalImages: false,
    placementSlot,
  });
  return (
    <Box width={width} minHeight={13} justifyContent="center" alignItems="center">
      {poster.kind !== "none" ? (
        <Text>{poster.placeholder}</Text>
      ) : (
        <SakuraPetal mode="placeholder" active={active} />
      )}
    </Box>
  );
}

// ── Facts (aligned label / value rows) ──────────────────────────────────────

function FactRows({
  facts,
  width,
}: {
  readonly facts: readonly MediaPanelFact[];
  readonly width: number;
}) {
  if (facts.length === 0) return null;
  const valueWidth = Math.max(6, width - FACT_LABEL_WIDTH - 1);
  return (
    <Box flexDirection="column">
      {facts.map((fact) => (
        <Box key={`${fact.label}:${fact.value}`} flexDirection="row" flexWrap="nowrap">
          <Text color={palette.muted}>
            {padColumnsEnd(truncateLine(fact.label, FACT_LABEL_WIDTH), FACT_LABEL_WIDTH)}{" "}
          </Text>
          <Text color={fact.tone === "success" ? palette.ok : palette.textDim}>
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
}: {
  readonly card: MediaPanelMiniCard;
  readonly title: string;
  readonly width: number;
  readonly active: boolean;
}) {
  const thumbCols = 8;
  const textWidth = Math.max(6, width - thumbCols - 3);
  const accent = card.kind === "resume" ? palette.accent : palette.text;
  return (
    <Box flexDirection="row" flexWrap="nowrap" marginTop={1}>
      <Box width={thumbCols} minHeight={3} justifyContent="center" alignItems="center">
        {card.thumbUrl ? (
          <MiniPosterTile url={card.thumbUrl} title={title} cols={thumbCols} rows={3} enabled />
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
}: {
  readonly model: MediaPanelModel;
  readonly railWidth: number;
  /** Viewport visibility — pauses petal animation when off-screen. */
  readonly active?: boolean;
  /** Required named slot — callers must pass postplay-rail / playing-rail explicitly. */
  readonly placementSlot: import("./kitty-placement-registry").KittyPlacementSlot;
  /** Prefer hero Kitty on post-play when next-up owns the primary slot. */
  readonly allowKitty?: boolean;
}) {
  const innerWidth = Math.max(12, railWidth - 3);
  const synopsisLines = model.synopsis
    ? wrapText(model.synopsis, innerWidth, SYNOPSIS_MAX_LINES)
    : [];

  return (
    <Box
      flexDirection="column"
      width={railWidth}
      paddingLeft={2}
      borderStyle="single"
      borderColor={palette.lineSoft}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
    >
      <PosterSlot
        url={model.posterUrl}
        width={innerWidth}
        active={active}
        placementSlot={placementSlot}
        allowKitty={allowKitty}
      />

      {/* Header: badge + title + secondary line */}
      <Box marginTop={1}>
        <Text color={palette.accent}>{`❀ ${model.kindBadge}`}</Text>
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

      {/* Prev / up next / resume mini-cards */}
      {model.miniCards.map((card) => (
        <React.Fragment key={card.kind}>
          <SectionLabel label={card.section} width={innerWidth} />
          <MiniCard card={card} title={model.title} width={innerWidth} active={active} />
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
