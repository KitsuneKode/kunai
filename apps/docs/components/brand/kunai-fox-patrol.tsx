"use client";

import { type FoxWalkerHandle, KunaiFoxWalker } from "@/components/brand/kunai-fox-walker";
import { advancePhase, blendPose, type FoxPose, gaitPose, STANDING_POSE } from "@/lib/fox-gait";
import { createPatrolState, stepPatrol } from "@/lib/patrol-machine";
import { useEffect, useRef, useState } from "react";

const SIZE = 56;
/** How long she takes to put her feet down when she reaches a stop. */
const SETTLE_MS = 200;

/**
 * Kanna pacing the top of the footer.
 *
 * A quiet bit of life at the bottom of every page: she walks a stretch of the
 * footer's top border, stops for a few seconds, turns and walks somewhere else.
 * It is the one place the mascot is allowed to move with nothing prompting her,
 * so it is held to the rules a decoration earns that right with.
 *
 * - **Only while seen.** An observer on the lane starts the frame loop when the
 *   footer scrolls into view and stops it when it leaves. Off screen she costs
 *   nothing, and she is not walking where no one can watch.
 * - **Only while the tab is.** A hidden tab pauses the loop too.
 * - **Never under reduced motion.** She stands still at the left instead; the
 *   footer reads the same without her.
 * - **Never in the way.** The lane has `pointer-events: none` and sits on the
 *   border line, so she cannot cover a link or intercept a tap.
 *
 * The movement is `lib/patrol-machine.ts` and the legs are `lib/fox-gait.ts`;
 * this component only connects them to the drawing and the frame clock.
 */
export function KunaiFoxPatrol() {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const foxRef = useRef<HTMLDivElement | null>(null);
  const walkerRef = useRef<FoxWalkerHandle | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const [facing, setFacing] = useState<"left" | "right">("right");

  useEffect(() => {
    const lane = laneRef.current;
    const fox = foxRef.current;
    if (!lane || !fox) return undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // `tick` is a hoisted function declaration, so it cannot see the narrowing
    // of `fox` above; a const of the narrowed type carries it in.
    const foxEl: HTMLDivElement = fox;
    let state = createPatrolState(0);
    let phase = 0;
    let pose: FoxPose = STANDING_POSE;
    let settleMs = SETTLE_MS;
    let laneWidth = lane.clientWidth;
    let frame: number | undefined;
    let last = 0;
    let visible = false;

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { rootMargin: "80px" },
    );
    const resizer = new ResizeObserver(() => {
      laneWidth = lane.clientWidth;
    });

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      // Clamped: a tab returning from the background hands over one huge delta,
      // which would teleport her across the lane on the first frame back.
      const dt = Math.min((now - (last || now)) / 1000, 0.05);
      last = now;

      const before = state;
      state = stepPatrol(state, { dt, lane: laneWidth, size: SIZE, rand: Math.random });
      if (state.facing !== before.facing) setFacing(state.facing);

      if (state.phase === "walking") {
        settleMs = 0;
        phase = advancePhase(phase, Math.abs(state.x - before.x), SIZE);
        pose = gaitPose(phase);
        walkerRef.current?.setPose(pose);
      } else if (settleMs < SETTLE_MS) {
        settleMs += dt * 1000;
        walkerRef.current?.setPose(blendPose(pose, STANDING_POSE, settleMs / SETTLE_MS));
      }
      foxEl.style.transform = `translate3d(${state.x.toFixed(1)}px, 0, 0)`;
    }

    function sync() {
      const shouldRun = visible && !document.hidden && !reducedMotion.matches && !pausedRef.current;
      if (reducedMotion.matches || pausedRef.current) {
        walkerRef.current?.setPose(STANDING_POSE);
        settleMs = SETTLE_MS;
      }
      if (shouldRun && frame === undefined) {
        last = 0;
        foxEl.style.willChange = "transform";
        frame = requestAnimationFrame(tick);
      } else if (!shouldRun && frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
        foxEl.style.willChange = "auto";
      }
    }

    syncRef.current = sync;
    observer.observe(lane);
    resizer.observe(lane);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    return () => {
      syncRef.current = () => {};
      observer.disconnect();
      resizer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    syncRef.current();
  }

  return (
    <>
      <div ref={laneRef} className="kunai-footer-patrol" aria-hidden="true">
        <div ref={foxRef} className="kunai-footer-patrol__fox">
          <KunaiFoxWalker ref={walkerRef} size={SIZE} facing={facing} />
        </div>
      </div>
      <span className="kunai-footer-patrol__caption">
        Kanna, the fox.
        <button type="button" className="kunai-footer-patrol__toggle" onClick={togglePause}>
          {paused ? "Resume Kanna" : "Pause Kanna"}
        </button>
      </span>
    </>
  );
}
