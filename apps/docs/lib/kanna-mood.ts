/**
 * How put-out Kanna is, and what she says about it.
 *
 * On this page she is off duty and allowed a temper (the terminal is where she is
 * brief and never chatty; see `docs/users/kanna.mdx`). You can pick her up and put
 * her somewhere, or tell her to stay, and she has opinions about being managed. This
 * is that opinion, as a number that rises when you push her around and falls when you
 * leave her alone, with three moods read off it.
 *
 * The consequence of pushing her is small and bounded on purpose: past a threshold
 * she sulks, which means flat ears, grumbling instead of chatter, and refusing to
 * come when called for a short while. It is never lasting and never blocks anything
 * on the page; a minute of being left alone and it is gone.
 *
 * Pure and clock-injected like the rest of her logic: every rule is a timing rule, so
 * callers pass `now` and nothing here reads a clock.
 */

export type Mood = "content" | "grumpy" | "sulking";

export type MoodState = {
  /** How put-out she is. Rises with each push, falls with time. */
  readonly annoyance: number;
  /** The time `annoyance` was last brought up to date, in ms. */
  readonly at: number;
  /** She will not answer a call before this time (ms), or 0. */
  readonly stubbornUntil: number;
};

/** One point of annoyance wears off per this long. */
export const DECAY_MS = 60_000;
/** From here she is short with you. */
export const GRUMPY_AT = 3;
/** From here she sulks, and stops coming when called. */
export const SULKING_AT = 5;
/** The ceiling, so a burst of pushing cannot bank an hour of sulking. */
export const MAX_ANNOYANCE = 7;
/** How long a sulk refuses a call. Short: it is a joke, not a punishment. */
export const STUBBORN_MS = 45_000;

export const CALM: MoodState = { annoyance: 0, at: 0, stubbornUntil: 0 };

/** What happened to her. */
export type KannaEvent = "picked-up" | "placed" | "stay" | "come" | "nap" | "poked";

/** How much each thing annoys her. Napping is the one thing she asks for. */
const ANNOYANCE = {
  "picked-up": 1,
  placed: 0,
  stay: 1,
  come: 0,
  nap: 0,
  poked: 0.25,
} satisfies Record<KannaEvent, number>;

/** Wear off the annoyance that has faded since `state.at`. */
export function settle(state: MoodState, now: number): MoodState {
  if (now <= state.at) return state;
  const faded = (now - state.at) / DECAY_MS;
  return {
    annoyance: Math.max(0, state.annoyance - faded),
    at: now,
    stubbornUntil: state.stubbornUntil,
  };
}

export function moodOf(state: MoodState, now: number): Mood {
  const { annoyance } = settle(state, now);
  if (annoyance >= SULKING_AT) return "sulking";
  if (annoyance >= GRUMPY_AT) return "grumpy";
  return "content";
}

/** Whether she is refusing a call right now. */
export function isStubborn(state: MoodState, now: number): boolean {
  return now < state.stubbornUntil;
}

export type Reaction = {
  readonly state: MoodState;
  /** `refused` only for a call made while she is being stubborn. */
  readonly outcome: "ok" | "refused";
  /** The mood she is in after this, which decides what she says. */
  readonly mood: Mood;
};

/**
 * What an event does to her.
 *
 * A call while she is stubborn is refused and annoys her no further: asking again
 * is not the push, the pushing was. Crossing into sulking starts one stubborn spell
 * and does not extend a running one, so she cannot be kept sulking by poking her.
 */
export function react(state: MoodState, event: KannaEvent, now: number): Reaction {
  const current = settle(state, now);

  if (event === "come" && isStubborn(current, now)) {
    return { state: current, outcome: "refused", mood: moodOf(current, now) };
  }

  const wasSulking = current.annoyance >= SULKING_AT;
  const annoyance = Math.min(MAX_ANNOYANCE, current.annoyance + ANNOYANCE[event]);
  const startsSulking = !wasSulking && annoyance >= SULKING_AT;
  const next: MoodState = {
    annoyance,
    at: now,
    stubbornUntil:
      startsSulking && !isStubborn(current, now) ? now + STUBBORN_MS : current.stubbornUntil,
  };
  return { state: next, outcome: "ok", mood: moodOf(next, now) };
}

type Pools = Readonly<Record<Mood, readonly string[]>>;

/**
 * What she says, by what happened and how she feels about it. Short and lower case
 * like everything she says on this page. The grumbling is aimed at being managed, not
 * at the reader: she is a cat who has been picked up, not an insult.
 */
const LINES = {
  "picked-up": {
    content: ["oh.", "hey, where are we going.", "put me down. gently.", "i can walk, you know."],
    grumpy: ["you again.", "this is undignified.", "i have legs.", "put. me. down."],
    sulking: ["i hate you. a little.", "i'm filing a complaint.", "stop.", "unbelievable."],
  },
  placed: {
    content: ["fine. i'll sit here.", "nice spot. i guess.", "ok. staying.", "comfy enough."],
    grumpy: ["fine. i'm staying. i'm not happy.", "you're lucky it's comfy.", "here. happy now?"],
    sulking: ["i see how it is.", "i'm not speaking to you.", "...", "i hate you. i'm staying."],
  },
  stay: {
    content: ["staying.", "sit. ok. sat.", "i'll be here.", "good a spot as any."],
    grumpy: ["i'm sitting. under protest.", "stay, she says.", "fine."],
    sulking: ["i said fine.", "you can't make me like it.", "...", "i'll remember this."],
  },
  come: {
    content: ["on my way.", "oh, now you want me.", "coming."],
    grumpy: ["finally.", "hm. ok.", "after all that."],
    sulking: ["...fine.", "only because i'm bored.", "don't push it."],
  },
  "come-refused": {
    content: ["in a minute.", "not yet."],
    grumpy: ["no.", "ask me later."],
    sulking: [
      "no.",
      "i'm not talking to you.",
      "ask me later. much later.",
      "i'm busy being upset.",
    ],
  },
  nap: {
    content: ["five more minutes.", "wake me for the good ones.", "zzz.", "nap time."],
    grumpy: ["finally, some peace.", "don't wake me.", "zzz. mostly."],
    sulking: ["good. go away.", "zzz. pointedly.", "i'm asleep. leave me alone."],
  },
  poked: {
    content: ["hey.", "yes?", "i'm working.", "you clicked me. bold."],
    grumpy: ["rude.", "i felt that.", "stop poking."],
    sulking: ["don't.", "no.", "i'm still mad.", "touch me again and see."],
  },
} satisfies Record<KannaEvent | "come-refused", Pools>;

/** The pool of lines for something that happened, in the mood she is in. */
export function linesFor(
  event: KannaEvent,
  mood: Mood,
  outcome: Reaction["outcome"] = "ok",
): readonly string[] {
  const key = event === "come" && outcome === "refused" ? "come-refused" : event;
  return LINES[key][mood];
}

/** What she mutters unprompted while she is sulking, in place of her usual chatter. */
export const SULKING_MUTTERS: readonly string[] = [
  "...",
  "still here.",
  "i'm fine.",
  "don't mind me.",
  "i'm not looking at you.",
];

/** Said once, the second time she is poked, so the controls can be found without a manual. */
export function tipFor(canUseKeys: boolean): string {
  return canUseKeys
    ? "tip: s makes me stay. c calls me. n is nap. or just carry me."
    : "tip: carry me somewhere and i'll stay there.";
}
