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
// It also has to fit. Below 70 content columns the two details use their short
// form and the payload wraps to the frame; it used to wrap to a fixed 60, which
// at 54x25 pushed the title and both option labels out of the frame. At the
// size floor the preview is the payload's field names, read from the same
// object, and `p` opens the values as a view of their own; while it is open
// no key can reach the answers behind it. None of that touches the decision.
//
// It carries no motion. The petal used to bloom here, under text a person is
// reading to make a privacy decision, while the screen that actually probes the
// machine had none. `design-system.md` warns against exactly that.

import type { AnalyticsPayload } from "@/services/analytics/usage-analytics-service";
import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled } from "../plain-mode";
import { palette } from "../shell-theme";
import type { SetupDensity } from "./setup-verdict";
import { ChoiceRow, ScreenTitle } from "./SetupFrame";

/** What each row answers, in row order. The cursor starts on neither. */
export const CONSENT_CHOICES = ["enabled", "disabled"] as const;

const OPTIONS = [
  {
    label: "Share anonymous usage",
    detail: "One ping a day. Counts installs, not people. The id changes every month.",
    short: "One ping a day. Counts installs, not people.",
  },
  {
    label: "Don't share",
    detail: "No network calls. No install id stored on disk.",
    short: "No network calls. No install id on disk.",
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
export function payloadPreviewLines(
  payload: AnalyticsPayload,
  budget: number = PREVIEW_LINE_BUDGET,
): readonly string[] {
  const fields = Object.entries(payload).map(
    ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  const lines: string[] = [];
  let current = "";
  for (const field of fields) {
    if (current && current.length + field.length + 2 > budget) {
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
  density = "wide",
  contentWidth = 76,
  expanded = false,
}: {
  /** `null` until a key moves the cursor: a cursor is not an answer. */
  readonly selectedIndex: number | null;
  readonly payload: AnalyticsPayload;
  readonly density?: SetupDensity;
  /** Columns inside the frame, from `setupContentWidth`. */
  readonly contentWidth?: number;
  /** Size floor only: `p` swapped the field names for the values. */
  readonly expanded?: boolean;
}) {
  const wide = density === "wide";
  const tiny = density === "tiny";
  const plain = plainModeEnabled();
  // The preview sits two columns in, and its own continuation lines two more.
  const preview = payloadPreviewLines(
    payload,
    Math.min(PREVIEW_LINE_BUDGET, Math.max(24, contentWidth - 6)),
  );

  // The size floor has about seven rows. Every line here is one row and is
  // truncated, never wrapped: an overflowing consent screen does not scroll,
  // it drops rows, and the rows it dropped were the two answers.
  if (tiny && expanded) {
    return (
      <Box flexDirection="column">
        {Object.entries(payload).map(([key, value]) => (
          <Text key={key} color={palette.text} wrap="truncate">
            {`${JSON.stringify(key)}: ${JSON.stringify(value)}`}
          </Text>
        ))}
        <Text color={palette.dim} wrap="truncate">
          Any key goes back.
        </Text>
      </Box>
    );
  }
  if (tiny) {
    return (
      <Box flexDirection="column">
        <Text color={palette.text} bold wrap="truncate">
          Share anonymous usage?
        </Text>
        <Text color={palette.muted} wrap="truncate">
          Nothing is sent unless you choose.
        </Text>
        {OPTIONS.map((option, i) => (
          <ChoiceRow
            key={option.label}
            label={option.label}
            detail={option.short}
            selected={i === selectedIndex}
            hideDetail
          />
        ))}
        <Text color={palette.text} wrap="truncate">
          {Object.keys(payload).join(", ")}
        </Text>
        <Text color={palette.dim} wrap="truncate">
          That is all of it · p for values
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ScreenTitle
        text="Share anonymous usage with Kunai?"
        sub={
          wide
            ? "Pick one with ↑↓ and Enter. Nothing is sent unless you choose to share."
            : "Nothing is sent unless you choose to share."
        }
      />

      <Box flexDirection="column">
        {OPTIONS.map((option, i) => (
          <ChoiceRow
            key={option.label}
            label={option.label}
            // Plain mode's `[selected] ` prefix takes eleven columns, and the
            // long form then wraps under it and swallows the prefix's space.
            detail={wide && !plain ? option.detail : option.short}
            selected={i === selectedIndex}
          />
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.muted}>The whole ping, as it would be sent</Text>
        <Box paddingLeft={2} flexDirection="column">
          {preview.map((line) => (
            <Text key={line} color={palette.text}>
              {line}
            </Text>
          ))}
          {wide ? (
            <>
              <Text color={palette.dim}>
                Never: titles · queries · providers · URLs · paths · your IP
              </Text>
              <Text color={palette.dim}>
                The raw id never leaves this machine. Off in /settings deletes it.
              </Text>
              <Text color={palette.dim}>See every ping that was sent: kunai analytics log</Text>
            </>
          ) : (
            <>
              <Text color={palette.dim}>
                Never: titles · queries · providers · URLs · paths · your IP. Off in /settings
                deletes it.
              </Text>
              <Text color={palette.dim}>Sent pings: kunai analytics log</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
