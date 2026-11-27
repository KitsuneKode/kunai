import { Box, Text } from "ink";
import React, { useState } from "react";

import { poseForMoment, voiceForMoment, type CompanionMoment } from "./companion-moment";
import { companionFallbackGlyph, companionMode } from "./companion-policy";
import { CompanionPet } from "./CompanionPet";
import { kannaLine } from "./kanna-voice";
import { reducedMotionEnabled } from "./motion-policy";
import { useFrameTick } from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

/**
 * The one place a companion is drawn.
 *
 * Surfaces report a moment; this decides the pose and the line, owns the
 * placement, and owns the space around it. That inversion is the whole point:
 * with sixteen `StateBlock` mount sites and three shells that render several
 * each, per-surface pets meant several components each believing they owned the
 * single Kitty slot, and the registry deletes the previous image whenever a
 * different one claims a slot. The setup wizard shipped that bug in both of its
 * forms — first as two pets erasing each other, then, once they had separate
 * slots, as two of her stacked on one screen.
 *
 * The spacing is here for the same reason. A `Box` with a margin around a null
 * child still lays out its margin, so a caller that wraps the companion and
 * forgets to gate the wrapper leaves an empty row behind when `KUNAI_PET=off` —
 * which is not "retired entirely". Owning the margin means there is no wrapper
 * left to forget.
 *
 * What renders, per tier:
 *
 * - `graphics` with `picture` — her, and her line beside her if the moment has one.
 * - `glyph`, or a picture standing down for a poster — `🦊 line`, or nothing at
 *   all where the moment has no line. A lone 🦊 is a stray emoji, not presence.
 * - `off` — nothing, margin included.
 *
 * A surface that has nothing to say passes `null` and gets nothing at all.
 * That is the common case and it is deliberately the easy one to write.
 */
export function CompanionHost({
  moment,
  picture = true,
  rows = 4,
  pick,
  marginTop,
  marginBottom,
  marginRight,
}: {
  readonly moment: CompanionMoment | null;
  /** Whether her picture may be drawn here. The line is decided by the moment. */
  readonly picture?: boolean;
  /** Height in terminal rows. Width is derived so the slot is square on screen. */
  readonly rows?: number;
  /** Which line of the moment's pool. Rolled once per mount when omitted. */
  readonly pick?: number;
  /** Space around her, applied only when she actually renders. */
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginRight?: number;
}) {
  // Fixed when the surface mounts, so a keystroke or a resize never re-rolls
  // the line out from under the reader.
  const [rolled] = useState(() => Math.floor(Math.random() * 997));
  const mode = companionMode();
  if (moment === null || mode === "off") return null;

  const voice = voiceForMoment(moment);
  const line = voice === null ? null : kannaLine(voice, pick ?? rolled);
  const drawn = mode === "graphics" && picture;
  if (!drawn && line === null) return null;

  return (
    <Box
      marginTop={marginTop}
      marginBottom={marginBottom}
      marginRight={marginRight}
      flexDirection="row"
      alignItems="center"
    >
      {drawn ? <CompanionPet pose={poseForMoment(moment)} rows={rows} /> : null}
      {line === null ? null : (
        // Keyed by the line, so a new moment types its line on from the start.
        <KannaLine
          key={line}
          text={drawn ? line : `${companionFallbackGlyph()} ${line}`}
          gap={drawn ? 2 : 0}
        />
      )}
    </Box>
  );
}

/** Characters revealed per frame, and the frame interval: a line lands in ≤300ms. */
const TYPE_ON_CHARS = 4;
const TYPE_ON_INTERVAL_MS = 30;

/**
 * Her line, typed on once when it appears.
 *
 * The one reaction that reaches every tier: the glyph cannot twitch, but the
 * line can arrive like something said rather than something printed. It runs
 * once per line on a transition and stops — `useFrameTick`'s `stopAfter` — so no
 * timer outlives it, and under reduced motion the line is simply there.
 */
function KannaLine({ text, gap }: { readonly text: string; readonly gap: number }) {
  const chars = [...text];
  const frames = Math.ceil(chars.length / TYPE_ON_CHARS);
  const tick = useFrameTick(true, TYPE_ON_INTERVAL_MS, frames);
  const shown = reducedMotionEnabled()
    ? text
    : chars.slice(0, Math.min(chars.length, (tick + 1) * TYPE_ON_CHARS)).join("");
  return (
    <Box marginLeft={gap}>
      <Text color={palette.dim}>{shown}</Text>
    </Box>
  );
}
