import { Box, measureElement, Text, useInput, type DOMElement } from "ink";
import React, { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { MouseTarget } from "../mouse/MouseRegions";
import { palette } from "../shell-theme";

/**
 * A fixed-height window over taller content: ↑/↓ and PgUp/PgDn scroll it, the
 * mouse wheel scrolls it, and ▲/▼ say there is more. The details sheet had no
 * scrolling at all, so on a short terminal its lower sections — seasons,
 * links, actions — were simply cut off.
 */
export function ScrollBox(props: {
  readonly id: string;
  readonly height: number;
  readonly active?: boolean;
  readonly children: ReactNode;
}) {
  const inner = useRef<DOMElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const height = Math.max(3, props.height);

  // Re-measure whenever the content changes; set only on a real change.
  // `children` is a trigger, not an input: new content means a new height.
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    const measured = measureElement(node).height;
    if (measured !== contentHeight) setContentHeight(measured);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- deliberate re-run trigger
  }, [props.children, contentHeight]);

  const maxOffset = Math.max(0, contentHeight - height);
  const clamped = Math.min(offset, maxOffset);
  const scroll = (delta: number) =>
    setOffset((current) => Math.max(0, Math.min(maxOffset, Math.min(current, maxOffset) + delta)));

  useInput(
    (_input, key) => {
      if (key.upArrow) scroll(-1);
      else if (key.downArrow) scroll(1);
      else if (key.pageUp) scroll(-(height - 1));
      else if (key.pageDown) scroll(height - 1);
    },
    { isActive: props.active !== false && maxOffset > 0 },
  );

  return (
    <MouseTarget id={props.id} onWheel={(direction) => scroll(direction === "up" ? -2 : 2)}>
      <Box flexDirection="column">
        <Box height={height} overflowY="hidden" flexDirection="column">
          <Box ref={inner} marginTop={-clamped} flexDirection="column" flexShrink={0}>
            {props.children}
          </Box>
        </Box>
        {maxOffset > 0 ? (
          <Text color={palette.dim}>
            {`${clamped > 0 ? "▲" : " "} ${clamped < maxOffset ? "▼" : " "}  ↑↓ / wheel to scroll`}
          </Text>
        ) : null}
      </Box>
    </MouseTarget>
  );
}
