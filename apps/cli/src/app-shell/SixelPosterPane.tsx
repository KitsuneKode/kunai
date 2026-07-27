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
}: {
  readonly poster: Extract<PosterResult, { kind: "sixel" }>;
}) {
  const ref = useRef<DOMElement>(null);

  useEffect(() => {
    return () => sixelOverlayManager.unregister(poster.overlayId);
  }, [poster.overlayId]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = measureElement(node);
    if (rect.width <= 0 || rect.height <= 0) return;
    sixelOverlayManager.commit(poster.overlayId, { rect, sixel: poster.sixel });
    // No dependency list: a sibling's line wrap can move this pane without
    // changing poster props, and a measured overlay must follow that movement.
  });

  return <Box ref={ref} width={poster.cols} height={poster.rows} />;
}

/** Standard poster output; only sixel needs an out-of-band measured pane. */
export function PosterOutput({ poster }: { readonly poster: PosterResult }) {
  if (poster.kind === "none") return null;
  if (poster.kind === "sixel") return <SixelPosterPane poster={poster} />;
  return <Text>{poster.placeholder}</Text>;
}
