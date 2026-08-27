import { ChartInstalls } from "@/components/analytics/chart-installs";
import { ShareSection } from "@/components/analytics/share-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocsAnalyticsSeries, SeriesPoint } from "@/lib/analytics-series";

/**
 * The over-time half of the page.
 *
 * `daily_rollup` is never pruned, so this history was already being stored
 * while the page showed a single day of it. Nothing new is collected to draw
 * these; the ingest suppresses across the whole window before publishing.
 *
 * Absent when the series endpoint has not been deployed or has no rollups —
 * the snapshot cards above still render on their own.
 */
export function TrendSection({ series }: { readonly series: DocsAnalyticsSeries | null }) {
  if (!series) return null;

  return (
    <div className="flex flex-col gap-4">
      <ChartInstalls points={series.points} from={series.from} to={series.to} />

      <div className="grid gap-4 @4xl/analytics:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ShareSection series={series} />

        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Day by day</CardTitle>
            <CardDescription>
              Every plotted value, as text — the chart’s accessible twin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendTable points={series.points} />
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground m-0 text-xs text-pretty">
        These counts are anonymous and best-effort. Anyone willing to fake pings can inflate them,
        so read them as a pulse rather than a measurement — Kunai deliberately collects no IP or
        identity that would let it prove otherwise.
      </p>
    </div>
  );
}

/**
 * The table twin.
 *
 * Every plotted value is reachable here, so the charts' tooltips enhance rather
 * than gate. It is no longer behind a `<details>`: the charts are now client
 * components, so with JavaScript off this table is the *only* rendering of the
 * data, and a collapsed summary would hide it entirely. It also discharges the
 * light-mode contrast WARN on the pale lifetime band.
 */
function TrendTable({ points }: { readonly points: readonly SeriesPoint[] }) {
  return (
    <div className="max-h-[260px] overflow-y-auto">
      <table className="kunai-chart text-xs">
        <caption className="sr-only">Active and lifetime installs per day</caption>
        <thead className="bg-card sticky top-0">
          <tr>
            <th scope="col" className="text-muted-foreground text-left font-normal">
              Day
            </th>
            <th scope="col" className="text-muted-foreground text-right font-normal">
              Active
            </th>
            <th scope="col" className="text-muted-foreground text-right font-normal">
              Lifetime
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day} className="kunai-chart-row">
              <th scope="row" className="text-foreground text-left font-normal tabular-nums">
                {point.day}
              </th>
              <td className="text-foreground text-right tabular-nums">{point.activeInstalls}</td>
              <td className="text-muted-foreground text-right tabular-nums">
                {point.lifetimeInstalls}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
