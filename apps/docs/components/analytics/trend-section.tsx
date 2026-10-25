import { HowToRead } from "@/components/analytics/how-to-read";
import { TrendSync } from "@/components/analytics/trend-sync";
import { releaseMarkers } from "@/lib/analytics-derive";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";
import { publishedReleaseNotesArtifacts } from "@/lib/release-notes";

/**
 * The over-time half of the page.
 *
 * `daily_rollup` is never pruned, so this history was already being stored
 * while the page showed a single day of it. Nothing new is collected to draw
 * these; the ingest suppresses across the whole window before publishing.
 *
 * Absent when the series endpoint has not been deployed or has no rollups —
 * the snapshot cards above still render on their own.
 *
 * The interactive surface (chart, share cards, day-by-day table) lives in
 * `TrendSync`; this shell stays a server component so the disclaimer and the
 * null check never depend on client state.
 */
export function TrendSection({ series }: { readonly series: DocsAnalyticsSeries | null }) {
  if (!series) return null;

  // Computed on the server so the client chart receives plain data, not the
  // whole generated release-notes bundle.
  const releases = releaseMarkers(
    series.points,
    publishedReleaseNotesArtifacts().map((release) => ({
      date: release.date,
      tag: release.tag,
    })),
  );

  return (
    <div className="flex flex-col gap-4">
      <TrendSync series={series} releases={releases} />

      <p className="text-muted-foreground m-0 text-xs leading-5 text-pretty">
        These counts are anonymous and best-effort. Anyone willing to fake pings can inflate them,
        so read them as a pulse rather than a measurement — Kunai deliberately collects no IP or
        identity that would let it prove otherwise.
      </p>

      <HowToRead series={series} />
    </div>
  );
}
