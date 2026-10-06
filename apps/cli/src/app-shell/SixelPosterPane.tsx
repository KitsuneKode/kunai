import { Box, measureElement, Text } from "ink";
import type { DOMElement } from "ink";
import React, { useEffect, useRef } from "react";

import type { PosterResult } from "./poster-types";
import { sixelOverlayManager } from "./sixel-overlay";

/**
 * Reserves a measured Ink rectangle for a sixel overlay. The rectangle contains
 * no text by design: Ink clears/repaints it on every frame, then the overlay
 * manager paints the pixels after the frame has reached the terminal.
 */
export function SixelPosterPane({
  poster,
  repaintAfterInkRender = true,
}: {
  readonly poster: Extract<PosterResult, { kind: "sixel" }>;
  readonly repaintAfterInkRender?: boolean;
}) {
  const ref = useRef<DOMElement>(null);
  // Owner token for this mount: slotted overlay ids are shared across
  // surfaces, so unmount cleanup must only release its own registration.
  const owner = useRef(Math.random().toString(36).slice(2));
  const ownerId = owner.current;

  useEffect(() => {
    return () => sixelOverlayManager.unregister(poster.overlayId, ownerId);
  }, [poster.overlayId, ownerId]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = measureElement(node);
    if (rect.width <= 0 || rect.height <= 0) return;
    sixelOverlayManager.commit(poster.overlayId, {
      rect,
      sixel: poster.sixel,
      repaintAfterInkRender,
      owner: ownerId,
    });
    // No dependency list: a sibling's line wrap can move this pane without
    // changing poster props, and a measured overlay must follow that movement.
  });

  return <Box ref={ref} width={poster.cols} height={poster.rows} />;
}

/** Standard poster output; only sixel needs an out-of-band measured pane. */
export function PosterOutput({
  poster,
  repaintAfterInkRender = true,
}: {
  readonly poster: PosterResult;
  readonly repaintAfterInkRender?: boolean;
}) {
  if (poster.kind === "none") return null;
  if (poster.kind === "sixel") {
    return <SixelPosterPane poster={poster} repaintAfterInkRender={repaintAfterInkRender} />;
  }
  return <Text>{poster.placeholder}</Text>;
}
