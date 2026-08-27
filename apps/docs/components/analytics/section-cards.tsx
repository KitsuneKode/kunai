import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  delta,
  type Delta,
  namedVersionCount,
  residualShare,
  type TrendDirection,
} from "@/lib/analytics-derive";
import type { DocsAnalyticsMetrics } from "@/lib/analytics-metrics";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";
import { IconMinus, IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";

/**
 * The four figures the page leads with.
 *
 * dashboard-01's section-cards chrome, but not its editorial: a growth
 * dashboard's fourth tile is a growth rate, and this page is a trust surface
 * with seven lifetime installs. The fourth tile here names the small-cell floor
 * instead — at this population it is the single fact shaping everything below
 * it, and stating it is more honest than inventing a percentage.
 *
 * Every figure is `tabular-nums`: these numbers change on each ISR revalidate
 * and proportional digits would shift the card width under them.
 */

const TREND_ICON: Readonly<Record<TrendDirection, typeof IconTrendingUp>> = {
  up: IconTrendingUp,
  down: IconTrendingDown,
  flat: IconMinus,
};

function StatCard({
  label,
  value,
  badge,
  headline,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly badge?: { readonly text: string; readonly direction: TrendDirection };
  readonly headline: string;
  readonly detail: string;
}) {
  const TrendIcon = badge ? TREND_ICON[badge.direction] : null;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {/*
          `font-sans` overrides the card heading face on purpose. `--font-heading`
          is the display serif, and a serif numeral at tile size reads as
          ornament rather than as a figure you can compare across four cards —
          the same call the page's original hero figure documented. Tabular so
          the four tiles keep their column widths when the counts change.
        */}
        <CardTitle className="font-sans text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        {badge ? (
          <CardAction>
            <Badge variant="outline" className="tabular-nums">
              {TrendIcon ? <TrendIcon stroke={1.5} /> : null}
              {badge.text}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">
          {headline}
          {TrendIcon ? <TrendIcon className="size-4" stroke={1.5} /> : null}
        </div>
        <div className="text-muted-foreground">{detail}</div>
      </CardFooter>
    </Card>
  );
}

/**
 * Copy for the lifetime tile, which must cover a FALL.
 *
 * A retention-adjusted drop renders a `-3` badge with a downward arrow; pairing
 * that with "Steady across the window" would have the tile contradict itself.
 */
function lifetimeHeadline(lifetime: Delta | null): string {
  if (!lifetime || lifetime.value === 0) return "Steady across the window";
  if (lifetime.value > 0) return `Grew by ${lifetime.value} this window`;
  return `Fell by ${Math.abs(lifetime.value)} as retired installs were pruned`;
}

export function SectionCards({
  metrics,
  series,
}: {
  readonly metrics: DocsAnalyticsMetrics | null;
  readonly series: DocsAnalyticsSeries | null;
}) {
  if (!metrics) return null;

  const points = series?.points ?? [];
  const first = points[0];
  const previous = points.at(-2);

  // Lifetime is a running total, so its delta spans the whole window; active is
  // a daily flow, so its delta is against the previous day.
  //
  // Lifetime is NOT monotonic: the ingest retention-adjusts it when
  // `lifetime_retired` absorbs pruned installs, so it can fall. A drop is
  // correct data, not a bug, and the copy below has to be able to say so —
  // see .docs/analytics-privacy-contract.md.
  const lifetimeDelta = first ? delta(metrics.lifetimeInstalls, first.lifetimeInstalls) : null;
  const activeDelta = previous ? delta(metrics.activeInstalls, previous.activeInstalls) : null;

  const suppressed = residualShare(metrics.byVersion);
  const named = namedVersionCount(points);

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs @xl/analytics:grid-cols-2 @5xl/analytics:grid-cols-4">
      <StatCard
        label="Lifetime installs"
        value={metrics.lifetimeInstalls.toLocaleString("en-US")}
        badge={
          lifetimeDelta
            ? { text: lifetimeDelta.label, direction: lifetimeDelta.direction }
            : undefined
        }
        headline={lifetimeHeadline(lifetimeDelta)}
        detail="Exact — one hashed row per install"
      />
      <StatCard
        label="Active yesterday"
        value={metrics.activeInstalls.toLocaleString("en-US")}
        badge={
          activeDelta ? { text: activeDelta.label, direction: activeDelta.direction } : undefined
        }
        headline={`Distinct installs on ${metrics.day}`}
        detail="A ping is one install, once a day"
      />
      <StatCard
        label="Reporting window"
        value={points.length > 0 ? `${points.length} days` : "—"}
        headline={series ? `${series.from} → ${series.to}` : "History not published yet"}
        detail="Daily rollups, never pruned"
      />
      <StatCard
        label="Below the floor"
        value={`${Math.round(suppressed * 100)}%`}
        badge={suppressed >= 1 ? { text: "all buckets", direction: "flat" } : undefined}
        headline={
          named > 0
            ? `${named} ${named === 1 ? "version" : "versions"} clear the floor`
            : "Every bucket folds into other"
        }
        detail="Groups under 5 installs are not reported"
      />
    </div>
  );
}
