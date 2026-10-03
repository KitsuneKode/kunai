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
import { commandForKey, type KannaCommand } from "@/lib/kanna-controls";
import {
  CALM,
  isStubborn,
  linesFor,
  moodOf,
  react as reactMood,
  SULKING_MUTTERS,
  tipFor,
  type KannaEvent,
  type Mood,
  type MoodState,
  type Reaction,
} from "@/lib/kanna-mood";
import { parsePlace, PLACE_KEY, type Place, seedFor, toPlace } from "@/lib/kanna-place";
import {
  createRoamerState,
  poseForPhase,
  stepRoamer,
  type RoamerPhase,
} from "@/lib/roamer-machine";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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
 * ## Telling her where to be
 *
 * She follows the pointer until you say otherwise. Carry her somewhere and she
 * stays there, and remembers it across pages and visits; `s` makes her stay where
 * she is, `c` calls her back, `n` sends her to sleep. She has opinions about being
 * managed: carrying her and telling her to stay annoy her (`lib/kanna-mood.ts`),
 * and past a point she sulks, which means flat ears, grumbling, and refusing to come
 * when called for a short while. It is bounded and it wears off; nothing on the page
 * ever depends on her.
 *
 * ## On a touch screen
 *
 * There is no pointer to follow, so she perches in the bottom-left corner asleep.
 * Tap to wake her, drag to move her (she stays where you leave her), tap the × to
 * dismiss her.
 *
 * ## Restraint
 *
 * She is dismissible and stays dismissed, she never covers anything (pointer
 * events pass straight through except on her), and `prefers-reduced-motion`
 * removes her entirely rather than freezing her mid-page.
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
/** How much smaller she is on a touch screen. */
const TOUCH_SCALE = 0.8;
/** How far the pointer must travel with her held before it is a carry, not a click. */
const DRAG_START_PX = 6;
/** How far from a side the window must leave her before her bubble opens inward. */
const BUBBLE_EDGE_PX = 150;

type BubbleSide = "left" | "center" | "right";

function bubbleSideFor(x: number): BubbleSide {
  if (x < BUBBLE_EDGE_PX) return "left";
  if (x > window.innerWidth - BUBBLE_EDGE_PX) return "right";
  return "center";
}

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

/** The pool that matches what she is visibly doing, and how she feels about it. */
function poolFor(phase: RoamerPhase, mood: Mood): readonly string[] {
  if (mood === "sulking") return SULKING_MUTTERS;
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

export function KunaiFoxRoamer({ size: fullSize = 58 }: { readonly size?: number }) {
  // Smaller on a touch screen, where she sits in a corner over the page instead of
  // trailing a pointer beside it, so she takes less of a small screen. Set once, on
  // mount, from the same query that decides she perches.
  const [coarse, setCoarse] = useState(false);
  const size = coarse ? Math.round(fullSize * TOUCH_SCALE) : fullSize;
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
  // Where she has been told to be. While pinned she ignores the pointer and simply
  // rests where she is, which is what makes "stay" cost no new movement code.
  const pinned = useRef(false);
  const perched = useRef(false);
  const moodState = useRef<MoodState>(CALM);
  const drag = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const pokes = useRef(0);
  const [mood, setMood] = useState<Mood>("content");
  const [carried, setCarried] = useState(false);
  const [bubbleSide, setBubbleSide] = useState<BubbleSide>("center");
  const bubbleSideRef = useRef<BubbleSide>("center");

  const [phase, setPhase] = useState<RoamerPhase>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("right");
  // True from the moment she starts walking until she has finished settling, so
  // the vector drawing is on screen for exactly as long as it has legs to move.
  const [showWalker, setShowWalker] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  // Docs chrome exclusion band: `#nd-sidebar` on the left, `#nd-toc` on the
  // right. She must never sit on clickable navigation — a TOC link that hits
  // her quip button reads as a dead link. Rects are cached and re-read on a
  // cadence because getBoundingClientRect every frame is a layout read.
  const exclusionBand = useRef<{ left: number; right: number } | null>(null);
  const exclusionStamp = useRef(0);

  // Resolved after mount so server and client agree on the first render, and so
  // a dismissal from a previous visit is honoured before she is ever painted.
  useEffect(() => {
    // A fine pointer gives her something to follow; a touch screen gets a perch.
    // Only the reduced-motion preference turns her off altogether.
    const eligible = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isDismissed = () => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    };
    // Where she starts: the place she was last left, if there is one, and on a touch
    // screen (nothing to follow) a perch in the corner, asleep. Otherwise she waits
    // for the pointer and is dropped in beside it on first sight.
    const seedPlace = () => {
      perched.current = !window.matchMedia("(pointer: fine)").matches;
      setCoarse(perched.current);
      const view = { width: window.innerWidth, height: window.innerHeight };
      let saved: Place | null = null;
      try {
        saved = parsePlace(window.localStorage.getItem(PLACE_KEY));
      } catch {
        // No store, no remembered place: she just starts fresh.
      }
      const seed = seedFor({ perched: perched.current, saved, view, margin: fullSize / 2 + 4 });
      if (seed) {
        machine.current = { ...createRoamerState(seed.at), phase: seed.phase };
        pinned.current = true;
        seeded.current = true;
      }
    };
    if (eligible() && !isDismissed()) {
      seedPlace();
      setEnabled(true);
    }
    // "Bring Kanna back" — the reverse of dismiss. Anything on the page can
    // dispatch this; she clears the flag and walks again without a reload.
    const restore = () => {
      if (!eligible()) return;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // An unavailable store just means the restore is session-scoped.
      }
      setEnabled(true);
    };
    window.addEventListener("kunai:roamer-restore", restore);
    return () => window.removeEventListener("kunai:roamer-restore", restore);
  }, [machine, fullSize]);

  const say = useCallback((pool: readonly string[]) => {
    setLine((current) => pickLine(pool, current));
  }, []);

  // What happened to her, and how she feels about it. Updates her mood and returns
  // the reaction, so the caller can pick the line that fits.
  const feel = useCallback((event: KannaEvent): Reaction => {
    const reaction = reactMood(moodState.current, event, Date.now());
    moodState.current = reaction.state;
    setMood(reaction.mood);
    return reaction;
  }, []);

  /** She reacts, and says so. */
  const respond = useCallback(
    (event: KannaEvent): Reaction => {
      const reaction = feel(event);
      say(linesFor(event, reaction.mood, reaction.outcome));
      return reaction;
    },
    [feel, say],
  );

  // Where she was left, kept across pages and visits so "stay" means stay.
  const remember = useCallback(() => {
    try {
      window.localStorage.setItem(
        PLACE_KEY,
        JSON.stringify(
          toPlace(machine.current.pos, { width: window.innerWidth, height: window.innerHeight }),
        ),
      );
    } catch {
      // No store: she stays for this page view and forgets after.
    }
  }, [machine]);

  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(PLACE_KEY);
    } catch {
      // Nothing was remembered to forget.
    }
  }, []);

  /** Tell her where to be: stay where she is, come to the pointer, or go to sleep. */
  const run = useCallback(
    (command: KannaCommand) => {
      const here = machine.current;
      if (command === "come") {
        const reaction = respond("come");
        if (reaction.outcome === "refused") return;
        pinned.current = false;
        forget();
        // Woken, if she was asleep, so she notices the pointer and walks to it.
        if (here.phase === "asleep") machine.current = { ...here, phase: "sitting", restMs: 0 };
        return;
      }
      pinned.current = true;
      machine.current = {
        ...here,
        committed: here.pos,
        phase: command === "nap" ? "asleep" : "sitting",
        restMs: 0,
      };
      remember();
      respond(command === "nap" ? "nap" : "stay");
    },
    [machine, respond, forget, remember],
  );

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
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!seeded.current) {
        // Drop her in beside the pointer on first sight rather than marching
        // her across the whole viewport from wherever she was parked.
        seeded.current = true;
        const at = { x: event.clientX - 90, y: event.clientY + 50 };
        machine.current = { ...createRoamerState(at), phase: "sitting" };
      }
    }

    function tick(timestamp: number) {
      frameRef.current = window.requestAnimationFrame(tick);
      const host = hostRef.current;
      if (!host) return;

      // Every frame, so motion is smooth; the *pace* is held constant by delta
      // time rather than by throttling the clock. A backgrounded tab returns
      // one enormous delta, which without the clamp teleports her across the
      // page on the first frame back.
      const previous = lastFrame.current || timestamp;
      lastFrame.current = timestamp;
      const dt = Math.min((timestamp - previous) / 1000, 0.05);

      if (!seeded.current) {
        // `.kunai-roamer` is fixed at the origin, so without this she is parked
        // in the top-left corner from mount until the pointer first moves.
        const parked = machine.current.pos;
        host.style.transform = `translate3d(${parked.x}px, ${parked.y}px, 0)`;
        return;
      }

      const before = machine.current;
      // While she is carried she is where the hand puts her. While she is pinned, or
      // sulking, she ignores the pointer and rests where she is. Otherwise she
      // follows it, as she always did.
      const ignoringPointer = pinned.current || isStubborn(moodState.current, Date.now());
      const next = drag.current
        ? before
        : stepRoamer(before, { pointer: ignoringPointer ? null : pointer.current, dt });
      machine.current = next;

      // Keep her out of the docs chrome columns — sidebar on the left, TOC on
      // the right. A TOC link that lands on her quip button reads as a dead
      // link. Rects re-read on a ~500ms cadence because getBoundingClientRect
      // every frame is a layout read.
      if (timestamp - exclusionStamp.current > 500) {
        exclusionStamp.current = timestamp;
        const sidebar = document.getElementById("nd-sidebar")?.getBoundingClientRect();
        const toc = document.getElementById("nd-toc")?.getBoundingClientRect();
        const left = sidebar && sidebar.width > 1 ? sidebar.right : null;
        const right = toc && toc.width > 1 ? toc.left : null;
        exclusionBand.current =
          left !== null || right !== null
            ? { left: left ?? 0, right: right ?? Number.POSITIVE_INFINITY }
            : null;
      }
      const band = exclusionBand.current;
      if (band) {
        const margin = size / 2 + 12;
        const clampedX = Math.min(Math.max(next.pos.x, band.left + margin), band.right - margin);
        if (clampedX !== next.pos.x) {
          machine.current = { ...next, pos: { ...next.pos, x: clampedX } };
        }
      }

      // Keep her inside the window. A place chosen on a big screen, a resize, or a
      // carry to the edge must never leave her half off the page.
      {
        const margin = size / 2 + 4;
        const here = machine.current.pos;
        const x = Math.min(Math.max(here.x, margin), Math.max(margin, window.innerWidth - margin));
        const y = Math.min(Math.max(here.y, margin), Math.max(margin, window.innerHeight - margin));
        if (x !== here.x || y !== here.y) machine.current = { ...machine.current, pos: { x, y } };
      }

      // The stride advances by the distance she actually covered, so her feet
      // keep pace with her speed, ease as she eases, and stop when she does.
      // Measured after the chrome clamp above: a clamped step that moved her
      // nowhere must not turn her legs.
      const finalPos = machine.current.pos;
      const stepX = finalPos.x - before.pos.x;
      const stepY = finalPos.y - before.pos.y;
      const travelled = Math.hypot(stepX, stepY);
      const stride = gait.current;
      if (next.phase === "walking") {
        stride.settleMs = 0;
        // Start each walk level; the tilt then follows where she is actually going.
        if (before.phase !== "walking") stride.heading = 0;
        // A frame that barely moved her has no meaningful direction; keep the last.
        if (travelled > 0.2) {
          stride.heading = smoothHeading(stride.heading, headingFromMotion(stepX, stepY), dt);
        }
        stride.phase = advancePhase(stride.phase, travelled, size);
        // Her path leans off horizontal: nose up to climb, nose down to descend.
        stride.pose = withHeading(gaitPose(stride.phase), stride.heading);
        walkerRef.current?.setPose(stride.pose);
        if (before.phase !== "walking") setShowWalker(true);
      } else if (showWalkerRef.current) {
        stride.settleMs += dt * 1000;
        const t = stride.settleMs / SETTLE_MS;
        walkerRef.current?.setPose(blendPose(stride.pose, STANDING_POSE, t));
        if (t >= 1) setShowWalker(false);
      }

      // React state only when it actually changed: this runs every frame, and
      // setting an identical phase would re-render the whole subtree at 60Hz.
      // Compared with what is drawn, not with the previous step: the phase is also
      // set from outside the step (a nap, being woken, being put down), and a
      // comparison with the previous step would never notice those.
      if (machine.current.phase !== phaseRef.current) setPhase(machine.current.phase);
      if (next.facing !== before.facing) setFacing(next.facing);

      const pos = machine.current.pos;
      const side = bubbleSideFor(pos.x);
      if (side !== bubbleSideRef.current) {
        bubbleSideRef.current = side;
        setBubbleSide(side);
      }
      host.style.transform = `translate3d(${(pos.x - size / 2).toFixed(1)}px, ${(
        pos.y -
        size / 2
      ).toFixed(1)}px, 0)`;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [enabled, size, machine]);

  // The keys. Plain letters, so `commandForKey` is strict about where they count:
  // never with a modifier, never in a field, never in a dialog such as search.
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!seeded.current) return;
      const element = event.target instanceof Element ? event.target : null;
      const command = commandForKey(
        event,
        element
          ? {
              tagName: element.tagName,
              isContentEditable: element instanceof HTMLElement && element.isContentEditable,
              inDialog: element.closest('[role="dialog"], dialog') !== null,
            }
          : null,
      );
      if (command) run(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, run]);

  // Her mood fades while nobody is touching her, so re-read it now and then. React
  // ignores a set to the value it already has, so this costs nothing while it is steady.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setMood(moodOf(moodState.current, Date.now())), 5000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  // Unprompted chatter. `phase` is read through a ref rather than a dependency
  // on purpose: as a dependency it re-ran this effect every time she started or
  // stopped walking, which cleared the pending timer, so the delay almost never
  // elapsed and she was close to silent.
  const phaseRef = useRef<RoamerPhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // The frame loop reads this instead of closing over `showWalker`, for the
  // same reason `phaseRef` exists: the loop is created once per `enabled`, and
  // a captured value would be frozen at whatever it was on mount.
  const showWalkerRef = useRef(showWalker);
  useEffect(() => {
    showWalkerRef.current = showWalker;
  }, [showWalker]);

  useEffect(() => {
    if (!enabled) return undefined;
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
          if (seeded.current) {
            say(poolFor(phaseRef.current, moodOf(moodState.current, Date.now())));
          }
          schedule();
        },
        min + Math.random() * (max - min),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, say]);

  // Carrying her. Pointer capture keeps the drag with her however fast the hand
  // moves, and the same handlers serve a mouse and a finger.
  const onFoxPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pos = machine.current.pos;
    drag.current = {
      dx: pos.x - event.clientX,
      dy: pos.y - event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onFoxPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const held = drag.current;
    if (!held) return;
    if (!held.moved) {
      if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < DRAG_START_PX) {
        return;
      }
      held.moved = true;
      setCarried(true);
      setShowWalker(false);
      respond("picked-up");
    }
    const pos = { x: event.clientX + held.dx, y: event.clientY + held.dy };
    machine.current = { ...machine.current, pos, committed: pos, phase: "idle", restMs: 0 };
  };

  const onFoxPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const held = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!held?.moved) return;
    // The click that follows a carry is not a poke.
    suppressClick.current = true;
    setCarried(false);
    pinned.current = true;
    machine.current = { ...machine.current, phase: "sitting", restMs: 0 };
    remember();
    respond("placed");
  };

  // A tap or click. The second one teaches the controls, once, in her own voice.
  const poke = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    pokes.current += 1;
    const here = machine.current;
    if (here.phase === "asleep") machine.current = { ...here, phase: "sitting", restMs: 0 };
    if (pokes.current === 2) {
      say([tipFor(!perched.current)]);
      return;
    }
    respond("poked");
  };

  const dismiss = useCallback(() => {
    setEnabled(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Dismissal still holds for this page view even if it cannot be stored.
    }
    // Let the restore chip in the sidebar footer appear without a reload.
    window.dispatchEvent(new Event("kunai:roamer-dismissed"));
  }, []);

  if (!enabled) return null;

  // Carried, or sulking while she rests, she wears the put-out face.
  const resting = phase !== "walking" && phase !== "asleep";
  const pose: KunaiFoxPose =
    carried || (mood === "sulking" && resting) ? "oops" : poseForPhase(phase);

  return (
    // Hidden from assistive tech, and out of the tab order, on purpose: she
    // only ever appears for a fine pointer, so there is no keyboard path that
    // could reach her and nothing here that is not decorative.
    <div ref={hostRef} className="kunai-roamer" aria-hidden="true">
      {line ? (
        <p className="kunai-roamer__bubble" data-side={bubbleSide}>
          {line}
        </p>
      ) : null}
      <button
        type="button"
        className={`kunai-roamer__fox is-${phase}${carried ? " is-carried" : ""}${
          !carried && mood === "sulking" ? " is-sulking" : ""
        }`}
        onClick={poke}
        onPointerDown={onFoxPointerDown}
        onPointerMove={onFoxPointerMove}
        onPointerUp={onFoxPointerUp}
        onPointerCancel={onFoxPointerUp}
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
