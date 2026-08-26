import type { SeriesPoint } from "@/lib/analytics-series";

/**
 * Active installs over time.
 *
 * One series, so no legend box — the caption names it. The line carries the
 * shape, the endpoint is the only marked point, and every value is also in the
 * table below: the SVG `<title>` tooltips enhance, they never gate a value.
 *
 * Server-rendered on purpose. The analytics page is static ISR, so the plot
 * ships as markup rather than waiting on a client chart runtime.
 */

const VIEW_W = 720;
const VIEW_H = 180;
const PAD_L = 8;
// Endpoint marker is r=4 with a 2px ring, so the right pad must clear 6px.
const PAD_R = 12;
const PAD_T = 12;
// Leaves room for the x-axis band so the card never grows a nested scrollbar.
const PAD_B = 22;

type Props = {
  readonly points: readonly SeriesPoint[];
  readonly caption: string;
};

function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function TrendPlot({ points, caption }: Props) {
  if (points.length === 0) return null;

  const max = niceCeiling(Math.max(...points.map((p) => p.activeInstalls), 1));
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  // A single day has no width to span; anchor it mid-plot rather than at x=0,
  // where the marker would sit half outside the axis.
  const x = (i: number) =>
    points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.activeInstalls)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)},${PAD_T + plotH} L${x(0)},${PAD_T + plotH} Z`;
  const last = points.at(-1);
  const titleId = "kunai-trend-plot-title";

  return (
    <figure className="flex flex-col gap-3">
      <svg className="kunai-plot" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-labelledby={titleId}>
        {/* Named by its own <title>: the accessible name lives in the SVG,
            which screen readers announce without a role override. */}
        <title id={titleId}>{caption}</title>
        {points.length > 1 ? <path className="kunai-plot-area" d={area} /> : null}
        <path className="kunai-plot-line" d={line} />
        {last ? (
          <circle
            className="kunai-plot-endpoint"
            cx={x(points.length - 1)}
            cy={y(last.activeInstalls)}
            r={4}
          />
        ) : null}
        {/* Baseline last so it sits above the area fill. */}
        <path className="kunai-plot-axis" d={`M${PAD_L},${PAD_T + plotH} H${VIEW_W - PAD_R}`} />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.activeInstalls)} r={12} fill="transparent">
            <title>{`${p.day}: ${p.activeInstalls} active`}</title>
          </circle>
        ))}
      </svg>
      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{points[0]?.day}</span>
        <span>{last?.day}</span>
      </div>
      <figcaption className="text-muted-foreground text-xs">
        {caption} Peak {max === 4 ? Math.max(...points.map((p) => p.activeInstalls)) : max} on this
        axis.
      </figcaption>
    </figure>
  );
}
