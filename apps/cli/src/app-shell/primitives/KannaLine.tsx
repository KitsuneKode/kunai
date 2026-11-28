import { Text } from "ink";
import React from "react";

import { companionFallbackGlyph } from "../companion-policy";
import { reducedMotionEnabled } from "../motion-policy";
import { measureColumns, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";
import { useShellDimensions } from "../use-viewport-policy";
import { useFrameTick } from "./SakuraPetal";

/**
 * How a line is delivered.
 *
 * - `resting` — she is waiting on you. One ear twitches now and then.
 * - `working` — she is doing something. The tail flicks once as the line lands.
 * - `settled` — it worked. The mark goes still and mint, like a finished petal.
 */
export type KannaLineTone = "resting" | "working" | "settled";

/**
 * The cell beside the glyph. One column in every frame, so nothing reflows.
 *
 * The marks are braille dots, the same family every terminal spinner uses, and
 * for the same reason: one cell wide in every font, and a single dot reads as a
 * flicker of movement rather than as punctuation. An apostrophe in this cell
 * turned her line into a quotation.
 */
const AT_REST = " ";
/** One dot, high: an ear. */
const EAR = "⠁";
/** Dots low in the cell, sweeping: a tail. */
const TAIL = ["⠄", "⠤", "⠠", AT_REST] as const;
const SETTLED = "·";

const TWITCH_INTERVAL_MS = 300;
/** One twitch per this many beats: 300ms of ear every 2.7 seconds. */
const TWITCH_PERIOD = 9;
const TAIL_INTERVAL_MS = 90;
const TYPE_INTERVAL_MS = 30;
/** The whole line is on screen within this many beats — 300ms at most. */
const TYPE_BEATS = 10;

/**
 * One line from the companion, with the small motion that makes it hers.
 *
 * This is the reaction tier, and it lives in character cells on purpose: a
 * terminal that cannot host an image gets exactly the same twitch and the same
 * typed-on line as one that can, and it costs a cell of diff per beat rather
 * than an image upload. Reduced motion pins every clock to zero — the full line
 * and a still mark, from the first frame.
 *
 * `showGlyph` is off where the illustrated fox stands beside the line: one fox
 * per surface, never her picture and her emoji together.
 */
export function KannaLine({
  line,
  tone = "resting",
  showGlyph = true,
  maxWidth,
}: {
  readonly line: string;
  readonly tone?: KannaLineTone;
  readonly showGlyph?: boolean;
  /** Columns available to the whole line, glyph and motion mark included. */
  readonly maxWidth?: number;
}) {
  const { cols } = useShellDimensions();
  // A resting line is already there when the surface appears: it sits under a
  // title someone is reading, and text that assembles itself beside that is a
  // distraction. A line that reports work types on, once, and stops — the host
  // keys this component on the text, so a new line types and an old one never
  // re-types.
  const types = tone !== "resting" && !reducedMotionEnabled();
  const typed = useFrameTick(types, TYPE_INTERVAL_MS, TYPE_BEATS);
  const twitch = useFrameTick(tone === "resting", TWITCH_INTERVAL_MS);
  const flick = useFrameTick(tone === "working", TAIL_INTERVAL_MS, TAIL.length - 1);

  const prefixColumns = (showGlyph ? measureColumns(companionFallbackGlyph()) : 0) + 1;
  // Never let a reaction wrap into the footer grammar: at 40 columns a full
  // sentence otherwise becomes a second row exactly where the compact footer
  // is already wrapping its chips.
  const width = Math.max(8, (maxWidth ?? cols) - prefixColumns - 1);
  const fitted = truncateLine(line, width);
  const shown = types ? fitted.slice(0, Math.ceil((fitted.length * typed) / TYPE_BEATS)) : fitted;
  const mark =
    tone === "settled"
      ? SETTLED
      : tone === "working"
        ? (TAIL[flick] ?? AT_REST)
        : twitch % TWITCH_PERIOD === TWITCH_PERIOD - 1
          ? EAR
          : AT_REST;

  return (
    <Text color={palette.dim}>
      {showGlyph ? companionFallbackGlyph() : ""}
      <Text color={tone === "settled" ? palette.ok : palette.dim}>{mark}</Text>
      {shown}
    </Text>
  );
}
