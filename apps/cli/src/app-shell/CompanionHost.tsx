import { Box } from "ink";
import React from "react";

import {
  poseForMoment,
  voiceForMoment,
  type CompanionCue,
  type CompanionMoment,
} from "./companion-moment";
import { companionMode } from "./companion-policy";
import { CompanionPet } from "./CompanionPet";
import { kannaLine } from "./kanna-voice";
import { KannaLine, type KannaLineTone } from "./primitives/KannaLine";
import { useShellDimensions } from "./use-viewport-policy";

/** Moments where the work came good; the line settles instead of flicking. */
const SETTLED_MOMENTS: ReadonlySet<CompanionMoment> = new Set(["recovered", "handoff"]);
/** Moments where she is waiting on the reader rather than working. */
const RESTING_MOMENTS: ReadonlySet<CompanionMoment> = new Set(["setup", "farewell", "stuck"]);

function toneFor(moment: CompanionMoment): KannaLineTone {
  if (SETTLED_MOMENTS.has(moment)) return "settled";
  return RESTING_MOMENTS.has(moment) ? "resting" : "working";
}

/**
 * The one place a companion is drawn, and the one place she speaks for a moment.
 *
 * Surfaces report a moment; this decides the pose, owns the placement, owns the
 * line and owns the space around it. That inversion is the whole point: with
 * sixteen `StateBlock` mount sites and three shells that render several each,
 * per-surface pets meant several components each believing they owned the
 * single Kitty slot, and the registry deletes the previous image whenever a
 * different one claims a slot. The setup wizard shipped that bug in both of its
 * forms — first as two pets erasing each other, then, once they had separate
 * slots, as two of her stacked on one screen.
 *
 * The line is here for the reach. The picture needs a graphics protocol; the
 * line needs a terminal. So each moment resolves to both, and a terminal that
 * cannot draw her still hears her — the same line, behind the glyph. Where the
 * picture is drawn the glyph is dropped: one fox per surface.
 *
 * The spacing is here because a `Box` with a margin around a null child still
 * lays out its margin, so a caller that wraps the companion and forgets to gate
 * the wrapper leaves an empty row behind when `KUNAI_PET=off` — which is not
 * "retired entirely". Three of four call sites remembered; one did not. Owning
 * the margin means there is no wrapper left to forget.
 *
 * A surface that has nothing to say passes `null` and gets nothing at all —
 * no pet, no line, no box, no margin. That is the common case and it is
 * deliberately the easy one to write.
 */
export function CompanionHost({
  moment,
  picture: mayDraw = true,
  rows = 4,
  marginTop,
  marginBottom,
  marginRight,
}: {
  readonly moment: CompanionMoment | null;
  /** False where content artwork has the frame: she keeps the line and yields the picture. */
  readonly picture?: boolean;
  /** Height in terminal rows. Width is derived so the slot is square on screen. */
  readonly rows?: number;
  /** Space around her, applied only when she actually renders. */
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginRight?: number;
}) {
  // Fixed when the host mounts, so re-rendering the surface never re-rolls the
  // line out from under the reader. A new moment picks from a different pool.
  const [pick] = React.useState(() => Math.floor(Math.random() * 997));
  const { cols } = useShellDimensions();
  const mode = companionMode();
  if (moment === null || companionMode() === "off") return null;

  const voice = voiceForMoment(moment);
  const line = voice ? kannaLine(voice, pick) : null;
  // The glyph tier draws her as the 🦊 in front of the line. With no line there
  // is nothing for it to stand in front of, so the lone glyph is the whole of
  // her — which is what that tier has always shown.
  const picture = mayDraw && (mode === "graphics" || line === null);
  if (!picture && line === null) return null;

  return (
    <Box
      marginTop={marginTop}
      marginBottom={marginBottom}
      marginRight={marginRight}
      alignItems="flex-end"
    >
      {picture ? <CompanionPet pose={poseForMoment(moment)} rows={rows} /> : null}
      {line ? (
        <Box marginLeft={picture ? 1 : 0}>
          <KannaLine
            key={line}
            line={line}
            tone={toneFor(moment)}
            showGlyph={!picture}
            maxWidth={cols - (picture ? rows * 2 + 2 : 0)}
          />
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * The host, fed a cue: a moment together with whether the picture may be
 * drawn for it. Loading surfaces decide the two at once — a poster on screen
 * takes the picture and leaves her the line — so they hand both over in one
 * value rather than unpacking it at the call site.
 */
export function CompanionCueHost({
  cue,
  ...layout
}: {
  readonly cue: CompanionCue | null;
  readonly rows?: number;
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginRight?: number;
}) {
  return <CompanionHost moment={cue?.moment ?? null} picture={cue?.picture} {...layout} />;
}
