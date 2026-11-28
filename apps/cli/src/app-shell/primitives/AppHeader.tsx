import { Box, Text } from "ink";
import React from "react";

import { composeHeader } from "../format/header";
import { plainBrandLabel, plainModeEnabled } from "../plain-mode";
import { measureColumns, truncateLine } from "../shell-text";
import { APP_LABEL, palette } from "../shell-theme";

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
  brand = APP_LABEL,
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
  const plain = plainModeEnabled();
  if (plain) {
    const parts = [
      brand === APP_LABEL ? plainBrandLabel(true) : brand.replace(/^🦊\s*/u, ""),
      destination,
      context?.trim() || undefined,
      status ? `Status: ${status}` : undefined,
      size ? `Terminal: ${size}` : undefined,
    ].filter((part): part is string => Boolean(part));
    const line = parts.join(" | ");
    return (
      <Box>
        <Text bold color={palette.text}>
          {width === undefined ? line : truncateLine(line, Math.max(12, width))}
        </Text>
      </Box>
    );
  }

  const compact = width !== undefined && width < 48;
  const compactBrand = compact && brand === APP_LABEL ? "🦊" : brand;
  const separator = compact ? " · " : "  ·  ";
  const h = composeHeader({ brand: compactBrand, destination, context, status, size });

  // Budget the crumb against the measured width of the fixed pieces so the
  // header stays one line. At narrow widths the brand collapses to the fox and
  // the separator tightens before anything semantic is sacrificed. If the row
  // still cannot fit, terminal size drops before the live status; the status is
  // truncated only as the final resort.
  const SEP = measureColumns(separator);
  const LEAD = 2;
  const RIGHT_GAP = 2;
  const fixedCols = measureColumns(h.brand) + SEP + measureColumns(h.pill);
  const measuredRightCols = (right: string) =>
    right ? (status ? 2 : 0) + measureColumns(right) + RIGHT_GAP : 0;

  let right = h.right;
  if (width !== undefined && fixedCols + measuredRightCols(right) > width && status && size) {
    right = status;
  }
  if (width !== undefined && right) {
    const rightTextBudget = width - fixedCols - RIGHT_GAP - (status ? 2 : 0);
    right = rightTextBudget > 0 ? truncateLine(right, rightTextBudget) : "";
  }

  const rightCols = measuredRightCols(right);
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
        <Text color={palette.dim}>{separator}</Text>
        <Text bold color={palette.bg} backgroundColor={palette.text} wrap="truncate-end">
          {h.pill}
        </Text>
        {crumb ? <Text color={palette.muted} wrap="truncate-end">{`  ${crumb}`}</Text> : null}
      </Box>
      {right ? (
        <Box flexShrink={0}>
          {status ? <Text color={statusColor}>{"● "}</Text> : null}
          <Text color={palette.muted} wrap="truncate-end">
            {right}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
