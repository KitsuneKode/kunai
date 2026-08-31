import { detectImageCapability } from "@/image";
import { isMultiplexed } from "@/image/capability";

export type CompanionPose = "idle" | "watch" | "go" | "wait";

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

/** Retire the companion entirely. `0`/`false` read as "no pet", not "less pet". */
const OFF_VALUES = new Set(["0", "false", "off", "none"]);
/** Stay on the portable glyph even where a graphics protocol is available. */
const GLYPH_VALUES = new Set(["glyph", "text", "unicode"]);

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
