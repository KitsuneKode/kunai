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

  // Lifetime only ever climbs, so its delta is growth across the whole window;
  // active is a daily flow, so its delta is against yesterday's yesterday.
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
        headline={
          lifetimeDelta && lifetimeDelta.value > 0
            ? `Grew by ${lifetimeDelta.value} this window`
            : "Steady across the window"
        }
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
