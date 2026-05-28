import { Box, Text } from "ink";
import React from "react";

import { composeHeader } from "../format/header";
import { measureColumns, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

/**
 * The single canonical header. Owns brand · destination pill · context · status
 * · size — content must not re-render any of these (kills the duplicate top bar).
 *
 * When `width` is supplied the crumb is budgeted so the row never wraps or lets
 * the context collide with the right-hand status group on a narrow terminal
 * (the "header bleed"). Brand and pill are identity anchors and never truncate;
 * the crumb absorbs the squeeze and drops out entirely when there is no room.
 */
export const AppHeader = React.memo(function AppHeader({
  brand = "🦊 Kunai",
  destination,
  context,
  status,
  statusColor = palette.ok,
  size,
  width,
}: {
  brand?: string;
  destination: string;
  context?: string;
  status?: string;
  statusColor?: string;
  size?: string;
  width?: number;
}) {
  const h = composeHeader({ brand, destination, context, status, size });

  // Budget the crumb against the measured width of the fixed pieces so the
  // header stays one line. "  ·  " (5) separates brand and pill; the crumb gets
  // a 2-col lead gap; the right group reserves its "● " dot (2) plus a 2-col gap.
  const SEP = 5;
  const LEAD = 2;
  const RIGHT_GAP = 2;
  const fixedCols = measureColumns(h.brand) + SEP + measureColumns(h.pill);
  const rightCols = h.right ? (status ? 2 : 0) + measureColumns(h.right) + RIGHT_GAP : 0;
  const contextBudget =
    width === undefined ? Number.POSITIVE_INFINITY : width - fixedCols - rightCols - LEAD;
  const crumb =
    h.context && contextBudget > 0
      ? Number.isFinite(contextBudget)
        ? truncateLine(h.context, contextBudget)
        : h.context
      : "";

  return (
    <Box justifyContent="space-between">
      <Box flexShrink={1}>
        <Text bold color={palette.text} wrap="truncate-end">
          {h.brand}
        </Text>
        <Text color={palette.dim}>{"  ·  "}</Text>
        <Text bold color={palette.bg} backgroundColor={palette.text} wrap="truncate-end">
          {h.pill}
        </Text>
        {crumb ? <Text color={palette.muted} wrap="truncate-end">{`  ${crumb}`}</Text> : null}
      </Box>
      {h.right ? (
        <Box flexShrink={0}>
          {status ? <Text color={statusColor}>{"● "}</Text> : null}
          <Text color={palette.muted} wrap="truncate-end">
            {h.right}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
