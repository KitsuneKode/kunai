// =============================================================================
// MouseRegions.tsx — the hit-test registry and the React seam.
//
// Components wrap content in a ref'd <Box> and call `useMouseRegion` with the
// handlers they want. After each commit the hook measures the node with Ink's
// `measureElement` (absolute layout coords — we render no <Static>, so layout
// coords are terminal coords) and upserts the region. The dispatcher resolves
// a terminal coordinate to the most recently registered region containing it —
// overlays mount after their underlays, so insertion order gives correct
// z-ordering for free.
// =============================================================================

import { Box, measureElement, type DOMElement } from "ink";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

import type { MouseEvent } from "./terminal-mouse";

export type MouseRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type MouseRegionHandlers = {
  /** Left click = press + release inside the same region. */
  readonly onClick?: (event: MouseEvent) => void;
  readonly onWheel?: (direction: "up" | "down", event: MouseEvent) => void;
  readonly onRightClick?: (event: MouseEvent) => void;
};

type MouseRegion = {
  readonly id: string;
  readonly rect: MouseRect;
  readonly handlers: MouseRegionHandlers;
  /** Monotonic — later registrations win overlapping hits. */
  readonly order: number;
};

export class MouseDispatcher {
  private regions = new Map<string, MouseRegion>();
  private orderCounter = 0;
  /** Press target held until release decides click vs miss. */
  private pendingPress: { regionId: string; x: number; y: number } | null = null;

  register(id: string, rect: MouseRect, handlers: MouseRegionHandlers): void {
    this.orderCounter += 1;
    this.regions.set(id, { id, rect, handlers, order: this.orderCounter });
  }

  unregister(id: string): void {
    this.regions.delete(id);
    if (this.pendingPress?.regionId === id) this.pendingPress = null;
  }

  clear(): void {
    this.regions.clear();
    this.pendingPress = null;
  }

  get size(): number {
    return this.regions.size;
  }

  /** Snapshot of live regions — tests and debug surfaces read this. */
  debugRegions(): readonly { id: string; rect: MouseRect }[] {
    return [...this.regions.values()].map(({ id, rect }) => ({ id, rect }));
  }

  private hit(x: number, y: number): MouseRegion | null {
    let best: MouseRegion | null = null;
    for (const region of this.regions.values()) {
      const { rect } = region;
      if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) {
        continue;
      }
      if (!best || region.order > best.order) best = region;
    }
    return best;
  }

  dispatch(event: MouseEvent): boolean {
    const region = this.hit(event.x, event.y);

    if (event.kind === "press") {
      this.pendingPress =
        region?.handlers.onClick || region?.handlers.onRightClick
          ? { regionId: region.id, x: event.x, y: event.y }
          : null;
      return region !== null;
    }

    if (event.kind === "release") {
      const pending = this.pendingPress;
      this.pendingPress = null;
      if (!pending || !region || region.id !== pending.regionId) return region !== null;
      const clickEvent: MouseEvent = { ...event, kind: "press" };
      if (event.button === "right") region.handlers.onRightClick?.(clickEvent);
      else if (event.button === "left") region.handlers.onClick?.(clickEvent);
      return true;
    }

    if (event.kind === "wheel") {
      const direction = event.button === "wheel-up" ? "up" : "down";
      if (!region?.handlers.onWheel) return false;
      region.handlers.onWheel(direction, event);
      return true;
    }

    if (event.kind === "drag") {
      return region !== null;
    }

    return region !== null;
  }
}

// ---------------------------------------------------------------------------
// React seam
// ---------------------------------------------------------------------------

const fallbackDispatcher = new MouseDispatcher();
export const MouseDispatchContext = createContext<MouseDispatcher>(fallbackDispatcher);

/** Test/debug seam: swap the dispatcher a tree dispatches into. */
export function MouseDispatchProvider(props: {
  readonly dispatcher: MouseDispatcher;
  readonly children: ReactElement | readonly ReactElement[];
}) {
  return (
    <MouseDispatchContext.Provider value={props.dispatcher}>
      {props.children}
    </MouseDispatchContext.Provider>
  );
}

type InkBoxRef = DOMElement;

/**
 * Register the element `ref` lands on as a mouse region. Re-measures after
 * every commit — layout shifts (list growth, overlay open, resize) re-register
 * at the new rect, so hit-testing always matches what is on screen.
 */
export function useMouseRegion(
  ref: { current: InkBoxRef | null },
  id: string,
  handlers: MouseRegionHandlers,
  options: { readonly active?: boolean } = {},
): void {
  const dispatcher = useContext(MouseDispatchContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const active = options.active !== false;

  useLayoutEffect(() => {
    if (!active) return;
    const node = ref.current;
    const layout = node ? measureElement(node) : { x: 0, y: 0, width: 0, height: 0 };
    if (layout.width <= 0 || layout.height <= 0) return;
    // measureElement is 0-based layout space; SGR mouse coords are 1-based
    // terminal cells. We render no <Static>, so the live region starts at
    // terminal (1,1) — a single +1 shift maps one space onto the other.
    dispatcher.register(
      id,
      { x: layout.x + 1, y: layout.y + 1, width: layout.width, height: layout.height },
      handlersRef.current,
    );
    return () => dispatcher.unregister(id);
  });
}

/**
 * Declarative region wrapper: `<MouseTarget id="…" onClick={…}><Row/></…>`.
 * The wrapping Box is transparent (no padding/border) so layout is unchanged;
 * it exists to hold the ref the hook measures.
 */
export function MouseTarget(props: {
  readonly id: string;
  readonly onClick?: (event: MouseEvent) => void;
  readonly onWheel?: (direction: "up" | "down", event: MouseEvent) => void;
  readonly onRightClick?: (event: MouseEvent) => void;
  readonly active?: boolean;
  readonly children: ReactNode;
}) {
  const ref = useRef<InkBoxRef | null>(null);
  useMouseRegion(
    ref,
    props.id,
    { onClick: props.onClick, onWheel: props.onWheel, onRightClick: props.onRightClick },
    { active: props.active },
  );
  return <Box ref={ref}>{props.children}</Box>;
}
