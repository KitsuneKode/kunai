import { detectImageCapability } from "@/image";
import { isMultiplexed } from "@/image/capability";

export type CompanionPose = "idle" | "watch" | "go" | "wait" | "oops" | "nap";

/**
 * What the companion is allowed to be on this run.
 *
 * - `graphics` — the illustrated still, over a graphics protocol.
 * - `glyph`    — the portable 🦊, for terminals that cannot host an image.
 * - `off`      — nothing at all.
 *
 * `off` exists because the previous shape had no way out: `KUNAI_PET=0` dropped
 * graphics but kept emitting the glyph, so a user who wanted the fox gone could
 * not get rid of it, and piped output picked up a stray emoji.
 */
export type CompanionMode = "graphics" | "glyph" | "off";

/**
 * The persisted in-app choice for the companion (`config.companionPet`).
 * "auto" means resolve from env and terminal capability, exactly as before the
 * setting existed.
 */
export type CompanionPreference = "auto" | "off";

/** Retire the companion entirely. `0`/`false` read as "no pet", not "less pet". */
const OFF_VALUES = new Set(["0", "false", "off", "none"]);
/** Stay on the portable glyph even where a graphics protocol is available. */
const GLYPH_VALUES = new Set(["glyph", "text", "unicode"]);

/**
 * Where the persisted preference is read from. Bootstrap wires this to the
 * config service so settings edits and `/pet` take effect on the next render
 * instead of the next launch; the default keeps bare callers (tests, the exit
 * screen before bootstrap) behaving as "auto".
 */
let preferenceSource: () => CompanionPreference = () => "auto";

export function setCompanionPreferenceSource(source: () => CompanionPreference): void {
  preferenceSource = source;
}

/**
 * Whether the companion can be toggled from inside the app at all. Any explicit
 * `KUNAI_PET` value (`off`, `glyph`, …) pins its tier for the run and a non-TTY
 * run has no surfaces — offering a toggle in either case would be a dead
 * control a stored preference cannot override.
 */
export function companionToggleable(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { readonly isTTY?: boolean } = process.stdout,
): boolean {
  return !(env.KUNAI_PET ?? "").trim() && stdout.isTTY === true;
}

/**
 * Resolve the companion mode for this process.
 *
 * Half-block is deliberately not a tier: this art turns to noise at two pixels
 * per cell, so the floor below a real graphics protocol is the glyph, never a
 * half-block render.
 */
export function companionMode(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { readonly isTTY?: boolean } = process.stdout,
): CompanionMode {
  const requested = env.KUNAI_PET?.toLowerCase() ?? "";
  if (OFF_VALUES.has(requested)) return "off";

  // Nothing decorative belongs in a pipe, a redirect, or a captured log.
  if (!stdout.isTTY) return "off";

  if (GLYPH_VALUES.has(requested)) return "glyph";

  // The persisted in-app off sits below the env overrides: `KUNAI_PET=off`
  // already returned above, and an explicit `KUNAI_PET=glyph` launch is the
  // stronger, per-run signal.
  if (preferenceSource() === "off") return "off";

  // Posters off means "draw me no images". The glyph is not an image, so it
  // survives — this disables the picture, not the companion.
  if (OFF_VALUES.has(env.KUNAI_POSTER?.toLowerCase() ?? "")) return "glyph";

  // Multiplexers rewrite the escape stream, so a placement here lands in the
  // wrong pane or never arrives.
  if (isMultiplexed(env)) return "glyph";

  const capability = detectImageCapability(env);
  if (!capability.available) return "glyph";

  return capability.renderer === "kitty-native" ||
    capability.renderer === "iterm-inline" ||
    capability.renderer === "sixel"
    ? "graphics"
    : "glyph";
}

export function companionFallbackGlyph(): string {
  return "🦊";
}
