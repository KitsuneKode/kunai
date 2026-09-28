"use client";

import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import { useCallback, useEffect, useRef, useState } from "react";

type KunaiFoxLiveProps = {
  readonly pose?: KunaiFoxPose;
  /** Cross-faded in while the pointer is near or the fox is hovered. */
  readonly alertPose?: KunaiFoxPose;
  readonly size?: number;
  readonly title?: string;
  readonly className?: string;
};

/** Beyond this the fox has not noticed you and stops paying for pointer maths. */
const NOTICE_RADIUS_PX = 320;
/** How far she leans at the very edge of the character. Deliberately small. */
const MAX_LEAN_PX = 6;

/**
 * The hero fox, with the two reactions a flat raster still can honestly carry:
 * she leans toward the pointer, and she changes pose when you get close.
 *
 * Per-part motion — an ear flick, a blink, pupils that track independently —
 * needs addressable parts, which means the character has to become SVG first.
 * Faking it by slicing eyes out of the raster would break on every re-export,
 * so this deliberately does the two things the PNG can do well instead of four
 * things badly.
 *
 * Everything here is disabled under `prefers-reduced-motion`, where the
 * component degrades to exactly the static `KunaiFox` it wraps.
 */
export function KunaiFoxLive({
  pose = "idle",
  alertPose = "watch",
  size = 120,
  title,
  className,
}: KunaiFoxLiveProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [noticed, setNoticed] = useState(false);
  const [rewarded, setRewarded] = useState(false);
  const [reduced, setReduced] = useState(true);

  // Resolved after mount so the server render and the first client render agree;
  // starting at `true` means the still, not the animated state, is what hydrates.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const apply = useCallback((dx: number, dy: number, near: boolean) => {
    const host = hostRef.current;
    if (!host) return;
    host.style.setProperty("--fox-dx", `${dx.toFixed(2)}px`);
    host.style.setProperty("--fox-dy", `${dy.toFixed(2)}px`);
    setNoticed(near);
  }, []);

  useEffect(() => {
    if (reduced) return undefined;
    if (!window.matchMedia("(pointer: fine)").matches) return undefined;

    function onMove(event: PointerEvent) {
      // Coalesced into one rAF so a fast pointer cannot queue a layout per event.
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const host = hostRef.current;
        if (!host) return;
        const box = host.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const distance = Math.hypot(dx, dy);
        if (distance > NOTICE_RADIUS_PX) {
          apply(0, 0, false);
          return;
        }
        // Normalised so the lean saturates well before the pointer arrives —
        // she leans toward you, she does not chase the cursor.
        const scale = MAX_LEAN_PX / NOTICE_RADIUS_PX;
        apply(dx * scale, dy * scale * 0.6, true);
      });
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [reduced, apply]);

  // The one motion on the page tied to something the reader did on purpose.
  // `CopyButton` announces the copy; it does not know a fox is listening.
  useEffect(() => {
    if (reduced) return undefined;
    let timer: number | undefined;
    function onCopied() {
      setRewarded(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRewarded(false), 640);
    }
    window.addEventListener("kunai:copied", onCopied);
    return () => {
      window.removeEventListener("kunai:copied", onCopied);
      window.clearTimeout(timer);
    };
  }, [reduced]);

  if (reduced) {
    return <KunaiFox pose={pose} size={size} title={title} className={className} />;
  }

  return (
    <div
      ref={hostRef}
      className={`kunai-fox-live${noticed ? " is-noticed" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      {/* Three transform layers on purpose: the host carries the lean, the
          stage carries the copy-reward hop, and each still carries its own
          breathing. One element cannot hold three animations of `transform`. */}
      <div className={`kunai-fox-live__stage${rewarded ? " kunai-fox--rewarded" : ""}`}>
        <KunaiFox pose={pose} size={size} title={title} animated className="kunai-fox-live__rest" />
        <KunaiFox pose={alertPose} size={size} className="kunai-fox-live__alert" />
      </div>
    </div>
  );
}
