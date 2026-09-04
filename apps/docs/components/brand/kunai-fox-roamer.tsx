"use client";

import { KunaiFox, type KunaiFoxPose } from "@/components/brand/kunai-fox";
import {
  createRoamerState,
  pointerIsOver,
  poseForPhase,
  stepRoamer,
  type RoamerPhase,
} from "@/lib/roamer-machine";
import {
  browserRoamerStore,
  readRoamerDismissed,
  resolveRoamerUrlOverride,
  setRoamerDismissed,
  subscribeRoamerPreference,
  urlWithoutRoamerParam,
  writeRoamerDismissed,
} from "@/lib/roamer-preference";
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
 * She is dismissible and stays dismissed, she never takes a click the page
 * wanted (events pass through the host always, and through her the moment she
 * is standing in front of something clickable — see `updateYield`), she only
 * exists on a fine pointer, and `prefers-reduced-motion` removes her entirely
 * rather than freezing her mid-page.
 *
 * ## The way back
 *
 * Dismissing her is reversible three ways, because a one-click permanent
 * decision taken by a button that sits over her ear is a decision people make
 * by accident. An undo offers itself for {@link UNDO_MS} straight after the
 * click, `?kanna=on` restores her from a link, and the toggle on her docs page
 * shows the current state and flips it. All three go through
 * `lib/roamer-preference.ts`; none of them are this component's own idea of
 * where the flag lives.
 */

/**
 * How the movement itself works — notice, commit, travel, settle, rest — lives
 * in `lib/roamer-machine.ts`, which is pure and clock-injected so every timing
 * rule in it is testable without a browser or a real sleep. What stays here is
 * the presentation: the gait clock, what she says, and when she is allowed to
 * exist at all.
 */
const STEP_MS = 190;
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
/**
 * How long the undo stays offered after she is dismissed.
 *
 * Long enough to notice a fox you did not mean to close and read one line about
 * it, short enough that a deliberate dismissal is not nagged at. The reference
 * is Gmail's undo-send window, which sits in the same range for the same
 * reason. After it lapses the durable routes — `?kanna=on` and the docs-page
 * toggle — are what is left, and both are documented.
 */
const UNDO_MS = 12000;

/**
 * What counts as something of the page's own that she must not stand in front of.
 *
 * Deliberately generous — a `[tabindex]` or a `[role]` is enough. Being wrong in
 * this direction costs one un-poked fox; being wrong the other way costs a
 * reader a link they clicked and did not get.
 */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
  return choices[Math.floor(Math.random() * choices.length)] as string;
}

/**
 * Is there something of the page's own under this point, behind her?
 *
 * `elementsFromPoint` returns the whole stack at a point, not just the top of
 * it, so this can ask what a click would have reached had she not been standing
 * there. Her own subtree is skipped: she is not what the reader was aiming at.
 */
function occludesInteractive(host: HTMLElement, x: number, y: number): boolean {
  return document
    .elementsFromPoint(x, y)
    .some((element) => !host.contains(element) && element.closest(INTERACTIVE_SELECTOR) !== null);
}

export function KunaiFoxRoamer({ size = 58 }: { readonly size?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  // Her whole movement state lives in a ref, not React state: it advances every
  // frame and must never queue a render to move her. What React does hold is
  // `phase` and `facing`, which change rarely and drive what is drawn.
  const machine = useRef(createRoamerState({ x: -400, y: -400 }));
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const stepFlag = useRef(false);
  const stepMs = useRef(0);
  const lastFrame = useRef(0);
  const seeded = useRef(false);
  /** Last value written to `data-yield`, so an unchanged frame writes nothing. */
  const yielding = useRef(false);

  const [phase, setPhase] = useState<RoamerPhase>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [line, setLine] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [undoOffered, setUndoOffered] = useState(false);

  /**
   * The single place that decides whether she may exist.
   *
   * Resolved after mount so server and client agree on the first render, and so
   * a dismissal from a previous visit is honoured before she is ever painted.
   *
   * It stays subscribed rather than answering once, because every input can
   * change while the page is open: a mouse gets plugged into a tablet, the OS
   * reduced-motion switch is flipped, another tab restores her, or the toggle
   * on her docs page does. The previous one-shot read meant reduced-motion
   * turned on mid-visit left the stylesheet hiding her while this component
   * went on running a `requestAnimationFrame` loop against an invisible fox
   * forever.
   */
  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const store = browserRoamerStore();

    // A `?kanna=` link is an instruction, not a query: persist it first so it
    // survives the navigation that follows, then let the normal gate read it
    // back like any other stored preference. Once carried out it is spent, so
    // it comes back out of the address bar rather than riding along into a
    // copied link or into the URL web analytics records.
    const override = resolveRoamerUrlOverride(window.location.search);
    if (override) {
      writeRoamerDismissed(store, override === "off");
      const cleaned = urlWithoutRoamerParam(window.location.href);
      // `replaceState` rather than a router call: this must not add a history
      // entry that the back button walks into, and Next treats a direct
      // `replaceState` as a shallow update it does not need to re-render for.
      if (cleaned !== null) window.history.replaceState(null, "", cleaned);
    }

    const evaluate = () => {
      setEnabled(finePointer.matches && !reducedMotion.matches && !readRoamerDismissed(store));
    };

    evaluate();
    finePointer.addEventListener("change", evaluate);
    reducedMotion.addEventListener("change", evaluate);
    const unsubscribe = subscribeRoamerPreference(evaluate);
    return () => {
      finePointer.removeEventListener("change", evaluate);
      reducedMotion.removeEventListener("change", evaluate);
      unsubscribe();
    };
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

    // She is re-mounted whenever this effect runs, so the fresh host carries no
    // `data-yield` yet. Without this the memo below could hold a stale `true`
    // and skip the write that CSS is waiting for, leaving her permanently
    // unclickable after a restore.
    yielding.current = false;

    function onMove(event: PointerEvent) {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!seeded.current) {
        // Drop her in beside the pointer on first sight rather than marching
        // her across the whole viewport from wherever she was parked.
        seeded.current = true;
        const at = { x: event.clientX - 90, y: event.clientY + 50 };
        machine.current = { ...createRoamerState(at), phase: "sitting" };
      }
      updateYield(event.clientX, event.clientY);
    }

    /**
     * Stand down whenever she is between the reader and the page.
     *
     * `SETTLE_PX` is 70 and she is 58 across, so at rest her edge is ~41px from
     * the cursor: reaching for anything near where you stopped puts the pointer
     * on her, and her click handler — the one that makes her talk — was eating
     * the click. Her own doc comment claimed she never covers anything, which
     * was true of the host and not of her body.
     *
     * The rule is what is *behind* her, not how the pointer got there. Dwell
     * timing was the obvious alternative and is wrong: aiming at a link is
     * itself a pause, so any dwell long enough to mean "I want the fox" is also
     * long enough to be someone lining up a click on what she is covering.
     *
     * Both reads are guarded by the cheap geometric test, so the hit test only
     * runs on the rare frames where the pointer is genuinely on her.
     */
    function updateYield(x: number, y: number) {
      const host = hostRef.current;
      if (!host) return;
      const over = pointerIsOver(machine.current.pos, { x, y }, size);
      const next = over && occludesInteractive(host, x, y);
      // Only on a real change. This runs every frame, and an attribute write
      // goes through the setter and dirties style whether or not the value
      // differs — the same reason the gait clock above only touches
      // `dataset.step` when the flag actually flips.
      if (next === yielding.current) return;
      yielding.current = next;
      host.dataset.yield = next ? "true" : "false";
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
      const next = stepRoamer(before, { pointer: pointer.current, dt });
      machine.current = next;

      // The gait runs on its own clock so footfalls stay even whatever the
      // frame rate is doing.
      if (next.phase === "walking") {
        stepMs.current += dt * 1000;
        if (stepMs.current >= STEP_MS) {
          stepMs.current = 0;
          stepFlag.current = !stepFlag.current;
          host.dataset.step = stepFlag.current ? "a" : "b";
        }
      }

      // React state only when it actually changed: this runs every frame, and
      // setting an identical phase would re-render the whole subtree at 60Hz.
      if (next.phase !== before.phase) setPhase(next.phase);
      if (next.facing !== before.facing) setFacing(next.facing);

      host.style.transform = `translate3d(${(next.pos.x - size / 2).toFixed(1)}px, ${(
        next.pos.y -
        size / 2
      ).toFixed(1)}px, 0)`;

      // Also here, not only on pointer move: what is behind her changes without
      // the pointer moving at all — the reader scrolls a link under a resting
      // fox, or she walks over one. The geometric guard inside means this costs
      // four comparisons on the frames where she is nowhere near the cursor.
      if (pointer.current) updateYield(pointer.current.x, pointer.current.y);
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
  const phaseRef = useRef<RoamerPhase>(phase);
  phaseRef.current = phase;

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
          if (seeded.current) say(poolFor(phaseRef.current));
          schedule();
        },
        min + Math.random() * (max - min),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, say]);

  // Neither of these touches `enabled` directly. They move the preference and
  // let the gate effect above re-derive from it, so there is exactly one
  // expression in this file that decides whether she is on screen — including
  // when the change arrives from another tab or her docs page.
  const dismiss = useCallback(() => {
    setRoamerDismissed(true);
    setUndoOffered(true);
  }, []);

  const restore = useCallback(() => {
    setUndoOffered(false);
    // Come back beside the pointer rather than resuming from wherever she was
    // standing when she was dismissed, which by now is nowhere near it.
    seeded.current = false;
    lastFrame.current = 0;
    machine.current = createRoamerState({ x: -400, y: -400 });
    setLine(null);
    setRoamerDismissed(false);
  }, []);

  // The undo withdraws itself. It is an offer, not a state you have to clear.
  useEffect(() => {
    if (!undoOffered) return undefined;
    const timer = window.setTimeout(() => setUndoOffered(false), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoOffered]);

  if (!enabled) {
    // Not `null` any more: the moment after a dismissal is the one moment the
    // way back is worth showing unprompted.
    // `<output>` rather than a div with `role="status"`: same announcement,
    // and unlike her it is not decorative — it is the only visible trace of a
    // state change, so a screen reader should get it.
    return undoOffered ? (
      <output className="kunai-roamer-undo">
        <span className="kunai-roamer-undo__text">Kanna is hidden.</span>
        <button type="button" className="kunai-roamer-undo__action" onClick={restore}>
          Bring her back
        </button>
      </output>
    ) : null;
  }

  const pose: KunaiFoxPose = poseForPhase(phase);

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
