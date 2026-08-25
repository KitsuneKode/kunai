// =============================================================================
// CapabilityIssueStrip.tsx — what's missing, said once, at the top of the shell
//
// Before this, a missing dependency was announced by a single `console.error`
// in `checkDeps` that the Ink shell painted over milliseconds later, plus a
// diagnostics entry nobody reads. A user with no mpv got a shell that silently
// could not play anything until they tried.
//
// Three rules keep it from becoming the warning banner people learn to ignore:
//
//   1. Derived at render from the live snapshot, never stored. Re-probing
//      clears it; nothing has to be dismissed for it to go away.
//   2. Context-gated. An issue that cannot affect this session's mode is not
//      raised — no ffmpeg warnings when downloads are off, no curl-impersonate
//      warning outside anime mode.
//   3. It says what breaks, not that something is missing.
//
// It takes no keyboard input, for the same reason `AnalyticsDisclosureBanner`
// does not: `ink-shell` owns a global `useInput`, and a second handler would
// make one key mean two things. The full list lives behind `kunai doctor`.
// =============================================================================

import type { CapabilitySnapshot } from "@/ui";
import { Box, Text } from "ink";
import React from "react";

import { buildDependencyRows, selectStartupIssueRows } from "./setup/dependency-rows";
import { palette } from "./shell-theme";

/** At most this many rows, so the strip can never push the shell off screen. */
const MAX_ROWS = 3;

export function CapabilityIssueStrip({
  snapshot,
  mode,
  downloadsEnabled,
  width,
}: {
  readonly snapshot: CapabilitySnapshot;
  readonly mode: "series" | "anime" | "youtube";
  readonly downloadsEnabled: boolean;
  readonly width: number;
}) {
  const rows = selectStartupIssueRows(buildDependencyRows(snapshot), {
    mode,
    downloadsEnabled,
  }).slice(0, MAX_ROWS);

  if (rows.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.warn}
      paddingX={1}
      width={width}
    >
      {rows.map((row) => (
        <Box key={row.id} flexDirection="column">
          <Box>
            <Text color={palette.warn} bold>
              {"△ "}
            </Text>
            <Text color={palette.text}>{row.consequence ?? `${row.name} not found`}</Text>
          </Box>
          {row.fix ? (
            <Box paddingLeft={2}>
              <Text color={palette.accent}>{row.fix}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
      <Text color={palette.dim} dimColor>
        Everything else still works. `kunai doctor` has the full report.
      </Text>
    </Box>
  );
}
