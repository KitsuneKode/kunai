export type MpvLaunchErrorKind = "dependency" | "unsafe-target";

/** Typed failures raised before mpv owns playback, so diagnostics keep the real remediation. */
export class MpvLaunchError extends Error {
  override readonly name = "MpvLaunchError";

  constructor(
    readonly kind: MpvLaunchErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export function classifyMpvLaunchError(error: unknown): {
  readonly failureClass: "dependency" | "cancelled" | "unknown";
  readonly hint: string;
} {
  if (error instanceof MpvLaunchError && error.kind === "dependency") {
    return {
      failureClass: "dependency",
      hint: "mpv is required for playback. Install mpv and retry.",
    };
  }
  if (error instanceof MpvLaunchError && error.kind === "unsafe-target") {
    return {
      failureClass: "unknown",
      hint: "Kunai rejected an unsafe playback target. Export Diagnostics and report the issue.",
    };
  }
  return {
    failureClass: "unknown",
    hint: "Run / export-diagnostics and / report-issue if this keeps failing.",
  };
}
