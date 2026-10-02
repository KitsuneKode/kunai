"use client";

import { type FoxWalkerHandle, KunaiFoxWalker } from "@/components/brand/kunai-fox-walker";
import { advancePhase, blendPose, type FoxPose, gaitPose, STANDING_POSE } from "@/lib/fox-gait";
import {
  domAnimation,
  LazyMotion,
  m,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Her stride between scroll events: how far into the step cycle, where the scroll last was, and her last pose. */
type StrideState = {
  phase: number;
  last: number;
  pose: FoxPose;
};

type FlowStep = {
  readonly title: string;
  readonly description: string;
};

/** Where the first and last step sit along the track, as a share of its width. */
const FIRST_STOP = 1 / 6;
const LAST_STOP = 5 / 6;
/** How long after the last scroll movement before she stops and stands. */
const STAND_AFTER_MS = 140;
/** How long she takes to put her feet down. */
const SETTLE_MS = 180;
const FOX_SIZE = 72;

/**
 * The three steps, with Kanna walking between them as the section scrolls.
 *
 * The section's whole job is "search, then resolve, then play". A row of three
 * identical cards says that in words; a fox that walks from the first step to
 * the third as you read down says it in motion, and it is the one place on the
 * page where progress is the content. Scroll is the input, so the motion is
 * never on a timer: she goes exactly as far as you have scrolled, no further.
 *
 * ## How she moves
 *
 * Scroll progress eases through a spring, so a flick of the wheel becomes a
 * short walk rather than a teleport. Her stride advances by the distance that
 * spring covers (`advancePhase`), the same rule the roaming fox uses, so the
 * feet never turn faster or slower than she travels. When the spring settles
 * she eases into a standing pose instead of freezing mid-step.
 *
 * ## What happens without motion
 *
 * Under `prefers-reduced-motion` she stands at the final step and nothing
 * listens to scroll. Before hydration, and without JavaScript, she stands at
 * the first step. In both cases the three steps below are ordinary list items,
 * so nothing a reader needs depends on her.
 *
 * Below `sm` the track is hidden and the steps stack as a vertical list: three
 * columns of prose do not fit a phone, and a fox walking down a column is a
 * different animation than the one this section earns.
 */
export function HomeFlowTimeline({ steps }: { readonly steps: readonly FlowStep[] }) {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const walkerRef = useRef<FoxWalkerHandle | null>(null);
  const reduced = useReducedMotion();
  const [travelPx, setTravelPx] = useState(0);

  // The distance between the first and last stop, in pixels. Measured, because
  // the stride is a distance and the track is fluid.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => setTravelPx(track.clientWidth * (LAST_STOP - FIRST_STOP));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: blockRef,
    // Starts as the block's top edge enters the lower part of the viewport and
    // finishes when its bottom edge is about 40% down the screen, so she spends
    // roughly one viewport of scroll getting from the first step to the last
    // and arrives while the reader is still looking at it.
    offset: ["start 90%", "end 40%"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 26, mass: 0.7 });
  const walkX = useTransform(progress, (value) => value * travelPx);

  const stride = useRef<StrideState>({ phase: 0, last: 0, pose: STANDING_POSE });
  const standTimer = useRef<number | undefined>(undefined);
  const settleFrame = useRef<number | undefined>(undefined);

  useMotionValueEvent(progress, "change", (value) => {
    if (reduced) return;
    const state = stride.current;
    const moved = Math.abs(value - state.last) * travelPx;
    state.last = value;
    if (moved === 0) return;

    if (settleFrame.current !== undefined) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = undefined;

    state.phase = advancePhase(state.phase, moved, FOX_SIZE);
    state.pose = gaitPose(state.phase);
    walkerRef.current?.setPose(state.pose);

    window.clearTimeout(standTimer.current);
    standTimer.current = window.setTimeout(() => {
      const from = state.pose;
      const startedAt = performance.now();
      const settle = (now: number) => {
        const t = (now - startedAt) / SETTLE_MS;
        state.pose = blendPose(from, STANDING_POSE, t);
        walkerRef.current?.setPose(state.pose);
        settleFrame.current = t < 1 ? requestAnimationFrame(settle) : undefined;
      };
      settleFrame.current = requestAnimationFrame(settle);
    }, STAND_AFTER_MS);
  });

  useEffect(
    () => () => {
      window.clearTimeout(standTimer.current);
      if (settleFrame.current !== undefined) cancelAnimationFrame(settleFrame.current);
    },
    [],
  );

  return (
    <LazyMotion features={domAnimation}>
      <div ref={blockRef} className="kunai-timeline">
        <div ref={trackRef} className="kunai-timeline__track" aria-hidden="true">
          <span className="kunai-timeline__rail" />
          {steps.map((step, index) => (
            <span
              className="kunai-timeline__node tabular-nums"
              key={step.title}
              style={{ left: `${(FIRST_STOP + (index * (LAST_STOP - FIRST_STOP)) / 2) * 100}%` }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          ))}
          <m.div
            className="kunai-timeline__fox"
            style={{
              // A plain number under reduced motion: she stands at the last
              // step and nothing is subscribed to scroll.
              x: reduced ? travelPx : walkX,
              left: `${FIRST_STOP * 100}%`,
              marginLeft: -FOX_SIZE / 2,
              width: FOX_SIZE,
              height: FOX_SIZE,
            }}
          >
            <KunaiFoxWalker ref={walkerRef} size={FOX_SIZE} facing="right" />
          </m.div>
        </div>

        <ol className="kunai-timeline__steps">
          {steps.map((step, index) => (
            <li className="kunai-timeline__step" key={step.title}>
              <span className="kunai-timeline__index tabular-nums" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="kunai-type-title">{step.title}</h3>
              <p className="kunai-type-body mt-2 text-sm">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </LazyMotion>
  );
}
