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

import { measureColumns } from "./shell-text";
import { palette } from "./shell-theme";

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
  const chars = Array.from(title);
  const matched = new Set(matchIndices);
  const segments: { text: string; matched: boolean; start: number }[] = [];
  let used = 0;
  let truncated = false;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    const width = measureColumns(char);
    if (used + width > widthBudget - 1 && i < chars.length - 1) {
      truncated = true;
      break;
    }
    if (used + width > widthBudget) {
      truncated = true;
      break;
    }
    used += width;
    const isMatch = matched.has(i);
    const last = segments[segments.length - 1];
    if (last && last.matched === isMatch) {
      last.text += char;
    } else {
      segments.push({ text: char, matched: isMatch, start: i });
    }
  }
  if (truncated) {
    const last = segments[segments.length - 1];
    if (last) last.text += "…";
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
  const rightWidth = rightText.length > 0 ? Math.min(measureColumns(rightText), 24) : 0;
  const titleBudget = Math.max(8, rowWidth - MARKER_WIDTH - (rightWidth > 0 ? rightWidth + 2 : 0));

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
            {truncateRight(rightText, rightWidth)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function truncateRight(text: string, width: number): string {
  if (measureColumns(text) <= width) return text;
  const chars = Array.from(text);
  let out = "";
  let used = 0;
  for (const char of chars) {
    const w = measureColumns(char);
    if (used + w > width - 1) break;
    out += char;
    used += w;
  }
  return `${out}…`;
}

/**
 * The anchored suggestion dropdown. `selectedIndex` indexes `model.items`
 * (flat order across sections); -1/undefined means no row is highlighted.
 */
export function SearchSuggestionBand<TValue>({
  model,
  selectedIndex = -1,
  width,
}: {
  readonly model: SuggestionBandModel<TValue>;
  readonly selectedIndex?: number;
  readonly width: number;
}) {
  let flatIndex = -1;
  return (
    <Box flexDirection="column" width={width}>
      {model.rows.map((row) => {
        switch (row.kind) {
          case "header":
            return (
              <Text key={`h:${row.label}`} color={palette.dim} dimColor>
                {"  "}
                {row.label}
              </Text>
            );
          case "item": {
            flatIndex += 1;
            return (
              <SuggestionRow
                key={`i:${row.item.suggestion.id}`}
                item={row.item}
                selected={flatIndex === selectedIndex}
                rowWidth={width}
              />
            );
          }
          case "skeleton":
            return (
              <Text key={`s:${row.skeletonIndex}`} color={palette.dim} dimColor>
                {"  "}
                {"░".repeat(SKELETON_WIDTHS[row.skeletonIndex % SKELETON_WIDTHS.length] ?? 18)}
              </Text>
            );
          case "hint":
            return (
              <Text key={`hint:${row.label}`} color={palette.dim} dimColor>
                {"  "}
                {row.label}
              </Text>
            );
        }
      })}
    </Box>
  );
}
