import type { MpvIpcSession, MpvIpcSessionOptions } from "./mpv-ipc";
import type { waitForMpvIpcEndpoint } from "./mpv-ipc";

export type PersistentMpvSessionRuntime = {
  which(command: string): string | null;
  spawn(
    command: string[],
    options: Parameters<typeof Bun.spawn>[1],
  ): Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;
  waitForIpcEndpoint: typeof waitForMpvIpcEndpoint;
  openIpcSession(options: MpvIpcSessionOptions): Promise<MpvIpcSession>;
};
