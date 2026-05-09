import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";

/** CLI `--offline`: opens the same flow as `/library`; mpv inherits stdio when stdin is a TTY. */
export class OfflineLibraryPhase implements Phase<void, "back"> {
  readonly name = "offline-library";

  async execute(_input: void, context: PhaseContext): Promise<PhaseResult<"back">> {
    const { openOfflineLibraryShell } = await import("@/app-shell/workflows");
    await openOfflineLibraryShell(context.container, undefined, {
      attachPlaybackStdioToMpv: process.stdin.isTTY,
    });
    return { status: "success", value: "back" };
  }
}
