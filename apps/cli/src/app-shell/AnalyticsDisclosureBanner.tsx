// The one-time notice for upgraders
//
// Users who never see the setup wizard sit at analytics: "unset" and would
// otherwise never be told. This shows once, on the first interactive launch
// after upgrade, and never again.
//
// It takes no keyboard input on purpose: `ink-shell` owns a global `useInput`
// handler, and a second one here would make Enter both dismiss the notice and
// fire whatever Enter means in the current view. It auto-hides instead.

import { ANALYTICS_PAYLOAD_FIELDS } from "@/services/analytics/usage-analytics-service";
import { Box, Text } from "ink";
import React from "react";

import { plainBorderStyle, plainModeEnabled } from "./plain-mode";
import { STATIC_PETAL } from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

/** Long enough to read four short lines without rushing, short enough not to squat. */
export const ANALYTICS_NOTICE_VISIBLE_MS = 15_000;

export function AnalyticsDisclosureBanner({ width }: { readonly width: number }) {
  const plain = plainModeEnabled();
  return (
    <Box
      flexDirection="column"
      borderStyle={plainBorderStyle("round", plain)}
      borderColor={plain ? undefined : palette.accent}
      paddingX={plain ? 0 : 1}
      width={width}
    >
      <Box>
        {plain ? (
          <Text color={palette.text} bold>
            Notice: Anonymous usage analytics is not enabled
          </Text>
        ) : (
          <>
            <Text color={palette.accent} bold>
              {STATIC_PETAL}
            </Text>
            <Text color={palette.text} bold>
              {"  Anonymous usage analytics is not enabled"}
            </Text>
          </>
        )}
      </Box>
      <Text color={palette.muted}>
        One ping a day: {ANALYTICS_PAYLOAD_FIELDS.join(", ")}. Nothing else.
      </Text>
      <Text color={palette.dim}>Never: titles · queries · providers · URLs · paths</Text>
      <Text color={palette.muted}>This is opt-in. Enable or disable it later in Settings.</Text>
    </Box>
  );
}
