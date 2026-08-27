import { Text } from "ink";
import React from "react";

import { companionPetUrl } from "./companion-assets";
import {
  companionFallbackGlyph,
  isCompanionGraphicsEnabled,
  type CompanionPose,
} from "./companion-policy";
import { MiniPosterTile } from "./primitives/MiniPosterTile";

type CompanionPetProps = {
  readonly pose?: CompanionPose;
  readonly rows?: number;
  readonly cols?: number;
};

/**
 * Codex-style companion: graphics protocol when the terminal can host it,
 * otherwise the portable fox glyph. Never half-block.
 */
export function CompanionPet({ pose = "idle", rows = 5, cols = 7 }: CompanionPetProps) {
  if (!isCompanionGraphicsEnabled()) {
    return <Text>{companionFallbackGlyph()}</Text>;
  }

  return (
    <MiniPosterTile
      url={companionPetUrl(pose)}
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
