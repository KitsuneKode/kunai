// The one screen that has to be exactly true
//
// Neutral, per `.docs/analytics-privacy-contract.md`: nothing is pre-selected,
// and neither answer is marked as the recommended one. The cursor starts on no
// row, Enter does nothing until a row is chosen, and no skip path may enable
// it. `s` here means "don't share", and `S` (accept every remaining default)
// stays on this screen without choosing.
//
// The payload preview is the real one: the shell passes what
// `describePayload()` returns, so the copy cannot drift from the wire.
//
// It carries no motion. The petal used to bloom here, under text a person is
// reading to make a privacy decision, while the screen that actually probes the
// machine had none. `design-system.md` warns against exactly that.

import type { AnalyticsPayload } from "@/services/analytics/usage-analytics-service";
import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";
import { ChoiceRow, ScreenTitle } from "./SetupFrame";

/** What each row answers, in row order. The cursor starts on neither. */
export const CONSENT_CHOICES = ["enabled", "disabled"] as const;

const OPTIONS = [
  {
    label: "Share anonymous usage",
    detail: "One ping a day. Counts installs, not people. The id changes every month.",
  },
  {
    label: "Don't share",
    detail: "No network calls. No install id stored on disk.",
  },
];

/**
 * Where an arrow moves the consent cursor. From no selection, down lands on the
 * first row and up on the last; after that it stays within the two rows.
 */
export function moveConsentCursor(current: number | null, delta: number): number {
  const last = CONSENT_CHOICES.length - 1;
  if (current === null) return delta > 0 ? 0 : last;
  return Math.max(0, Math.min(last, current + delta));
}

/** Widest a preview line gets before the next field starts a new one. */
const PREVIEW_LINE_BUDGET = 60;

/**
 * The payload as JSON, packed a few fields to a line so it reads like the body
 * it is without taking a row per key.
 */
export function payloadPreviewLines(payload: AnalyticsPayload): readonly string[] {
  const fields = Object.entries(payload).map(
    ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  const lines: string[] = [];
  let current = "";
  for (const field of fields) {
    if (current && current.length + field.length + 2 > PREVIEW_LINE_BUDGET) {
      lines.push(`${current},`);
      current = field;
    } else {
      current = current ? `${current}, ${field}` : field;
    }
  }
  if (current) lines.push(current);
  return lines.map(
    (line, i) => `${i === 0 ? "{ " : "  "}${line}${i === lines.length - 1 ? " }" : ""}`,
  );
}

export function AnalyticsScreen({
  selectedIndex,
  payload,
}: {
  /** `null` until a key moves the cursor: a cursor is not an answer. */
  readonly selectedIndex: number | null;
  readonly payload: AnalyticsPayload;
}) {
  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="Share anonymous usage with Kunai?"
        sub="Pick one with ↑↓ and Enter. Nothing is sent unless you choose to share."
      />

      <Box flexDirection="column">
        {OPTIONS.map((option, i) => (
          <ChoiceRow
            key={option.label}
            label={option.label}
            detail={option.detail}
            selected={i === selectedIndex}
          />
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.muted}>The whole ping, as it would be sent</Text>
        <Box paddingLeft={2} flexDirection="column">
          {payloadPreviewLines(payload).map((line) => (
            <Text key={line} color={palette.text}>
              {line}
            </Text>
          ))}
          <Text color={palette.dim}>
            Never: titles · queries · providers · URLs · paths · your IP
          </Text>
          <Text color={palette.dim}>
            The raw id never leaves this machine. Off in /settings deletes it.
          </Text>
          <Text color={palette.dim}>See every ping that was sent: kunai analytics log</Text>
        </Box>
      </Box>
    </Box>
  );
}
