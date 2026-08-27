"use client";

import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Kanna, loose on the page.
 *
 * She trails the pointer, faces the way she is walking, sits down when you stop
 * moving, and eventually curls up. Clicking her gets a line out of her.
 *
 * ## Tone
 *
 * She is deliberately goofier here than she is in the terminal. That is not a
 * drift — the CLI is her at work, where the whole promise is getting out of the
 * way, and one chatty line in someone's shell is a bug. A marketing page is her
 * off duty. Same character, different room.
 *
 * ## Restraint
 *
 * She is dismissible and stays dismissed, she never covers anything (pointer
 * events pass straight through except on her), she only exists on a fine
 * pointer, and `prefers-reduced-motion` removes her entirely rather than
 * freezing her mid-page.
 */

type Phase = "walking" | "sitting" | "asleep";

/** Pixels per tick, along the unit vector. Constant — this is the whole trick. */
const SPEED_PX = 15;
/** ~10 steps a second. oneko throttles to the same cadence for the same reason. */
const TICK_MS = 100;
/** She stops this far out rather than climbing onto the cursor. */
const DEAD_ZONE_PX = 68;
/** Ticks of stillness before she sits down. */
const SIT_AFTER_TICKS = 22;
/** Once sitting, a 1-in-N chance per tick of curling up. Roughly 20s. */
const SLEEP_ODDS = 200;
/**
 * How long she goes between unprompted lines, by state.
 *
 * Sleeping earns the longest gap — an animal that mutters every twenty seconds
 * is not asleep — and walking the shortest, because that is when you are most
 * likely to be looking at her.
 */
const CHATTER_WINDOW_MS: Record<Phase, readonly [number, number]> = {
  walking: [16000, 34000],
  sitting: [24000, 52000],
  asleep: [45000, 90000],
};
const BUBBLE_MS = 4200;
const STORAGE_KEY = "kunai.roamer.dismissed";

/**
 * What she says, by state.
 *
 * Three flavours run through the resting pool — what the tool actually does,
 * something anime-shaped, and plain goofiness — because a companion that only
 * ever markets at you is an ad, and one that only jokes is noise. Walking and
 * sleeping get their own short pools so an unprompted line always fits what she
 * is visibly doing.
 */
const RESTING_LINES = [
  // what it does
  "mpv does the hard part. i just find things.",
  "seven mirrors. six were lying.",
  "i don't buffer. i just leave.",
  "no accounts, no ads, no opinions.",
  "your watchlist is local. nobody's selling it.",
  "twelve tabs, or one command.",
  "yt-dlp and i have an understanding.",
  "ffmpeg is a friend. a difficult friend.",
  "providers go down. that's what fallbacks are for.",
  "the install command is up there.",
  // anime-shaped
  "another season, another twelve episodes.",
  "the opening is ninety seconds. i can skip it.",
  "sub or dub. i don't judge. much.",
  "filler arc detected.",
  "episode one is free. episode two is where they get you.",
  // goofy
  "i've been awake since 2am.",
  "i'm not a loading spinner.",
  "this is my page. you're visiting.",
  "i could nap right here.",
  "you're still scrolling.",
] as const;

const WALKING_LINES = [
  "where are we going.",
  "slow down.",
  "i have short legs.",
  "keep going, i'll follow.",
] as const;

const SLEEPY_LINES = [
  "zzz.",
  "five more minutes.",
  "wake me for the good ones.",
  "mm. filler episode.",
] as const;

const POKED_LINES = ["hey.", "you clicked me. bold.", "yes?", "i'm working.", "rude."] as const;

/** The pool that matches what she is visibly doing. */
function poolFor(phase: Phase): readonly string[] {
  if (phase === "asleep") return SLEEPY_LINES;
  if (phase === "walking") return WALKING_LINES;
  return RESTING_LINES;
}

/** A line from the pool that is not the one she just said. */
function pickLine(pool: readonly string[], last: string | null): string {
  const fresh = pool.filter((candidate) => candidate !== last);
  const choices = fresh.length > 0 ? fresh : pool;
  return choices[Math.floor(Math.random() * choices.length)] as string;
}

export function KunaiFoxRoamer({ size = 58 }: { readonly size?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  // Position and target live in refs, not state: this updates every frame and
  // must never queue a React render to move her.
  const pos = useRef({ x: -400, y: -400 });
  const target = useRef({ x: -400, y: -400 });
  const idleTicks = useRef(0);
  const stepFlag = useRef(false);
  const lastTick = useRef(0);
  const seeded = useRef(false);

  const [phase, setPhase] = useState<Phase>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [line, setLine] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Resolved after mount so server and client agree on the first render, and so
  // a dismissal from a previous visit is honoured before she is ever painted.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      // A blocked or unavailable store is not a reason to refuse to render.
    }
    setEnabled(true);
  }, []);

  const say = useCallback((pool: readonly string[]) => {
    setLine((current) => pickLine(pool, current));
  }, []);

  // Clear whatever she last said, on its own timer, so a new line always gets
  // its full read regardless of what triggered it.
  useEffect(() => {
    if (line === null) return undefined;
    const timer = window.setTimeout(() => setLine(null), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [line]);

  useEffect(() => {
    if (!enabled) return undefined;

    function onMove(event: PointerEvent) {
      target.current = { x: event.clientX, y: event.clientY };
      if (!seeded.current) {
        // Drop her in beside the pointer on first sight rather than marching
        // her across the whole viewport from wherever she was parked.
        seeded.current = true;
        pos.current = { x: event.clientX - 90, y: event.clientY + 50 };
      }
    }

    function tick(timestamp: number) {
      frameRef.current = window.requestAnimationFrame(tick);
      // rAF rather than setInterval, so a backgrounded tab stops her entirely.
      if (timestamp - lastTick.current < TICK_MS) return;
      lastTick.current = timestamp;

      const host = hostRef.current;
      if (!host || !seeded.current) return;

      const dx = target.current.x - pos.current.x;
      const dy = target.current.y - pos.current.y;
      const distance = Math.hypot(dx, dy);

      if (distance > DEAD_ZONE_PX) {
        idleTicks.current = 0;
        // Unit vector times a constant. Her pace is identical whether the
        // pointer is just outside the dead zone or across the page.
        pos.current.x += (dx / distance) * SPEED_PX;
        pos.current.y += (dy / distance) * SPEED_PX;
        stepFlag.current = !stepFlag.current;
        host.dataset.step = stepFlag.current ? "a" : "b";
        setPhase("walking");
        // Only commit to a direction on real horizontal travel, so she does not
        // flip back and forth while the pointer wanders vertically.
        if (Math.abs(dx) > 10) setFacing(dx > 0 ? "right" : "left");
      } else {
        idleTicks.current += 1;
        if (idleTicks.current > SIT_AFTER_TICKS) {
          // Sitting is the resting state. Sleep is a coin flip she keeps making
          // while nothing happens, so dropping off is never on a schedule the
          // reader can feel coming.
          setPhase((current) =>
            current === "asleep"
              ? current
              : Math.floor(Math.random() * SLEEP_ODDS) === 0
                ? "asleep"
                : "sitting",
          );
        }
      }

      host.style.transform = `translate3d(${Math.round(pos.current.x - size / 2)}px, ${Math.round(
        pos.current.y - size / 2,
      )}px, 0)`;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [enabled, size]);

  // Unprompted chatter. `phase` is read through a ref rather than a dependency
  // on purpose: as a dependency it re-ran this effect every time she started or
  // stopped walking, which cleared the pending timer, so the delay almost never
  // elapsed and she was close to silent.
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: number;
    const schedule = () => {
      const [min, max] = CHATTER_WINDOW_MS[phaseRef.current];
      timer = window.setTimeout(
        () => {
          // Silent until she has actually been seen, and never over a line the
          // reader is still reading.
          if (seeded.current) say(poolFor(phaseRef.current));
          schedule();
        },
        min + Math.random() * (max - min),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, say]);

  const dismiss = useCallback(() => {
    setEnabled(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Dismissal still holds for this page view even if it cannot be stored.
    }
  }, []);

  if (!enabled) return null;

  // `go` is the only directional still in the current sheet, so it carries
  // walking. When the seek/carry pair lands this becomes seek → carry.
  const pose: KunaiFoxPose = phase === "walking" ? "go" : phase === "asleep" ? "wait" : "idle";

  return (
    // Hidden from assistive tech, and out of the tab order, on purpose: she
    // only ever appears for a fine pointer, so there is no keyboard path that
    // could reach her and nothing here that is not decorative.
    <div ref={hostRef} className="kunai-roamer" aria-hidden="true">
      {line ? <p className="kunai-roamer__bubble">{line}</p> : null}
      <button
        type="button"
        className={`kunai-roamer__fox is-${phase}`}
        onClick={() => say(phase === "asleep" ? SLEEPY_LINES : POKED_LINES)}
        tabIndex={-1}
      >
        <KunaiFox pose={pose} facing={facing} size={size} />
      </button>
      <button type="button" className="kunai-roamer__close" onClick={dismiss} tabIndex={-1}>
        ×
      </button>
    </div>
  );
}
