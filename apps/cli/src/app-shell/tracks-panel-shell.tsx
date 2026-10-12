import { isFavoriteSource, sortByFavorites } from "@/domain/playback/source-name";
import {
  buildTrackPanelRows,
  type TrackCapability,
  type TrackCapabilityGroup,
  type TrackCapabilityRisk,
  type TrackCapabilitySection,
} from "@/domain/playback/track-capabilities";
import { sanitizeTerminalText } from "@/domain/text-display";
import { Box, Text } from "ink";
import React from "react";

import { MouseTarget } from "./mouse/MouseRegions";
import { StateBlock } from "./primitives/StateBlock";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette, APP_LABEL } from "./shell-theme";
import {
  chunkSubtitleGrid,
  disambiguateSubtitleLabels,
  SUBTITLE_CELL_MIN_WIDTH,
  TRACKS_SECTION_COL_WIDTH as SECTION_COL_WIDTH,
  TRACKS_TWO_PANE_MIN_WIDTH as TWO_PANE_MIN_WIDTH,
  subtitleGridColumns,
  subtitleGridWindow,
  tracksPaneVisibleRows,
  tracksCountsHeader,
} from "./tracks-panel-layout";
import { createInitialTracksNav, type TracksNavState } from "./tracks-panel-nav";

/** Stable empty default so the favorites prop keeps referential equality across renders. */
const EMPTY_FAVORITES: readonly string[] = [];

export type TracksPointerActions = {
  readonly section: (section: TrackCapabilitySection) => void;
  readonly option: (section: TrackCapabilitySection, value: string) => void;
  readonly scroll: (section: TrackCapabilitySection, direction: "up" | "down") => void;
};

function TrackOptionTarget({
  capability,
  pointer,
  children,
}: {
  readonly capability: TrackCapability;
  readonly pointer?: TracksPointerActions;
  readonly children: React.ReactNode;
}) {
  return (
    <MouseTarget
      id={`tracks:option:${capability.section}:${capability.value}`}
      active={Boolean(pointer)}
      onClick={() => pointer?.option(capability.section, capability.value)}
      onWheel={(direction) => pointer?.scroll(capability.section, direction)}
    >
      {children}
    </MouseTarget>
  );
}

export type TracksPanelShellProps = {
  groups: readonly TrackCapabilityGroup[];
  width: number;
  height?: number;
  nav?: TracksNavState;
  favorites?: readonly string[];
  /** Counts-header tail (provider/host label). */
  providerLabel?: string;
  filterQuery?: string;
  /** Inline nav hints — off when ShellFooter already owns the footer (root overlay). */
  showNavHint?: boolean;
  pointer?: TracksPointerActions;
};

function riskColor(risk: TrackCapabilityRisk): string {
  switch (risk) {
    case "failed":
      return palette.dangerText;
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
  if (capability.selected && capability.risk === "failed") return palette.dangerText;
  if (capability.selected) return palette.ok;
  if (!capability.enabled) return palette.muted;
  return riskColor(capability.risk);
}

function rowStatusGlyph(
  capability: TrackCapability,
): { readonly glyph: string; readonly color: string } | null {
  if (capability.risk === "failed") {
    return { glyph: "✕ ", color: palette.dangerText };
  }
  if (capability.selected) {
    return { glyph: "✓ ", color: palette.ok };
  }
  return null;
}

function rowTag(capability: TrackCapability): string | null {
  if (capability.selected && capability.risk === "failed") {
    return capability.reason ?? "failed on last try";
  }
  if (capability.risk === "failed") {
    return capability.reason ?? "failed on last try";
  }
  if (capability.selected) return "current";
  if (capability.risk === "fallback") return "not tried";
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
    provider: count("provider"),
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
  showNavHint = false,
  pointer,
}: TracksPanelShellProps) {
  if (groups.length === 0) {
    return (
      <Box paddingX={1}>
        <StateBlock
          model={{
            kind: "empty",
            title: "No stream details yet",
            detail: "Track and subtitle inventory appears once playback resolves a source.",
          }}
          width={width}
        />
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
          {APP_LABEL}
          {"  "}
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

  const footer = showNavHint ? (
    <Box marginTop={1}>
      <Text color={palette.dim}>
        ↑↓ choose · → enter · ⏎ switch ·{showFavoriteHint ? " f favorite ·" : ""} esc back
      </Text>
    </Box>
  ) : null;

  if (width < TWO_PANE_MIN_WIDTH) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        <StackedView
          groups={groups}
          favorites={favorites}
          width={width}
          height={height}
          nav={state}
          pointer={pointer}
        />
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
              <MouseTarget
                key={`sec-${group.section}`}
                id={`tracks:section:${group.section}`}
                active={Boolean(pointer)}
                onClick={() => pointer?.section(group.section)}
                onWheel={(direction) => pointer?.scroll(group.section, direction)}
              >
                <Box>
                  <Text color={focused ? palette.accent : palette.dim}>
                    {focused ? "▸ " : "  "}
                  </Text>
                  <Box width={9}>
                    <Text
                      color={active ? palette.text : palette.muted}
                      bold={active}
                      wrap="truncate"
                    >
                      {group.title}
                    </Text>
                  </Box>
                  <Text color={palette.dim} wrap="truncate">
                    {truncateLine(currentValue(group), SECTION_COL_WIDTH - 12)}
                  </Text>
                </Box>
              </MouseTarget>
            );
          })}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {focusedGroup ? (
            <OptionsPane
              group={focusedGroup}
              pointer={pointer}
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
  pointer,
}: {
  group: TrackCapabilityGroup;
  pointer?: TracksPointerActions;
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
    const columns = subtitleGridColumns(width);
    const cellWidth = Math.max(SUBTITLE_CELL_MIN_WIDTH, Math.floor(width / columns));
    // Repeated language names ("English" four times over) are unpickable without
    // this; the labels carry their own discriminator before they reach the grid.
    const labels = disambiguateSubtitleLabels(rows);
    const focusedIndex = optionsFocused ? Math.min(state.optionIndex, rows.length - 1) : 0;
    // Reserve the header, the hint line, and both overflow markers.
    const { startRow, endRow, totalRows } = subtitleGridWindow({
      totalCells: rows.length,
      columns,
      focusedIndex,
      visibleRows: tracksPaneVisibleRows(height),
    });
    const grid = chunkSubtitleGrid(rows, columns).slice(startRow, endRow);
    const hiddenAbove = startRow * columns;
    const hiddenBelowCells = Math.max(0, rows.length - endRow * columns);

    return (
      <Box flexDirection="column">
        <Text color={palette.muted} bold>
          {headerLabel}
        </Text>
        {hiddenAbove > 0 ? <Text color={palette.dim}>{`↑ ${hiddenAbove} more`}</Text> : null}
        {grid.map((line, rowIndex) => (
          <Box key={`subrow-${line[0]?.value ?? rowIndex}`}>
            {line.map((capability, cellIndex) => {
              const flatIndex = (startRow + rowIndex) * columns + cellIndex;
              const highlighted = optionsFocused && flatIndex === state.optionIndex;
              return (
                <TrackOptionTarget
                  key={`sub-${capability.value}`}
                  capability={capability}
                  pointer={pointer}
                >
                  <Box width={cellWidth}>
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
                      {capability.selected ? "✓ " : highlighted ? "▌ " : "  "}
                      {sanitizeTerminalText(labels[flatIndex] ?? capability.label)}
                    </Text>
                  </Box>
                </TrackOptionTarget>
              );
            })}
          </Box>
        ))}
        {hiddenBelowCells > 0 ? (
          <Text color={palette.dim}>{`↓ ${hiddenBelowCells} more`}</Text>
        ) : null}
        <Text color={palette.dim}>
          {truncateLine(
            totalRows > 1
              ? "↳ attach live in mpv · ↑↓ row · ←→ within row"
              : "↳ subtitles attach live in mpv — switch instantly in the player",
            width,
          )}
        </Text>
      </Box>
    );
  }

  const maxVisible = Math.max(1, Math.min(rows.length, tracksPaneVisibleRows(height)));
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
        const statusGlyph = rowStatusGlyph(capability);
        return (
          <TrackOptionTarget
            key={`opt-${capability.value}`}
            capability={capability}
            pointer={pointer}
          >
            <Box flexDirection="row">
              <Text color={highlighted ? palette.accent : palette.dim}>
                {highlighted ? "▌ " : capability.selected ? "› " : "  "}
              </Text>
              {fav ? <Text color={palette.accent}>♥ </Text> : null}
              {statusGlyph ? (
                <Text color={statusGlyph.color} bold={capability.risk === "failed"}>
                  {statusGlyph.glyph}
                </Text>
              ) : null}
              <Text
                color={rowColor(capability, highlighted)}
                bold={highlighted || capability.selected}
                wrap="truncate"
              >
                {sanitizeTerminalText(capability.label)}
              </Text>
              {capability.detail || tag ? (
                <Text color={highlighted ? palette.accentSoft : palette.dim}>
                  {"  "}
                  {truncateLine(
                    [tag, capability.detail].filter(Boolean).join(" · "),
                    Math.max(
                      8,
                      width - capability.label.length - (fav ? 6 : 4) - (statusGlyph ? 2 : 0),
                    ),
                  )}
                </Text>
              ) : null}
            </Box>
          </TrackOptionTarget>
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
  height,
  nav,
  pointer,
}: {
  groups: readonly TrackCapabilityGroup[];
  favorites: readonly string[];
  width: number;
  height?: number;
  nav: TracksNavState;
  pointer?: TracksPointerActions;
}) {
  const orderedGroups = groups.map((group) => ({ ...group, rows: displayRows(group, favorites) }));
  const allRows = buildTrackPanelRows(orderedGroups);
  const group = orderedGroups[nav.sectionIndex];
  const focused = group?.rows[nav.optionIndex];
  const focusedIndex = Math.max(
    0,
    allRows.findIndex(
      (row) =>
        row.group.section === group?.section &&
        (nav.focusedPane === "sections"
          ? row.kind === "header"
          : row.kind === "row" && row.capability.value === focused?.value),
    ),
  );
  const budget = tracksPaneVisibleRows(height);
  const start = getWindowStart(focusedIndex, allRows.length, budget);
  const rows = allRows.slice(start, start + budget);
  const hiddenRows = allRows.length - start - rows.length;
  return (
    <Box flexDirection="column">
      {start > 0 ? <Text color={palette.dim}>↑ more</Text> : null}
      {rows.map((row) => {
        if (row.kind === "header") {
          return (
            <MouseTarget
              key={`h-${row.group.section}`}
              id={`tracks:section:${row.group.section}`}
              active={Boolean(pointer)}
              onClick={() => pointer?.section(row.group.section)}
            >
              <Box marginTop={1}>
                <Text color={palette.textDim} bold>
                  {row.group.title}
                </Text>
              </Box>
            </MouseTarget>
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
        const highlighted =
          nav.focusedPane === "options" &&
          row.group.section === group?.section &&
          capability.value === focused?.value;
        const fav =
          capability.section === "source" && isFavoriteSource(favorites, capability.label);
        const statusGlyph = rowStatusGlyph(capability);
        return (
          <TrackOptionTarget
            key={`r-${row.group.section}-${capability.value}`}
            capability={capability}
            pointer={pointer}
          >
            <Box flexDirection="row">
              <Text color={palette.dim}>
                {highlighted ? "▌ " : capability.selected ? "› " : "  "}
              </Text>
              {fav ? <Text color={palette.accent}>♥ </Text> : null}
              {statusGlyph ? (
                <Text color={statusGlyph.color} bold={capability.risk === "failed"}>
                  {statusGlyph.glyph}
                </Text>
              ) : null}
              <Text
                color={rowColor(capability, highlighted)}
                bold={highlighted || capability.selected}
                wrap="truncate"
              >
                {truncateLine(capability.label, width - 6 - (statusGlyph ? 2 : 0))}
              </Text>
            </Box>
          </TrackOptionTarget>
        );
      })}
      {hiddenRows > 0 ? (
        <Text color={palette.dim}>{`↓ ${String(hiddenRows)} more — scroll to see`}</Text>
      ) : null}
    </Box>
  );
}
