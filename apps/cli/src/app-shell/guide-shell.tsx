import { truncateLine } from "@/domain/text-display";
import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import { GUIDE_SURFACE_TAGS, type GuideRow, type GuideSectionRows } from "./guide-model";
import { useOverlayLayout } from "./overlay-layout-context";
import { CommandPalette } from "./shell-command-ui";
import { ShellFooter } from "./shell-primitives";
import { palette } from "./shell-theme";
import type { FooterAction } from "./types";

type GuideLine =
  | { readonly kind: "header"; readonly title: string; readonly blurb: string }
  | { readonly kind: "entry"; readonly row: GuideRow; readonly entryIndex: number };

function flattenGuideLines(sections: readonly GuideSectionRows[]): readonly GuideLine[] {
  const lines: GuideLine[] = [];
  let entryIndex = 0;
  for (const section of sections) {
    lines.push({ kind: "header", title: section.title, blurb: section.blurb });
    for (const row of section.rows) {
      lines.push({ kind: "entry", row, entryIndex });
      entryIndex += 1;
    }
  }
  return lines;
}

/**
 * The `/guide` surface — a browsable directory of what Kunai can do. Enter on
 * a row does one of three things, decided by the caller: run it here, hand it
 * to the search screen underneath, or name the surface it lives on.
 */
export function GuideShell({
  sections,
  maxRows,
  commandMode,
  commandInput,
  commandCursor,
  commands,
  highlightedIndex,
  footerActions,
  statusNote,
  onActivate,
}: {
  readonly sections: readonly GuideSectionRows[];
  /** Terminal-row budget for the scrollable list — not a count of items. */
  readonly maxRows: number;
  readonly commandMode: boolean;
  readonly commandInput: string;
  readonly commandCursor: number;
  readonly commands: readonly ResolvedAppCommand[];
  readonly highlightedIndex: number;
  readonly footerActions: readonly FooterAction[];
  readonly statusNote: string | null;
  readonly onActivate: (row: GuideRow) => void;
}) {
  const lines = useMemo(() => flattenGuideLines(sections), [sections]);
  const entryCount = useMemo(
    () => sections.reduce((total, section) => total + section.rows.length, 0),
    [sections],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeIndex = Math.min(selectedIndex, Math.max(0, entryCount - 1));

  useInput(
    (input, key) => {
      if (commandMode || entryCount === 0) return;
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) =>
          key.upArrow ? (current - 1 + entryCount) % entryCount : (current + 1) % entryCount,
        );
        return;
      }
      if (key.return) {
        const line = lines.find(
          (candidate) => candidate.kind === "entry" && candidate.entryIndex === safeIndex,
        );
        if (line?.kind === "entry") onActivate(line.row);
      }
    },
    { isActive: !commandMode },
  );

  const selectedLineIndex = lines.findIndex(
    (line) => line.kind === "entry" && line.entryIndex === safeIndex,
  );

  // Budget rendered rows, not logical lines: a section header draws two rows
  // (title + blurb, plus its margin row when it lands mid-window), an entry
  // draws exactly one because its text is truncated to the panel width.
  const lineCost = (line: GuideLine, atWindowStart: boolean) =>
    line.kind === "header" ? (atWindowStart ? 2 : 3) : 1;
  let windowStart = Math.max(0, selectedLineIndex);
  let backfill = 0;
  while (windowStart > 0) {
    const line = lines[windowStart];
    if (line === undefined) break;
    const cost = lineCost(line, false);
    if (backfill + cost > Math.floor(maxRows / 2)) break;
    backfill += cost;
    windowStart -= 1;
  }
  let usedRows = 0;
  let windowEnd = windowStart;
  while (windowEnd < lines.length) {
    const line = lines[windowEnd];
    if (line === undefined) break;
    const cost = lineCost(line, windowEnd === windowStart);
    if (usedRows + cost > maxRows) break;
    usedRows += cost;
    windowEnd += 1;
  }
  const visibleLines = lines.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box flexDirection="row" flexWrap="nowrap">
          <Text color={palette.accent} bold>
            {"❀ Guide"}
          </Text>
          <Text color={palette.muted}>{"  ·  everything Kunai can do"}</Text>
        </Box>
        <Text color={palette.dim}>
          {"Enter runs it — rows marked → live on another screen · ? shows keybindings"}
        </Text>
        {statusNote ? <Text color={palette.accent}>{statusNote}</Text> : null}
        <Box flexDirection="column" marginTop={1}>
          {visibleLines.map((line, index) =>
            line.kind === "header" ? (
              <Box key={`h-${line.title}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                <Text color={palette.text} bold>
                  {line.title}
                </Text>
                <Text color={palette.dim}>{line.blurb}</Text>
              </Box>
            ) : (
              <GuideRowLine
                key={line.row.command}
                row={line.row}
                selected={line.entryIndex === safeIndex}
              />
            ),
          )}
        </Box>
      </Box>
      {commandMode ? (
        <CommandPalette
          input={commandInput}
          cursor={commandCursor}
          commands={commands}
          highlightedIndex={highlightedIndex}
        />
      ) : null}
      <ShellFooter
        taskLabel="↑↓ choose · Enter run · ? keybindings · Esc close"
        actions={footerActions}
        mode="detailed"
        commandMode={commandMode}
        companionHint
      />
    </Box>
  );
}

function GuideRowLine({ row, selected }: { readonly row: GuideRow; readonly selected: boolean }) {
  const { contentColumns } = useOverlayLayout();
  const tag = GUIDE_SURFACE_TAGS[row.surface];
  const inactive = !row.enabled;
  // Everything on the row is truncated to the panel's inner width so an entry
  // can never wrap to a second terminal line — the window math above assumes
  // exactly one row per entry. The full disabled reason still reaches the user
  // through Enter, which shows it on the status line.
  const tagText = row.surface === "run" ? "" : `  ${tag}`;
  const detail = `${row.description}${row.note ? ` · ${row.note}` : ""}${
    inactive && row.reason ? ` — ${row.reason}` : ""
  }`;
  const detailWidth = Math.max(8, contentColumns - 2 - 2 - 24 - tagText.length);
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={selected ? palette.accent : inactive ? palette.dim : palette.text}>
        {truncateLine(row.invocation.padEnd(24), 24)}
      </Text>
      <Text color={inactive ? palette.dim : palette.textDim}>
        {truncateLine(detail, detailWidth)}
      </Text>
      {tagText ? <Text color={palette.dim}>{tagText}</Text> : null}
    </Box>
  );
}
