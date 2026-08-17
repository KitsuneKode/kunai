import { fetchDocsAnalyticsMetrics, formatUsageLine } from "@/lib/analytics-metrics";
import Link from "next/link";

/** Quiet home line — hidden entirely when metrics are unavailable. */
export async function UsageLine() {
  const metrics = await fetchDocsAnalyticsMetrics();
  if (!metrics) return null;

  return (
    <p className="text-fd-muted-foreground mt-4 text-xs leading-relaxed">
      {formatUsageLine(metrics)}
      {" · "}
      <Link
        className="hover:text-fd-foreground underline decoration-dotted underline-offset-2"
        href="/telemetry"
      >
        usage analytics
      </Link>
      {" · opt out with /analytics"}
    </p>
  );
}
