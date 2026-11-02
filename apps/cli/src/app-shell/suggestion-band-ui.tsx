// =============================================================================
// Search suggestion band — anchored dropdown rendered under the search field.
//
// Spotlight-style grouping ("From your list" / "Catalog"), ▌ accent selection
// bar, the typed substring painted in palette.accent, right-aligned dim meta,
// dim ░ skeleton rows while the catalog call is in flight, and an honest
// "keep typing" hint when nothing matched. Pure render — all scoring, ordering,
// and visibility decisions live in domain/search/suggestion-engine.
// =============================================================================

import type { ScoredSuggestion, SuggestionBandModel } from "@/domain/search/suggestion-engine";
import { Box, Text } from "ink";
import React from "react";

import { MouseTarget } from "./mouse/MouseRegions";
import { measureColumns, sanitizeTerminalText, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MARKER_WIDTH = 2;
const SKELETON_WIDTHS = [18, 26, 12] as const;

type TitleSegment = {
  readonly text: string;
  readonly matched: boolean;
  /** Code-point offset where the run starts — stable React key material. */
  readonly start: number;
};

/**
 * Split `title` into matched/unmatched runs for the accent highlight, truncated
 * to `widthBudget` columns with an ellipsis. `matchIndices` are code-point
 * indices into the original title (the scorer maps normalized matches back).
 */
function titleSegments(
  title: string,
  matchIndices: readonly number[],
  widthBudget: number,
): readonly TitleSegment[] {
  // Truncate complete graphemes before painting scorer code-point matches.
  const clean = sanitizeTerminalText(title);
  const display = truncateLine(clean, widthBudget);
  const matched = clean === title ? new Set(matchIndices) : new Set<number>();
  const segments: { text: string; matched: boolean; start: number }[] = [];
  let offset = 0;
  for (const { segment: char } of GRAPHEMES.segment(display)) {
    const i = offset;
    offset += Array.from(char).length;
    const isMatch = Array.from(char).some((_, index) => matched.has(i + index));
    const last = segments[segments.length - 1];
    if (last && last.matched === isMatch) last.text += char;
    else segments.push({ text: char, matched: isMatch, start: i });
  }
  return segments;
}

function SuggestionRow<TValue>({
  item,
  selected,
  rowWidth,
}: {
  readonly item: ScoredSuggestion<TValue>;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const { suggestion } = item;
  const badge = suggestion.badge?.trim() ?? "";
  const meta = suggestion.meta?.trim() ?? "";
  const rightText = [meta, badge].filter(Boolean).join("  ·  ");
  const rightWidth =
    rightText.length > 0
      ? Math.min(measureColumns(rightText), 24, Math.max(0, rowWidth - MARKER_WIDTH - 10))
      : 0;
  const titleBudget = Math.max(1, rowWidth - MARKER_WIDTH - (rightWidth > 0 ? rightWidth + 2 : 0));

  return (
    <Box
      width={rowWidth}
      backgroundColor={selected ? palette.accentFill : undefined}
      flexDirection="row"
      overflow="hidden"
    >
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Box width={titleBudget} overflow="hidden">
        <Text wrap="truncate">
          {titleSegments(suggestion.title, item.matchIndices, titleBudget).map((segment) => (
            <Text
              key={segment.start}
              color={segment.matched ? palette.accent : selected ? palette.text : palette.textDim}
              bold={selected && segment.matched}
              dimColor={!selected && !segment.matched}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      </Box>
      {rightWidth > 0 ? (
        <Box width={rightWidth + 2} justifyContent="flex-end">
          <Text wrap="truncate" color={palette.dim} dimColor>
            {truncateLine(rightText, rightWidth)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Includes the border and the selected preview in the browse row budget. */
export function getSuggestionBandRowCount<TValue>(
  model: SuggestionBandModel<TValue>,
  selectedIndex: number,
  maxRows = 12,
): number {
  if (model.rows.length === 0) return 0;
  const previewRows = model.items[selectedIndex] ? 3 : 0;
  return Math.min(model.rows.length, Math.max(1, maxRows - 3 - previewRows)) + 3 + previewRows;
}

/** Anchored, bounded surface. Selection previews only already-fetched metadata. */
export function SearchSuggestionBand<TValue>({
  model,
  selectedIndex = -1,
  width,
  maxRows = 12,
  pointerActive,
  onSelect,
}: {
  readonly model: SuggestionBandModel<TValue>;
  readonly selectedIndex?: number;
  readonly width: number;
  readonly maxRows?: number;
  readonly pointerActive?: boolean;
  readonly onSelect?: (item: ScoredSuggestion<TValue>) => void;
}) {
  const selected = model.items[selectedIndex]?.suggestion;
  const contentWidth = Math.max(1, width - 4);
  const rowCount = getSuggestionBandRowCount(model, selectedIndex, maxRows);
  if (rowCount === 0) return null;
  const capacity = rowCount - 3 - (selected ? 3 : 0);
  const selectedRow = selected
    ? model.rows.findIndex((row) => row.kind === "item" && row.item.suggestion === selected)
    : -1;
  const start = Math.min(
    Math.max(0, selectedRow - capacity + 1),
    Math.max(0, model.rows.length - capacity),
  );
  const visibleRows = model.rows.slice(start, start + capacity);
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      height={rowCount}
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      backgroundColor={palette.surface}
      paddingX={1}
    >
      <Text color={palette.textDim} wrap="truncate">
        {truncateLine("Suggestions · ↑↓ move · Esc dismiss", contentWidth)}
      </Text>
      {visibleRows.map((row, index) => {
        switch (row.kind) {
          case "header":
            return (
              <Text key={`h:${row.label}`} color={palette.muted} wrap="truncate">
                {truncateLine(`${start > 0 && index === 0 ? "↑ " : ""}${row.label}`, contentWidth)}
              </Text>
            );
          case "item":
            return (
              <MouseTarget
                key={`i:${row.item.suggestion.id}`}
                id={`browse:suggestion:${row.item.suggestion.id}`}
                active={pointerActive}
                onClick={() => onSelect?.(row.item)}
              >
                <SuggestionRow
                  item={row.item}
                  selected={row.item.suggestion === selected}
                  rowWidth={contentWidth}
                />
              </MouseTarget>
            );
          case "skeleton":
            return (
              <Text key={`s:${row.skeletonIndex}`} color={palette.muted} wrap="truncate">
                {truncateLine(
                  `  ${"░".repeat(SKELETON_WIDTHS[row.skeletonIndex % SKELETON_WIDTHS.length] ?? 18)}`,
                  contentWidth,
                )}
              </Text>
            );
          case "hint":
            return (
              <Text key={`hint:${row.label}`} color={palette.muted} wrap="truncate">
                {truncateLine(row.label, contentWidth)}
              </Text>
            );
        }
      })}
      {selected ? (
        <Box flexDirection="column" height={3}>
          <Text color={palette.accent} wrap="truncate">
            {truncateLine(
              selected.value !== undefined
                ? "Preview · Enter open · Ctrl+O details"
                : "Preview · Enter search",
              contentWidth,
            )}
          </Text>
          <Text color={palette.text} wrap="truncate">
            {truncateLine(selected.title, contentWidth)}
          </Text>
          <Text color={palette.textDim} wrap="truncate">
            {truncateLine(
              [selected.meta, selected.badge].filter(Boolean).join(" · ") ||
                (selected.value !== undefined ? "Title suggestion" : "Previous search"),
              contentWidth,
            )}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
