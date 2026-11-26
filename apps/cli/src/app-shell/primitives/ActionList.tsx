import { Box, Text } from "ink";
import React from "react";

import { PressRow } from "../mouse/PickRow";
import { plainModeEnabled, selectionPrefix } from "../plain-mode";
import { padColumnsEnd, truncateLine } from "../shell-text";
import { hotkeyLabel, palette } from "../shell-theme";
import {
  normalizeActionShortcut,
  type ActionRowModel,
  type ActionRowTone,
} from "./ActionList.model";

function toneColor(tone: ActionRowTone | undefined): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.dangerText;
  if (tone === "muted") return palette.dim;
  return palette.text;
}

function ActionRow({
  row,
  selected = false,
  width = 72,
}: {
  readonly row: ActionRowModel;
  readonly selected?: boolean;
  readonly width?: number;
}) {
  const plain = plainModeEnabled();
  const disabled = Boolean(row.disabledReason);
  if (plain) {
    const shortcut = row.shortcut ? ` (${hotkeyLabel(normalizeActionShortcut(row.shortcut))})` : "";
    const detail = row.disabledReason
      ? ` — unavailable: ${row.disabledReason}`
      : row.detail
        ? ` — ${row.detail}`
        : "";
    return (
      <Box>
        <Text color={disabled ? palette.dim : toneColor(row.tone)} bold={selected && !disabled}>
          {`${selectionPrefix(selected, true)}${row.label}${shortcut}${detail}`}
        </Text>
      </Box>
    );
  }
  const detailWidth = Math.max(10, width - 24);
  return (
    <Box>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={disabled ? palette.dim : toneColor(row.tone)} bold={!disabled}>
        {padColumnsEnd(truncateLine(row.label, 18), 18)}
      </Text>
      <Text color={disabled ? palette.dim : palette.muted}>
        {truncateLine(row.disabledReason ?? row.detail ?? "", detailWidth)}
      </Text>
      {row.shortcut ? (
        <Text color={disabled ? palette.dim : palette.accent}>
          {" "}
          {hotkeyLabel(normalizeActionShortcut(row.shortcut))}
        </Text>
      ) : null}
    </Box>
  );
}

export function ActionList({
  rows,
  selectedIndex = 0,
  width = 72,
}: {
  readonly rows: readonly ActionRowModel[];
  readonly selectedIndex?: number;
  readonly width?: number;
}) {
  return (
    <Box flexDirection="column">
      {/* A click presses the row's shortcut — the surface's own key handler. */}
      {rows.map((row, index) => (
        <PressRow key={row.id} id={`action:${row.id}:${row.label}`} keyHint={row.shortcut ?? ""}>
          <ActionRow row={row} selected={index === selectedIndex} width={width} />
        </PressRow>
      ))}
    </Box>
  );
}
