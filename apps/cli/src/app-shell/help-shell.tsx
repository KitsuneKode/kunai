import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import { helpSections, type HelpSection } from "./keybindings";
import { plainModeEnabled, plainTabLabel } from "./plain-mode";
import { CommandPalette } from "./shell-command-ui";
import { ShellFooter } from "./shell-primitives";
import { palette } from "./shell-theme";
import type { FooterAction } from "./types";

const HELP_TABS_INTERNAL = helpSections().map((section) => section.group);
const HELP_SECTION_BY_GROUP = new Map<string, HelpSection>(
  helpSections().map((section) => [section.group, section]),
);

/** Render rows for a given help tab, direct from the keybinding registry. */
export function helpTabRows(tab: string): readonly { key: string; desc: string }[] {
  return (HELP_SECTION_BY_GROUP.get(tab)?.items ?? []).map((hint) => ({
    key: hint.keys,
    desc: hint.label,
  }));
}

/** Ordered help tab groups captured once so render does not re-derive them. */
export const HELP_TABS: readonly string[] = HELP_TABS_INTERNAL;

/** Test seam over the same registry rows the live overlay renders. */
export function buildHelpTabRows(tab: string): readonly { key: string; desc: string }[] {
  return helpTabRows(tab);
}

export function HelpShell({
  sections,
  scopeLabel,
  commandMode,
  commandInput,
  commandCursor,
  commands,
  highlightedIndex,
  footerActions,
  onClose,
}: {
  /** Scope-filtered help sections for the surface beneath the overlay. */
  sections: readonly HelpSection[];
  /** Human label for the active scope, shown in the header (e.g. "playing"). */
  scopeLabel: string;
  commandMode: boolean;
  commandInput: string;
  commandCursor: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  footerActions: readonly FooterAction[];
  onClose: () => void;
}) {
  const tabs = sections.length > 0 ? sections.map((section) => section.group) : HELP_TABS;
  const sectionByGroup = useMemo(
    () => new Map(sections.map((section) => [section.group, section])),
    [sections],
  );
  const [activeTab, setActiveTab] = useState<string>(tabs[0] ?? "Global");
  // Scope can change while the overlay is open (playback starts/ends); keep the
  // active tab valid instead of rendering an empty body.
  const safeActiveTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? "Global");

  useInput(
    (input, key) => {
      if (commandMode) return;
      if (key.tab) {
        setActiveTab((prev) => {
          const idx = tabs.indexOf(prev);
          const delta = key.shift ? -1 : 1;
          const next = tabs[(idx + delta + tabs.length) % tabs.length];
          return next ?? tabs[0] ?? prev;
        });
        return;
      }
      if (input === "?") {
        // The global `?` binding only fires "open help". When help is already
        // at the top, the same key should close it. Bail to Esc-style close
        // here so the user has a single, predictable toggle key.
        onClose();
      }
    },
    { isActive: !commandMode },
  );

  const plain = plainModeEnabled();
  const rows = (sectionByGroup.get(safeActiveTab)?.items ?? []).map((hint) => ({
    key: hint.keys,
    desc: hint.label,
  }));
  // Dense reference card: split the active section's rows into two balanced
  // columns so a long surface (player/postPlayback) reads without scrolling.
  // Plain mode keeps one column so a screen reader hears each binding in order.
  const half = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, half);
  const rightRows = rows.slice(half);
  const keyColWidth = Math.max(8, ...rows.map((row) => row.key.length));
  const renderColumn = (columnRows: typeof rows, side: "left" | "right") => (
    <Box flexDirection="column" flexGrow={1} marginRight={side === "left" ? 2 : 0}>
      {columnRows.map((row) => (
        <Box key={row.key} flexDirection="row" marginBottom={0} flexWrap="nowrap">
          <Text color={palette.accent}>{row.key.padEnd(keyColWidth)}</Text>
          <Text color={palette.textDim}> {row.desc}</Text>
        </Box>
      ))}
    </Box>
  );
  const renderPlainRows = (
    <Box flexDirection="column" marginTop={1}>
      {rows.map((row) => (
        <Text key={row.key} color={palette.text}>
          {`${row.key}  ${row.desc}`}
        </Text>
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box flexDirection="row" flexWrap="nowrap">
          <Text color={palette.accent} bold>
            {plain ? "Help" : "❀ Help"}
          </Text>
          <Text color={palette.muted}>{plain ? `: ${scopeLabel}` : `  ·  ${scopeLabel}`}</Text>
        </Box>
        <Text color={palette.dim}>
          {plain
            ? "Tab or Shift+Tab cycles sections. Esc or ? closes"
            : "Tab / Shift+Tab cycles sections · Esc or ? closes"}
        </Text>
        <Box flexDirection="row" marginTop={1} marginBottom={0} flexWrap="wrap">
          {tabs.map((tab) => (
            <Box key={tab} marginRight={3} flexDirection="column">
              <Text color={safeActiveTab === tab ? palette.accent : palette.dim}>
                {plainTabLabel(tab, safeActiveTab === tab, plain)}
              </Text>
              {!plain && safeActiveTab === tab ? (
                <Text color={palette.accent}>{"─".repeat(tab.length)}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
        {plain ? (
          renderPlainRows
        ) : (
          <Box flexDirection="row" marginTop={1}>
            {renderColumn(leftRows, "left")}
            {rightRows.length > 0 ? renderColumn(rightRows, "right") : null}
          </Box>
        )}
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
        taskLabel={
          plain
            ? "Tab or Shift+Tab cycles sections. Esc or ? closes"
            : "Tab/Shift+Tab sections · Esc or ? closes"
        }
        actions={footerActions}
        mode="detailed"
        commandMode={commandMode}
        companionHint
      />
    </Box>
  );
}
