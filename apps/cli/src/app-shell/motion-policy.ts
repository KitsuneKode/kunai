import { plainModeEnabled } from "./plain-mode";

/** `0`/`false` read as "not requested", the same way `KUNAI_PET` and `KUNAI_POSTER` do. */
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

function requested(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized !== "" && !OFF_VALUES.has(normalized);
}

/**
 * Whether the user asked for no animation: `KUNAI_REDUCED_MOTION`, the
 * cross-tool `NO_MOTION`, or plain / screen-reader mode (`--plain`,
 * `KUNAI_PLAIN=1`, or `config.plainMode`). Read on every call rather than at
 * module load so a changed environment or setting is honored immediately.
 *
 * Every animated surface gates on this, because the cue that something is
 * loading must survive without movement: the message text stays, the glyph
 * stops cycling.
 */
export function reducedMotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return requested(env.KUNAI_REDUCED_MOTION) || requested(env.NO_MOTION) || plainModeEnabled(env);
}
