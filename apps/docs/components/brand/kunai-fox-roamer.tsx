"use client";

import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import { type FoxWalkerHandle, KunaiFoxWalker } from "@/components/brand/kunai-fox-walker";
import {
  advancePhase,
  blendPose,
  type FoxPose,
  gaitPose,
  headingFromMotion,
  smoothHeading,
  STANDING_POSE,
  withHeading,
} from "@/lib/fox-gait";
import { useKannaPaused } from "@/lib/kanna-motion";
import {
  createRoamerState,
  poseForPhase,
  stepRoamer,
  type RoamerPhase,
} from "@/lib/roamer-machine";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/**
 * How the movement itself works — notice, commit, travel, settle, rest — lives
 * in `lib/roamer-machine.ts`, which is pure and clock-injected so every timing
 * rule in it is testable without a browser or a real sleep. How her body moves
 * while she travels lives in `lib/fox-gait.ts`, pure for the same reason. What
 * stays here is the presentation: wiring distance travelled into the gait, what
 * she says, and when she is allowed to exist at all.
 */

/**
 * How long she takes to put her feet down after she stops.
 *
 * Cutting from a mid-stride leg to the resting still in one frame reads as a
 * glitch; a short blend to a standing pose reads as her arriving. Short enough
 * that the resting still is up before anyone has looked for it.
 */
const SETTLE_MS = 160;
/**
 * How long she goes between unprompted lines, by state.
 *
 * Sleeping earns the longest gap — an animal that mutters every twenty seconds
 * is not asleep — and walking the shortest, because that is when you are most
 * likely to be looking at her.
 */
const CHATTER_WINDOW_MS: Partial<Record<RoamerPhase, readonly [number, number]>> = {
  walking: [16000, 34000],
  // Arriving and looking at you: she has just moved, so she is not due a line yet.
  sitting: [24000, 52000],
  // Bored is where an unprompted line lands best — she has nothing else to do.
  idle: [14000, 30000],
  asleep: [45000, 90000],
  // `noticing` is absent on purpose. It is a 350ms beat before she commits —
  // long enough to see, far too short to talk in. Absent rather than given a
  // huge delay: browsers store the delay in a signed 32-bit integer, so
  // anything past ~24.8 days overflows and the callback fires on the next tick.
  // A sentinel meant to silence her would have made her talk immediately.
};
/** How long to wait before re-checking a phase that has no line of its own. */
const CHATTER_RECHECK_MS = 1200;
const BUBBLE_MS = 4200;
const STORAGE_KEY = "kunai.roamer.dismissed";

/** Browser preferences and dismissal are external state, with an empty SSR snapshot. */
export function createRoamerVisibilityStore(host: {
  readonly matchMedia: (
    query: string,
  ) => Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
  readonly localStorage: Pick<Storage, "getItem" | "removeItem">;
  readonly addEventListener: Window["addEventListener"];
  readonly removeEventListener: Window["removeEventListener"];
}) {
  const fine = host.matchMedia("(pointer: fine)");
  const reduced = host.matchMedia("(prefers-reduced-motion: reduce)");
  let dismissedForPage: boolean | null = null;
  const eligible = () => fine.matches && !reduced.matches;
  return {
    getSnapshot() {
      if (!eligible()) return false;
      if (dismissedForPage !== null) return !dismissedForPage;
      try {
        return host.localStorage.getItem(STORAGE_KEY) !== "1";
      } catch {
        return true;
      }
    },
    subscribe(onChange: () => void) {
      const dismiss = () => {
        dismissedForPage = true;
        onChange();
      };
      const restore = () => {
        if (!eligible()) return;
        try {
          host.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Restore still works for this page view when storage is unavailable.
        }
        dismissedForPage = false;
        onChange();
      };
      const storage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== STORAGE_KEY) return;
        dismissedForPage = null;
        onChange();
      };
      fine.addEventListener("change", onChange);
      reduced.addEventListener("change", onChange);
      host.addEventListener("storage", storage);
      host.addEventListener("kunai:roamer-dismissed", dismiss);
      host.addEventListener("kunai:roamer-restore", restore);
      return () => {
        fine.removeEventListener("change", onChange);
        reduced.removeEventListener("change", onChange);
        host.removeEventListener("storage", storage);
        host.removeEventListener("kunai:roamer-dismissed", dismiss);
        host.removeEventListener("kunai:roamer-restore", restore);
      };
    },
  };
}

let visibilityStore: ReturnType<typeof createRoamerVisibilityStore> | undefined;
const getVisibilityStore = () => (visibilityStore ??= createRoamerVisibilityStore(window));
const subscribeVisibility = (onChange: () => void) => getVisibilityStore().subscribe(onChange);
const getVisibilitySnapshot = () => getVisibilityStore().getSnapshot();
const getServerVisibilitySnapshot = () => false;

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
function poolFor(phase: RoamerPhase): readonly string[] {
  if (phase === "asleep") return SLEEPY_LINES;
  if (phase === "walking") return WALKING_LINES;
  return RESTING_LINES;
}

/** A line from the pool that is not the one she just said. */
function pickLine(pool: readonly string[], last: string | null): string {
  const fresh = pool.filter((candidate) => candidate !== last);
  const choices = fresh.length > 0 ? fresh : pool;
  return choices[Math.floor(Math.random() * choices.length)] ?? pool[0] ?? "";
}

type GaitState = {
  phase: number;
  heading: number;
  pose: FoxPose;
  settleMs: number;
};

export function KunaiFoxRoamer({ size = 58 }: { readonly size?: number }) {
  const paused = useKannaPaused();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  // Her whole movement state lives in a ref, not React state: it advances every
  // frame and must never queue a render to move her. What React does hold is
  // `phase` and `facing`, which change rarely and drive what is drawn.
  const machine = useState(() => ({ current: createRoamerState({ x: -400, y: -400 }) }))[0];
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The walking drawing is vector parts she can swing a leg on; the resting
  // poses are stills. `walkerRef` is the handle that hangs a pose on the parts,
  // `gait` the stride she is in, and `settle` how far through putting her feet
  // down she is. All three advance every frame, so none of them is React state.
  const walkerRef = useRef<FoxWalkerHandle | null>(null);
  const gait = useRef<GaitState>({ phase: 0, heading: 0, pose: STANDING_POSE, settleMs: 0 });
  const lastFrame = useRef(0);
  const seeded = useRef(false);
  const attachHost = useCallback(
    (host: HTMLDivElement | null) => {
      hostRef.current = host;
      if (!host) return;
      // A restored host must keep its position even when no frame may run.
      const pos = machine.current.pos;
      host.style.transform = `translate3d(${(pos.x - size / 2).toFixed(1)}px, ${(pos.y - size / 2).toFixed(1)}px, 0)`;
    },
    [machine, size],
  );

  const [phase, setPhase] = useState<RoamerPhase>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("right");
  // True from the moment she starts walking until she has finished settling, so
  // the vector drawing is on screen for exactly as long as it has legs to move.
  const [showWalker, setShowWalker] = useState(false);
  // The frame loop reads this instead of closing over `showWalker`, for the
  // same reason `phaseRef` exists: the loop is created once per `enabled`, and
  // a captured value would be frozen at whatever it was on mount.
  const showWalkerRef = useRef(showWalker);
  useEffect(() => {
    showWalkerRef.current = showWalker;
  }, [showWalker]);
  const [line, setLine] = useState<string | null>(null);
  const enabled = useSyncExternalStore(
    subscribeVisibility,
    getVisibilitySnapshot,
    getServerVisibilitySnapshot,
  );
  // Docs chrome exclusion band: `#nd-sidebar` on the left, `#nd-toc` on the
  // right. She must never sit on clickable navigation — a TOC link that hits
  // her quip button reads as a dead link. Rects are cached and re-read on a
  // cadence because getBoundingClientRect every frame is a layout read.
  const exclusionBand = useRef<{ left: number; right: number } | null>(null);
  const exclusionStamp = useRef(0);

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
    if (!enabled || paused) return undefined;
    lastFrame.current = 0;

    function refreshExclusionBand() {
      const sidebar = document.getElementById("nd-sidebar")?.getBoundingClientRect();
      const toc = document.getElementById("nd-toc")?.getBoundingClientRect();
      const left = sidebar && sidebar.width > 1 ? sidebar.right : null;
      const right = toc && toc.width > 1 ? toc.left : null;
      exclusionBand.current =
        left !== null || right !== null
          ? { left: left ?? 0, right: right ?? Number.POSITIVE_INFINITY }
          : null;
      exclusionStamp.current = performance.now();
    }

    function startLoop() {
      if (document.hidden || frameRef.current !== null || !seeded.current) return;
      lastFrame.current = 0;
      frameRef.current = window.requestAnimationFrame(tick);
    }

    function stopLoop() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }

    function onMove(event: PointerEvent) {
      // Keep Kanna patrolling calmly along the bottom edge corridor so she never
      // walks across headlines, prose, or cards, while still tracking your cursor horizontally.
      const corridorY = Math.max(size, window.innerHeight - size / 2 - 14);
      pointer.current = { x: event.clientX, y: corridorY };
      if (!seeded.current) {
        seeded.current = true;
        const startX = Math.max(size, Math.min(window.innerWidth - size, event.clientX - 90));
        const at = { x: startX, y: corridorY };
        machine.current = { ...createRoamerState(at), phase: "sitting" };
        refreshExclusionBand();
      }
      startLoop();
    }

    function onCopied() {
      if (seeded.current) say(["Copied — paste it in your shell.", "Ready when you are."]);
    }

    function tick(timestamp: number) {
      frameRef.current = null;
      const host = hostRef.current;
      if (!host || !seeded.current) return;

      const previous = lastFrame.current || timestamp;
      lastFrame.current = timestamp;
      const dt = Math.min((timestamp - previous) / 1000, 0.05);

      const before = machine.current;
      const next = stepRoamer(before, { pointer: pointer.current, dt });
      machine.current = next;

      // Refresh docs sidebar/TOC bounds occasionally while moving so navigation stays clickable.
      if (next.phase === "walking" && timestamp - exclusionStamp.current > 1000) {
        refreshExclusionBand();
      }
      const band = exclusionBand.current;
      const edgePad = size / 2 + 16;
      const minX = band ? band.left + edgePad : edgePad;
      const maxX = band
        ? Math.min(band.right - edgePad, window.innerWidth - edgePad)
        : window.innerWidth - edgePad;
      const corridorY = Math.max(size, window.innerHeight - size / 2 - 14);
      let clampedX = Math.min(Math.max(next.pos.x, minX), Math.max(minX, maxX));
      // Step aside from the centered bottom Command Dock pill when it is mounted.
      const dockPill = document.querySelector(".kunai-dock-pill");
      if (dockPill) {
        const dockRect = dockPill.getBoundingClientRect();
        if (clampedX > dockRect.left - edgePad && clampedX < dockRect.right + edgePad) {
          const mid = (dockRect.left + dockRect.right) / 2;
          clampedX =
            clampedX < mid
              ? Math.max(minX, dockRect.left - edgePad)
              : Math.min(maxX, dockRect.right + edgePad);
        }
      }
      if (clampedX !== next.pos.x || corridorY !== next.pos.y) {
        machine.current = { ...next, pos: { x: clampedX, y: corridorY } };
      }

      const finalPos = machine.current.pos;
      const stepX = finalPos.x - before.pos.x;
      const stepY = finalPos.y - before.pos.y;
      const travelled = Math.hypot(stepX, stepY);
      const stride = gait.current;
      if (next.phase === "walking") {
        stride.settleMs = 0;
        if (before.phase !== "walking") stride.heading = 0;
        if (travelled > 0.2) {
          stride.heading = smoothHeading(stride.heading, headingFromMotion(stepX, stepY), dt);
        }
        stride.phase = advancePhase(stride.phase, travelled, size);
        stride.pose = withHeading(gaitPose(stride.phase), stride.heading);
        walkerRef.current?.setPose(stride.pose);
        if (before.phase !== "walking") setShowWalker(true);
      } else if (showWalkerRef.current) {
        stride.settleMs += dt * 1000;
        const t = stride.settleMs / SETTLE_MS;
        walkerRef.current?.setPose(blendPose(stride.pose, STANDING_POSE, t));
        if (t >= 1) setShowWalker(false);
      }

      if (next.phase !== before.phase) setPhase(next.phase);
      if (next.facing !== before.facing) setFacing(next.facing);

      const pos = machine.current.pos;
      host.style.transform = `translate3d(${(pos.x - size / 2).toFixed(1)}px, ${(
        pos.y -
        size / 2
      ).toFixed(1)}px, 0)`;

      // Once asleep and fully settled, pause rAF completely until the next pointer move.
      const isSleepingIdle = next.phase === "asleep" && !showWalkerRef.current && travelled === 0;
      if (!isSleepingIdle && !document.hidden) {
        frameRef.current = window.requestAnimationFrame(tick);
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", refreshExclusionBand, { passive: true });
    window.addEventListener("kunai:copied", onCopied);
    function syncVisibility() {
      if (document.hidden) {
        stopLoop();
      } else if (seeded.current && machine.current.phase !== "asleep") {
        startLoop();
      }
    }
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", refreshExclusionBand);
      window.removeEventListener("kunai:copied", onCopied);
      document.removeEventListener("visibilitychange", syncVisibility);
      stopLoop();
    };
  }, [enabled, paused, size, machine, say]);

  // Unprompted chatter. `phase` is read through a ref rather than a dependency
  // on purpose: as a dependency it re-ran this effect every time she started or
  // stopped walking, which cleared the pending timer, so the delay almost never
  // elapsed and she was close to silent.
  const phaseRef = useRef<RoamerPhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!enabled || paused) return undefined;
    let timer: number;
    const schedule = () => {
      const window_ = CHATTER_WINDOW_MS[phaseRef.current];
      if (!window_) {
        // A phase with nothing to say. Re-check soon rather than scheduling a
        // long timer she would have to be interrupted out of.
        timer = window.setTimeout(schedule, CHATTER_RECHECK_MS);
        return;
      }
      const [min, max] = window_;
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
  }, [enabled, paused, say]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Dismissal still holds for this page view even if it cannot be stored.
    }
    // Let the restore chip in the sidebar footer appear without a reload.
    window.dispatchEvent(new Event("kunai:roamer-dismissed"));
  }, []);

  if (!enabled) return null;

  const pose: KunaiFoxPose = poseForPhase(phase);

  return (
    // Hidden from assistive tech, and out of the tab order, on purpose: she
    // only ever appears for a fine pointer, so there is no keyboard path that
    // could reach her and nothing here that is not decorative.
    <div ref={attachHost} className="kunai-roamer" data-paused={paused} aria-hidden="true">
      {line ? <p className="kunai-roamer__bubble">{line}</p> : null}
      <button
        type="button"
        className={`kunai-roamer__fox is-${phase}`}
        onClick={() => say(phase === "asleep" ? SLEEPY_LINES : POKED_LINES)}
        tabIndex={-1}
      >
        {showWalker ? (
          <KunaiFoxWalker ref={walkerRef} facing={facing} size={size} />
        ) : (
          <KunaiFox pose={pose} facing={facing} size={size} />
        )}
      </button>
      <button type="button" className="kunai-roamer__close" onClick={dismiss} tabIndex={-1}>
        ×
      </button>
    </div>
  );
}
