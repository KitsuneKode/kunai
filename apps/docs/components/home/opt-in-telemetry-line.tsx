import { fetchDocsTelemetryMetrics, formatOptInTelemetryLine } from "@/lib/telemetry-metrics";
import Link from "next/link";

/** Quiet home line — hidden entirely when metrics are unavailable. */
export async function OptInTelemetryLine() {
  const metrics = await fetchDocsTelemetryMetrics();
  if (!metrics) return null;

  return (
    <p className="text-fd-muted-foreground mt-4 text-xs leading-relaxed">
      {formatOptInTelemetryLine(metrics)}
      {" · "}
      <Link
        className="hover:text-fd-foreground underline decoration-dotted underline-offset-2"
        href="/telemetry"
      >
        opt-in pulse
      </Link>
      {" · lifetime is approximate"}
    </p>
  );
}
