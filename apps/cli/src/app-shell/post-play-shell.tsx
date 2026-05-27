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
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { PlaybackRecommendationRailItem } from "./types";
import { useViewportPolicy } from "./use-viewport-policy";

// ── Props ──────────────────────────────────────────────────────────────────────

export type PostPlayShellProps = {
  title: string;
  episodeLabel: string;
  nextEpisodeLabel?: string;
  resumeLabel?: string;
  postPlayState: PostPlayState;
  recommendations?: readonly PlaybackRecommendationRailItem[];
  totalEpisodes?: number;
  watchedEpisodes?: number;
  currentSeason?: number;
  /** Optional poster URL — rendered wide-only as a reserved placeholder slot. */
  posterUrl?: string;
  /** Optional rich catalog metadata; surfaces what is present, never hangs on absent fields. */
  titleDetail?: TitleDetail;
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
}: {
  readonly actions: readonly PostPlayActionRow[];
  readonly width: number;
}) {
  const detailWidth = Math.max(10, width - 28);
  return (
    <Box flexDirection="column" marginTop={1}>
      {actions.map((action, idx) => {
        const isPrimary = idx === 0;
        return (
          <Box key={action.id} flexDirection="row" flexWrap="nowrap">
            <Text color={isPrimary ? palette.accent : palette.dim}>{isPrimary ? "▌ " : "  "}</Text>
            <Text color={isPrimary ? palette.text : palette.textDim} bold={isPrimary}>
              {action.label.padEnd(18).slice(0, 18)}
            </Text>
            <Text color={palette.muted}>{truncateLine(action.detail, detailWidth)}</Text>
            <Text color={isPrimary ? palette.accent : palette.dim}> {action.shortcut}</Text>
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

function DiscoveryCards({
  cards,
  width,
}: {
  readonly cards: readonly PostPlayDiscoveryCard[];
  readonly width: number;
}) {
  if (cards.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {cards.map((card) => (
        <Box key={card.id} flexDirection="row" flexWrap="nowrap">
          <Text color={palette.accent} bold>
            {String(card.index).padStart(1)}{" "}
          </Text>
          <Text color={palette.text} bold>
            {truncateLine(card.title, Math.max(8, width - 22))}
          </Text>
          {card.reason ? (
            <Text color={palette.dim}>
              {" "}
              · {truncateLine(card.reason, Math.max(4, width - card.title.length - 6))}
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

// ── Poster placeholder slot (wide-only; reserved even when no image) ───────────

function PosterSlot({ title, width }: { readonly title: string; readonly width: number }) {
  // Width ~28–36 cols; height ~7 rows to reserve space and prevent metadata jump.
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 3)
    .join("");

  return (
    <Box
      width={width}
      minHeight={7}
      justifyContent="center"
      alignItems="center"
      borderStyle="single"
      borderColor={palette.lineSoft}
    >
      <Text color={palette.dim} bold>
        {initials || "?"}
      </Text>
    </Box>
  );
}

// ── Right rail ─────────────────────────────────────────────────────────────────

function PostPlayRail({
  view,
  title,
  railWidth,
}: {
  readonly view: PostPlayView;
  readonly title: string;
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
      {/* Poster slot — always reserved to prevent layout jump on artwork load */}
      <PosterSlot title={title} width={railWidth - 3} />

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

export const PostPlayShell = React.memo(function PostPlayShell({
  title,
  episodeLabel,
  nextEpisodeLabel,
  resumeLabel,
  postPlayState,
  recommendations = [],
  totalEpisodes,
  watchedEpisodes,
  currentSeason,
  posterUrl: _posterUrl,
  titleDetail,
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
    resumeLabel,
    postPlayState,
    recommendations,
    totalEpisodes,
    watchedEpisodes,
    currentSeason,
    titleDetail,
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
        <ActionRows actions={view.actions} width={bodyWidth} />

        {/* Discovery picks */}
        {showDiscovery && view.discovery.length > 0 ? (
          <>
            <GroupLabel label={view.discoveryHeading} width={bodyWidth} />
            <DiscoveryCards cards={view.discovery} width={bodyWidth} />
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

      {/* ── Right rail (wide only; not on did-not-start — that state stays calm) ── */}
      {showRail && view.heroKind !== "did-not-start" ? (
        <PostPlayRail view={view} title={title} railWidth={railWidth} />
      ) : null}
    </Box>
  );
});
