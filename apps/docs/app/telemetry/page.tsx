import { OptInUsagePanel } from "@/components/telemetry/opt-in-usage-panel";
import { docsSiteUrl } from "@/lib/site";
import { fetchDocsTelemetryMetrics } from "@/lib/telemetry-metrics";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Opt-in telemetry",
  description:
    "See Kunai’s public opt-in usage pulse, the exact ping payload, and how consent stays off by default.",
  alternates: {
    canonical: `${docsSiteUrl}/telemetry`,
  },
  openGraph: {
    title: "Kunai opt-in telemetry",
    description:
      "Public aggregate opt-in counts only — never titles, queries, or install UUIDs on this page.",
    url: `${docsSiteUrl}/telemetry`,
    type: "website",
    siteName: "Kunai Docs",
  },
};

export default async function TelemetryPage() {
  const metrics = await fetchDocsTelemetryMetrics();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-4 border-b pb-8">
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
          Trust surface
        </p>
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Opt-in telemetry</h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-7 text-pretty">
          A quiet public pulse for consented installs — not a growth dashboard. Fresh Kunai profiles
          send nothing until you say yes.
        </p>
      </header>

      <OptInUsagePanel metrics={metrics} />
    </main>
  );
}
