import type { Container } from "@/container";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import { probeInvidiousHealth } from "@/services/youtube/invidious-health";
import { probeYtDlpAsync } from "@/services/ytdlp/YtDlpService";

export type YoutubeDiagnosticsProbe = {
  readonly ytDlp: { readonly available: boolean; readonly version?: string };
  readonly invidious: Awaited<ReturnType<typeof probeInvidiousHealth>>;
};

export async function runYoutubeDiagnosticsProbes(
  container: Container,
): Promise<YoutubeDiagnosticsProbe> {
  const [ytDlp, invidious] = await Promise.all([
    probeYtDlpAsync(),
    probeInvidiousHealth({
      preferredInstanceUrl: container.config.youtubeMetadata.instanceUrl,
    }),
  ]);

  container.diagnosticsService.record({
    category: "runtime",
    operation: "youtube.ytdlp.probe",
    message: ytDlp.available ? `yt-dlp ${ytDlp.version ?? "unknown"}` : "yt-dlp missing",
    context: { ...ytDlp },
  });
  container.diagnosticsService.record({
    category: "provider",
    operation: "youtube.invidious.health",
    message: invidious.ok
      ? `Invidious ${invidious.instance} (${invidious.latencyMs}ms)`
      : `Invidious unhealthy: ${invidious.error ?? "unknown"}`,
    context: { ...invidious },
  });

  return { ytDlp, invidious };
}

export function extractYoutubeProbeFromEvents(
  recentEvents: readonly DiagnosticEvent[],
): YoutubeDiagnosticsProbe | null {
  const ytEvent = recentEvents.find((event) => event.operation === "youtube.ytdlp.probe");
  const invEvent = recentEvents.find((event) => event.operation === "youtube.invidious.health");
  if (!ytEvent && !invEvent) return null;

  const ytContext = ytEvent?.context as
    | { readonly available?: boolean; readonly version?: string }
    | undefined;
  const invContext = invEvent?.context as
    | {
        readonly ok?: boolean;
        readonly instance?: string | null;
        readonly latencyMs?: number | null;
        readonly instanceCount?: number;
        readonly error?: string;
      }
    | undefined;

  return {
    ytDlp: {
      available: ytContext?.available === true,
      version: typeof ytContext?.version === "string" ? ytContext.version : undefined,
    },
    invidious: {
      ok: invContext?.ok === true,
      instance: invContext?.instance ?? null,
      latencyMs: invContext?.latencyMs ?? null,
      instanceCount: invContext?.instanceCount,
      error: invContext?.error,
    },
  };
}

export function formatYoutubeDiagnosticsDetail(probe: YoutubeDiagnosticsProbe): {
  readonly tooling: string;
  readonly invidious: string;
  readonly toolingTone: "success" | "warning" | "neutral";
  readonly invidiousTone: "success" | "warning" | "neutral";
} {
  const tooling = probe.ytDlp.available
    ? `yt-dlp ${probe.ytDlp.version ?? "ready"}`
    : "yt-dlp missing (required for YouTube playback quality + downloads)";
  const invidious = probe.invidious.ok
    ? `${probe.invidious.instance ?? "instance"} · ${probe.invidious.latencyMs ?? "?"}ms · ${probe.invidious.instanceCount ?? 1} available`
    : (probe.invidious.error ?? "Invidious metadata unreachable");
  return {
    tooling,
    invidious,
    toolingTone: probe.ytDlp.available ? "success" : "warning",
    invidiousTone: probe.invidious.ok ? "success" : "warning",
  };
}
