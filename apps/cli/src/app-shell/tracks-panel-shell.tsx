import { isFavoriteSource, sortByFavorites } from "@/domain/playback/source-name";
import {
  type TrackCapability,
  type TrackCapabilityGroup,
  type TrackCapabilityRisk,
  type TrackCapabilitySection,
} from "@/domain/playback/track-capabilities";
import { sanitizeTerminalText } from "@/domain/text-display";
import { Box, Text } from "ink";
import React from "react";

import { MouseTarget } from "./mouse/MouseRegions";
import { plainModeEnabled, selectionPrefix } from "./plain-mode";
import { StateBlock } from "./primitives/StateBlock";
import { getWindowStart, measureColumns, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import {
  chunkSubtitleGrid,
  compactTrackFailureReason,
  disambiguateSubtitleLabels,
  SUBTITLE_CELL_MIN_WIDTH,
  TRACKS_TWO_PANE_MIN_WIDTH as TWO_PANE_MIN_WIDTH,
  TRACKS_SECTION_COL_WIDTH as SECTION_COL_WIDTH,
  tracksSectionTabLabel,
  subtitleGridColumns,
  subtitleGridWindow,
  tracksPaneVisibleRows,
  tracksCountsHeader,
  tracksOptionsPaneWidth,
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
  onBack?: () => void;
};

function riskColor(risk: TrackCapabilityRisk): string {
  switch (risk) {
    case "failed":
      return palette.muted;
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
    return { glyph: "× ", color: palette.muted };
  }
  if (capability.selected) {
    return { glyph: "✓ ", color: palette.ok };
  }
  return null;
}

function rowTag(capability: TrackCapability): string | null {
  if (capability.selected && capability.risk === "failed") {
    return "Retry";
  }
  if (capability.risk === "failed") {
    return "Retry";
  }
  if (capability.selected) return null;
  if (capability.risk === "fallback") return "not tried";
  if (capability.risk === "unavailable") return "unavailable";
  if (capability.enabled) return null;
  return null;
}

/** Ordinary rows show media facts; raw routes and failure traces stay in diagnostics. */
function compactTrackDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const facts = detail.match(
    /(?:\b(?:4K|\d{3,4}p)\b|\b\d+ subtitles?\b|\b(?:English|Japanese|Hindi|French|Spanish|German|Original) audio\b|\b(?:hardsub|soft subs)\b|Best available[^·]*|Currently[^·]*)/gi,
  );
  return facts ? [...new Set(facts)].join(" · ") : undefined;
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
  onBack,
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
      <Box justifyContent="space-between" width={Math.max(1, width - 2)}>
        {headerLine ? (
          <Text color={palette.muted}>
            {truncateLine(headerLine, Math.max(8, width - (onBack ? 18 : 2)))}
          </Text>
        ) : null}
        {onBack ? (
          <MouseTarget id="tracks:back" onClick={onBack}>
            <Text color={palette.textDim}>
              ← Back <Text color={palette.muted}>(Esc)</Text>
            </Text>
          </MouseTarget>
        ) : null}
      </Box>
      {filterQuery.trim() ? (
        <Text color={palette.accentSoft}>{truncateLine(`filter: ${filterQuery}`, width - 2)}</Text>
      ) : null}
    </Box>
  );

  const plain = plainModeEnabled();
  const footer = showNavHint ? (
    <Box marginTop={1}>
      <Text color={palette.dim}>
        {plain
          ? `Up/Down choose, Right enter, Enter switch,${showFavoriteHint ? " f favorite," : ""} Esc back`
          : `↑↓ choose · → enter · ⏎ switch ·${showFavoriteHint ? " f favorite ·" : ""} esc back`}
      </Text>
    </Box>
  ) : null;

  if (plain || width < TWO_PANE_MIN_WIDTH) {
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

  const sectionPaneWidth = SECTION_COL_WIDTH;
  const rightWidth = tracksOptionsPaneWidth(width);

  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      <Box flexDirection="row">
        <Box flexDirection="column" width={sectionPaneWidth} marginRight={2}>
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
                <Box backgroundColor={active ? palette.accentFill : undefined}>
                  <Text color={focused ? palette.accent : palette.dim}>
                    {focused ? "▸ " : "  "}
                  </Text>
                  <Box width={10} flexShrink={0}>
                    <Text
                      color={active ? palette.text : palette.muted}
                      bold={active}
                      wrap="truncate"
                    >
                      {group.title}
                    </Text>
                  </Box>
                  <Text color={palette.dim} wrap="truncate">
                    {truncateLine(currentValue(group), sectionPaneWidth - 13)}
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

function TrackListRow({
  capability,
  favorite,
  highlighted,
  width,
  pointer,
}: {
  readonly capability: TrackCapability;
  readonly favorite: boolean;
  readonly highlighted: boolean;
  readonly width: number;
  readonly pointer?: TracksPointerActions;
}) {
  const tag = rowTag(capability);
  const statusGlyph = rowStatusGlyph(capability);
  const detail = [
    tag,
    capability.risk === "failed" ? compactTrackFailureReason(capability.reason) : null,
    compactTrackDetail(capability.detail),
  ]
    .filter(Boolean)
    .join(" · ");
  const prefixWidth = 2 + (favorite ? 2 : 0) + (statusGlyph ? 2 : 0);
  const detailWidth =
    detail && width >= 34 ? Math.min(measureColumns(detail), Math.floor(width * 0.42)) : 0;
  const labelWidth = Math.max(1, width - prefixWidth - (detailWidth ? detailWidth + 2 : 0));

  return (
    <TrackOptionTarget capability={capability} pointer={pointer}>
      <Box
        flexDirection="row"
        width={width}
        backgroundColor={highlighted ? palette.accentFill : undefined}
      >
        <Text color={highlighted ? palette.accent : palette.dim}>
          {highlighted ? "▌ " : capability.selected ? "› " : "  "}
        </Text>
        {favorite ? <Text color={palette.accent}>♥ </Text> : null}
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
          {truncateLine(sanitizeTerminalText(capability.label), labelWidth)}
        </Text>
        {detailWidth > 0 ? (
          <Text color={highlighted ? palette.accentSoft : palette.dim}>
            {"  "}
            {truncateLine(detail, detailWidth)}
          </Text>
        ) : null}
      </Box>
    </TrackOptionTarget>
  );
}

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
                  <Box
                    width={cellWidth}
                    backgroundColor={highlighted ? palette.accentFill : undefined}
                  >
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
                      {highlighted ? "▌" : " "}
                      {capability.selected ? "✓ " : "  "}
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
        return (
          <TrackListRow
            key={`opt-${capability.value}`}
            capability={capability}
            favorite={fav}
            highlighted={highlighted}
            width={width}
            pointer={pointer}
          />
        );
      })}
      {hiddenBelow > 0 ? <Text color={palette.dim}>{`↓ ${hiddenBelow} more`}</Text> : null}
    </Box>
  );
}

/** Narrow fallback: a compact section tab strip plus the focused section's rows. */
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
  const group = orderedGroups[Math.min(nav.sectionIndex, orderedGroups.length - 1)];
  if (!group) return null;

  const rows = group.rows;
  const focused = nav.focusedPane === "options" ? group.rows[nav.optionIndex] : undefined;
  const focusedIndex = Math.max(
    0,
    rows.findIndex((row) => row.value === focused?.value),
  );
  const budget = tracksPaneVisibleRows(height);
  const start = getWindowStart(focusedIndex, rows.length, budget);
  const visible = rows.slice(start, start + budget);
  const plain = plainModeEnabled();
  const hiddenRows = rows.length - start - visible.length;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" width={Math.max(1, width - 2)} marginBottom={1}>
        {orderedGroups.map((entry, index) => {
          const active = entry.section === group.section;
          const label = tracksSectionTabLabel(entry.title);
          return (
            <MouseTarget
              key={`tab-${entry.section}`}
              id={`tracks:section:${entry.section}`}
              active={Boolean(pointer)}
              onClick={() => pointer?.section(entry.section)}
            >
              <Text color={active ? palette.accent : palette.dim} bold={active}>
                {active ? `[${label}]` : ` ${label} `}
                {index < orderedGroups.length - 1 ? " " : ""}
              </Text>
            </MouseTarget>
          );
        })}
      </Box>
      {rows.length === 0 ? (
        <Text color={palette.dim}>
          {truncateLine(group.emptyReason ?? "Nothing to switch.", width - 4)}
        </Text>
      ) : null}
      {start > 0 ? <Text color={palette.dim}>{plain ? "More above" : "↑ more"}</Text> : null}
      {visible.map((capability) => {
        const highlighted = nav.focusedPane === "options" && capability.value === focused?.value;
        const fav =
          capability.section === "source" && isFavoriteSource(favorites, capability.label);
        if (plain) {
          const tags = [
            capability.selected ? "[active]" : "",
            fav ? "[favorite]" : "",
            capability.risk === "failed" ? `[${compactTrackFailureReason(capability.reason)}]` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Text
              key={`r-${group.section}-${capability.value}`}
              color={rowColor(capability, highlighted)}
              bold={highlighted || capability.selected}
            >
              {`${selectionPrefix(highlighted, true)}${capability.label}${tags ? ` ${tags}` : ""}`}
            </Text>
          );
        }
        return (
          <TrackListRow
            key={`r-${group.section}-${capability.value}`}
            capability={capability}
            favorite={fav}
            highlighted={highlighted}
            width={Math.max(1, width - 2)}
            pointer={pointer}
          />
        );
      })}
      {hiddenRows > 0 ? (
        <Text color={palette.dim}>{`↓ ${String(hiddenRows)} more — scroll to see`}</Text>
      ) : null}
    </Box>
  );
}
