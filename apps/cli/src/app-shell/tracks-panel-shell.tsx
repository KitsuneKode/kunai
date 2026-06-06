import { isFavoriteSource, sortByFavorites } from "@/domain/playback/source-name";
import {
  buildTrackPanelRows,
  type TrackCapability,
  type TrackCapabilityGroup,
  type TrackCapabilityRisk,
  type TrackCapabilitySection,
} from "@/domain/playback/track-capabilities";
import { Box, Text } from "ink";
import React from "react";

import { getWindowStart, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { chunkSubtitleGrid, tracksCountsHeader } from "./tracks-panel-layout";
import { createInitialTracksNav, type TracksNavState } from "./tracks-panel-nav";

/** Width below which the two-pane layout collapses to the stacked single column. */
const TWO_PANE_MIN_WIDTH = 56;
const SECTION_COL_WIDTH = 22;
/** Stable empty default so the favorites prop keeps referential equality across renders. */
const EMPTY_FAVORITES: readonly string[] = [];

export type TracksPanelShellProps = {
  groups: readonly TrackCapabilityGroup[];
  width: number;
  height?: number;
  nav?: TracksNavState;
  favorites?: readonly string[];
  /** Counts-header tail (provider/host label). */
  providerLabel?: string;
  filterQuery?: string;
};

function riskColor(risk: TrackCapabilityRisk): string {
  switch (risk) {
    case "failed":
      return palette.danger;
    case "fallback":
      return palette.accentDeep;
    case "unavailable":
      return palette.dim;
    default:
      return palette.text;
  }
}

// A switchable row leads with weight (it's an action); a fact row is dim (it's
// information). The current selection reads as "ok" so the eye lands on it.
function rowColor(capability: TrackCapability, highlighted: boolean): string {
  if (highlighted) return palette.accent;
  if (capability.selected && capability.risk === "failed") return palette.danger;
  if (capability.selected) return palette.ok;
  if (!capability.enabled) return palette.muted;
  return riskColor(capability.risk);
}

function rowTag(capability: TrackCapability): string | null {
  if (capability.selected && capability.risk === "failed") return "current · failed";
  if (capability.selected) return "current";
  if (capability.risk === "failed") return "failed";
  if (capability.risk === "fallback") return "fallback";
  if (capability.risk === "unavailable") return "unavailable";
  if (capability.enabled) return "available";
  return null;
}

function currentValue(group: TrackCapabilityGroup): string {
  return group.rows.find((row) => row.selected)?.label ?? group.rows[0]?.label ?? "—";
}

function sectionCounts(groups: readonly TrackCapabilityGroup[]) {
  const count = (section: TrackCapabilitySection): number =>
    groups.find((group) => group.section === section)?.rows.length ?? 0;
  return {
    source: count("source"),
    quality: count("quality"),
    audio: count("audio"),
    subtitle: count("subtitle"),
  };
}

/** Order a section's rows for display — sources are favorites-first, others keep provider order. */
function displayRows(
  group: TrackCapabilityGroup,
  favorites: readonly string[],
): readonly TrackCapability[] {
  if (group.section === "source") {
    return sortByFavorites(group.rows, favorites, (row) => row.label);
  }
  return group.rows;
}

export const TracksPanelShell = React.memo(function TracksPanelShell({
  groups,
  width,
  height,
  nav,
  favorites = EMPTY_FAVORITES,
  providerLabel,
  filterQuery = "",
}: TracksPanelShellProps) {
  if (groups.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={palette.muted}>No stream details available for this title yet.</Text>
      </Box>
    );
  }

  const state = nav ?? createInitialTracksNav({});
  const counts = sectionCounts(groups);
  const headerLine = tracksCountsHeader(counts, providerLabel);
  const focusedGroup = groups[Math.min(state.sectionIndex, groups.length - 1)];
  const showFavoriteHint = focusedGroup?.section === "source";

  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={palette.accent} bold>
          🦊 Kunai{"  "}
        </Text>
        <Text color={palette.textDim} bold>
          Tracks
        </Text>
      </Box>
      {headerLine ? <Text color={palette.dim}>{truncateLine(headerLine, width - 2)}</Text> : null}
      {filterQuery.trim() ? (
        <Text color={palette.accentSoft}>{truncateLine(`filter: ${filterQuery}`, width - 2)}</Text>
      ) : null}
    </Box>
  );

  const footer = (
    <Box marginTop={1}>
      <Text color={palette.dim}>
        ↑↓ choose · → enter · ⏎ switch ·{showFavoriteHint ? " f favorite ·" : ""} esc back
      </Text>
    </Box>
  );

  if (width < TWO_PANE_MIN_WIDTH) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        <StackedView groups={groups} favorites={favorites} width={width} />
        {footer}
      </Box>
    );
  }

  const rightWidth = width - SECTION_COL_WIDTH - 3;

  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      <Box flexDirection="row">
        <Box flexDirection="column" width={SECTION_COL_WIDTH} marginRight={2}>
          {groups.map((group, index) => {
            const focused = state.focusedPane === "sections" && index === state.sectionIndex;
            const active = index === state.sectionIndex;
            return (
              <Box key={`sec-${group.section}`}>
                <Text color={focused ? palette.accent : palette.dim}>{focused ? "▸ " : "  "}</Text>
                <Box width={9}>
                  <Text color={active ? palette.text : palette.muted} bold={active} wrap="truncate">
                    {group.title}
                  </Text>
                </Box>
                <Text color={palette.dim} wrap="truncate">
                  {truncateLine(currentValue(group), SECTION_COL_WIDTH - 12)}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {focusedGroup ? (
            <OptionsPane
              group={focusedGroup}
              state={state}
              favorites={favorites}
              width={Math.max(12, rightWidth)}
              height={height}
            />
          ) : null}
        </Box>
      </Box>
      {footer}
    </Box>
  );
});

function OptionsPane({
  group,
  state,
  favorites,
  width,
  height,
}: {
  group: TrackCapabilityGroup;
  state: TracksNavState;
  favorites: readonly string[];
  width: number;
  height?: number;
}) {
  const optionsFocused = state.focusedPane === "options";
  const rows = displayRows(group, favorites);

  if (rows.length === 0) {
    return (
      <Text color={palette.dim}>
        {truncateLine(group.emptyReason ?? "Nothing to switch.", width)}
      </Text>
    );
  }

  const headerLabel = `${group.title.toUpperCase()} · ${rows.length}`;

  if (group.section === "subtitle") {
    const columns = Math.max(1, Math.floor(width / 16));
    const grid = chunkSubtitleGrid(rows, columns);
    return (
      <Box flexDirection="column">
        <Text color={palette.muted} bold>
          {headerLabel}
        </Text>
        {grid.map((line, rowIndex) => (
          <Box key={`subrow-${line[0]?.value ?? rowIndex}`}>
            {line.map((capability, cellIndex) => {
              const flatIndex = rowIndex * columns + cellIndex;
              const highlighted = optionsFocused && flatIndex === state.optionIndex;
              return (
                <Box key={`sub-${capability.value}`} width={16}>
                  <Text
                    color={
                      highlighted
                        ? palette.accent
                        : capability.selected
                          ? palette.ok
                          : palette.textDim
                    }
                    bold={highlighted || capability.selected}
                    wrap="truncate"
                  >
                    {capability.selected ? "✓ " : "  "}
                    {capability.label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
        <Text color={palette.dim}>
          ↳ subtitles attach live in mpv — switch instantly in the player
        </Text>
      </Box>
    );
  }

  const maxVisible = Math.max(4, Math.min(rows.length, (height ?? 18) - 4));
  const highlightIndex = optionsFocused ? Math.min(state.optionIndex, rows.length - 1) : 0;
  const windowStart = getWindowStart(highlightIndex, rows.length, maxVisible);
  const visible = rows.slice(windowStart, windowStart + maxVisible);
  const hiddenBelow = Math.max(0, rows.length - windowStart - visible.length);

  return (
    <Box flexDirection="column">
      <Text color={palette.muted} bold>
        {headerLabel}
      </Text>
      {windowStart > 0 ? <Text color={palette.dim}>{`↑ ${windowStart} more`}</Text> : null}
      {visible.map((capability, offset) => {
        const index = windowStart + offset;
        const highlighted = optionsFocused && index === state.optionIndex;
        const fav = group.section === "source" && isFavoriteSource(favorites, capability.label);
        const tag = rowTag(capability);
        return (
          <Box key={`opt-${capability.value}`} flexDirection="row">
            <Text color={highlighted ? palette.accent : palette.dim}>
              {highlighted ? "▌ " : capability.selected ? "› " : "  "}
            </Text>
            {fav ? <Text color={palette.accent}>♥ </Text> : null}
            <Text
              color={rowColor(capability, highlighted)}
              bold={highlighted || capability.selected}
              wrap="truncate"
            >
              {capability.label}
            </Text>
            {capability.detail || tag ? (
              <Text color={highlighted ? palette.accentSoft : palette.dim}>
                {"  "}
                {truncateLine(
                  [tag, capability.detail].filter(Boolean).join(" · "),
                  Math.max(8, width - capability.label.length - (fav ? 6 : 4)),
                )}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {hiddenBelow > 0 ? <Text color={palette.dim}>{`↓ ${hiddenBelow} more`}</Text> : null}
    </Box>
  );
}

/** Narrow fallback: sections stacked with their rows, honoring the focused option. */
function StackedView({
  groups,
  favorites,
  width,
}: {
  groups: readonly TrackCapabilityGroup[];
  favorites: readonly string[];
  width: number;
}) {
  const rows = buildTrackPanelRows(groups);
  return (
    <Box flexDirection="column">
      {rows.map((row) => {
        if (row.kind === "header") {
          return (
            <Box key={`h-${row.group.section}`} marginTop={1}>
              <Text color={palette.textDim} bold>
                {row.group.title}
              </Text>
            </Box>
          );
        }
        if (row.kind === "empty") {
          return (
            <Box key={`e-${row.group.section}`} paddingLeft={2}>
              <Text color={palette.dim}>{truncateLine(row.reason, width - 4)}</Text>
            </Box>
          );
        }
        const { capability } = row;
        const fav =
          capability.section === "source" && isFavoriteSource(favorites, capability.label);
        return (
          <Box key={`r-${row.group.section}-${capability.value}`} flexDirection="row">
            <Text color={palette.dim}>{capability.selected ? "› " : "  "}</Text>
            {fav ? <Text color={palette.accent}>♥ </Text> : null}
            <Text color={rowColor(capability, false)} bold={capability.selected} wrap="truncate">
              {truncateLine(capability.label, width - 6)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
