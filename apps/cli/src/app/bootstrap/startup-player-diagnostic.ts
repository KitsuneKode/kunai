import type { PlayerMode } from "@/domain/playback/player-choice";
import { requiredManagedPlayer } from "@/domain/playback/player-choice";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CapabilitySnapshot } from "@/ui";

/**
 * Record the selected-player startup gap once. The shell stays usable without
 * the binary; playback remains gated later, so this is diagnostic evidence, not
 * a fatal startup branch.
 */
export function recordStartupPlayerDiagnostic(input: {
  readonly diagnostics: Pick<DiagnosticsService, "record">;
  readonly playerMode: PlayerMode;
  readonly capabilitySnapshot: CapabilitySnapshot;
}): void {
  const requiredPlayer = requiredManagedPlayer(input.playerMode);
  const missing =
    (requiredPlayer === "mpv" && !input.capabilitySnapshot.mpv) ||
    (requiredPlayer === "vlc" && !input.capabilitySnapshot.vlc);
  if (!requiredPlayer || !missing) return;

  const issueId = `${requiredPlayer}-missing`;
  input.diagnostics.record({
    category: "session",
    operation: `startup.capability.${issueId}`,
    message: `${requiredPlayer} missing at startup — shell will mount; playback remains gated`,
    context: {
      issues: input.capabilitySnapshot.issues
        .filter((issue) => issue.id === issueId)
        .map((issue) => issue.message),
    },
  });
}
