// =============================================================================
// post-play-shell.tsx — episode page + remote (Sakura canonical rebuild)
//
// Design authority: .design/cli/kunai-sakura-canonical.html §3 Post-play
// Two-column on wide (≥120): left = hero + action list + discovery cards
//                              right rail = poster slot + up-next card + facts
// Narrow/medium: rail collapses, all content in single column.
//
// All derivation lives in buildPostPlayView (post-play-view.ts) — this file
// is render-only. No inline component definitions; memo the shell.
// =============================================================================

import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { PostPlayState } from "@/domain/playback/post-play-state";
import { Box, Text } from "ink";
import React from "react";

import {
  buildPostPlayView,
  type PostPlayActionRow,
  type PostPlayDiscoveryCard,
  type PostPlayProgressBar,
  type PostPlayRailFact,
  type PostPlayUpNextCard,
  type PostPlayView,
} from "./post-play-view";
import { measureColumns, padColumnsEnd, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { PlaybackRecommendationRailItem } from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useViewportPolicy } from "./use-viewport-policy";

// ── Props ──────────────────────────────────────────────────────────────────────

export type PostPlayShellProps = {
  title: string;
  episodeLabel: string;
  nextEpisodeLabel?: string;
  queueNextLabel?: string;
  resumeLabel?: string;
  postPlayState: PostPlayState;
  recommendations?: readonly PlaybackRecommendationRailItem[];
  totalEpisodes?: number;
  watchedEpisodes?: number;
  currentSeason?: number;
  /** Optional poster URL — rendered wide-only in the rail artwork slot. */
  posterUrl?: string;
  /** Optional next-episode thumbnail; preferred over the series poster in the rail. */
  nextEpisodeThumbUrl?: string;
  /** Optional rich catalog metadata; surfaces what is present, never hangs on absent fields. */
  titleDetail?: TitleDetail;
  autoplayPaused?: boolean;
  autoskipPaused?: boolean;
  stopAfterCurrent?: boolean;
  /** Highlighted action row for keyboard navigation (↑/↓ or j/k). */
  selectedActionIndex?: number;
};

// ── Color mapping ─────────────────────────────────────────────────────────────

function heroColor(color: PostPlayView["heroColor"]): string {
  if (color === "accent") return palette.accent;
  if (color === "ok") return palette.ok;
  if (color === "milestone") return palette.milestone;
  return palette.dim;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressStrip({
  bar,
  width,
  color,
}: {
  readonly bar: PostPlayProgressBar;
  readonly width: number;
  readonly color: string;
}) {
  const filled = Math.floor((bar.percent / 100) * width);
  const empty = Math.max(0, width - filled);
  return (
    <Box marginTop={1} flexDirection="row" flexWrap="nowrap">
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={palette.dim}>{"░".repeat(empty)}</Text>
      <Text color={palette.muted}> {bar.label}</Text>
    </Box>
  );
}

// ── Action list ───────────────────────────────────────────────────────────────

function ActionRows({
  actions,
  width,
  selectedIndex = 0,
}: {
  readonly actions: readonly PostPlayActionRow[];
  readonly width: number;
  readonly selectedIndex?: number;
}) {
  const markerWidth = 2;
  const labelWidth = Math.min(18, Math.max(10, Math.floor(width * 0.32)));
  const shortcutWidth = Math.max(
    5,
    ...actions.map((action) => measureColumns(` [${action.shortcut}]`)),
  );
  const detailWidth = Math.max(0, width - markerWidth - labelWidth - shortcutWidth);
  const safeSelectedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, actions.length - 1));
  return (
    <Box flexDirection="column" marginTop={1}>
      {actions.map((action, idx) => {
        const isSelected = idx === safeSelectedIndex;
        const shortcut = padColumnsEnd(` [${action.shortcut}]`, shortcutWidth);
        const label = padColumnsEnd(truncateLine(action.label, labelWidth), labelWidth);
        return (
          <Box key={action.id} flexDirection="row" flexWrap="nowrap">
            <Text color={isSelected ? palette.accent : palette.dim}>
              {isSelected ? "▌ " : "  "}
            </Text>
            <Text color={isSelected ? palette.text : palette.textDim} bold={isSelected}>
              {label}
            </Text>
            {detailWidth > 0 ? (
              <Text color={palette.muted}>{truncateLine(action.detail, detailWidth)}</Text>
            ) : null}
            <Text color={isSelected ? palette.accent : palette.dim}>{shortcut}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Group label (discovery heading) ──────────────────────────────────────────

function GroupLabel({ label, width }: { readonly label: string; readonly width: number }) {
  const sideLen = Math.max(0, width - label.length - 2);
  const left = Math.floor(sideLen / 2);
  const right = Math.max(0, sideLen - left);
  return (
    <Box marginTop={1} marginBottom={0} flexDirection="row" flexWrap="nowrap">
      <Text color={palette.lineSoft}>{"─".repeat(left)}</Text>
      <Text color={palette.muted}> {label} </Text>
      <Text color={palette.lineSoft}>{"─".repeat(right)}</Text>
    </Box>
  );
}

// ── Discovery cards ───────────────────────────────────────────────────────────

// Text-mode mini-poster (chafa symbols inside Ink, not a Kitty placement), so
// many picks coexist with the single Kitty hero in the body. `preserveTerminalImages`
// keeps a pick render from wiping that hero.
function PickPoster({
  url,
  title,
  cols,
  rows,
}: {
  readonly url?: string;
  readonly title: string;
  readonly cols: number;
  readonly rows: number;
}) {
  const { poster } = usePosterPreview(url, {
    rows,
    cols,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{initialsOf(title)}</Text>;
}

function DiscoveryCard({
  card,
  width,
}: {
  readonly card: PostPlayDiscoveryCard;
  readonly width: number;
}) {
  const titleWidth = Math.max(8, width - 4);
  const reasonWidth = Math.max(4, width - 4);
  const posterCols = Math.max(8, width - 4);
  return (
    <Box
      borderStyle="single"
      borderColor={palette.lineSoft}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      width={width}
    >
      <Box minHeight={3} justifyContent="center" alignItems="center">
        <PickPoster url={card.posterUrl} title={card.title} cols={posterCols} rows={3} />
      </Box>
      <Text color={palette.accent} bold>
        {String(card.index)}
      </Text>
      <Text color={palette.text} bold>
        {truncateLine(card.title, titleWidth)}
      </Text>
      {card.reason ? (
        <Text color={palette.muted}>{truncateLine(card.reason, reasonWidth)}</Text>
      ) : null}
    </Box>
  );
}

function DiscoveryCards({
  cards,
  width,
  layout,
}: {
  readonly cards: readonly PostPlayDiscoveryCard[];
  readonly width: number;
  readonly layout: "list" | "cards";
}) {
  if (cards.length === 0) return null;
  if (layout === "cards") {
    const gap = 2;
    const cardWidth = Math.max(16, Math.floor((width - gap * (cards.length - 1)) / cards.length));
    return (
      <Box flexDirection="row" marginTop={1} flexWrap="nowrap">
        {cards.map((card, index) => (
          <Box key={card.id} marginRight={index === cards.length - 1 ? 0 : gap}>
            <DiscoveryCard card={card} width={cardWidth} />
          </Box>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {cards.map((card) => (
        <Box key={card.id} flexDirection="row" flexWrap="nowrap">
          <Box width={5}>
            <PickPoster url={card.posterUrl} title={card.title} cols={4} rows={2} />
          </Box>
          <Text color={palette.accent} bold>
            {String(card.index).padStart(1)}{" "}
          </Text>
          <Text color={palette.text} bold>
            {truncateLine(card.title, Math.max(8, width - 27))}
          </Text>
          {card.reason ? (
            <Text color={palette.dim}>
              {" "}
              · {truncateLine(card.reason, Math.max(4, width - measureColumns(card.title) - 11))}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

// ── Rail — poster slot + facts ─────────────────────────────────────────────────

function UpNextCard({
  card,
  width,
}: {
  readonly card: PostPlayUpNextCard;
  readonly width: number;
}) {
  const textWidth = Math.max(8, width - 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexWrap="nowrap">
        <Box
          borderStyle="single"
          borderColor={palette.lineSoft}
          paddingX={1}
          flexDirection="column"
          width={width}
        >
          <Text color={palette.text} bold>
            {truncateLine(card.label, textWidth)}
          </Text>
          <Text color={palette.muted}>{truncateLine(card.meta, textWidth)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function RailFacts({
  facts,
  width,
}: {
  readonly facts: readonly PostPlayRailFact[];
  readonly width: number;
}) {
  if (facts.length === 0) return null;
  const labelWidth = 10;
  const valueWidth = Math.max(8, width - labelWidth - 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      {facts.map((fact) => (
        <Box key={`${fact.label}:${fact.value}`} flexDirection="row" flexWrap="nowrap">
          <Text color={palette.muted}>{fact.label.padEnd(labelWidth).slice(0, labelWidth)} </Text>
          <Text color={fact.tone === "success" ? palette.ok : palette.textDim}>
            {truncateLine(fact.value, valueWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function RailLabel({ label }: { readonly label: string }) {
  return (
    <Box marginTop={1}>
      <Text color={palette.muted} bold>
        {label.toUpperCase()}
      </Text>
    </Box>
  );
}

// ── Rail artwork (wide-only; reserved height so metadata never jumps) ──────────

function initialsOf(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 3)
      .join("") || "?"
  );
}

// Renders the real terminal image (kitty or chafa text) for the next-episode
// thumbnail when available, falling back to the series poster, then to title
// initials. One image only — two simultaneous poster previews would clobber
// each other through the shared clearRenderedPosterImages() pass.
function RailArtwork({
  url,
  title,
  width,
}: {
  readonly url?: string;
  readonly title: string;
  readonly width: number;
}) {
  const innerCols = Math.max(8, width - 2);
  const { poster, posterState } = usePosterPreview(url, {
    rows: 5,
    cols: innerCols,
    enabled: Boolean(url),
    variant: "preview",
  });

  return (
    <Box width={width} minHeight={7} justifyContent="center" alignItems="center">
      {poster.kind !== "none" ? (
        <Text>{poster.placeholder}</Text>
      ) : (
        <Text color={palette.dim} bold>
          {posterState === "loading" ? "…" : initialsOf(title)}
        </Text>
      )}
    </Box>
  );
}

// ── Right rail ─────────────────────────────────────────────────────────────────

function PostPlayRail({
  view,
  title,
  railWidth,
  artworkUrl,
}: {
  readonly view: PostPlayView;
  readonly title: string;
  readonly railWidth: number;
  readonly artworkUrl?: string;
}) {
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
      {/* Artwork slot — next-episode thumbnail (or series poster) — always
          reserved to prevent layout jump on artwork load */}
      <RailArtwork url={artworkUrl} title={title} width={railWidth - 3} />

      {/* Up next card */}
      {view.upNext ? (
        <>
          <RailLabel label="Up next" />
          <UpNextCard card={view.upNext} width={railWidth - 3} />
        </>
      ) : null}

      {/* Season / series facts */}
      {view.railFacts.length > 0 ? (
        <>
          <RailLabel label="Details" />
          <RailFacts facts={view.railFacts} width={railWidth - 3} />
        </>
      ) : null}
    </Box>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────

const EMPTY_RECOMMENDATIONS: readonly PlaybackRecommendationRailItem[] = [];

export const PostPlayShell = React.memo(function PostPlayShell({
  title,
  episodeLabel,
  nextEpisodeLabel,
  queueNextLabel,
  resumeLabel,
  postPlayState,
  recommendations = EMPTY_RECOMMENDATIONS,
  totalEpisodes,
  watchedEpisodes,
  currentSeason,
  posterUrl,
  nextEpisodeThumbUrl,
  titleDetail,
  autoplayPaused,
  autoskipPaused,
  stopAfterCurrent,
  selectedActionIndex = 0,
}: PostPlayShellProps) {
  const viewport = useViewportPolicy("playback");
  const isWide = viewport.breakpoint === "wide";
  const isMedium = viewport.breakpoint === "medium";
  const showRail = isWide;
  const showDiscovery = !viewport.ultraCompact && (isWide || isMedium);

  // Rail occupies a fixed slice of wide columns; body gets the rest.
  const totalWidth = Math.max(60, viewport.columns - 2);
  const railWidth = isWide ? Math.min(36, Math.max(28, Math.floor(totalWidth * 0.27))) : 0;
  const bodyWidth = isWide
    ? Math.max(28, totalWidth - railWidth - 4)
    : Math.min(76, Math.max(28, totalWidth - 2));

  const view = buildPostPlayView({
    title,
    episodeLabel,
    nextEpisodeLabel,
    queueNextLabel,
    resumeLabel,
    postPlayState,
    recommendations,
    totalEpisodes,
    watchedEpisodes,
    currentSeason,
    titleDetail,
    autoplayPaused,
    autoskipPaused,
    stopAfterCurrent,
  });

  const hColor = heroColor(view.heroColor);
  const barWidth = Math.min(36, bodyWidth - 4);

  return (
    <Box flexDirection="row" paddingX={1}>
      {/* ── Left / body column ─────────────────────────────────────────── */}
      <Box flexDirection="column" width={bodyWidth}>
        {/* Title hero */}
        <Text color={palette.text} bold>
          {truncateLine(title, bodyWidth)}
        </Text>

        {/* Episode meta line */}
        {view.episodeMeta ? (
          <Text color={palette.muted}>{truncateLine(view.episodeMeta, bodyWidth)}</Text>
        ) : null}

        {/* Hero zone label */}
        <Box marginTop={1}>
          <Text color={hColor} bold>
            {view.heroLabel}
          </Text>
        </Box>

        {/* Hero sub (nextAirDate, series count, etc.) */}
        {view.heroSub ? (
          <Text color={palette.muted}>{truncateLine(view.heroSub, bodyWidth)}</Text>
        ) : null}

        {/* Progress bar */}
        {view.progressBar ? (
          <ProgressStrip bar={view.progressBar} width={barWidth} color={hColor} />
        ) : null}

        {/* Action rows */}
        <ActionRows actions={view.actions} width={bodyWidth} selectedIndex={selectedActionIndex} />

        {/* Discovery picks */}
        {showDiscovery && view.discovery.length > 0 ? (
          <>
            <GroupLabel label={view.discoveryHeading} width={bodyWidth} />
            <DiscoveryCards
              cards={view.discovery}
              width={bodyWidth}
              layout={isWide ? "cards" : "list"}
            />
          </>
        ) : null}

        {/* Narrow: name the picks inline (calm affordance, not a punitive wall). */}
        {!showDiscovery && recommendations.length > 0 ? (
          <Box marginTop={1}>
            <Text color={palette.dim}>
              {`+${recommendations.length} picks · `}
              {truncateLine(
                recommendations
                  .slice(0, 2)
                  .map((rec) => rec.title)
                  .join(" · "),
                bodyWidth - 14,
              )}
            </Text>
          </Box>
        ) : null}
      </Box>

      {/* ── Right rail (wide only) ─────────────────────────────────────── */}
      {showRail ? (
        <PostPlayRail
          view={view}
          title={title}
          railWidth={railWidth}
          artworkUrl={nextEpisodeThumbUrl ?? posterUrl}
        />
      ) : null}
    </Box>
  );
});
