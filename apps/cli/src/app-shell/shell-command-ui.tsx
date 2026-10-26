import { getLineEditorViewport, splitCursor } from "@/app-shell/line-editor";
import type { LocalTitleEntry, LocalTitleMatch } from "@/domain/palette/local-title-index";
import { Box, Text } from "ink";
import React from "react";

import type { ResolvedAppCommand } from "./commands";
import { getCommandPaletteVisibleCommandCount } from "./layout-policy";
import { MouseTarget } from "./mouse/MouseRegions";
import {
  COMMAND_GROUP_LABELS,
  CONTEXT_COMMAND_IDS,
  buildCommandPickerModel,
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
    return (
      <>
        <Text backgroundColor={palette.accent} color="black">
          {" "}
        </Text>
        {visiblePlaceholder ? <Text color={palette.dim}>{visiblePlaceholder}</Text> : null}
      </>
    );
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
      <Text backgroundColor={palette.accent} color="black">
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

function paletteTitleSectionLabel(entry: LocalTitleEntry | undefined, expanded: boolean): string {
  if (!entry || expanded) return TITLE_SECTION_LABEL;
  return `${TITLE_SECTION_LABEL} · ${paletteTitleSummary(entry)}`;
}

function paletteTitlePreviewRows(titleCount: number, terminalRows: number): number {
  return titleCount > 0 && terminalRows >= 48 ? 3 : 0;
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

function PaletteLocalTitles({
  matches,
  commandCount,
  highlightedIndex,
  expanded,
  width,
  pointer,
}: {
  readonly matches: readonly LocalTitleMatch[];
  readonly commandCount: number;
  readonly highlightedIndex: number;
  readonly expanded: boolean;
  readonly width: number;
  readonly pointer?: PalettePointerActions | null;
}) {
  if (matches.length === 0) return null;
  const selectedTitle = matches[highlightedIndex - commandCount]?.entry;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.dim} dimColor>
        {truncateLine(paletteTitleSectionLabel(selectedTitle, expanded), width)}
      </Text>
      {matches.map((match, index) => {
        const absoluteIndex = commandCount + index;
        const selected = absoluteIndex === highlightedIndex;
        const aliasWidth = Math.min(20, Math.max(10, Math.floor(width * 0.28)));
        const titleWidth = Math.max(12, width - aliasWidth - 7);
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
            <Box width={width + 4} backgroundColor={selected ? palette.accentFill : undefined}>
              <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
              <Box width={titleWidth}>
                <AccentTitleLabel
                  title={match.entry.title}
                  ranges={match.ranges}
                  width={titleWidth}
                />
              </Box>
              <Text color={palette.dim}> </Text>
              <Text wrap="truncate" color={selected ? palette.text : palette.muted}>
                {detail}
              </Text>
            </Box>
          </MouseTarget>
        );
      })}
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
}: {
  input: string;
  pointer?: PalettePointerActions;
  cursor?: number;
  commands: readonly ResolvedAppCommand[];
  /** Local title matches — rendered as a capped JUMP TO section under commands. */
  titleMatches?: readonly LocalTitleMatch[];
  highlightedIndex: number;
  maxVisible?: number;
  width?: number;
}) {
  const pointerContext = React.useContext(PalettePointerContext);
  const pointer = pointerProp ?? pointerContext;
  const contextTitleMatches = React.useContext(PaletteTitleMatchesContext);
  const titleMatches = titleMatchesProp ?? contextTitleMatches ?? [];
  const { cols: shellColumns, rows: terminalRows } = useShellDimensions();
  const shellWidth = Math.max(28, width ?? shellColumns);
  const maxVisible = maxVisibleProp ?? getPlaybackCommandPaletteMaxVisible(terminalRows);
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  const matches = model.options
    .map((option) => commands.find((command) => command.id === option.value))
    .filter((command): command is ResolvedAppCommand => Boolean(command));
  const showGrouped = input.trim().length === 0 && matches.length > 0;
  const selectedTitle = titleMatches[highlightedIndex - matches.length]?.entry;
  const previewRows = paletteTitlePreviewRows(titleMatches.length, terminalRows);
  const reserveTitlePreview = previewRows > 0;
  const visibleCount = getCommandPaletteVisibleCommandCount({
    maxRows: Math.max(1, maxVisible - previewRows),
    totalMatches: matches.length,
    grouped: showGrouped,
  });
  const windowStart = getWindowStart(model.selectedIndex, matches.length, visibleCount);
  const windowEnd = Math.min(windowStart + visibleCount, matches.length);
  const visibleMatches = matches.slice(windowStart, windowEnd);
  const contentWidth = resolveCommandPaletteWidth(Math.min(shellWidth, shellColumns));

  const renderCommand = (command: ResolvedAppCommand, absoluteIndex: number) => {
    // Compare against the raw highlighted index — model.selectedIndex is clamped
    // to command rows, so a highlighted title row must deselect every command.
    const selected = absoluteIndex === highlightedIndex;
    const alias = `/${command.aliases[0]}`;
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
              Math.min(
                matches.length + titleMatches.length - 1,
                highlightedIndex + (direction === "up" ? -1 : 1),
              ),
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
        <Text color={palette.accent}>/</Text>
        <LineEditorText
          value={input}
          cursor={cursor}
          focused
          placeholder="type a command"
          maxWidth={Math.max(8, contentWidth - 2)}
        />
      </Box>
      <Text color={palette.dim} dimColor>
        Tab autocomplete · ↑↓ choose · Enter run
        {matches.length > visibleMatches.length ? ` · ${matches.length} commands` : ""}
      </Text>
      {reserveTitlePreview ? (
        <PaletteTitlePreview entry={selectedTitle} width={contentWidth} />
      ) : null}
      <Box flexDirection="column">
        {matches.length > 0 ? (
          <>
            {/* Scroll affordance only when there is actually more above — no empty
                placeholder line, so the palette stays tight. */}
            {windowStart > 0 ? <Text color={palette.dim}> ▲ more</Text> : null}
            {showGrouped ? (
              <>
                {(() => {
                  const rows: React.ReactNode[] = [];
                  let previousGroup: "context" | "global" | null = null;
                  for (const [index, command] of visibleMatches.entries()) {
                    const group = CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global";
                    if (group !== previousGroup) {
                      rows.push(
                        <Box
                          key={`group:${group}:${windowStart + index}`}
                          marginTop={index > 0 ? 1 : 0}
                        >
                          <Text color={palette.dim} dimColor>
                            {COMMAND_GROUP_LABELS[group].toUpperCase()}
                          </Text>
                        </Box>,
                      );
                      previousGroup = group;
                    }
                    rows.push(renderCommand(command, windowStart + index));
                  }
                  return <>{rows}</>;
                })()}
              </>
            ) : (
              visibleMatches.map((command, index) => {
                const absoluteIndex = windowStart + index;
                return renderCommand(command, absoluteIndex);
              })
            )}
            {windowEnd < matches.length ? <Text color={palette.dim}> ▼ more</Text> : null}
          </>
        ) : (
          <Text color={palette.dim}>No matching commands</Text>
        )}
      </Box>
      <PaletteLocalTitles
        matches={titleMatches}
        commandCount={matches.length}
        highlightedIndex={highlightedIndex}
        expanded={reserveTitlePreview}
        width={contentWidth}
        pointer={pointer}
      />
    </Box>
  );
}
