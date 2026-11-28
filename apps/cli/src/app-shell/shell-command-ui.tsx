import { getLineEditorViewport, splitCursor } from "@/app-shell/line-editor";
import type { LocalTitleEntry, LocalTitleMatch } from "@/domain/palette/local-title-index";
import { Box, Text } from "ink";
import React from "react";

import type { ResolvedAppCommand } from "./commands";
import { MouseTarget } from "./mouse/MouseRegions";
import { buildPaletteRows, type PaletteRankedRow } from "./palette-ranking";
import { plainModeEnabled, selectionPrefix } from "./plain-mode";
import {
  COMMAND_GROUP_LABELS,
  CONTEXT_COMMAND_IDS,
  getPlaybackCommandPaletteMaxVisible,
  resolveCommandPaletteWidth,
} from "./shell-command-model";
import { getWindowStart, measureColumns, padColumnsEnd, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";

export function LineEditorText({
  value,
  cursor,
  focused,
  placeholder,
  maxWidth,
  ghostSuffix,
}: {
  value: string;
  cursor: number;
  focused: boolean;
  placeholder?: string;
  maxWidth?: number;
  /** Dim type-ahead completion rendered after the cursor at end-of-line. */
  ghostSuffix?: string;
}) {
  const viewport = getLineEditorViewport(value, cursor, maxWidth);
  const visiblePlaceholder =
    placeholder && maxWidth ? truncateLine(placeholder, Math.max(1, maxWidth - 1)) : placeholder;

  if (!focused) {
    const displayValue =
      value.length > 0 && maxWidth ? truncateLine(value, Math.max(1, maxWidth)) : value;
    return displayValue.length > 0 ? (
      <Text color={palette.text}>{displayValue}</Text>
    ) : (
      <Text color={palette.dim}>{visiblePlaceholder ?? ""}</Text>
    );
  }

  if (value.length === 0) {
    if (plainModeEnabled()) {
      return <Text color={palette.dim}>{visiblePlaceholder ?? ""}</Text>;
    }
    return (
      <>
        <Text backgroundColor={palette.accent} color={palette.bg}>
          {" "}
        </Text>
        {visiblePlaceholder ? <Text color={palette.dim}>{visiblePlaceholder}</Text> : null}
      </>
    );
  }

  if (plainModeEnabled()) {
    return <Text color={palette.text}>{viewport.value}</Text>;
  }

  const { before, cursorChar, after } = splitCursor(viewport.value, viewport.cursor);
  const visibleCursor = cursorChar.length > 0 ? cursorChar : " ";
  // Ghost completion only trails an end-of-line cursor — never mid-text.
  const atEnd = after.length === 0 && cursorChar.length === 0;
  const ghostWidth =
    maxWidth === undefined ? undefined : Math.max(0, maxWidth - measureColumns(before) - 1);
  const ghost = atEnd && ghostSuffix ? ghostSuffix : "";
  const visibleGhost =
    ghostWidth === undefined ? ghost : truncateLine(ghost, Math.max(0, ghostWidth));

  return (
    <>
      <Text color={palette.text}>{before}</Text>
      <Text backgroundColor={palette.accent} color={palette.bg}>
        {visibleCursor}
      </Text>
      <Text color={palette.text}>{after}</Text>
      {visibleGhost ? <Text color={palette.dim}>{visibleGhost}</Text> : null}
    </>
  );
}

const TITLE_SECTION_LABEL = "JUMP TO";

/**
 * Overlay shells render CommandPalette through ~10 per-overlay call sites that
 * all share one useShellInput — this context hands titleMatches to every site
 * without threading a prop through each overlay component. An explicit prop
 * wins over the context value.
 */
const PaletteTitleMatchesContext = React.createContext<readonly LocalTitleMatch[] | null>(null);

export function PaletteTitleMatchesProvider({
  matches,
  children,
}: {
  readonly matches: readonly LocalTitleMatch[];
  readonly children: React.ReactNode;
}) {
  return (
    <PaletteTitleMatchesContext.Provider value={matches}>
      {children}
    </PaletteTitleMatchesContext.Provider>
  );
}

function AccentTitleLabel({
  title,
  ranges,
  width,
}: {
  title: string;
  ranges: readonly [number, number][];
  width: number;
}) {
  const visible = truncateLine(title, width);
  const clipped = ranges
    .map(([start, end]): [number, number] => [start, Math.min(end, visible.length)])
    .filter(([start, end]) => end > start);
  const nodes: { start: number; text: string; accent: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of clipped) {
    if (start > cursor)
      nodes.push({ start: cursor, text: visible.slice(cursor, start), accent: false });
    nodes.push({ start, text: visible.slice(start, end), accent: true });
    cursor = end;
  }
  if (cursor < visible.length)
    nodes.push({ start: cursor, text: visible.slice(cursor), accent: false });
  return (
    <Text wrap="truncate">
      {nodes.map((node) => (
        <Text
          key={`${node.start}:${node.accent ? "m" : "t"}`}
          color={node.accent ? palette.accent : palette.text}
          bold={node.accent}
        >
          {node.text}
        </Text>
      ))}
    </Text>
  );
}

export type PalettePointerActions = {
  readonly select: (index: number) => void;
  readonly activate: (index: number) => void;
  readonly close: () => void;
};
export const PalettePointerContext = React.createContext<PalettePointerActions | null>(null);

function paletteTitleSummary(entry: LocalTitleEntry): string {
  const kind =
    entry.mediaKind === "video"
      ? "YouTube"
      : entry.mediaKind === "anime"
        ? "Anime"
        : entry.contentType === "movie"
          ? "Movie"
          : "Series";
  return `${kind} · ${entry.providerId ?? entry.source}`;
}

function paletteTitlePreviewRows(titleCount: number, terminalRows: number): number {
  return titleCount > 0 && terminalRows >= 30 ? 3 : 0;
}

function PaletteTitlePreview({
  entry,
  width,
}: {
  readonly entry?: LocalTitleEntry;
  readonly width: number;
}) {
  return (
    <Box flexDirection="column" height={3} paddingLeft={2}>
      {entry ? (
        <>
          <Text color={palette.text} bold wrap="truncate">
            {truncateLine(entry.title, width - 2)}
          </Text>
          <Text color={palette.muted} wrap="truncate">
            {truncateLine(`${paletteTitleSummary(entry)} · ${entry.detail}`, width - 2)}
          </Text>
          <Text color={palette.dim}>Enter open title · Esc close</Text>
        </>
      ) : (
        <Text color={palette.dim}>Point at a title or use ↑↓ to preview</Text>
      )}
    </Box>
  );
}

export function CommandPalette({
  input,
  pointer: pointerProp,
  cursor = input.length,
  commands,
  titleMatches: titleMatchesProp,
  highlightedIndex,
  maxVisible: maxVisibleProp,
  width,
  catalogSearch = false,
  catalogSearchOffline = false,
}: {
  input: string;
  pointer?: PalettePointerActions;
  cursor?: number;
  commands: readonly ResolvedAppCommand[];
  /** Local title matches — ranked with commands as JUMP TO rows. */
  titleMatches?: readonly LocalTitleMatch[];
  highlightedIndex: number;
  maxVisible?: number;
  width?: number;
  /** Append the catalog-search escape hatch when no prefix match exists. */
  catalogSearch?: boolean;
  /** Show the escape hatch but explain that catalog search is offline-disabled. */
  catalogSearchOffline?: boolean;
}) {
  const pointerContext = React.useContext(PalettePointerContext);
  const pointer = pointerProp ?? pointerContext;
  const contextTitleMatches = React.useContext(PaletteTitleMatchesContext);
  const titleMatches = titleMatchesProp ?? contextTitleMatches ?? [];
  const { cols: shellColumns, rows: terminalRows } = useShellDimensions();
  const shellWidth = Math.max(28, width ?? shellColumns);
  const maxVisible = maxVisibleProp ?? getPlaybackCommandPaletteMaxVisible(terminalRows);
  const rows = buildPaletteRows(input, commands, titleMatches, {
    catalogSearch,
    offline: catalogSearchOffline,
  });
  const showGrouped = input.trim().length === 0 && rows.length > 0;
  const selectedRow = rows[highlightedIndex];
  const selectedTitle = selectedRow?.kind === "title" ? selectedRow.match.entry : undefined;
  const previewRows = paletteTitlePreviewRows(titleMatches.length, terminalRows);
  const reserveTitlePreview = previewRows > 0;
  const visibleCount = Math.max(1, maxVisible - previewRows);
  const windowStart = getWindowStart(highlightedIndex, rows.length, visibleCount);
  const windowEnd = Math.min(windowStart + visibleCount, rows.length);
  const visibleRows = rows.slice(windowStart, windowEnd);
  const contentWidth = resolveCommandPaletteWidth(Math.min(shellWidth, shellColumns));

  const plain = plainModeEnabled();
  const renderCommand = (command: ResolvedAppCommand, absoluteIndex: number) => {
    const selected = absoluteIndex === highlightedIndex;
    const alias = `/${command.aliases[0]}`;
    if (plain) {
      const status = !command.enabled ? ` [unavailable: ${command.reason ?? "unavailable"}]` : "";
      return (
        <Text
          key={command.id}
          color={!command.enabled ? palette.dim : selected ? palette.text : palette.textDim}
          bold={selected && command.enabled}
        >
          {`${selectionPrefix(selected, true)}${alias} — ${command.description}${status}`}
        </Text>
      );
    }
    const aliasWidth = Math.min(20, Math.max(10, Math.floor(contentWidth * 0.28)));
    const detailWidth = Math.max(10, contentWidth - aliasWidth - 7);
    const detail = padColumnsEnd(truncateLine(command.description, detailWidth), detailWidth);
    const showReason = !command.enabled && selected;
    return (
      <MouseTarget
        key={command.id}
        id={`palette:command:${command.id}`}
        active={Boolean(pointer)}
        onClick={() => {
          if (selected && command.enabled) pointer?.activate(absoluteIndex);
          else pointer?.select(absoluteIndex);
        }}
        onWheel={(direction) =>
          pointer?.select(
            Math.max(
              0,
              Math.min(rows.length - 1, highlightedIndex + (direction === "up" ? -1 : 1)),
            ),
          )
        }
      >
        <Box flexDirection="column" width={contentWidth + 4}>
          <Box width={contentWidth + 4} backgroundColor={selected ? palette.accentFill : undefined}>
            <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
            <Text
              color={!command.enabled ? palette.dim : selected ? palette.accent : palette.text}
              bold={selected && command.enabled}
              dimColor={!command.enabled}
            >
              {padColumnsEnd(truncateLine(alias, aliasWidth), aliasWidth)}
            </Text>
            <Text color={palette.dim}> </Text>
            <Text
              wrap="truncate"
              color={command.enabled ? (selected ? palette.text : palette.muted) : palette.dim}
              dimColor={!command.enabled}
            >
              {detail}
            </Text>
          </Box>
          {showReason ? (
            <Box paddingLeft={4}>
              <Text color={palette.dim} dimColor>
                {command.reason ?? "unavailable"}
              </Text>
            </Box>
          ) : null}
        </Box>
      </MouseTarget>
    );
  };

  const renderTitle = (match: LocalTitleMatch, absoluteIndex: number) => {
    const selected = absoluteIndex === highlightedIndex;
    if (plain) {
      return (
        <Text
          key={`title:${match.entry.source}:${match.entry.titleId}`}
          color={selected ? palette.text : palette.textDim}
          bold={selected}
        >
          {`${selectionPrefix(selected, true)}${match.entry.title} — ${match.entry.detail}`}
        </Text>
      );
    }
    const aliasWidth = Math.min(20, Math.max(10, Math.floor(contentWidth * 0.28)));
    const titleWidth = Math.max(12, contentWidth - aliasWidth - 7);
    const detail = padColumnsEnd(truncateLine(match.entry.detail, aliasWidth), aliasWidth);
    return (
      <MouseTarget
        key={`title:${match.entry.source}:${match.entry.titleId}`}
        id={`palette:title:${match.entry.source}:${match.entry.titleId}`}
        active={Boolean(pointer)}
        onHover={() => pointer?.select(absoluteIndex)}
        onClick={() =>
          selected ? pointer?.activate(absoluteIndex) : pointer?.select(absoluteIndex)
        }
      >
        <Box width={contentWidth + 4} backgroundColor={selected ? palette.accentFill : undefined}>
          <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
          <Box width={titleWidth}>
            <AccentTitleLabel title={match.entry.title} ranges={match.ranges} width={titleWidth} />
          </Box>
          <Text color={palette.dim}> </Text>
          <Text wrap="truncate" color={selected ? palette.text : palette.muted}>
            {detail}
          </Text>
        </Box>
      </MouseTarget>
    );
  };

  const renderSearch = (
    row: Extract<PaletteRankedRow, { kind: "search" }>,
    absoluteIndex: number,
  ) => {
    const query = row.query;
    const selected = absoluteIndex === highlightedIndex;
    const label = `Search catalog for "${query}"`;
    if (plain) {
      return (
        <Text
          key={`search:${query}`}
          color={selected ? palette.text : palette.textDim}
          bold={selected}
        >
          {`${selectionPrefix(selected, true)}${label}${row.disabledReason && selected ? ` — ${row.disabledReason}` : ""}`}
        </Text>
      );
    }
    return (
      <MouseTarget
        key={`search:${query}`}
        id="palette:search-catalog"
        active={Boolean(pointer)}
        onHover={() => pointer?.select(absoluteIndex)}
        onClick={() =>
          selected ? pointer?.activate(absoluteIndex) : pointer?.select(absoluteIndex)
        }
      >
        <Box width={contentWidth + 4} backgroundColor={selected ? palette.accentFill : undefined}>
          <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
          <Text color={selected ? palette.accent : palette.text} bold={selected} wrap="truncate">
            {truncateLine(label, contentWidth - 2)}
          </Text>
          <Text color={palette.dim}>
            {" "}
            {selected && row.disabledReason ? row.disabledReason : "enter"}
          </Text>
        </Box>
      </MouseTarget>
    );
  };

  const renderRow = (row: PaletteRankedRow, absoluteIndex: number) => {
    if (row.kind === "command") return renderCommand(row.command, absoluteIndex);
    if (row.kind === "title") return renderTitle(row.match, absoluteIndex);
    return renderSearch(row, absoluteIndex);
  };

  const renderedRows: React.ReactNode[] = [];
  let previousGroup: "context" | "global" | null = null;
  let wroteTitleSection = false;
  let wroteCommandSectionAfterTitles = false;
  for (const [index, row] of visibleRows.entries()) {
    const absoluteIndex = windowStart + index;
    if (showGrouped && row.kind === "command") {
      const group = CONTEXT_COMMAND_IDS.has(row.command.id) ? "context" : "global";
      if (group !== previousGroup) {
        renderedRows.push(
          <Box key={`group:${group}:${absoluteIndex}`} marginTop={index > 0 ? 1 : 0}>
            <Text color={palette.dim} dimColor>
              {COMMAND_GROUP_LABELS[group].toUpperCase()}
            </Text>
          </Box>,
        );
        previousGroup = group;
      }
    }
    if (!showGrouped && row.kind === "title" && !wroteTitleSection) {
      renderedRows.push(
        <Text key="jump-to-header" color={palette.dim} dimColor>
          {TITLE_SECTION_LABEL}
        </Text>,
      );
      wroteTitleSection = true;
    }
    if (
      !showGrouped &&
      row.kind === "command" &&
      wroteTitleSection &&
      !wroteCommandSectionAfterTitles
    ) {
      renderedRows.push(
        <Text key="commands-after-titles-header" color={palette.dim} dimColor>
          COMMANDS
        </Text>,
      );
      wroteCommandSectionAfterTitles = true;
    }
    renderedRows.push(renderRow(row, absoluteIndex));
  }

  return (
    <Box flexDirection="column" marginTop={1} width={shellWidth} flexShrink={0}>
      {pointer ? (
        <MouseTarget id="palette:back" onClick={pointer.close}>
          <Text color={palette.textDim}>
            ← Back <Text color={palette.muted}>(Esc)</Text>
          </Text>
        </MouseTarget>
      ) : null}
      <Box marginTop={0}>
        {plain ? (
          <Text color={palette.text} bold>
            {`Command palette (focused): /${input}`}
          </Text>
        ) : (
          <>
            <Text color={palette.accent}>/</Text>
            <LineEditorText
              value={input}
              cursor={cursor}
              focused
              placeholder="type a command"
              maxWidth={Math.max(8, contentWidth - 2)}
            />
          </>
        )}
      </Box>
      <Text color={palette.dim} dimColor={!plain}>
        {plain
          ? `Tab autocomplete, Up/Down choose, Enter run, Esc close${rows.length > visibleCount ? ` (${rows.length} rows)` : ""}`
          : `Tab autocomplete · ↑↓ choose · Enter run${rows.length > visibleCount ? ` · ${rows.length} rows` : ""}`}
      </Text>
      {reserveTitlePreview ? (
        <PaletteTitlePreview entry={selectedTitle} width={contentWidth} />
      ) : null}
      <Box flexDirection="column">
        {rows.length > 0 ? (
          <>
            {windowStart > 0 ? (
              <Text color={palette.dim}>{plain ? "More rows above" : " ▲ more"}</Text>
            ) : null}
            {renderedRows}
            {windowEnd < rows.length ? (
              <Text color={palette.dim}>{plain ? "More rows below" : " ▼ more"}</Text>
            ) : null}
          </>
        ) : (
          <Text color={palette.dim}>No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}
