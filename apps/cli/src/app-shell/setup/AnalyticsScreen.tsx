// =============================================================================
// analytics-screen.tsx — the one screen that has to be exactly true
//
// Recommended and pre-selected, per `.docs/analytics-privacy-contract.md`, with
// one guardrail the input handler enforces: no skip path may enable it. `s`
// here selects off, and `S` (accept every remaining default) stops on this
// screen rather than passing through.
//
// It carries no motion. The petal used to bloom here, under text a person is
// reading to make a privacy decision, while the screen that actually probes the
// machine had none. `design-system.md` warns against exactly that.
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import packageJson from "../../../package.json" with { type: "json" };
import { palette } from "../shell-theme";
import { ChoiceRow, ScreenTitle } from "./SetupFrame";

/** "Turn it on" leads. Index is load-bearing — see the input handler. */
export const ANALYTICS_ON_INDEX = 0;
export const ANALYTICS_OFF_INDEX = 1;

const OPTIONS = [
  {
    label: "Turn it on",
    detail: "One ping a day. Counts unique installs, not people.",
  },
  {
    label: "Keep it off",
    detail: "No network calls. No install id stored on disk.",
  },
];

export function AnalyticsScreen({ selectedIndex }: { readonly selectedIndex: number }) {
  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="Help Kunai know it's being used"
        sub="Recommended. Nothing is sent until you confirm here."
      />

      <Box flexDirection="column">
        {OPTIONS.map((option, i) => (
          <ChoiceRow
            key={option.label}
            label={option.label}
            detail={option.detail}
            selected={i === selectedIndex}
            {...(i === ANALYTICS_ON_INDEX ? { badge: "← recommended" } : {})}
          />
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.muted}>Privacy first, by construction</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={palette.text}>
            {`{ "installId": "<sha256 of a local id>", "version": "${packageJson.version}",`}
          </Text>
          <Text color={palette.text}>
            {`  "os": "${process.platform}", "arch": "${process.arch}", "ts": 0 }`}
          </Text>
          <Text color={palette.dim} dimColor>
            Never: titles · queries · providers · URLs · paths · your IP
          </Text>
          <Text color={palette.dim} dimColor>
            The raw id never leaves this machine. Off in /settings deletes it.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
