import {
  buildTrackPanelRows,
  type TrackCapability,
  type TrackCapabilityGroup,
  type TrackCapabilityRisk,
} from "@/domain/playback/track-capabilities";
import { Box, Text } from "ink";
import React from "react";

import { getWindowStart, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

export type TracksPanelShellProps = {
  groups: readonly TrackCapabilityGroup[];
  /** Index over switchable rows only; -1 (or out of range) when nothing is selectable. */
  selectedIndex: number;
  width: number;
  height?: number;
};

function riskColor(risk: TrackCapabilityRisk): string {
  switch (risk) {
    case "failed":
      return palette.danger;
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
  if (capability.selected) return palette.ok;
  if (!capability.enabled) return palette.muted;
  return riskColor(capability.risk);
}

function rowTag(capability: TrackCapability): string | null {
  if (capability.selected) return "current";
  if (capability.risk === "failed") return "failed";
  if (capability.risk === "fallback") return "fallback";
  if (capability.risk === "unavailable") return "unavailable";
  if (capability.enabled) return "available";
  return null;
}

export const TracksPanelShell = React.memo(function TracksPanelShell({
  groups,
  selectedIndex,
  width,
  height,
}: TracksPanelShellProps) {
  const rows = buildTrackPanelRows(groups);
  const labelWidth = Math.min(28, Math.max(14, Math.floor(width * 0.4)));
  const sourceCount = groups.find((group) => group.section === "source")?.rows.length ?? 0;
  const qualityCount = groups.find((group) => group.section === "quality")?.rows.length ?? 0;
  const audioCount = groups.find((group) => group.section === "audio")?.rows.length ?? 0;
  const subtitleCount = groups.find((group) => group.section === "subtitle")?.rows.length ?? 0;
  const maxVisibleRows = Math.max(6, Math.min(rows.length, (height ?? 22) - 2));
  const highlightedRowIndex = Math.max(
    0,
    rows.findIndex((row) => row.kind === "row" && row.selectableIndex === selectedIndex),
  );
  const windowStart = getWindowStart(highlightedRowIndex, rows.length, maxVisibleRows);
  const visibleRows = rows.slice(windowStart, windowStart + maxVisibleRows);
  const hiddenAbove = windowStart;
  const hiddenBelow = Math.max(0, rows.length - windowStart - visibleRows.length);

  if (rows.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={palette.muted}>No stream details available for this title yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={palette.dim}>
          {truncateLine(
            [
              sourceCount ? `${sourceCount} sources` : null,
              qualityCount ? `${qualityCount} qualities` : null,
              audioCount ? `${audioCount} audio` : null,
              subtitleCount ? `${subtitleCount} subtitles` : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join("  ·  "),
            width - 2,
          )}
        </Text>
      </Box>
      {hiddenAbove > 0 ? <Text color={palette.dim}>{`↑ ${hiddenAbove} more`}</Text> : null}
      {visibleRows.map((row, offset) => {
        const index = windowStart + offset;
        if (row.kind === "header") {
          return (
            <Box key={`h-${row.group.section}`} marginTop={index === 0 ? 0 : 1}>
              <Text color={palette.textDim} bold>
                {row.group.title}
              </Text>
              {!row.group.selectable ? <Text color={palette.dim}>{"  ·  facts"}</Text> : null}
            </Box>
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
        const highlighted = row.selectableIndex === selectedIndex;
        const color = rowColor(capability, highlighted);
        const tag = rowTag(capability);
        const marker = highlighted ? "▌ " : capability.selected ? "› " : "  ";
        const detailParts = [tag, capability.detail, capability.reason].filter(
          (part): part is string => Boolean(part),
        );

        return (
          <Box key={`r-${row.group.section}-${capability.value}`} flexDirection="row">
            <Text color={highlighted ? palette.accent : palette.dim}>{marker}</Text>
            <Box width={labelWidth}>
              <Text color={color} bold={highlighted || capability.selected} wrap="truncate">
                {capability.label}
              </Text>
            </Box>
            {detailParts.length > 0 ? (
              <Text color={highlighted ? palette.accentSoft : palette.dim}>
                {truncateLine(detailParts.join("  ·  "), Math.max(8, width - labelWidth - 6))}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {hiddenBelow > 0 ? <Text color={palette.dim}>{`↓ ${hiddenBelow} more`}</Text> : null}
    </Box>
  );
});
