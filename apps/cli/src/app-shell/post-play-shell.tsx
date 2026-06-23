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
  type PostPlayNextUpHero,
  type PostPlayProgressBar,
  type PostPlayRailFact,
  type PostPlayUpNextCard,
  type PostPlayView,
} from "./post-play-view";
import { MiniPosterTile } from "./primitives/MiniPosterTile";
import { ViewportResizeGate } from "./shell-primitives";
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
  /** Live autoplay countdown seconds; when set, the hero shows "Playing in Ns". */
  autoNextCountdownSeconds?: number;
  /** Pre-formatted personal watch-time line for the series-complete celebration. */
  watchTimeSummary?: string;
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
        <MiniPosterTile
          url={card.posterUrl}
          title={card.title}
          cols={posterCols}
          rows={3}
          enabled
        />
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
            <MiniPosterTile url={card.posterUrl} title={card.title} cols={4} rows={2} enabled />
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
          <Text color={palette.muted}>
            {padColumnsEnd(truncateLine(fact.label, labelWidth), labelWidth)}{" "}
          </Text>
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

// ── Title initials fallback (shared by hero + pick posters) ────────────────────

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

// ── Next-Up hero (body centerpiece; holds the one Kitty image) ─────────────────

function NextUpHeroCard({
  hero,
  artworkUrl,
  title,
  width,
  countdownSeconds,
}: {
  readonly hero: PostPlayNextUpHero;
  readonly artworkUrl?: string;
  readonly title: string;
  readonly width: number;
  readonly countdownSeconds?: number;
}) {
  const innerWidth = Math.max(20, width - 4);
  const posterCols = 10;
  const textWidth = Math.max(8, innerWidth - posterCols - 2);
  const { poster, posterState } = usePosterPreview(artworkUrl, {
    rows: 4,
    cols: posterCols,
    enabled: Boolean(artworkUrl),
    variant: "preview",
  });
  const countdownLine =
    countdownSeconds && countdownSeconds > 0
      ? `Playing in ${countdownSeconds}s · ↵ now · x cancel`
      : hero.kind === "resume"
        ? "↵ resume · e episodes"
        : "↵ play · e episodes";
  return (
    <Box
      borderStyle="round"
      borderColor={palette.accent}
      flexDirection="column"
      width={width}
      paddingX={1}
      marginTop={1}
    >
      <Text color={palette.accent} bold>
        ▶ UP NEXT
      </Text>
      <Box flexDirection="row" marginTop={1}>
        <Box width={posterCols} minHeight={4} justifyContent="center" alignItems="center">
          {poster.kind !== "none" ? (
            <Text>{poster.placeholder}</Text>
          ) : (
            <Text color={palette.dim} bold>
              {posterState === "loading" ? "…" : initialsOf(title)}
            </Text>
          )}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={palette.text} bold>
            {truncateLine(hero.label, textWidth)}
          </Text>
          <Text color={palette.muted}>{truncateLine(hero.meta, textWidth)}</Text>
          <Text color={countdownSeconds ? palette.accent : palette.dim}>
            {truncateLine(countdownLine, textWidth)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── Right rail ─────────────────────────────────────────────────────────────────

function PostPlayRail({
  view,
  railWidth,
}: {
  readonly view: PostPlayView;
  readonly railWidth: number;
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
  autoNextCountdownSeconds,
  watchTimeSummary,
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
    watchTimeSummary,
  });

  const hColor = heroColor(view.heroColor);
  const barWidth = Math.min(36, bodyWidth - 4);

  return (
    <ViewportResizeGate kind="playback" message="Resize terminal to see post-play options">
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

          {/* Series-complete celebration replaces the generic hero label + sub:
            milestone banner + catalog stats + optional personal watch-time. */}
          {view.celebration ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={palette.milestone} bold>
                {view.heroLabel}
              </Text>
              <Text color={palette.muted}>
                {truncateLine(view.celebration.statLine, bodyWidth)}
              </Text>
              {view.celebration.watchTimeLine ? (
                <Text color={palette.ok}>
                  {truncateLine(view.celebration.watchTimeLine, bodyWidth)}
                </Text>
              ) : null}
            </Box>
          ) : (
            <>
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
            </>
          )}

          {/* Progress bar */}
          {view.progressBar ? (
            <ProgressStrip bar={view.progressBar} width={barWidth} color={hColor} />
          ) : null}

          {/* Next-Up hero — the centerpiece, holds the one Kitty image */}
          {view.nextUpHero ? (
            <NextUpHeroCard
              hero={view.nextUpHero}
              artworkUrl={nextEpisodeThumbUrl ?? posterUrl}
              title={title}
              width={bodyWidth}
              countdownSeconds={autoNextCountdownSeconds}
            />
          ) : null}

          {/* Action rows */}
          <ActionRows
            actions={view.actions}
            width={bodyWidth}
            selectedIndex={selectedActionIndex}
          />

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

          {/* Live-keys footer — discoverable, premium affordance */}
          <Box marginTop={1}>
            <Text color={palette.dim}>
              {truncateLine(
                [
                  "↑↓ move",
                  "↵ select",
                  recommendations.length > 0 ? "1·2·3 picks" : null,
                  view.nextUpHero ? "x cancel" : null,
                  "/ search",
                ]
                  .filter(Boolean)
                  .join("   ·   "),
                bodyWidth,
              )}
            </Text>
          </Box>
        </Box>

        {/* ── Right rail (wide only) ─────────────────────────────────────── */}
        {showRail ? <PostPlayRail view={view} railWidth={railWidth} /> : null}
      </Box>
    </ViewportResizeGate>
  );
});
