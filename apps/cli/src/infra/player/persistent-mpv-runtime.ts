import type { fetchRemoteSubtitle } from "@/services/playback/remote-subtitle-download";
import type { checkStremioPlaybackPreflight } from "@/services/playback/stream-health-check";

import type { MpvIpcSession, MpvIpcSessionOptions } from "./mpv-ipc";
import type { waitForMpvIpcEndpoint } from "./mpv-ipc";
import type { createPlaybackOutputGate } from "./playback-output-gate";
import type { createPlaybackWatchdog } from "./playback-watchdog";

export type PersistentMpvSessionRuntime = {
  /** Injectable event source for deterministic playback lifecycle tests. */
  createPlaybackWatchdog?: typeof createPlaybackWatchdog;
  /** Injectable strict addon preflight; production uses checkStremioPlaybackPreflight. */
  checkAddonPreflight?: typeof checkStremioPlaybackPreflight;
  /** Guarded subtitle download seam; production uses fetchRemoteSubtitle. */
  downloadSubtitle?: typeof fetchRemoteSubtitle;
  /** One output gate per playback cycle; tests inject a short decode grace. */
  createPlaybackOutputGate?: typeof createPlaybackOutputGate;
  which(command: string): string | null;
  /** Optional filesystem probe for mpv discovery (flatpak app dirs). Defaults to real fs. */
  exists?(path: string): boolean;
  /** Deterministic clock for cooldown-sensitive recovery logic in tests. */
  now?(): number;
  spawn(
    command: string[],
    options: Parameters<typeof Bun.spawn>[1],
  ): Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;
  waitForIpcEndpoint: typeof waitForMpvIpcEndpoint;
  openIpcSession(options: MpvIpcSessionOptions): Promise<MpvIpcSession>;
};
