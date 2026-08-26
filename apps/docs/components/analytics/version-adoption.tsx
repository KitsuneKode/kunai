import {
  dayOffsets,
  isFullySuppressed,
  MAX_VERSION_BANDS,
  RESIDUAL_LABEL,
  versionBands,
  type DocsAnalyticsSeries,
} from "@/lib/analytics-series";

/**
 * Version share over time — does a release actually propagate?
 *
 * Bands stack oldest at the bottom, newest on top, colored by the ordinal ramp
 * so the release order is visible in the color rather than only in the legend.
 * Share, not counts: the question is what fraction has moved, and a count chart
 * answers "how many installs" instead.
 *
 * With a small population every bucket sits under the small-cell floor and the
 * whole chart is residual. That is suppression working, not a broken chart, so
 * this says so in words instead of drawing one grey band.
 */

const VIEW_W = 720;
const VIEW_H = 200;
const PAD_L = 8;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

type Props = {
  readonly series: DocsAnalyticsSeries;
};

export function VersionAdoption({ series }: Props) {
  const bands = versionBands(series);
  const suppressed = isFullySuppressed(series);

  if (suppressed) {
    return (
      <p className="text-muted-foreground text-sm">
        Every version bucket is below the five-install reporting floor, so the whole window folds
        into <span className="text-foreground font-medium">other</span>. Version share appears here
        once a release is running on enough machines to publish without identifying anyone.
      </p>
    );
  }

  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;
  const offsets = dayOffsets(series.points.map((p) => p.day));
  const x = (i: number) => PAD_L + (offsets[i] ?? 0) * plotW;

  // Bottom-up: residual first, then oldest to newest.
  const stackOrder = [RESIDUAL_LABEL, ...bands];

  const dayShares = series.points.map((point) => {
    const total = Object.values(point.byVersion).reduce((sum, n) => sum + n, 0);
    const named = bands.reduce((sum, b) => sum + (point.byVersion[b] ?? 0), 0);
    const residual = Math.max(0, total - named);
    const shares = new Map<string, number>();
    if (total > 0) {
      shares.set(RESIDUAL_LABEL, residual / total);
      for (const b of bands) shares.set(b, (point.byVersion[b] ?? 0) / total);
    }
    return shares;
  });

  const bandPath = (bucket: string, index: number): string => {
    const below = stackOrder.slice(0, index);
    const top: string[] = [];
    const bottom: string[] = [];
    series.points.forEach((_, i) => {
      const base = below.reduce((sum, b) => sum + (dayShares[i]?.get(b) ?? 0), 0);
      const value = dayShares[i]?.get(bucket) ?? 0;
      const yBase = PAD_T + plotH - base * plotH;
      const yTop = PAD_T + plotH - (base + value) * plotH;
      top.push(`${i === 0 ? "M" : "L"}${x(i)},${yTop}`);
      bottom.unshift(`L${x(i)},${yBase}`);
    });
    // A single day has no span, so give the band a visible column.
    if (series.points.length === 1) {
      const base = below.reduce((sum, b) => sum + (dayShares[0]?.get(b) ?? 0), 0);
      const value = dayShares[0]?.get(bucket) ?? 0;
      const yBase = PAD_T + plotH - base * plotH;
      const yTop = PAD_T + plotH - (base + value) * plotH;
      const half = Math.min(40, plotW / 4);
      const cx = PAD_L + plotW / 2;
      return `M${cx - half},${yTop} L${cx + half},${yTop} L${cx + half},${yBase} L${cx - half},${yBase} Z`;
    }
    return `${top.join(" ")} ${bottom.join(" ")} Z`;
  };

  const titleId = "kunai-version-adoption-title";
  const latest = series.points.at(-1);
  const latestShares = dayShares.at(-1);

  return (
    <figure className="flex flex-col gap-3">
      <svg className="kunai-plot" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-labelledby={titleId}>
        <title id={titleId}>
          {`Share of active installs by version, ${series.from} to ${series.to}`}
        </title>
        {stackOrder.map((bucket, index) => {
          const residual = bucket === RESIDUAL_LABEL;
          // Band 1 is the oldest published version; the residual has no slot.
          const slot = residual ? undefined : String(Math.min(index, MAX_VERSION_BANDS));
          const share = latestShares?.get(bucket) ?? 0;
          return (
            <path
              key={bucket}
              className="kunai-plot-band"
              data-band={slot}
              data-residual={residual ? "true" : undefined}
              d={bandPath(bucket, index)}
            >
              <title>{`${bucket}: ${Math.round(share * 100)}% on ${latest?.day}`}</title>
            </path>
          );
        })}
        <path className="kunai-plot-axis" d={`M${PAD_L},${PAD_T + plotH} H${VIEW_W - PAD_R}`} />
      </svg>

      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{series.from}</span>
        <span>{series.to}</span>
      </div>

      {/* Identity is never colour alone: a legend is always present for >= 2 bands. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {[...stackOrder].reverse().map((bucket) => {
          const residual = bucket === RESIDUAL_LABEL;
          const index = stackOrder.indexOf(bucket);
          const slot = residual ? undefined : String(Math.min(index, MAX_VERSION_BANDS));
          return (
            <li key={bucket} className="flex items-center gap-1.5">
              <span
                className="kunai-legend-swatch"
                data-band={slot}
                data-residual={residual ? "true" : undefined}
                aria-hidden="true"
              />
              <span className={residual ? "text-muted-foreground" : "text-foreground"}>
                {bucket}
              </span>
            </li>
          );
        })}
      </ul>

      <figcaption className="text-muted-foreground text-xs">
        Share of active installs by version. Bands stack oldest to newest; buckets under the
        five-install floor fold into <span className="text-foreground">other</span>.
      </figcaption>
    </figure>
  );
}
