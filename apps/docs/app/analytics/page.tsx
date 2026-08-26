import { TrendSection } from "@/components/analytics/trend-section";
import { UsagePanel } from "@/components/analytics/usage-panel";
import { fetchDocsAnalyticsMetrics } from "@/lib/analytics-metrics";
import { fetchDocsAnalyticsSeries } from "@/lib/analytics-series";
import { buildPageMetadata } from "@/lib/page-metadata";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai usage analytics — public install pulse by version and OS",
  absoluteTitle: true,
  description:
    "Kunai’s public usage pulse: aggregate install counts by version, OS, and architecture, the exact opt-in ping payload, and the privacy limits that bound it.",
  socialDescription:
    "Public aggregate counts only — never titles, queries, or install UUIDs on this page.",
  path: "/analytics",
});

export default async function AnalyticsPage() {
  // Both are optional: the page renders whichever the endpoints can supply.
  const [metrics, series] = await Promise.all([
    fetchDocsAnalyticsMetrics(),
    fetchDocsAnalyticsSeries(),
  ]);

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-4 border-b pb-8">
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
          Trust surface
        </p>
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Usage analytics</h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-7 text-pretty">
          A quiet public pulse for installs running Kunai — not a growth dashboard. Analytics is
          optional; enable or disable it in Settings.
        </p>
      </header>

      <UsagePanel metrics={metrics} />
      <TrendSection series={series} />
    </main>
  );
}
