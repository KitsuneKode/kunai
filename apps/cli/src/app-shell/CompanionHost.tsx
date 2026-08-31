import React from "react";

import { poseForMoment, type CompanionMoment } from "./companion-moment";
import { CompanionPet } from "./CompanionPet";

/**
 * The one place a companion is drawn.
 *
 * Surfaces report a moment; this decides the pose and owns the placement. That
 * inversion is the whole point: with sixteen `StateBlock` mount sites and three
 * shells that render several each, per-surface pets meant several components
 * each believing they owned the single Kitty slot, and the registry deletes the
 * previous image whenever a different one claims a slot. The setup wizard
 * shipped that bug in both of its forms — first as two pets erasing each other,
 * then, once they had separate slots, as two of her stacked on one screen.
 *
 * A surface that has nothing to say passes `null` and gets nothing. That is the
 * common case and it is deliberately the easy one to write.
 */
export function CompanionHost({
  moment,
  rows = 4,
}: {
  readonly moment: CompanionMoment | null;
  /** Height in terminal rows. Width is derived so the slot is square on screen. */
  readonly rows?: number;
}) {
  if (moment === null) return null;
  return <CompanionPet pose={poseForMoment(moment)} rows={rows} />;
}
