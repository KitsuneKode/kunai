import { Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

const BOOLEAN_SWITCH_WIDTH = 8;

export function BooleanSwitch({
  on,
  width = BOOLEAN_SWITCH_WIDTH,
}: {
  on: boolean;
  width?: number;
}) {
  const label = on ? "● on" : "○ off";
  return (
    <Text color={on ? palette.ok : palette.muted} dimColor={!on}>
      {label.padEnd(width)}
    </Text>
  );
}

export function SegmentSwitch({
  labels,
  activeIndex,
}: {
  labels: readonly string[];
  activeIndex: number;
}) {
  return (
    <Text>
      {labels.map((label, index) => {
        const active = index === activeIndex;
        return (
          <Text
            key={label}
            color={active ? palette.ok : palette.muted}
            bold={active}
            dimColor={!active}
          >
            {index > 0 ? "  " : ""}
            {active ? "● " : "○ "}
            {label}
          </Text>
        );
      })}
    </Text>
  );
}

export function SettingsSwitchRow({
  label,
  detail,
  on,
  selected,
}: {
  label: string;
  detail?: string;
  on: boolean;
  selected: boolean;
}) {
  return (
    <Text wrap="truncate-end">
      <BooleanSwitch on={on} />
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={palette.text} bold={selected}>
        {label}
      </Text>
      {detail ? (
        <Text color={palette.muted} dimColor>
          {`  ${detail}`}
        </Text>
      ) : null}
    </Text>
  );
}
