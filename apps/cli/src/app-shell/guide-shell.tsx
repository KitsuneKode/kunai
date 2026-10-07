import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import { GUIDE_SURFACE_TAGS, type GuideRow, type GuideSectionRows } from "./guide-model";
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
  maxVisible,
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
  readonly maxVisible: number;
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
  const windowStart = Math.max(
    0,
    Math.min(
      selectedLineIndex - Math.floor(maxVisible / 2),
      Math.max(0, lines.length - maxVisible),
    ),
  );
  const visibleLines = lines.slice(windowStart, windowStart + maxVisible);

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
  const tag = GUIDE_SURFACE_TAGS[row.surface];
  const inactive = !row.enabled;
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={selected ? palette.accent : inactive ? palette.dim : palette.text}>
        {row.invocation.padEnd(24)}
      </Text>
      <Text color={inactive ? palette.dim : palette.textDim}>
        {row.description}
        {row.note ? ` · ${row.note}` : ""}
        {inactive && row.reason ? ` — ${row.reason}` : ""}
      </Text>
      {row.surface !== "run" ? <Text color={palette.dim}>{`  ${tag}`}</Text> : null}
    </Box>
  );
}
