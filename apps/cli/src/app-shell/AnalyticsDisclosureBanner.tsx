// =============================================================================
// AnalyticsDisclosureBanner.tsx — the one-time notice for upgraders
//
// Users who never see the setup wizard sit at analytics: "unset" and would
// otherwise never be told. This shows once, on the first interactive launch
// after upgrade, and never again.
//
// It takes no keyboard input on purpose: `ink-shell` owns a global `useInput`
// handler, and a second one here would make Enter both dismiss the notice and
// fire whatever Enter means in the current view. It auto-hides instead.
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import { STATIC_PETAL } from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

/** Long enough to read four short lines without rushing, short enough not to squat. */
export const ANALYTICS_NOTICE_VISIBLE_MS = 15_000;

export function AnalyticsDisclosureBanner({ width }: { readonly width: number }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.accent}
      paddingX={1}
      width={width}
    >
      <Box>
        <Text color={palette.accent} bold>
          {STATIC_PETAL}
        </Text>
        <Text color={palette.text} bold>
          {"  Anonymous usage analytics is not enabled"}
        </Text>
      </Box>
      <Text color={palette.muted}>
        Once a day Kunai sends installId, version, os, arch, ts — nothing else.
      </Text>
      <Text color={palette.dim} dimColor>
        Never: titles · queries · providers · URLs · paths
      </Text>
      <Text color={palette.muted}>This is opt-in. Enable or disable it later in Settings.</Text>
    </Box>
  );
}
