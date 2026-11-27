import { subscribeTerminalCellPixels } from "@/image/cell-size";
import { Box, Text } from "ink";
import React, { useEffect, useState, useSyncExternalStore } from "react";

import { companionPetPath } from "./companion-assets";
import { companionFallbackGlyph, companionMode, type CompanionPose } from "./companion-policy";
import {
  acquireKannaSprite,
  holdKannaSprites,
  kannaSlot,
  kannaSpriteAvailable,
  readyKannaSprite,
} from "./kanna-sprite";
import { reducedMotionEnabled } from "./motion-policy";
import { MiniPosterTile } from "./primitives/MiniPosterTile";

type CompanionPetProps = {
  readonly pose?: CompanionPose;
  /** Height in terminal rows. Width is derived so the slot is square on screen. */
  readonly rows?: number;
};

/**
 * The companion: the illustrated fox where the terminal can host a graphics
 * protocol, the portable fox glyph where it cannot, and nothing at all when the
 * companion is switched off. Never half-block — this art turns to noise at two
 * pixels per cell.
 *
 * Two picture paths, chosen by what survives Ink's full-frame repaint:
 *
 * - Kitty and Ghostty (and tmux passing through to them) get a sprite: placed
 *   by placeholder text, animated by the terminal. See `kanna-sprite.ts`.
 * - iTerm2, WezTerm and Sixel terminals get the still, through the measured
 *   overlay every poster uses, redrawn after each Ink frame.
 */
export function CompanionPet({ pose = "idle", rows = 4 }: CompanionPetProps) {
  const mode = companionMode();
  if (mode === "off") return null;
  if (mode === "glyph") return <Text>{companionFallbackGlyph()}</Text>;
  if (kannaSpriteAvailable()) return <SpritePet pose={pose} rows={rows} />;

  return (
    <MiniPosterTile
      url={companionPetPath(pose)}
      title="Kunai"
      enabled
      rows={rows}
      cols={rows}
      allowKitty
      allowSixel
      debounceMs={0}
      placementSlot="companion"
      square
    />
  );
}

/** A changing number that re-renders when the terminal reports a new cell size. */
let cellSizeVersion = 0;
function subscribeCellSize(listener: () => void): () => void {
  return subscribeTerminalCellPixels(() => {
    cellSizeVersion += 1;
    listener();
  });
}

function SpritePet({ pose, rows }: { readonly pose: CompanionPose; readonly rows: number }) {
  // Subscribed for the re-render alone: a new cell size changes the slot below,
  // which is what the upload keys on.
  useSyncExternalStore(subscribeCellSize, () => cellSizeVersion);
  // No motion under reduced motion: one drawing goes up, and no frames follow.
  const animated = !reducedMotionEnabled();
  const { cols, pixels } = kannaSlot(rows);
  // Read from the sprite table on every render rather than kept in state, so a
  // pose change shows the new pose the instant it is uploaded and never shows
  // the old one in the meantime. The state is only a "something landed" nudge.
  const ready = readyKannaSprite(pose, { rows, cols, pixels }, animated);
  const [failed, setFailed] = useState<string | null>(null);
  const [, setLanded] = useState(0);
  const key = `${pose}:${rows}x${cols}:${pixels}:${animated}`;

  useEffect(() => {
    const release = holdKannaSprites();
    let current = true;
    void acquireKannaSprite(pose, { rows, cols, pixels }, animated).then((sprite) => {
      if (!current) return undefined;
      if (sprite) setLanded((n) => n + 1);
      else setFailed(key);
      return undefined;
    });
    return () => {
      current = false;
      release();
    };
  }, [key, pose, rows, cols, pixels, animated]);

  // The picture could not be prepared here, so she is the glyph — the same
  // floor every terminal without a graphics protocol stands on.
  if (failed === key) return <Text>{companionFallbackGlyph()}</Text>;
  // Reserve the slot while the upload is in flight, so she arrives into a space
  // already hers rather than pushing the text beside her sideways.
  if (!ready) return <Box width={cols} height={rows} />;
  return <Text>{ready.placeholder}</Text>;
}
