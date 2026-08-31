import { Box } from "ink";
import React from "react";

import { poseForMoment, type CompanionMoment } from "./companion-moment";
import { companionMode } from "./companion-policy";
import { CompanionPet } from "./CompanionPet";

/**
 * The one place a companion is drawn.
 *
 * Surfaces report a moment; this decides the pose, owns the placement, and owns
 * the space around it. That inversion is the whole point: with sixteen
 * `StateBlock` mount sites and three shells that render several each,
 * per-surface pets meant several components each believing they owned the
 * single Kitty slot, and the registry deletes the previous image whenever a
 * different one claims a slot. The setup wizard shipped that bug in both of its
 * forms — first as two pets erasing each other, then, once they had separate
 * slots, as two of her stacked on one screen.
 *
 * The spacing is here for the same reason. A `Box` with a margin around a null
 * child still lays out its margin, so a caller that wraps the companion and
 * forgets to gate the wrapper leaves an empty row behind when `KUNAI_PET=off` —
 * which is not "retired entirely". Three of four call sites remembered; one did
 * not. Owning the margin means there is no wrapper left to forget.
 *
 * A surface that has nothing to say passes `null` and gets nothing at all —
 * no pet, no box, no margin. That is the common case and it is deliberately
 * the easy one to write.
 */
export function CompanionHost({
  moment,
  rows = 4,
  marginTop,
  marginBottom,
  marginRight,
}: {
  readonly moment: CompanionMoment | null;
  /** Height in terminal rows. Width is derived so the slot is square on screen. */
  readonly rows?: number;
  /** Space around her, applied only when she actually renders. */
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginRight?: number;
}) {
  if (moment === null || companionMode() === "off") return null;

  return (
    <Box marginTop={marginTop} marginBottom={marginBottom} marginRight={marginRight}>
      <CompanionPet pose={poseForMoment(moment)} rows={rows} />
    </Box>
  );
}
