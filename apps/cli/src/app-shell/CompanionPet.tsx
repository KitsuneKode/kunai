import { getTerminalCellPixels, subscribeTerminalCellPixels } from "@/image/cell-size";
import { Box, Text } from "ink";
import React, { useEffect, useState, useSyncExternalStore } from "react";

import { companionPetPath } from "./companion-assets";
import { companionFallbackGlyph, companionMode, type CompanionPose } from "./companion-policy";
import {
  acquireKannaSprite,
  holdKannaSprites,
  kannaEpoch,
  kannaSlot,
  kannaSpriteAvailable,
  readyKannaSprite,
  subscribeKannaEpoch,
  type KannaSprite,
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

function SpritePet({ pose, rows }: { readonly pose: CompanionPose; readonly rows: number }) {
  // Both are inputs to the slot and the upload: a new cell size changes how
  // many pixels she needs, and a new epoch means every id she had is dead.
  const cell = useSyncExternalStore(subscribeTerminalCellPixels, getTerminalCellPixels);
  const epoch = useSyncExternalStore(subscribeKannaEpoch, kannaEpoch);
  // No motion under reduced motion: one drawing goes up, and no frames follow.
  const animated = !reducedMotionEnabled();
  const slot = kannaSlot(rows, cell);
  // `undefined` is still uploading; `null` is an upload that could not happen.
  const [sprite, setSprite] = useState<KannaSprite | null | undefined>(
    () => readyKannaSprite(pose, slot, animated) ?? undefined,
  );

  useEffect(() => {
    const release = holdKannaSprites();
    let current = true;
    const load = async (): Promise<void> => {
      // The slot is rebuilt here rather than captured: it is a fresh object on
      // every render, and `rows` and `cell` are what it is actually made of.
      const next = await acquireKannaSprite(pose, kannaSlot(rows, cell), animated, epoch);
      if (current) setSprite(next);
    };
    void load();
    return () => {
      current = false;
      release();
    };
  }, [pose, rows, animated, cell, epoch]);

  // The picture could not be prepared here, so she is the glyph — the same
  // floor every terminal without a graphics protocol stands on.
  if (sprite === null) return <Text>{companionFallbackGlyph()}</Text>;
  // Reserve the slot while the upload is in flight, so she arrives into a space
  // already hers rather than pushing the text beside her sideways.
  if (!sprite || sprite.rows !== slot.rows || sprite.cols !== slot.cols) {
    return <Box width={slot.cols} height={slot.rows} />;
  }
  return <Text>{sprite.placeholder}</Text>;
}
