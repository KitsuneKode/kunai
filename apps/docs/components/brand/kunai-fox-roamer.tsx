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

/** Below this she has arrived and stops correcting, so she never jitters. */
const ARRIVE_PX = 90;
/** How far behind the pointer she settles. She follows; she does not hover. */
const TRAIL_PX = 74;
/** Fraction of the remaining gap closed per frame. Low enough to read as walking. */
const EASE = 0.055;
/** Stillness before she sits, then before she curls up. */
const SIT_AFTER_MS = 2200;
const SLEEP_AFTER_MS = 14000;
/** She speaks unprompted at a random interval inside this window. */
const CHATTER_MIN_MS = 22000;
const CHATTER_MAX_MS = 48000;
const BUBBLE_MS = 4200;
const STORAGE_KEY = "kunai.roamer.dismissed";

const LINES = [
  "hi.",
  "you clicked me. bold.",
  "i found seven mirrors. six were lying.",
  "mpv does the hard part. i just find things.",
  "still faster than opening twelve tabs.",
  "i'm not a loading spinner.",
  "the install command is up there.",
  "i've been awake since 2am.",
  "ask me about ffmpeg. actually, don't.",
  "that command works. i checked.",
  "you're still scrolling.",
  "nap incoming.",
] as const;

const SLEEPY_LINES = ["zzz.", "five more minutes.", "wake me for the good ones."] as const;

/** A line from the pool that is not the one she just said. */
function pickLine(pool: readonly string[], last: string | null): string {
  const fresh = pool.filter((candidate) => candidate !== last);
  const choices = fresh.length > 0 ? fresh : pool;
  return choices[Math.floor(Math.random() * choices.length)] as string;
}

export function KunaiFoxRoamer({ size = 92 }: { readonly size?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  // Position and target live in refs, not state: this updates every frame and
  // must never queue a React render to move her.
  const pos = useRef({ x: -400, y: -400 });
  const target = useRef({ x: -400, y: -400 });
  const lastMove = useRef(Date.now());
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
      lastMove.current = Date.now();
      if (!seeded.current) {
        // Drop her in beside the pointer on first sight rather than sliding her
        // across the whole viewport from wherever she was parked.
        seeded.current = true;
        pos.current = { x: event.clientX - TRAIL_PX, y: event.clientY + 40 };
      }
    }

    function step() {
      frameRef.current = window.requestAnimationFrame(step);
      const host = hostRef.current;
      if (!host || !seeded.current) return;

      const dx = target.current.x - pos.current.x;
      const dy = target.current.y - pos.current.y;
      const distance = Math.hypot(dx, dy);
      const still = Date.now() - lastMove.current;

      if (distance > ARRIVE_PX) {
        pos.current.x += dx * EASE;
        pos.current.y += dy * EASE;
        setPhase("walking");
        // Only commit to a direction on real horizontal travel, so she does not
        // flap back and forth while the pointer wanders vertically.
        if (Math.abs(dx) > 12) setFacing(dx > 0 ? "right" : "left");
      } else if (still > SLEEP_AFTER_MS) {
        setPhase("asleep");
      } else if (still > SIT_AFTER_MS) {
        setPhase("sitting");
      }

      host.style.transform = `translate3d(${Math.round(pos.current.x - size / 2)}px, ${Math.round(
        pos.current.y - size / 2,
      )}px, 0)`;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    frameRef.current = window.requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [enabled, size]);

  // Unprompted chatter, on a fresh random delay each time so it never lands on
  // a rhythm the reader can start predicting.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: number;
    const schedule = () => {
      const delay = CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS);
      timer = window.setTimeout(() => {
        if (seeded.current) say(phase === "asleep" ? SLEEPY_LINES : LINES);
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, phase, say]);

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
        onClick={() => say(phase === "asleep" ? SLEEPY_LINES : LINES)}
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
