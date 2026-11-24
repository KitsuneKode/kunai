import type { checkStremioPlaybackPreflight } from "@/services/playback/stream-health-check";
import type { fetchStremioSubtitle } from "@/services/playback/stremio-subtitle-download";

import type { MpvIpcSession, MpvIpcSessionOptions } from "./mpv-ipc";
import type { waitForMpvIpcEndpoint } from "./mpv-ipc";
import type { createPlaybackWatchdog } from "./playback-watchdog";

export type PersistentMpvSessionRuntime = {
  /** Injectable event source for deterministic playback lifecycle tests. */
  createPlaybackWatchdog?: typeof createPlaybackWatchdog;
  /** Injectable strict addon preflight; production uses checkStremioPlaybackPreflight. */
  checkAddonPreflight?: typeof checkStremioPlaybackPreflight;
  /** Guarded subtitle download seam; production uses fetchStremioSubtitle. */
  downloadAddonSubtitle?: typeof fetchStremioSubtitle;
  which(command: string): string | null;
  /** Optional filesystem probe for mpv discovery (flatpak app dirs). Defaults to real fs. */
  exists?(path: string): boolean;
  spawn(
    command: string[],
    options: Parameters<typeof Bun.spawn>[1],
  ): Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;
  waitForIpcEndpoint: typeof waitForMpvIpcEndpoint;
  openIpcSession(options: MpvIpcSessionOptions): Promise<MpvIpcSession>;
};
