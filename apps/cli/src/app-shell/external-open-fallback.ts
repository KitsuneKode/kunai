import type { ExternalOpenFailureReason, ExternalOpenResult } from "@/infra/os/external-open";

export type ExternalOpenFallback = {
  readonly summary: string;
  readonly explanation: string;
  readonly copyTargets: readonly string[];
};

function explanationFor(reason: ExternalOpenFailureReason, detail?: string): string {
  switch (reason) {
    case "disabled":
      return "External opening is disabled (KUNAI_DISABLE_EXTERNAL_URL).";
    case "unsupported-platform":
      return "No opener is configured for this platform.";
    case "opener-not-found":
      return "Could not find a system opener (xdg-open / open / cmd).";
    case "spawn-failed":
      return detail?.trim()
        ? `Failed to launch the system opener (${detail.trim()}).`
        : "Failed to launch the system opener.";
    case "non-zero-exit":
      return detail?.trim()
        ? `The system opener exited with an error (${detail.trim()}).`
        : "The system opener exited with an error.";
  }
}

function summaryFor(result: Extract<ExternalOpenResult, { ok: false }>): string {
  if (result.target.kind === "path") return "Could not open folder";
  return "Could not open link";
}

function copyTargetsFor(
  result: Extract<ExternalOpenResult, { ok: false }>,
  bundlePath?: string,
): readonly string[] {
  const primary = result.target.kind === "url" ? result.target.url : result.target.path;
  if (bundlePath && bundlePath.trim().length > 0 && bundlePath !== primary) {
    return [primary, bundlePath];
  }
  return [primary];
}

/** Build a concise, copyable fallback for a typed opener failure. */
export function buildExternalOpenFallback(input: {
  readonly result: Extract<ExternalOpenResult, { ok: false }>;
  readonly bundlePath?: string;
}): ExternalOpenFallback {
  const { result, bundlePath } = input;
  return {
    summary: summaryFor(result),
    explanation: explanationFor(result.reason, result.detail),
    copyTargets: copyTargetsFor(result, bundlePath),
  };
}

/** Single-line note for playback feedback / overlay status. */
export function formatExternalOpenFallbackNote(fallback: ExternalOpenFallback): string {
  const copies =
    fallback.copyTargets.length === 1
      ? `Copy: ${fallback.copyTargets[0]}`
      : fallback.copyTargets.map((target, index) => `Copy ${index + 1}: ${target}`).join(" · ");
  return `${fallback.summary}. ${copies}. ${fallback.explanation}`;
}

/** Convenience: format a failure result into a user-facing note. */
export function noteForExternalOpenFailure(
  result: Extract<ExternalOpenResult, { ok: false }>,
  options?: { readonly bundlePath?: string },
): string {
  return formatExternalOpenFallbackNote(
    buildExternalOpenFallback({ result, bundlePath: options?.bundlePath }),
  );
}
