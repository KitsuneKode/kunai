import { UsagePanel } from "@/components/analytics/usage-panel";
import { fetchDocsAnalyticsMetrics } from "@/lib/analytics-metrics";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Usage analytics",
  description:
    "See Kunai’s public usage pulse, the exact ping payload, and how the opt-out default works.",
  alternates: {
    canonical: `${docsSiteUrl}/telemetry`,
  },
  openGraph: {
    title: "Kunai usage analytics",
    description:
      "Public aggregate counts only — never titles, queries, or install UUIDs on this page.",
    url: `${docsSiteUrl}/telemetry`,
    type: "website",
    siteName: "Kunai Docs",
  },
};

export default async function TelemetryPage() {
  const metrics = await fetchDocsAnalyticsMetrics();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-4 border-b pb-8">
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
          Trust surface
        </p>
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Usage analytics</h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-7 text-pretty">
          A quiet public pulse for installs running Kunai — not a growth dashboard. Analytics is on
          by default; opt out anytime with <code className="font-mono">/analytics</code>.
        </p>
      </header>

      <UsagePanel metrics={metrics} />
    </main>
  );
}
