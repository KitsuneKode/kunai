import { Text } from "ink";
import React from "react";

import { companionPetPath } from "./companion-assets";
import { companionFallbackGlyph, companionMode, type CompanionPose } from "./companion-policy";
import { MiniPosterTile } from "./primitives/MiniPosterTile";

type CompanionPetProps = {
  readonly pose?: CompanionPose;
  readonly rows?: number;
  readonly cols?: number;
};

/**
 * The companion: the illustrated still where the terminal can host a graphics
 * protocol, the portable fox glyph where it cannot, and nothing at all when the
 * companion is switched off. Never half-block — this art turns to noise at two
 * pixels per cell.
 */
export function CompanionPet({ pose = "idle", rows = 5, cols = 7 }: CompanionPetProps) {
  const mode = companionMode();
  if (mode === "off") return null;
  if (mode === "glyph") return <Text>{companionFallbackGlyph()}</Text>;

  return (
    <MiniPosterTile
      url={companionPetPath(pose)}
      title="Kunai"
      enabled
      rows={rows}
      cols={cols}
      allowKitty
      allowSixel
      debounceMs={0}
      placementSlot="companion"
      square
    />
  );
}
