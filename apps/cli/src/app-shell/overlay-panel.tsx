import { Box, Text } from "ink";
import React from "react";

import { DetailsSheetUI } from "./details-pane-ui";
import type { DetailsPanelData } from "./details-panel";
import { DetailsSheet } from "./details-sheet-ui";
import type { DetailsSheetModel } from "./details-sheet.model";
import { useSettledValue } from "./hooks/use-settled-value";
import { useIsInsideOverlay } from "./overlay-layout-context";
import { PickerOptionRow } from "./overlay-picker-row";
import { PosterInitialBlock } from "./poster-initial-block";
import type { PosterResult } from "./poster-types";
import { LoadingState } from "./primitives/LoadingState";
import { SakuraPetal } from "./primitives/SakuraPetal";
import {
  getWindowStart,
  padColumnsEnd,
  truncateAtWord,
  truncateLine,
  wrapText,
} from "./shell-text";
import { palette, semanticToneColor, statusColor } from "./shell-theme";
import type { ShellPanelLine, ShellPickerOption } from "./types";
import { usePosterPreview } from "./use-poster-preview";

export { formatPickerDisplayRow, formatPickerOptionRow } from "./overlay-picker-row.model";

const HistoryProgressBar = React.memo(function HistoryProgressBar({
  percentage,
}: {
  readonly percentage: number;
}) {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;

  return <>[{`${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}`}]</>;
});

export type BrowseOverlay =
  | {
      type: "help" | "about" | "diagnostics" | "history" | "details";
      title: string;
      subtitle: string;
      lines: readonly ShellPanelLine[];
      detailData?: DetailsPanelData;
      /** Rich details sheet model — preferred over detailData when present. */
      sheet?: DetailsSheetModel;
      seasonsExpanded?: boolean;
      imageUrl?: string;
      loading?: boolean;
      scrollIndex?: number;
    }
  | {
      type: "provider" | "history-picker";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
      filterMode?: "all" | "watching" | "completed";
    }
  | {
      type: "episode-picker";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
    };

export function getOverlayPickerPreviewImageUrl(overlay: BrowseOverlay): string | undefined {
  if (overlay.type !== "episode-picker") return undefined;
  return overlay.options[overlay.selectedIndex]?.previewImageUrl;
}

function resolvePanelTone(tone: ShellPanelLine["tone"]): string {
  return statusColor(tone ?? "neutral");
}

// Right-hand preview rail for the episode picker. The poster slot is height-
// reserved so the metadata below it never jumps when artwork resolves (spec:
// episode-season-picker.md). Falls back to a quiet placeholder before/without art.
/** Shared "no poster" sentinel so suppression doesn't allocate a new object per render. */
const POSTER_NONE: PosterResult = { kind: "none" };

const EpisodePreviewRail = React.memo(function EpisodePreviewRail({
  poster,
  spinner,
  option,
  width,
}: {
  poster: PosterResult;
  /** Cache-missed and pending past the threshold — see usePosterPreview. */
  spinner: boolean;
  option: ShellPickerOption<string> | undefined;
  width: number;
}) {
  const badgeColor = semanticToneColor(option?.tone);
  return (
    <Box flexDirection="column" width={width} marginLeft={2} flexShrink={0}>
      <Box height={6} width={width}>
        {poster.kind !== "none" ? (
          <Text>{poster.placeholder}</Text>
        ) : spinner ? (
          <SakuraPetal mode="loading" />
        ) : (
          <Text color={palette.dim} dimColor>
            no preview art
          </Text>
        )}
      </Box>
      {option ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.text} bold>
            {truncateAtWord(option.label, Math.max(8, width))}
          </Text>
          {option.badge ? <Text color={badgeColor}>{option.badge}</Text> : null}
          {option.previewBody ? (
            <Text color={palette.dim}>
              {truncateAtWord(option.previewBody, Math.max(8, width * 2))}
            </Text>
          ) : null}
          {option.detail ? (
            <Text color={palette.dim}>{truncateAtWord(option.detail, Math.max(8, width))}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});

export function OverlayPanel({
  overlay,
  width,
  maxLinesOverride,
}: {
  overlay: BrowseOverlay;
  width: number;
  maxLinesOverride?: number;
}) {
  const insideOverlay = useIsInsideOverlay();
  const contentWidth = Math.max(24, width - 4);
  const maxLines = maxLinesOverride ?? (overlay.type === "episode-picker" ? 8 : 6);
  const isPickerOverlay =
    overlay.type === "provider" ||
    overlay.type === "history-picker" ||
    overlay.type === "episode-picker";
  const isLineOverlay =
    overlay.type === "help" ||
    overlay.type === "about" ||
    overlay.type === "diagnostics" ||
    overlay.type === "history" ||
    overlay.type === "details";
  const optionWindowStart = isPickerOverlay
    ? getWindowStart(overlay.selectedIndex, overlay.options.length, maxLines)
    : 0;
  const optionWindowEnd = optionWindowStart + maxLines;
  const visibleOptions = isPickerOverlay
    ? overlay.options.slice(optionWindowStart, optionWindowEnd)
    : [];
  const pickerAccent = palette.accent;
  const pickerBusyMessage =
    overlay.type === "provider"
      ? "Updating provider…"
      : overlay.type === "history-picker"
        ? "Loading history…"
        : "Saving settings…";
  const pickerPreviewImageUrl = getOverlayPickerPreviewImageUrl(overlay);
  // Gate the poster pipeline on the settled selection so holding ↑/↓ through the
  // episode list never spawns a chafa/Kitty subprocess mid-navigation.
  const settledPickerImageUrl = useSettledValue(pickerPreviewImageUrl);
  const pickerNavigating = pickerPreviewImageUrl !== settledPickerImageUrl;
  const { poster: pickerPoster, spinner: pickerSpinner } = usePosterPreview(settledPickerImageUrl, {
    rows: 6,
    cols: 16,
    enabled: overlay.type === "episode-picker" && Boolean(settledPickerImageUrl),
    // `settledPickerImageUrl` already absorbs the navigation burst.
    debounceMs: 16,
    placementSlot: "overlay-picker",
  });
  // Suppress the heavy chafa block while navigating; Kitty (out-of-band) stays.
  const pickerPosterSuppressed = pickerNavigating && pickerPoster.kind === "text";
  // Two-pane episode picker: dense list (left) + anchored preview rail (right).
  // The rail hides first on narrow terminals (spec: responsive). When shown it
  // takes a fixed column so the list width — and every row — stays stable.
  const railColumnWidth = 20;
  const showPreviewRail = overlay.type === "episode-picker" && contentWidth >= 56;
  const listContentWidth = showPreviewRail
    ? Math.max(18, contentWidth - railColumnWidth - 2)
    : contentWidth;

  return (
    <Box marginTop={insideOverlay ? 0 : 1} flexDirection="column" paddingX={insideOverlay ? 0 : 1}>
      {insideOverlay ? null : (
        <>
          <Text color={palette.text} bold>
            {overlay.title}
          </Text>
          <Text color={palette.dim}>{overlay.subtitle}</Text>
        </>
      )}
      {isPickerOverlay ? (
        <>
          <Box marginTop={1}>
            {overlay.filterQuery.length > 0 ? (
              <>
                <Text color={pickerAccent}>Filter: </Text>
                <Text color={palette.text} bold>
                  {overlay.filterQuery}
                </Text>
              </>
            ) : overlay.type === "history-picker" && overlay.filterMode ? (
              <Box flexDirection="row">
                {(["all", "watching", "completed"] as const).map((mode) => {
                  const active = overlay.filterMode === mode;
                  return (
                    <Box key={mode} marginRight={3} flexDirection="column">
                      <Text color={active ? palette.accent : palette.muted}>{mode}</Text>
                      {active ? (
                        <Text color={palette.accent}>{"─".repeat(mode.length)}</Text>
                      ) : null}
                    </Box>
                  );
                })}
                <Text color={palette.dim} dimColor>
                  Tab cycle
                </Text>
              </Box>
            ) : (
              <Text color={palette.dim}>
                {overlay.type === "provider"
                  ? "Type to narrow providers"
                  : overlay.type === "history-picker"
                    ? "Type to narrow history (or filter by 'completed', 'watching')"
                    : overlay.type === "episode-picker"
                      ? "Type to narrow episodes"
                      : "Type to narrow this list"}
              </Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="row">
            <Box flexDirection="column" flexGrow={1}>
              {optionWindowStart > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
              {visibleOptions.map((option, index) => {
                const optionIndex = optionWindowStart + index;
                const selected = optionIndex === overlay.selectedIndex;
                // Section separator — render as a non-selectable group header
                if (typeof option.value === "string" && option.value.startsWith("section:")) {
                  const isHistory = overlay.type === "history-picker";
                  const headerLabel = option.label.toUpperCase();
                  const usesAccent = isHistory;
                  return (
                    <Box key={`section-${option.value}`} marginTop={1} flexDirection="column">
                      <Text color={usesAccent ? palette.text : palette.dim} bold={usesAccent}>
                        {headerLabel}
                      </Text>
                      {usesAccent ? (
                        <Text color={palette.accent}>{"─".repeat(headerLabel.length)}</Text>
                      ) : null}
                    </Box>
                  );
                }
                const rowAccentColor =
                  option.tone === "success"
                    ? palette.ok
                    : option.tone === "warning"
                      ? semanticToneColor("warning")
                      : option.tone === "info"
                        ? semanticToneColor("info")
                        : option.tone === "error"
                          ? palette.danger
                          : null;
                // Treatment C: selection is shown by a single accent bar (rendered by
                // PickerOptionRow) + the elevated surface, not per-row ✓/▶/○ marker soup.
                // Watched/current/resume state is carried by row tone + trailing badge + detail.
                // Derive dot indicator for settings rows
                const effectiveLabel = option.label;
                const isHistoryPicker = overlay.type === "history-picker";
                const historyPosterWidth = 4;
                const prefixWidth =
                  isHistoryPicker && option.posterTitle ? historyPosterWidth + 1 : 0;
                const historyRowWidth = Math.max(0, listContentWidth - prefixWidth);
                return (
                  <Box
                    key={`${option.value}-${optionIndex}`}
                    backgroundColor={selected ? palette.accentFill : undefined}
                    flexDirection="row"
                  >
                    {isHistoryPicker && option.posterTitle ? (
                      <Box marginRight={1}>
                        <PosterInitialBlock
                          title={option.posterTitle}
                          width={historyPosterWidth}
                          height={3}
                        />
                      </Box>
                    ) : null}
                    <Box flexDirection="column" flexGrow={1}>
                      <Text bold={selected} wrap="truncate-end">
                        <PickerOptionRow
                          label={effectiveLabel}
                          detail={option.detail}
                          badge={option.badge}
                          width={historyRowWidth}
                          selected={selected}
                          accentColor={rowAccentColor}
                          pickerAccent={pickerAccent}
                          labelColor={option.tone === "error" ? palette.danger : undefined}
                        />
                      </Text>
                      {isHistoryPicker && option.historyProgress ? (
                        <Text
                          color={option.historyProgress.completed ? palette.ok : palette.accent}
                        >
                          <HistoryProgressBar percentage={option.historyProgress.percentage} />
                          {`  ${option.historyProgress.percentage}%`}
                        </Text>
                      ) : null}
                    </Box>
                  </Box>
                );
              })}
              {optionWindowEnd < overlay.options.length ? (
                <Text color={palette.dim}> ▼ ...</Text>
              ) : null}
            </Box>
            {showPreviewRail ? (
              <EpisodePreviewRail
                poster={pickerPosterSuppressed ? POSTER_NONE : pickerPoster}
                spinner={pickerSpinner && !pickerNavigating}
                option={overlay.options[overlay.selectedIndex]}
                width={railColumnWidth}
              />
            ) : null}
          </Box>
          {overlay.busy || overlay.type !== "episode-picker" ? (
            overlay.busy ? (
              <LoadingState message={pickerBusyMessage} framed />
            ) : (
              <Box marginTop={1}>
                <Text color={palette.dim}>
                  {`${overlay.options.length} items  ·  ↑↓ choose · Enter select · Esc close`}
                </Text>
              </Box>
            )
          ) : null}
        </>
      ) : isLineOverlay && overlay.loading ? (
        <LoadingState message="Loading panel…" framed />
      ) : overlay.type === "details" && overlay.sheet ? (
        <Box marginTop={1} flexDirection="column">
          <DetailsSheet
            model={overlay.sheet}
            seasonsExpanded={overlay.seasonsExpanded ?? false}
            width={contentWidth}
          />
        </Box>
      ) : overlay.type === "details" && overlay.detailData ? (
        <Box marginTop={1} flexDirection="column">
          <DetailsSheetUI
            data={overlay.detailData}
            lines={overlay.lines}
            width={contentWidth}
            scrollIndex={overlay.scrollIndex ?? 0}
            maxVisibleLines={Math.max(10, maxLinesOverride ?? 18)}
          />
          <Box marginTop={1}>
            <Text color={palette.dim}>↑↓ scroll · Enter play · / commands · Esc close</Text>
          </Box>
        </Box>
      ) : isLineOverlay ? (
        <Box marginTop={1} flexDirection="column">
          {overlay.lines
            .slice(overlay.scrollIndex ?? 0, (overlay.scrollIndex ?? 0) + maxLines)
            .map((line: ShellPanelLine) => {
              const isHeader = !line.detail && line.label.startsWith("───");
              if (isHeader) {
                // Section rule — small top gap for grouping, no per-line blank lines.
                return (
                  <Box key={`${line.label}-h`} marginTop={1}>
                    <Text color={palette.muted}>{truncateLine(line.label, contentWidth)}</Text>
                  </Box>
                );
              }
              const labelWidth = Math.min(16, Math.max(8, Math.floor(contentWidth * 0.26)));
              const detailLines = line.detail
                ? wrapText(line.detail, contentWidth - labelWidth - 1, 6)
                : [];
              // Short fact → inline "label  value"; long detail (synopsis) → label
              // then wrapped body. Either way: no blank line between facts.
              if (detailLines.length <= 1) {
                return (
                  <Box key={`${line.label}-${line.detail ?? ""}`}>
                    <Text color={resolvePanelTone(line.tone)}>
                      {padColumnsEnd(truncateLine(line.label, labelWidth), labelWidth)}
                    </Text>
                    <Text color={palette.dim}>{detailLines[0] ?? ""}</Text>
                  </Box>
                );
              }
              return (
                <Box key={`${line.label}-multi`} flexDirection="column">
                  <Text color={resolvePanelTone(line.tone)}>
                    {truncateLine(line.label, contentWidth)}
                  </Text>
                  {detailLines.map((detailLine) => (
                    <Text key={`${line.label}-${detailLine}`} color={palette.dim}>
                      {detailLine}
                    </Text>
                  ))}
                </Box>
              );
            })}
          {/*
            No hint line here. The context strip above already reports position
            ("18/57 lines") and the shell footer below already lists the keys, so
            this rendered a third near-identical line — the diagnostics overlay
            ended up stacking three of them.
          */}
        </Box>
      ) : null}
    </Box>
  );
}
