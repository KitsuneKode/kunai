import { TrendPlot } from "@/components/analytics/trend-plot";
import { VersionAdoption } from "@/components/analytics/version-adoption";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";

/**
 * The over-time half of the page.
 *
 * `daily_rollup` is never pruned, so this history was already being stored
 * while the page showed a single day of it. Nothing new is collected to draw
 * these; the ingest suppresses across the whole window before publishing.
 *
 * Absent when the series endpoint has not been deployed or has no rollups —
 * the daily snapshot above still renders on its own.
 */
export function TrendSection({ series }: { readonly series: DocsAnalyticsSeries | null }) {
  if (!series) return null;

  const points = series.points;
  const first = points[0];
  const last = points.at(-1);
  const delta = (last?.activeInstalls ?? 0) - (first?.activeInstalls ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Over time</CardTitle>
        <CardDescription>
          {points.length === 1
            ? "One day of history so far — the window fills in as daily rollups accumulate."
            : `${points.length} days, ${series.from} to ${series.to}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h3 className="text-foreground m-0 text-sm font-medium">Active installs</h3>
          <TrendPlot
            points={points}
            caption={
              points.length > 1
                ? `Installs seen on each day, ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)} across the window.`
                : "Installs seen on the only day recorded so far."
            }
          />
          <TrendTable points={points} />
        </section>

        <Separator />

        <section className="flex flex-col gap-3">
          <h3 className="text-foreground m-0 text-sm font-medium">Version share</h3>
          <VersionAdoption series={series} />
        </section>

        <p className="text-muted-foreground m-0 text-xs text-pretty">
          These counts are anonymous and best-effort. Anyone willing to fake pings can inflate them,
          so read them as a pulse rather than a measurement — Kunai deliberately collects no IP or
          identity that would let it prove otherwise.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The table twin.
 *
 * Every plotted value is reachable here, so the plot's tooltips enhance rather
 * than gate. Collapsed by default because it restates the chart — it is the
 * accessible equivalent, not a second reading.
 */
function TrendTable({
  points,
}: {
  readonly points: readonly { day: string; activeInstalls: number }[];
}) {
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
        Table view — {points.length} {points.length === 1 ? "day" : "days"}
      </summary>
      <div className="mt-3 max-h-64 overflow-y-auto">
        <table className="kunai-chart">
          <caption className="sr-only">Active installs per day</caption>
          <thead>
            <tr>
              <th scope="col" className="text-muted-foreground text-left font-normal">
                Day
              </th>
              <th scope="col" className="text-muted-foreground text-right font-normal">
                Active
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
