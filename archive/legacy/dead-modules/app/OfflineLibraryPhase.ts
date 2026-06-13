import { buildPickerActionContext, openCompletedDownloadsPicker } from "@/app-shell/workflows";
import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";

/** CLI `--offline`: opens the same flow as `/library`; mpv inherits stdio when stdin is a TTY. */
export class OfflineLibraryPhase implements Phase<void, "back"> {
  readonly name = "offline-library";

  async execute(_input: void, context: PhaseContext): Promise<PhaseResult<"back">> {
    await openCompletedDownloadsPicker(
      context.container,
      buildPickerActionContext({ container: context.container, taskLabel: "Offline library" }),
    );
    return { status: "success", value: "back" };
  }
}
