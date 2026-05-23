import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "../shell-text";
import { hotkeyLabel, palette } from "../shell-theme";

export type ActionRowTone = "normal" | "success" | "warning" | "danger" | "muted";

export type ActionRowModel = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly shortcut?: string;
  readonly tone?: ActionRowTone;
  readonly disabledReason?: string;
};

export function normalizeActionShortcut(shortcut: string): string {
  return shortcut.replace(/^\[/u, "").replace(/\]$/u, "");
}

export function getEnabledActionRows(rows: readonly ActionRowModel[]): readonly ActionRowModel[] {
  return rows.filter((row) => !row.disabledReason);
}

function toneColor(tone: ActionRowTone | undefined): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.danger;
  if (tone === "muted") return palette.dim;
  return palette.text;
}

export function ActionRow({
  row,
  selected = false,
  width = 72,
}: {
  readonly row: ActionRowModel;
  readonly selected?: boolean;
  readonly width?: number;
}) {
  const disabled = Boolean(row.disabledReason);
  const detailWidth = Math.max(10, width - 24);
  return (
    <Box>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={disabled ? palette.dim : toneColor(row.tone)} bold={!disabled}>
        {truncateLine(row.label, 18).padEnd(18)}
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
      {rows.map((row, index) => (
        <ActionRow key={row.id} row={row} selected={index === selectedIndex} width={width} />
      ))}
    </Box>
  );
}

export default ActionList;
