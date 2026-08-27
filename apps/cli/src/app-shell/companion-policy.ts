import { detectImageCapability } from "@/image";
import { isMultiplexed } from "@/image/capability";

const DISABLE_VALUES = new Set(["0", "false"]);

export type CompanionPose = "idle" | "watch" | "go" | "wait";

/**
 * Whether the illustrated fox pet may use a graphics protocol.
 *
 * Half-block is skipped on purpose: this art turns to noise at two pixels per
 * cell. Unicode 🦊 is the floor.
 */
export function isCompanionGraphicsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { readonly isTTY?: boolean } = process.stdout,
): boolean {
  if (DISABLE_VALUES.has(env.KUNAI_PET?.toLowerCase() ?? "")) return false;
  if (DISABLE_VALUES.has(env.KUNAI_POSTER?.toLowerCase() ?? "")) return false;
  if (!stdout.isTTY) return false;
  if (isMultiplexed(env)) return false;

  const capability = detectImageCapability(env);
  if (!capability.available) return false;
  return (
    capability.renderer === "kitty-native" ||
    capability.renderer === "iterm-inline" ||
    capability.renderer === "sixel"
  );
}

export function companionFallbackGlyph(): string {
  return "🦊";
}
