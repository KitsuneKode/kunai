import {
  defaultAndroidIntentRuntime,
  resolveAndroidIntentCommand,
  type AndroidIntentRuntime,
} from "@/infra/player/android-intent-launcher";

import type { DoctorFinding } from "./doctor";

/**
 * Whether Kunai can hand a video to a player on this phone. It needs one of
 * Termux's intent launchers; without one, every play fails before the player.
 */
export function androidPlayerHandoffFinding(
  runtime: Pick<AndroidIntentRuntime, "which"> = defaultAndroidIntentRuntime,
): DoctorFinding {
  const command = resolveAndroidIntentCommand({
    target: "chooser",
    url: "https://example.invalid/kunai-doctor-check",
    runtime: { ...defaultAndroidIntentRuntime, which: runtime.which },
  });
  if (command.ok) {
    return {
      severity: "info",
      code: "android-player-handoff",
      message: `Android playback hands videos to VLC or mpv-android through ${command.launcher}.`,
      remediation: [],
    };
  }
  return {
    severity: "warning",
    code: "android-player-handoff-missing",
    message:
      "No Android intent launcher was found, so Kunai cannot hand a video to VLC or mpv-android.",
    remediation: [
      "pkg install termux-am",
      "Install VLC for Android or mpv-android, then run kunai doctor again.",
    ],
  };
}
